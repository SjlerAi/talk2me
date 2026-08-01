'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const PREVIEW_DATABASE = 'kloka_talk2me';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{8}_\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
}

async function ensureLedger(connection) {
  await connection.execute(`CREATE TABLE IF NOT EXISTS os2_schema_migrations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    migration_name VARCHAR(255) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_by VARCHAR(190) NULL,
    execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_os2_schema_migration_name (migration_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function run() {
  const database = required('DB_NAME');
  if (database !== PREVIEW_DATABASE) throw new Error(`REFUSING_NON_PREVIEW_DATABASE:${database}`);
  if (String(process.env.ALLOW_PREVIEW_MIGRATIONS || '').toLowerCase() !== 'true') {
    throw new Error('ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED');
  }

  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  try {
    await ensureLedger(connection);
    const [appliedRows] = await connection.execute('SELECT migration_name, checksum_sha256 FROM os2_schema_migrations');
    const applied = new Map(appliedRows.map(row => [row.migration_name, row.checksum_sha256]));
    let executed = 0;

    for (const name of migrationFiles()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      const digest = checksum(sql);
      if (applied.has(name)) {
        if (applied.get(name) !== digest) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${name}`);
        console.log(`skip ${name}`);
        continue;
      }
      const started = Date.now();
      await connection.query(sql);
      await connection.execute(`INSERT INTO os2_schema_migrations
        (migration_name,checksum_sha256,executed_by,execution_ms)
        VALUES (:name,:checksum,:executedBy,:executionMs)`, {
        name,
        checksum: digest,
        executedBy: process.env.USER || process.env.USERNAME || 'preview-runner',
        executionMs: Date.now() - started
      });
      executed += 1;
      console.log(`applied ${name}`);
    }

    console.log(`Migration run complete. Applied ${executed} new migration(s).`);
  } finally {
    await connection.end();
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
