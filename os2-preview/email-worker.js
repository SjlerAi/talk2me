'use strict';

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const PREVIEW_DB = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const DEFAULT_MAX_ATTEMPTS = 7;
const STALE_CLAIM_MINUTES = 15;
const MAX_STALE_RELEASES = 100;
const MAX_SUBJECT_BYTES = 998;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,99}$/;
const EMAIL_PATTERN = /^[^\s<>@,;:\\"()[\]]+@[^\s<>@,;:\\"()[\]]+\.[A-Za-z]{2,63}$/;
const RETRYABLE_CODES = new Set(['EDNS', 'ECONNECTION', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

function controlledError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function strictBoolean(env, name, fallback = false) {
  const raw = String(env[name] == null ? String(fallback) : env[name]).trim().toLowerCase();
  if (!['true', 'false'].includes(raw)) throw controlledError(`INVALID_${name}`);
  return raw === 'true';
}

function strictInteger(env, name, fallback, min, max) {
  const raw = String(env[name] == null ? fallback : env[name]).trim();
  if (!/^[0-9]+$/.test(raw)) throw controlledError(`INVALID_${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw controlledError(`INVALID_${name}`);
  return value;
}

function requiredText(env, name, maxLength, pattern) {
  const value = String(env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) {
    throw controlledError(`INVALID_${name}`);
  }
  return value;
}

function normaliseEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : '';
}

function parseMailbox(value, fieldName) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > 320 || /[\r\n\u0000]/.test(raw)) throw controlledError(`INVALID_${fieldName}`);
  const angle = raw.match(/^(.*)<([^<>]+)>$/);
  if (!angle) {
    const address = normaliseEmail(raw);
    if (!address) throw controlledError(`INVALID_${fieldName}`);
    return { address, formatted: address };
  }
  const name = angle[1].trim().replace(/^"|"$/g, '');
  const address = normaliseEmail(angle[2]);
  if (!address || !name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) throw controlledError(`INVALID_${fieldName}`);
  const safeName = name.replace(/["\\]/g, '');
  return { address, formatted: `"${safeName}" <${address}>` };
}

function parseRecipientAllowlist(value) {
  const entries = String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!entries.length || entries.length > 100) throw controlledError('INVALID_EMAIL_PREVIEW_RECIPIENT_ALLOWLIST');
  const exact = new Set();
  const domains = new Set();
  for (const entry of entries) {
    if (entry.startsWith('@')) {
      const domain = entry.slice(1);
      if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
        throw controlledError('INVALID_EMAIL_PREVIEW_RECIPIENT_ALLOWLIST');
      }
      domains.add(domain);
    } else {
      const email = normaliseEmail(entry);
      if (!email) throw controlledError('INVALID_EMAIL_PREVIEW_RECIPIENT_ALLOWLIST');
      exact.add(email);
    }
  }
  return Object.freeze({ exact, domains, count: exact.size + domains.size });
}

function recipientAllowed(email, allowlist) {
  const normalised = normaliseEmail(email);
  if (!normalised) return false;
  if (allowlist.exact.has(normalised)) return true;
  const domain = normalised.slice(normalised.lastIndexOf('@') + 1);
  return allowlist.domains.has(domain);
}

function smtpConfigured(env = process.env) {
  return ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'EMAIL_PREVIEW_RECIPIENT_ALLOWLIST']
    .every(name => String(env[name] || '').trim());
}

function loadEmailWorkerConfig(env = process.env) {
  const database = requiredText(env, 'DB_NAME', 128, /^[A-Za-z0-9_]+$/);
  if (database !== PREVIEW_DB) throw controlledError('REFUSING_NON_PREVIEW_DATABASE');
  const branch = requiredText(env, 'RELEASE_BRANCH', 200, /^[A-Za-z0-9._/-]+$/);
  if (branch !== RELEASE_BRANCH) throw controlledError('REFUSING_UNCONTROLLED_RELEASE_BRANCH');
  if (!strictBoolean(env, 'EMAIL_WORKER_ENABLED')) throw controlledError('EMAIL_WORKER_DISABLED');
  if (strictBoolean(env, 'ALLOW_PRODUCTION_MUTATION')) throw controlledError('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (strictBoolean(env, 'ENABLE_CUSTOMER_MERGE_EXECUTION')) throw controlledError('MERGE_EXECUTION_FLAG_PROHIBITED');
  if (String(env.SMTP_ALLOW_INVALID_CERT || '').trim().toLowerCase() === 'true') throw controlledError('INVALID_SMTP_CERTIFICATE_OVERRIDE_PROHIBITED');

  const smtpPort = strictInteger(env, 'SMTP_PORT', 587, 1, 65535);
  if (![465, 587].includes(smtpPort)) throw controlledError('SMTP_PORT_MUST_BE_465_OR_587');
  const smtpSecure = strictBoolean(env, 'SMTP_SECURE', smtpPort === 465);
  if ((smtpPort === 465) !== smtpSecure) throw controlledError('SMTP_PORT_SECURITY_MISMATCH');
  const from = parseMailbox(env.SMTP_FROM, 'SMTP_FROM');
  const replyTo = String(env.SMTP_REPLY_TO || '').trim() ? parseMailbox(env.SMTP_REPLY_TO, 'SMTP_REPLY_TO') : null;
  const messageIdDomain = String(env.SMTP_MESSAGE_ID_DOMAIN || from.address.split('@')[1]).trim().toLowerCase();
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(messageIdDomain)) {
    throw controlledError('INVALID_SMTP_MESSAGE_ID_DOMAIN');
  }

  return Object.freeze({
    database,
    branch,
    dbHost: requiredText(env, 'DB_HOST', 255, /^[^\s]+$/),
    dbPort: strictInteger(env, 'DB_PORT', 3306, 1, 65535),
    dbUser: requiredText(env, 'DB_USER', 128, /^[A-Za-z0-9_.@-]+$/),
    dbPassword: String(env.DB_PASSWORD || ''),
    dbConnectionLimit: strictInteger(env, 'EMAIL_DB_CONNECTION_LIMIT', 4, 2, 10),
    smtpHost: requiredText(env, 'SMTP_HOST', 255, /^[A-Za-z0-9.-]+$/),
    smtpPort,
    smtpSecure,
    smtpUser: requiredText(env, 'SMTP_USER', 320, /^[^\s]+$/),
    smtpPassword: requiredText(env, 'SMTP_PASSWORD', 4096),
    smtpFrom: from.formatted,
    smtpFromAddress: from.address,
    smtpReplyTo: replyTo ? replyTo.formatted : null,
    smtpMessageIdDomain: messageIdDomain,
    smtpMaxConnections: strictInteger(env, 'SMTP_MAX_CONNECTIONS', 2, 1, 5),
    smtpMaxMessages: strictInteger(env, 'SMTP_MAX_MESSAGES', 100, 10, 1000),
    maxAttempts: strictInteger(env, 'EMAIL_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 10),
    intervalMs: strictInteger(env, 'EMAIL_WORKER_INTERVAL_MS', 30000, 10000, 3600000),
    batchSize: strictInteger(env, 'EMAIL_WORKER_BATCH_SIZE', 10, 1, 50),
    runOnce: strictBoolean(env, 'EMAIL_WORKER_RUN_ONCE'),
    allowlist: parseRecipientAllowlist(env.EMAIL_PREVIEW_RECIPIENT_ALLOWLIST)
  });
}

function createTransport(config) {
  if (!config || config.database !== PREVIEW_DB || config.branch !== RELEASE_BRANCH) throw controlledError('EMAIL_WORKER_CONFIG_REQUIRED');
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: !config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
    pool: true,
    maxConnections: config.smtpMaxConnections,
    maxMessages: config.smtpMaxMessages,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 45000,
    dnsTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: config.smtpHost
    }
  });
}

function retryDelayMinutes(attempts) {
  const schedule = [2, 5, 15, 30, 60, 180, 360];
  const index = Math.min(Math.max(Number(attempts || 1) - 1, 0), schedule.length - 1);
  return schedule[index];
}

function safeError(error) {
  const code = String(error && error.code || '').trim().toUpperCase();
  if (SAFE_CODE.test(code)) return code;
  const responseCode = Number(error && error.responseCode);
  if (Number.isInteger(responseCode) && responseCode >= 400 && responseCode <= 599) return `SMTP_${responseCode}`;
  return 'SMTP_SEND_FAILED';
}

function retryableFailure(error) {
  const code = safeError(error);
  if (RETRYABLE_CODES.has(code)) return true;
  const responseCode = Number(error && error.responseCode);
  return Number.isInteger(responseCode) && responseCode >= 400 && responseCode <= 499;
}

function headerText(value, code, maxCharacters) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > maxCharacters || /[\r\n\u0000-\u001f\u007f]/.test(text)) throw controlledError(code);
  return text;
}

function bodyText(value, code, maxBytes, required) {
  const text = String(value == null ? '' : value);
  if ((required && !text.trim()) || Buffer.byteLength(text, 'utf8') > maxBytes || text.includes('\u0000')) throw controlledError(code);
  return text;
}

function validateQueueRow(row, config) {
  const id = Number(row && row.id);
  if (!Number.isSafeInteger(id) || id < 1) throw controlledError('EMAIL_QUEUE_ID_INVALID');
  const recipientEmail = normaliseEmail(row.recipient_email);
  if (!recipientEmail) throw controlledError('EMAIL_RECIPIENT_INVALID');
  if (!recipientAllowed(recipientEmail, config.allowlist)) throw controlledError('EMAIL_RECIPIENT_NOT_ALLOWLISTED');
  const recipientName = row.recipient_name == null || row.recipient_name === '' ? null : headerText(row.recipient_name, 'EMAIL_RECIPIENT_NAME_INVALID', 180);
  const subject = headerText(row.subject, 'EMAIL_SUBJECT_INVALID', 240);
  if (Buffer.byteLength(subject, 'utf8') > MAX_SUBJECT_BYTES) throw controlledError('EMAIL_SUBJECT_BYTES_EXCEEDED');
  const text = bodyText(row.body_text, 'EMAIL_BODY_TEXT_INVALID', MAX_TEXT_BYTES, true);
  const html = row.body_html == null || row.body_html === '' ? null : bodyText(row.body_html, 'EMAIL_BODY_HTML_INVALID', MAX_HTML_BYTES, false);
  const attempts = Number(row.attempts);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > config.maxAttempts) throw controlledError('EMAIL_ATTEMPT_COUNT_INVALID');
  const relatedEntityType = row.related_entity_type == null || row.related_entity_type === '' ? null : headerText(row.related_entity_type, 'EMAIL_RELATED_ENTITY_TYPE_INVALID', 80);
  if (relatedEntityType && !/^[A-Za-z][A-Za-z0-9_]{1,79}$/.test(relatedEntityType)) throw controlledError('EMAIL_RELATED_ENTITY_TYPE_INVALID');
  const relatedEntityId = row.related_entity_id == null ? null : Number(row.related_entity_id);
  if (relatedEntityId != null && (!Number.isSafeInteger(relatedEntityId) || relatedEntityId < 1)) throw controlledError('EMAIL_RELATED_ENTITY_ID_INVALID');
  return Object.freeze({ ...row, id, recipient_email: recipientEmail, recipient_name: recipientName, subject, body_text: text, body_html: html, attempts, related_entity_type: relatedEntityType, related_entity_id: relatedEntityId });
}

async function prepareConnection(connection, config) {
  await connection.query("SET time_zone='+00:00'");
  const [[identity]] = await connection.query('SELECT DATABASE() database_name, CONNECTION_ID() connection_id');
  if (!identity || identity.database_name !== PREVIEW_DB || !Number.isSafeInteger(Number(identity.connection_id))) {
    throw controlledError('EMAIL_DATABASE_IDENTITY_MISMATCH');
  }
  if (config.database !== PREVIEW_DB) throw controlledError('EMAIL_DATABASE_CONFIGURATION_MISMATCH');
}

async function verifyPool(pool, config) {
  const connection = await pool.getConnection();
  try { await prepareConnection(connection, config); }
  finally { connection.release(); }
}

async function releaseStaleClaims(pool, config) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT id,related_entity_type,related_entity_id
        FROM os2_email_queue
       WHERE status='processing'
         AND processing_started_at<DATE_SUB(NOW(),INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)
       ORDER BY processing_started_at,id
       LIMIT ${MAX_STALE_RELEASES} FOR UPDATE`);
    for (const row of rows) {
      const id = Number(row.id);
      const [update] = await connection.execute(`
        UPDATE os2_email_queue
           SET status='failed',worker_id=NULL,processing_started_at=NULL,
               failure_reason='STALE_PROCESSING_STATE_UNCERTAIN',updated_at=NOW()
         WHERE id=:id AND status='processing'
           AND processing_started_at<DATE_SUB(NOW(),INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)`, { id });
      if (Number(update.affectedRows) !== 1) throw controlledError('EMAIL_STALE_CLAIM_STATE_CHANGED');
      if (row.related_entity_type === 'os2_notifications' && Number.isSafeInteger(Number(row.related_entity_id)) && Number(row.related_entity_id) > 0) {
        await connection.execute(`
          UPDATE os2_notifications
             SET delivery_status='failed',failure_reason='STALE_PROCESSING_STATE_UNCERTAIN'
           WHERE id=:id AND delivery_status='pending'`, { id: Number(row.related_entity_id) });
      }
    }
    await connection.commit();
    return rows.length;
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally { connection.release(); }
}

async function claimNext(pool, config, workerId) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    const [[row]] = await connection.execute(`
      SELECT id,recipient_email,recipient_name,subject,body_text,body_html,
             related_entity_type,related_entity_id,attempts
        FROM os2_email_queue
       WHERE status='pending'
         AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())
         AND attempts<${config.maxAttempts}
       ORDER BY COALESCE(next_attempt_at,created_at),id
       LIMIT 1 FOR UPDATE`);
    if (!row) {
      await connection.commit();
      return null;
    }
    const [update] = await connection.execute(`
      UPDATE os2_email_queue
         SET status='processing',attempts=attempts+1,processing_started_at=NOW(),
             worker_id=:workerId,failure_reason=NULL,updated_at=NOW()
       WHERE id=:id AND status='pending'
         AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())
         AND attempts=:previousAttempts`, {
      workerId,
      id: Number(row.id),
      previousAttempts: Number(row.attempts || 0)
    });
    if (Number(update.affectedRows) !== 1) throw controlledError('EMAIL_CLAIM_STATE_CHANGED');
    await connection.commit();
    return { ...row, attempts: Number(row.attempts || 0) + 1 };
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally { connection.release(); }
}

async function markSent(pool, config, workerId, row, info) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.beginTransaction();
    const messageId = String(info && info.messageId || '').trim();
    if (!messageId || messageId.length > 255 || /[\r\n\u0000]/.test(messageId)) throw controlledError('SMTP_PROVIDER_MESSAGE_ID_INVALID');
    const [update] = await connection.execute(`
      UPDATE os2_email_queue
         SET status='sent',sent_at=NOW(),provider_message_id=:messageId,
             failure_reason=NULL,processing_started_at=NULL,worker_id=NULL,updated_at=NOW()
       WHERE id=:id AND status='processing' AND worker_id=:workerId`, {
      id: row.id,
      workerId,
      messageId
    });
    if (Number(update.affectedRows) !== 1) throw controlledError('EMAIL_SENT_STATE_CHANGED');
    if (row.related_entity_type === 'os2_notifications' && row.related_entity_id) {
      await connection.execute(`
        UPDATE os2_notifications
           SET delivery_status='sent',delivered_at=NOW(),sent_at=COALESCE(sent_at,NOW()),failure_reason=NULL
         WHERE id=:id AND delivery_status='pending'`, { id: row.related_entity_id });
    }
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally { connection.release(); }
}

