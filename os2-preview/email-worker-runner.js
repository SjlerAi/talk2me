'use strict';

const mysql = require('mysql2/promise');
const { startEmailWorker } = require('./email-worker');

const required = ['DB_HOST','DB_USER','DB_NAME'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Email worker cannot start; missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Math.max(2, Math.min(Number(process.env.EMAIL_DB_CONNECTION_LIMIT || 4), 10)),
  queueLimit: 0,
  namedPlaceholders: true,
  charset: 'utf8mb4'
});

const state = startEmailWorker({ pool });
if (!state.enabled || !state.configured) {
  pool.end().finally(() => process.exit(1));
}

async function shutdown(signal) {
  console.log(`OS2 email worker received ${signal}`);
  try {
    if (state.stop) await state.stop();
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', error => {
  console.error('OS2 email worker uncaught exception', error?.code || error?.message || error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', error => {
  console.error('OS2 email worker unhandled rejection', error?.code || error?.message || error);
});
