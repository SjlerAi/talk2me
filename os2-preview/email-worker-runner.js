'use strict';

const mysql = require('mysql2/promise');
const {
  loadEmailWorkerConfig,
  verifyPool,
  startEmailWorker,
  safeError
} = require('./email-worker');

let pool = null;
let state = null;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`OS2 email worker received ${signal}`);
  try {
    if (state && state.stop) await state.stop();
  } catch (error) {
    console.error('OS2 email worker stop failed', safeError(error));
    exitCode = 1;
  }
  try {
    if (pool) await pool.end();
  } catch (error) {
    console.error('OS2 email worker database close failed', safeError(error));
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

async function main() {
  process.umask(0o077);
  const config = loadEmailWorkerConfig(process.env);
  pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.dbConnectionLimit,
    maxIdle: config.dbConnectionLimit,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: false,
    connectTimeout: 10000,
    namedPlaceholders: true,
    charset: 'utf8mb4',
    timezone: 'Z'
  });
  await verifyPool(pool, config);
  state = startEmailWorker({ pool, config });
  if (config.runOnce) {
    await state.done;
    await shutdown('EMAIL_WORKER_RUN_ONCE_COMPLETE', 0);
  }
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM', 0).catch(error => {
    console.error('OS2 email worker shutdown failed', safeError(error));
    process.exitCode = 1;
  });
});
process.once('SIGINT', () => {
  shutdown('SIGINT', 0).catch(error => {
    console.error('OS2 email worker shutdown failed', safeError(error));
    process.exitCode = 1;
  });
});
process.once('uncaughtException', error => {
  console.error('OS2 email worker uncaught exception', safeError(error));
  shutdown('uncaughtException', 1).catch(() => { process.exitCode = 1; });
});
process.once('unhandledRejection', error => {
  console.error('OS2 email worker unhandled rejection', safeError(error));
  shutdown('unhandledRejection', 1).catch(() => { process.exitCode = 1; });
});

if (require.main === module) {
  main().catch(async error => {
    console.error('OS2 EMAIL WORKER FAILED', safeError(error));
    await shutdown('startupFailure', 1);
  });
}

module.exports = { main, shutdown };