async function markFailed(pool, config, workerId, row, error, options = {}) {
  const connection = await pool.getConnection();
  const forceFinal = options.forceFinal === true;
  const reason = safeError(error);
  const finalFailure = forceFinal || row.attempts >= config.maxAttempts || !retryableFailure(error);
  const delay = retryDelayMinutes(row.attempts);
  try {
    await prepareConnection(connection, config);
    await connection.beginTransaction();
    const [update] = await connection.execute(`
      UPDATE os2_email_queue
         SET status=:status,failure_reason=:reason,
             next_attempt_at=CASE WHEN :finalFailure=1 THEN next_attempt_at ELSE DATE_ADD(NOW(),INTERVAL ${delay} MINUTE) END,
             processing_started_at=NULL,worker_id=NULL,updated_at=NOW()
       WHERE id=:id AND status='processing' AND worker_id=:workerId`, {
      id: row.id,
      workerId,
      status: finalFailure ? 'failed' : 'pending',
      reason,
      finalFailure: finalFailure ? 1 : 0
    });
    if (Number(update.affectedRows) !== 1) throw controlledError('EMAIL_FAILURE_STATE_CHANGED');
    if (finalFailure && row.related_entity_type === 'os2_notifications' && row.related_entity_id) {
      await connection.execute(`
        UPDATE os2_notifications
           SET delivery_status='failed',failure_reason=:reason
         WHERE id=:id AND delivery_status='pending'`, { id: row.related_entity_id, reason });
    }
    await connection.commit();
    return { finalFailure, reason, delay: finalFailure ? null : delay };
  } catch (stateError) {
    try { await connection.rollback(); } catch (_) {}
    throw stateError;
  } finally { connection.release(); }
}

