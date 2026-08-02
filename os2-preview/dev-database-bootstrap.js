'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const EXPECTED_DATABASE = 'kloka_talk2me';
const REQUIRED_CONFIRMATION = 'REBUILD_KLOKA_TALK2ME_DEVELOPMENT_DATABASE';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{8}_\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

async function ensureDevelopmentTarget(connection) {
  const [[identity]] = await connection.query('SELECT DATABASE() AS database_name');
  if (!identity || identity.database_name !== EXPECTED_DATABASE) {
    throw new Error(`WRONG_DATABASE:${identity ? identity.database_name : 'unknown'}`);
  }

  if (process.env.OS2_DEV_DATABASE_CONFIRMATION !== REQUIRED_CONFIRMATION) {
    throw new Error('DEVELOPMENT_DATABASE_CONFIRMATION_REQUIRED');
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('PRODUCTION_ENVIRONMENT_PROHIBITED');
  }
}

async function ensureLedger(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS os2_schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      migration_name VARCHAR(255) NOT NULL,
      checksum_sha256 CHAR(64) NOT NULL,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      executed_by VARCHAR(190) NOT NULL,
      execution_ms INT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_os2_schema_migration_name (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedMigrations(connection) {
  const [rows] = await connection.query(
    'SELECT migration_name, checksum_sha256 FROM os2_schema_migrations ORDER BY id'
  );
  return new Map(rows.map(row => [row.migration_name, row.checksum_sha256]));
}

async function run() {
  const files = migrationFiles();
  if (files.length !== 25) throw new Error(`EXPECTED_25_MIGRATIONS_FOUND_${files.length}`);

  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
    charset: 'utf8mb4',
    multipleStatements: true,
    connectTimeout: 10000
  });

  try {
    await ensureDevelopmentTarget(connection);
    await connection.query("SET SESSION time_zone = '+00:00'");
    await ensureLedger(connection);

    const applied = await appliedMigrations(connection);
    const executedBy = String(process.env.USER || process.env.USERNAME || 'os2-development-bootstrap').slice(0, 190);
    const result = [];

    for (const name of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      const checksum = sha256(sql);
      const existingChecksum = applied.get(name);

      if (existingChecksum) {
        if (existingChecksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${name}`);
        result.push({ migration: name, status: 'already_applied' });
        continue;
      }

      const started = Date.now();
      try {
        await connection.query(sql);
        const executionMs = Date.now() - started;
        await connection.execute(
          `INSERT INTO os2_schema_migrations
             (migration_name, checksum_sha256, executed_by, execution_ms)
           VALUES (?, ?, ?, ?)`,
          [name, checksum, executedBy, executionMs]
        );
        result.push({ migration: name, status: 'applied', executionMs });
      } catch (error) {
        error.message = `MIGRATION_FAILED:${name}:${error.message}`;
        throw error;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      database: EXPECTED_DATABASE,
      migrationCount: files.length,
      result
    }, null, 2));
  } finally {
    await connection.end();
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
