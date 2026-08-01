'use strict';

const nodemailer = require('nodemailer');

function smtpConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
}

function createTransport(env = process.env) {
  if (!smtpConfigured(env)) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: Math.max(1, Math.min(Number(env.SMTP_MAX_CONNECTIONS || 2), 5)),
    maxMessages: Math.max(10, Number(env.SMTP_MAX_MESSAGES || 100)),
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: String(env.SMTP_ALLOW_INVALID_CERT || '').toLowerCase() !== 'true' }
  });
}

function retryDelayMinutes(attempts) {
  const schedule = [2, 5, 15, 30, 60, 180, 360];
  return schedule[Math.min(Math.max(Number(attempts || 1) - 1, 0), schedule.length - 1)];
}

function safeError(error) {
  return String(error?.code || error?.responseCode || error?.message || 'SMTP_SEND_FAILED').slice(0, 500);
}

async function claimNext(pool, workerId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.execute(`
      SELECT id,recipient_email,recipient_name,subject,body_text,body_html,
             related_entity_type,related_entity_id,attempts
        FROM os2_email_queue
       WHERE status='pending' AND next_attempt_at<=NOW()
         AND attempts<:maxAttempts
       ORDER BY next_attempt_at,id
       LIMIT 1 FOR UPDATE`, { maxAttempts:Number(process.env.EMAIL_MAX_ATTEMPTS || 7) });
    if (!row) {
      await connection.commit();
      return null;
    }
    await connection.execute(`
      UPDATE os2_email_queue
         SET status='processing',attempts=attempts+1,processing_started_at=NOW(),
             worker_id=:workerId,updated_at=NOW()
       WHERE id=:id`, { workerId,id:Number(row.id) });
    await connection.commit();
    return { ...row, attempts:Number(row.attempts || 0) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markSent(pool, row, info) {
  await pool.execute(`
    UPDATE os2_email_queue
       SET status='sent',sent_at=NOW(),provider_message_id=:messageId,
           failure_reason=NULL,processing_started_at=NULL,worker_id=NULL,updated_at=NOW()
     WHERE id=:id AND status='processing'`, {
    id:Number(row.id), messageId:String(info?.messageId || '').slice(0,255) || null
  });
  if (row.related_entity_type === 'os2_notifications' && row.related_entity_id) {
    await pool.execute(`UPDATE os2_notifications SET delivery_status='sent',delivered_at=NOW() WHERE id=:id`, { id:Number(row.related_entity_id) });
  }
}

async function markFailed(pool, row, error) {
  const maxAttempts = Number(process.env.EMAIL_MAX_ATTEMPTS || 7);
  const finalFailure = Number(row.attempts) >= maxAttempts;
  const delay = retryDelayMinutes(row.attempts);
  await pool.execute(`
    UPDATE os2_email_queue
       SET status=:status,failure_reason=:reason,
           next_attempt_at=CASE WHEN :finalFailure=1 THEN next_attempt_at ELSE DATE_ADD(NOW(),INTERVAL :delay MINUTE) END,
           processing_started_at=NULL,worker_id=NULL,updated_at=NOW()
     WHERE id=:id AND status='processing'`, {
    id:Number(row.id), status:finalFailure ? 'failed' : 'pending', reason:safeError(error),
    finalFailure:finalFailure ? 1 : 0, delay
  });
  if (finalFailure && row.related_entity_type === 'os2_notifications' && row.related_entity_id) {
    await pool.execute(`UPDATE os2_notifications SET delivery_status='failed' WHERE id=:id`, { id:Number(row.related_entity_id) });
  }
}

async function releaseStaleClaims(pool) {
  await pool.execute(`
    UPDATE os2_email_queue
       SET status='pending',worker_id=NULL,processing_started_at=NULL,
           failure_reason='STALE_PROCESSING_CLAIM_RELEASED',next_attempt_at=NOW(),updated_at=NOW()
     WHERE status='processing' AND processing_started_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE)`);
}

function startEmailWorker({ pool, logger = console }) {
  const enabled = String(process.env.EMAIL_WORKER_ENABLED || '').toLowerCase() === 'true';
  const transport = enabled ? createTransport(process.env) : null;
  const state = { enabled, configured:Boolean(transport), running:false, timer:null, workerId:`os2-${process.pid}-${Date.now()}` };
  if (!enabled) {
    logger.log('OS2 email worker disabled');
    return state;
  }
  if (!transport) {
    logger.warn('OS2 email worker enabled but SMTP configuration is incomplete');
    return state;
  }
  const intervalMs = Math.max(10000, Number(process.env.EMAIL_WORKER_INTERVAL_MS || 30000));
  const batchSize = Math.max(1, Math.min(Number(process.env.EMAIL_WORKER_BATCH_SIZE || 10), 50));
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await releaseStaleClaims(pool);
      for (let index = 0; index < batchSize; index += 1) {
        const row = await claimNext(pool, state.workerId);
        if (!row) break;
        try {
          const info = await transport.sendMail({
            from: process.env.SMTP_FROM,
            replyTo: process.env.SMTP_REPLY_TO || undefined,
            to: row.recipient_name ? { name:row.recipient_name,email:row.recipient_email } : row.recipient_email,
            subject: row.subject,
            text: row.body_text,
            html: row.body_html || undefined,
            headers: { 'X-Talk2Me-Queue-ID':String(row.id) }
          });
          await markSent(pool,row,info);
        } catch (error) {
          logger.error('OS2 queued email failed', row.id, safeError(error));
          await markFailed(pool,row,error);
        }
      }
    } catch (error) {
      logger.error('OS2 email worker cycle failed', safeError(error));
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(run,intervalMs);
  state.timer.unref();
  setTimeout(run,2000).unref();
  state.stop = async () => {
    if (state.timer) clearInterval(state.timer);
    if (transport) transport.close();
  };
  logger.log(`OS2 email worker started as ${state.workerId}`);
  return state;
}

module.exports = { smtpConfigured, createTransport, retryDelayMinutes, startEmailWorker, releaseStaleClaims };
