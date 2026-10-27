const mysql = require('mysql2/promise');

const isUat = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const dbName = String(process.env.DB_NAME || '').trim();
const dbUser = String(process.env.DB_USER || '').trim();
const outboundEmailEnabled = String(process.env.OUTBOUND_EMAIL_ENABLED || 'true').trim().toLowerCase() === 'true';
const privateUploadDir = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();

// The TK2M rehearsal is a separate account and database. Fail closed before
// constructing a pool if a copied UENT runtime configuration is accidentally used.
const isTk2mStaging = String(process.env.CRM_STAGE_MODE || '').trim().toLowerCase() === 'true';
if (isTk2mStaging) {
  const expectedUploadDir = '/home/talk/crm-migration/staging-uploads/talk2me_uat_private_uploads';
  const allowedLocalHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!isUat) throw new Error('TK2M staging safety: UAT_MODE must remain true to preserve approved office screens.');
  if (dbName !== 'talk_crm_stage' || dbUser !== 'talk_crmstg') {
    throw new Error('TK2M staging safety: staging DB and dedicated DB user are required.');
  }
  if (!allowedLocalHosts.has(String(process.env.DB_HOST || 'localhost').trim())) {
    throw new Error('TK2M staging safety: the DB connection must be local.');
  }
  if (privateUploadDir !== expectedUploadDir) {
    throw new Error('TK2M staging safety: only the isolated staging upload root is permitted.');
  }
  if (process.env.BASE_PATH !== '/' || process.env.APP_URL !== 'https://crm.tk2m.co.za') {
    throw new Error('TK2M staging safety: the canonical root URL and base path must be configured.');
  }
  if (String(process.env.SESSION_SECURE || '').trim().toLowerCase() !== 'true') {
    throw new Error('TK2M staging safety: secure session cookies are required.');
  }
  if (outboundEmailEnabled || String(process.env.ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS || '').toLowerCase() === 'true'
      || String(process.env.CUDO_EXTERNAL_SEND_ENABLED || '').toLowerCase() === 'true'
      || String(process.env.CRM_BACKGROUND_WORKERS_ENABLED || '').toLowerCase() === 'true') {
    throw new Error('TK2M staging safety: outbound communication and background workers must be disabled.');
  }
} else if (isUat) {
  if (dbName !== 'uent_Crm') throw new Error(`UAT safety: DB_NAME must be uent_Crm, received ${dbName || '(blank)'}.`);
  if (dbUser !== 'uent_Crm-Uat') throw new Error(`UAT safety: DB_USER must be uent_Crm-Uat, received ${dbUser || '(blank)'}.`);
  if (outboundEmailEnabled) throw new Error('UAT safety: OUTBOUND_EMAIL_ENABLED must be false.');
  if (privateUploadDir !== '/home/uent/talk2me_uat_private_uploads') {
    throw new Error('UAT safety: PRIVATE_UPLOAD_DIR must be /home/uent/talk2me_uat_private_uploads.');
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: dbUser,
  password: process.env.DB_PASSWORD,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  charset: 'utf8mb4'
});

module.exports = pool;
