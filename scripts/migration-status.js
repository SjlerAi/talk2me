require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

async function run() {
  const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(name => name.endsWith('.sql')).sort();
  const [tables] = await db.query("SHOW TABLES LIKE 'schema_migrations'");
  const applied = new Set();
  if (tables.length) {
    const [rows] = await db.query('SELECT migration_name FROM schema_migrations ORDER BY migration_name');
    rows.forEach(row => applied.add(row.migration_name));
  }
  files.forEach(name => console.log(`${applied.has(name) ? 'APPLIED' : 'PENDING'} ${name}`));
  const pending = files.filter(name => !applied.has(name)).length;
  console.log(`Pending migrations: ${pending}`);
  if (pending) process.exitCode = 2;
}

run().catch(error => {
  console.error('Migration status failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.end());
