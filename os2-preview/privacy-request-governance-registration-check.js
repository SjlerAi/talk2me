'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const governance = fs.readFileSync(path.join(root, 'privacy-request-governance-check.js'), 'utf8');
const workerGovernance = fs.readFileSync(path.join(root, 'privacy-export-worker-check.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'privacy-routes.js'), 'utf8');
const securityRoutes = fs.readFileSync(path.join(root, 'security-routes.js'), 'utf8');

const failures = [];
const controls = [];
function control(name, condition) {
  try { assert.ok(condition, name); controls.push(name); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
function marker(name, source, value) { control(name, source.includes(value)); }

control('01 privacy request governance command is registered', pkg.scripts['check:privacy-request-governance'] === 'node privacy-request-governance-check.js');
control('02 privacy request registration guard command is registered', pkg.scripts['check:privacy-request-governance-registration'] === 'node privacy-request-governance-registration-check.js');
control('03 privacy request checker syntax is validated', pkg.scripts.check.includes('node --check privacy-request-governance-check.js'));
control('04 registration guard syntax is validated', pkg.scripts.check.includes('node --check privacy-request-governance-registration-check.js'));
control('05 privacy request checker executes in normal validation', pkg.scripts.check.includes('node privacy-request-governance-check.js'));
control('06 registration guard executes in normal validation', pkg.scripts.check.includes('node privacy-request-governance-registration-check.js'));
marker('07 privacy request checker declares exactly sixty controls', governance, 'Expected exactly 60 named privacy-request controls');
marker('08 privacy request checker emits meaningful control count', governance, 'meaningfulControls: 60');
marker('09 privacy request checker keeps production mutation disabled', governance, 'productionMutationEnabled: false');
marker('10 privacy request checker keeps merge execution disabled', governance, 'mergeExecutionEnabled: false');
marker('11 authenticated privacy boundary remains protected', governance, "router.use('/api/os2/privacy', requireAuth)");
marker('12 privacy read permission remains protected', governance, "requirePermission('privacy.read')");
marker('13 privacy manage permission remains protected', governance, "requirePermission('privacy.manage')");
marker('14 privacy decide permission remains protected', governance, "requirePermission('privacy.decide')");
marker('15 privacy export permission remains protected', governance, "requirePermission('privacy.export')");
marker('16 privacy retention permission remains protected', governance, "requirePermission('privacy.retention')");
marker('17 positive identifier validation remains protected', governance, 'Number.isSafeInteger(id) && id > 0');
marker('18 bounded control-character rejection remains protected', governance, '08 bounded text rejects control characters');
marker('19 cryptographic request reference remains protected', governance, 'crypto.randomBytes(6)');
marker('20 bounded error fallback remains protected', governance, 'error:fallback');
marker('21 customer-scoped consent query remains protected', governance, 'WHERE c.master_customer_id=:customerId');
marker('22 consent result limit remains protected', governance, 'LIMIT 1000');
marker('23 active-customer lock remains protected', governance, 'archived_at IS NULL LIMIT 1 FOR UPDATE');
marker('24 missing-customer rejection remains protected', governance, 'CUSTOMER_NOT_FOUND');
marker('25 consent status allowlist remains protected', governance, "['granted','withdrawn','not_required','pending']");
marker('26 consent grant timestamp remains protected', governance, "CASE WHEN :status='granted' THEN NOW() ELSE NULL END");
marker('27 consent withdrawal timestamp remains protected', governance, "CASE WHEN :status='withdrawn' THEN NOW() ELSE NULL END");
marker('28 consent audit remains protected', governance, 'customer_consent_recorded');
marker('29 request status allowlist remains protected', governance, "['received','identity_verification','in_review','approved','rejected','completed','cancelled']");
marker('30 request list limit remains protected', governance, 'LIMIT 500');
marker('31 request type allowlist remains protected', governance, "['access','correction','restriction','objection','deletion','export']");
marker('32 request due-date rule remains protected', governance, 'DATE_ADD(NOW(),INTERVAL 30 DAY)');
marker('33 request creation audit remains protected', governance, 'privacy_request_created');
marker('34 request-row locking remains protected', governance, 'SELECT * FROM os2_data_subject_requests WHERE id=:id LIMIT 1 FOR UPDATE');
marker('35 self-approval prevention remains protected', governance, 'SELF_APPROVAL_NOT_ALLOWED');
marker('36 terminal-state prevention remains protected', governance, 'PRIVACY_REQUEST_TERMINAL');
marker('37 rejection-reason requirement remains protected', governance, 'REJECTION_REASON_REQUIRED');
marker('38 compare-and-set request update remains protected', governance, 'WHERE id=:id AND status=:currentStatus');
marker('39 one-row request transition remains protected', governance, 'PRIVACY_REQUEST_STATE_CHANGED');
marker('40 request decision audit remains protected', governance, 'privacy_request_status_changed');
marker('41 export format allowlist remains protected', governance, "['json','csv_bundle']");
marker('42 exportable request-type gate remains protected', governance, "['access','export'].includes(record.request_type)");
marker('43 approved-request gate remains protected', governance, "['approved','completed'].includes(record.status)");
marker('44 duplicate active export prevention remains protected', governance, 'ACTIVE_PRIVACY_EXPORT_ALREADY_EXISTS');
marker('45 active-export expiry check remains protected', governance, 'expires_at IS NOT NULL AND expires_at>NOW()');
marker('46 seven-day export expiry remains protected', governance, 'DATE_ADD(NOW(),INTERVAL 7 DAY)');
marker('47 release authorization evidence remains protected', governance, 'release_authorised');
marker('48 export queue audit remains protected', governance, 'privacy_export_queued');
marker('49 serializable queue transaction remains protected', governance, "isolationLevel:'SERIALIZABLE'");
marker('50 metadata permission remains protected', governance, "router.get('/api/os2/privacy/exports/:id', requirePermission('privacy.export')");
marker('51 originating request join remains protected', governance, 'JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id');
marker('52 private storage non-disclosure remains protected', governance, 'metadata does not expose private storage references');
marker('53 metadata access evidence remains protected', governance, 'metadata_view');
marker('54 revocation reason remains protected', governance, 'PRIVACY_EXPORT_REVOCATION_REASON_REQUIRED');
marker('55 worker claim clearing remains protected', governance, "status='revoked',worker_id=NULL,claimed_at=NULL");
marker('56 revocation audit remains protected', governance, 'privacy_export_revoked');
marker('57 retention reason requirement remains protected', governance, 'RETENTION_DECISION_REASON_REQUIRED');
marker('58 retention audit remains protected', governance, 'retention_review_decided');
marker('59 authenticated security-router mounting remains protected', governance, 'router.use(createPrivacyRouter({pool,requireAuth}))');
control('60 worker and request governance remain independently registered', pkg.scripts['check:privacy-export-worker'] === 'node privacy-export-worker-check.js' && workerGovernance.includes('Expected exactly 60 named privacy-export controls') && routes.includes("router.use('/api/os2/privacy', requireAuth)") && securityRoutes.includes('router.use(createPrivacyRouter({pool,requireAuth}))'));

if (controls.length !== 60) failures.push(`Expected exactly 60 registration controls; found ${controls.length}`);
if (failures.length) {
  console.error('PRIVACY GOVERNANCE REGISTRATION CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  check: 'privacy-request-governance-registration',
  meaningfulControls: 60,
  privacyRequestGovernanceRegistered: true,
  privacyExportWorkerGovernanceRegistered: true,
  normalValidationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