function messageForRow(config, row) {
  const messageId = `<talk2me-preview-queue-${row.id}@${config.smtpMessageIdDomain}>`;
  return {
    from: config.smtpFrom,
    replyTo: config.smtpReplyTo || undefined,
    to: row.recipient_name ? { name: row.recipient_name, address: row.recipient_email } : row.recipient_email,
    envelope: { from: config.smtpFromAddress, to: row.recipient_email },
    messageId,
    subject: row.subject,
    text: row.body_text,
    html: row.body_html || undefined,
    headers: {
      'X-Talk2Me-Environment': 'preview',
      'X-Talk2Me-Queue-ID': String(row.id)
    },
    disableFileAccess: true,
    disableUrlAccess: true
  };
}

async function runEmailCycle({ pool, transport, config, workerId, logger = console }) {
  const results = [];
  const staleFailed = await releaseStaleClaims(pool, config);
  for (let index = 0; index < config.batchSize; index += 1) {
    const claimed = await claimNext(pool, config, workerId);
    if (!claimed) break;
    let row;
    try {
      row = validateQueueRow(claimed, config);
    } catch (error) {
      const outcome = await markFailed(pool, config, workerId, { ...claimed, id: Number(claimed.id), attempts: Number(claimed.attempts) }, error, { forceFinal: true });
      logger.error('OS2 queued email rejected', Number(claimed.id), outcome.reason);
      results.push({ id: Number(claimed.id), status: 'failed', reason: outcome.reason });
      continue;
    }
    let accepted = false;
    try {
      const info = await transport.sendMail(messageForRow(config, row));
      accepted = true;
      await markSent(pool, config, workerId, row, info);
      results.push({ id: row.id, status: 'sent' });
    } catch (error) {
      const outcome = await markFailed(pool, config, workerId, row, error, { forceFinal: accepted });
      logger.error('OS2 queued email failed', row.id, outcome.reason);
      results.push({ id: row.id, status: outcome.finalFailure ? 'failed' : 'pending', reason: outcome.reason });
    }
  }
  return { staleFailed, results };
}

