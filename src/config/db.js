const mysql = require('mysql2/promise');

const isUat = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const dbName = String(process.env.DB_NAME || '').trim();
const dbUser = String(process.env.DB_USER || '').trim();
const outboundEmailEnabled = String(process.env.OUTBOUND_EMAIL_ENABLED || 'true').trim().toLowerCase() === 'true';
const privateUploadDir = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();

if (isUat) {
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
