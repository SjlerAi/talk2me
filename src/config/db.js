const mysql = require('mysql2/promise');

const isUat = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const dbName = String(process.env.DB_NAME || '').trim();
const outboundEmailEnabled = String(process.env.OUTBOUND_EMAIL_ENABLED || 'true').trim().toLowerCase() === 'true';
const privateUploadDir = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();

if (isUat) {
  if (!dbName) throw new Error('UAT safety: DB_NAME is required.');
  if (dbName === 'uent_talk2me_crm') throw new Error('UAT safety: refusing to connect to the production Talk2Me database.');
  if (outboundEmailEnabled) throw new Error('UAT safety: OUTBOUND_EMAIL_ENABLED must be false.');
  if (privateUploadDir === '/home/uent/talk2me_private_uploads') throw new Error('UAT safety: refusing to share the production private-upload directory.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  charset: 'utf8mb4'
});

module.exports = pool;
