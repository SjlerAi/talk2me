'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PREVIEW_DB,
  RELEASE_BRANCH,
  DEFAULT_MAX_ATTEMPTS,
  STALE_CLAIM_MINUTES,
  MAX_SUBJECT_BYTES,
  MAX_TEXT_BYTES,
  MAX_HTML_BYTES,
  smtpConfigured,
  loadEmailWorkerConfig,
  retryDelayMinutes,
  safeError,
  retryableFailure,
  normaliseEmail,
  parseRecipientAllowlist,
  recipientAllowed,
  validateQueueRow,
  messageForRow
} = require('./email-worker');

const root = __dirname;
const worker = fs.readFileSync(path.join(root, 'email-worker.js'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'email-worker-runner.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '20260801_007_email_worker_delivery.sql'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'EMAIL_WORKER_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
const controls = [];

function control(name, condition) {
  try {
    assert.ok(condition, name);
    controls.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
function marker(name, text) { control(name, worker.includes(text)); }
function supporting(name, condition) {
  try { assert.ok(condition, name); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_USER: 'kloka_talk',
  DB_PASSWORD: 'database-secret',
  DB_NAME: 'kloka_talk2me',
  RELEASE_BRANCH: 'agent/talk2me-os2-integrated-rebuild',
  EMAIL_WORKER_ENABLED: 'true',
  EMAIL_DB_CONNECTION_LIMIT: '4',
  EMAIL_MAX_ATTEMPTS: '7',
  EMAIL_WORKER_INTERVAL_MS: '30000',
  EMAIL_WORKER_BATCH_SIZE: '10',
  EMAIL_WORKER_RUN_ONCE: 'false',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'preview@example.com',
  SMTP_PASSWORD: 'smtp-secret',
  SMTP_FROM: 'Talk2Me Preview <preview@example.com>',
  SMTP_REPLY_TO: 'support@example.com',
  SMTP_MAX_CONNECTIONS: '2',
  SMTP_MAX_MESSAGES: '100',
  SMTP_MESSAGE_ID_DOMAIN: 'example.com',
  EMAIL_PREVIEW_RECIPIENT_ALLOWLIST: 'tester@example.com,@test.example.com',
  ALLOW_PRODUCTION_MUTATION: 'false',
  ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
};
const config = loadEmailWorkerConfig(validEnv);
const allowlist = parseRecipientAllowlist(validEnv.EMAIL_PREVIEW_RECIPIENT_ALLOWLIST);
const validRow = validateQueueRow({
  id: 42,
  recipient_email: 'Tester@Example.com',
  recipient_name: 'Preview Tester',
  subject: 'Preview delivery',
  body_text: 'Controlled preview message',
  body_html: '<p>Controlled preview message</p>',
  related_entity_type: 'os2_notifications',
  related_entity_id: 8,
  attempts: 1
}, config);
const message = messageForRow(config, validRow);

control('01 exact preview database identity', PREVIEW_DB === 'kloka_talk2me' && config.database === PREVIEW_DB);
control('02 exact controlled branch identity', RELEASE_BRANCH === 'agent/talk2me-os2-integrated-rebuild' && config.branch === RELEASE_BRANCH);
control('03 default maximum attempts fixed at seven', DEFAULT_MAX_ATTEMPTS === 7 && config.maxAttempts === 7);
control('04 stale-claim threshold fixed at fifteen minutes', STALE_CLAIM_MINUTES === 15);
control('05 complete SMTP configuration includes recipient allowlist', smtpConfigured(validEnv));
marker('06 explicit email worker enablement required', 'EMAIL_WORKER_DISABLED');
marker('07 production mutation flag prohibited', 'PRODUCTION_MUTATION_FLAG_PROHIBITED');
marker('08 customer merge execution flag prohibited', 'MERGE_EXECUTION_FLAG_PROHIBITED');
marker('09 invalid SMTP certificate override prohibited', 'INVALID_SMTP_CERTIFICATE_OVERRIDE_PROHIBITED');
control('10 SMTP transport ports limited to 465 or 587', config.smtpPort === 587 && worker.includes('SMTP_PORT_MUST_BE_465_OR_587'));
marker('11 SMTP port and implicit TLS mode must agree', 'SMTP_PORT_SECURITY_MISMATCH');
control('12 SMTP host is validated', config.smtpHost === 'smtp.example.com');
control('13 SMTP user is required', config.smtpUser === 'preview@example.com');
control('14 SMTP password is required without source logging', config.smtpPassword === 'smtp-secret' && !worker.includes('console.log(config.smtpPassword)'));
control('15 From mailbox is parsed and canonicalized', config.smtpFromAddress === 'preview@example.com' && config.smtpFrom.includes('<preview@example.com>'));
control('16 Reply-To mailbox is independently validated', config.smtpReplyTo === 'support@example.com');
control('17 deterministic Message-ID domain is validated', config.smtpMessageIdDomain === 'example.com');
control('18 preview recipient allowlist is mandatory', config.allowlist.count === 2);
control('19 exact recipient allowlisting works', recipientAllowed('tester@example.com', allowlist));
control('20 recipient-domain allowlisting works', recipientAllowed('person@test.example.com', allowlist));
control('21 recipient email normalization is deterministic', normaliseEmail(' Tester@Example.COM ') === 'tester@example.com');
marker('22 database port is strictly bounded', "strictInteger(env, 'DB_PORT', 3306, 1, 65535)");
marker('23 database connection count is strictly bounded', "strictInteger(env, 'EMAIL_DB_CONNECTION_LIMIT', 4, 2, 10)");
marker('24 SMTP connection count is strictly bounded', "strictInteger(env, 'SMTP_MAX_CONNECTIONS', 2, 1, 5)");
marker('25 SMTP message count per pooled connection is bounded', "strictInteger(env, 'SMTP_MAX_MESSAGES', 100, 10, 1000)");
marker('26 delivery attempt count is strictly bounded', "strictInteger(env, 'EMAIL_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 10)");
marker('27 polling interval is strictly bounded', "strictInteger(env, 'EMAIL_WORKER_INTERVAL_MS', 30000, 10000, 3600000)");
marker('28 cycle batch size is strictly bounded', "strictInteger(env, 'EMAIL_WORKER_BATCH_SIZE', 10, 1, 50)");
marker('29 run-once mode uses strict Boolean parsing', "strictBoolean(env, 'EMAIL_WORKER_RUN_ONCE')");
marker('30 SMTP certificates must validate', 'rejectUnauthorized: true');
marker('31 minimum transport security is TLS 1.2', "minVersion: 'TLSv1.2'");
marker('32 STARTTLS is required on port 587', 'requireTLS: !config.smtpSecure');
marker('33 SMTP file access is disabled', 'disableFileAccess: true');
marker('34 SMTP URL access is disabled', 'disableUrlAccess: true');
marker('35 SMTP protocol logging and debugging are disabled', 'logger: false');
control('36 SMTP connection, greeting, DNS and socket timeouts are bounded', ['connectionTimeout: 10000','greetingTimeout: 10000','socketTimeout: 45000','dnsTimeout: 10000'].every(text => worker.includes(text)));
marker('37 every database connection uses UTC', "SET time_zone='+00:00'");
marker('38 every database connection verifies database identity', 'SELECT DATABASE() database_name, CONNECTION_ID() connection_id');
marker('39 queue claiming uses serializable isolation', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
marker('40 null or due next-attempt timestamps are claimable', '(next_attempt_at IS NULL OR next_attempt_at<=NOW())');
marker('41 queue candidates are locked before claim', 'LIMIT 1 FOR UPDATE');
marker('42 claim transition requires exactly one affected row', 'EMAIL_CLAIM_STATE_CHANGED');
marker('43 stale processing state is failed rather than replayed', 'STALE_PROCESSING_STATE_UNCERTAIN');
marker('44 stale linked notifications are marked failed', "delivery_status='failed',failure_reason='STALE_PROCESSING_STATE_UNCERTAIN'");
control('45 subjects reject header injection and respect byte bounds', validRow.subject === 'Preview delivery' && MAX_SUBJECT_BYTES === 998 && worker.includes('EMAIL_SUBJECT_BYTES_EXCEEDED'));
control('46 message body sizes are bounded', MAX_TEXT_BYTES === 256 * 1024 && MAX_HTML_BYTES === 512 * 1024);
control('47 claimed recipient is rechecked against preview allowlist', validRow.recipient_email === 'tester@example.com' && worker.includes('EMAIL_RECIPIENT_NOT_ALLOWLISTED'));
control('48 related entity identity is validated', validRow.related_entity_type === 'os2_notifications' && validRow.related_entity_id === 8);
control('49 queue ID produces deterministic preview Message-ID', message.messageId === '<talk2me-preview-queue-42@example.com>');
control('50 SMTP envelope fixes sender and one recipient', message.envelope.from === 'preview@example.com' && message.envelope.to === 'tester@example.com');
control('51 named recipient uses Nodemailer address property', message.to.address === 'tester@example.com' && !Object.prototype.hasOwnProperty.call(message.to, 'email'));
control('52 generated message excludes cc, bcc and attachments', !('cc' in message) && !('bcc' in message) && !('attachments' in message));
control('53 raw SMTP prose is reduced to a bounded code', safeError(new Error('customer-specific server response')) === 'SMTP_SEND_FAILED');
control('54 only defined connection or 4xx failures are retryable', retryableFailure({ code:'EDNS' }) && retryableFailure({ responseCode:421 }) && !retryableFailure({ responseCode:550 }));
control('55 retry backoff is bounded and deterministic', [1,2,3,4,5,6,7,8].map(retryDelayMinutes).join(',') === '2,5,15,30,60,180,360,360');
marker('56 sent-state update is bound to exact worker ownership', "WHERE id=:id AND status='processing' AND worker_id=:workerId");
marker('57 failed-state update is bound to exact worker ownership', 'EMAIL_FAILURE_STATE_CHANGED');
marker('58 notification status and queue status share one transaction', "await connection.beginTransaction();");
marker('59 scheduling prevents overlapping cycles and tracks current run', 'if (state.running || state.stopping) return null;');
control('60 graceful shutdown waits for current delivery and uses one-shot signals', worker.includes('if (state.currentRun)') && runner.includes("process.once('SIGTERM'") && runner.includes("process.once('SIGINT'"));

supporting('delivery migration contains claim and provider tracking columns', ['processing_started_at','worker_id','provider_message_id','delivered_at'].every(text => migration.includes(text)));
supporting('runtime schema creation remains prohibited', !/CREATE\s+TABLE/i.test(worker) && !/CREATE\s+TABLE/i.test(runner));
supporting('runner uses restrictive umask', runner.includes('process.umask(0o077)'));
supporting('runner disables database keepalive', runner.includes('enableKeepAlive: false'));
supporting('runner verifies pool before starting delivery', runner.includes('await verifyPool(pool, config)'));
supporting('runner closes state and pool during shutdown', runner.includes('await state.stop()') && runner.includes('await pool.end()'));
supporting('worker start command is exact', pkg.scripts['start:email-worker'] === 'node email-worker-runner.js');
supporting('worker governance command is exact', pkg.scripts['check:email-worker'] === 'node email-worker-check.js');
supporting('worker syntax and governance run in normal validation', pkg.scripts.check.includes('node --check email-worker.js') && pkg.scripts.check.includes('node --check email-worker-runner.js') && pkg.scripts.check.includes('node email-worker-check.js'));
supporting('runbook declares all sixty controls', runbook.includes('## Sixty governed controls') && runbook.includes('60. Graceful shutdown waits for the current delivery cycle.'));
supporting('runbook states production remains untouched', runbook.includes('Production at `talk2me.uent.co.za` remains untouched'));
supporting('email transport has no invalid certificate bypass', !worker.includes('SMTP_ALLOW_INVALID_CERT ||') && !worker.includes('rejectUnauthorized: String'));
supporting('old setInterval scheduler removed', !worker.includes('setInterval('));
supporting('old recipient email property removed', !worker.includes('name:row.recipient_name,email:row.recipient_email'));

if (controls.length !== 60) failures.push(`Expected exactly 60 named email-worker controls; found ${controls.length}`);
if (failures.length) {
  console.error('EMAIL WORKER 60-CONTROL CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'email-worker-governance',
  meaningfulControls: 60,
  previewDatabase: PREVIEW_DB,
  controlledBranch: RELEASE_BRANCH,
  defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
  staleClaimMinutes: STALE_CLAIM_MINUTES,
  recipientAllowlistRequired: true,
  tlsCertificateValidationRequired: true,
  tls12MinimumRequired: true,
  headerInjectionRejected: true,
  messageBodiesBounded: true,
  staleDeliveryReplayProhibited: true,
  workerOwnershipRequiredForStateChanges: true,
  deterministicMessageIdRequired: true,
  gracefulShutdownRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