function startEmailWorker({ pool, config, logger = console, transport = null }) {
  if (!pool || !config) throw controlledError('EMAIL_WORKER_START_ARGUMENTS_REQUIRED');
  const smtpTransport = transport || createTransport(config);
  const state = {
    enabled: true,
    configured: true,
    running: false,
    stopping: false,
    timer: null,
    currentRun: null,
    workerId: `os2-email-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
    done: null,
    stop: null,
    runNow: null
  };
  let resolveDone;
  state.done = new Promise(resolve => { resolveDone = resolve; });

  const execute = async () => {
    if (state.running || state.stopping) return null;
    state.running = true;
    state.currentRun = runEmailCycle({ pool, transport: smtpTransport, config, workerId: state.workerId, logger });
    try { return await state.currentRun; }
    finally { state.currentRun = null; state.running = false; }
  };
  const schedule = delay => {
    if (state.stopping) return;
    state.timer = setTimeout(async () => {
      state.timer = null;
      try { await execute(); }
      catch (error) { logger.error('OS2 email worker cycle failed', safeError(error)); }
      if (config.runOnce) {
        state.stopping = true;
        smtpTransport.close();
        resolveDone();
      } else if (!state.stopping) schedule(config.intervalMs);
    }, delay);
  };
  state.runNow = execute;
  state.stop = async () => {
    if (state.stopping) return state.done;
    state.stopping = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.currentRun) {
      try { await state.currentRun; } catch (_) {}
    }
    smtpTransport.close();
    resolveDone();
    return state.done;
  };
  schedule(config.runOnce ? 0 : 2000);
  logger.log(`OS2 email worker started as ${state.workerId}`);
  return state;
}

module.exports = {
  PREVIEW_DB,
  RELEASE_BRANCH,
  DEFAULT_MAX_ATTEMPTS,
  STALE_CLAIM_MINUTES,
  MAX_SUBJECT_BYTES,
  MAX_TEXT_BYTES,
  MAX_HTML_BYTES,
  smtpConfigured,
  loadEmailWorkerConfig,
  createTransport,
  retryDelayMinutes,
  safeError,
  retryableFailure,
  normaliseEmail,
  parseRecipientAllowlist,
  recipientAllowed,
  validateQueueRow,
  prepareConnection,
  verifyPool,
  releaseStaleClaims,
  claimNext,
  markSent,
  markFailed,
  messageForRow,
  runEmailCycle,
  startEmailWorker
};
