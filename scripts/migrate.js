require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/config/db');
const packageInfo = require('../package.json');

const migrationsDir = path.join(__dirname, '..', 'migrations');

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function ensureTrackingTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    migration_name VARCHAR(255) NOT NULL,
    checksum CHAR(64) NOT NULL,
    application_version VARCHAR(50) NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_name (migration_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function run() {
  await ensureTrackingTable();
  const files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  const [appliedRows] = await db.query('SELECT migration_name, checksum FROM schema_migrations');
  const applied = new Map(appliedRows.map(row => [row.migration_name, row.checksum]));

  let appliedCount = 0;
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error(`Applied migration was modified: ${name}`);
      console.log(`SKIP ${name}`);
      continue;
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of splitStatements(sql)) await connection.query(statement);
      await connection.execute(
        'INSERT INTO schema_migrations (migration_name, checksum, application_version) VALUES (:name, :checksum, :version)',
        { name, checksum, version: packageInfo.version || null }
      );
      await connection.commit();
      appliedCount += 1;
      console.log(`APPLIED ${name}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  console.log(appliedCount ? `Database migrations applied: ${appliedCount}` : 'Database is up to date.');
}

run().catch(error => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.end());
