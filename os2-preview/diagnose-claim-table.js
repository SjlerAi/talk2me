const fs = require('fs');
const mysql = require('mysql2/promise');

function loadHtaccessEnv() {
  const htaccessPath = '/home/kloka/talk2me.kloka.co.za/.htaccess';
  if (!fs.existsSync(htaccessPath)) return;

  const allowed = new Set(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']);
  for (const rawLine of fs.readFileSync(htaccessPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*SetEnv\s+([A-Z0-9_]+)\s+(.+?)\s*$/);
    if (!match || !allowed.has(match[1]) || process.env[match[1]]) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function main() {
  loadHtaccessEnv();

  const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing database settings: ${missing.join(', ')}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  try {
    const [[status]] = await connection.execute(`
      SELECT ENGINE, ROW_FORMAT, TABLE_ROWS, AUTO_INCREMENT, CREATE_OPTIONS,
             DATA_LENGTH, INDEX_LENGTH, DATA_FREE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'data_change_requests'
      LIMIT 1
    `);

    const [columns] = await connection.execute(`
      SELECT ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
             COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'data_change_requests'
      ORDER BY ORDINAL_POSITION
    `);

    const [[maxRow]] = await connection.execute(`
      SELECT COUNT(*) AS row_count, MAX(id) AS max_id
      FROM data_change_requests
    `);

    const [createRows] = await connection.query('SHOW CREATE TABLE data_change_requests');
    const createSql = createRows[0]?.['Create Table'] || null;

    console.log(JSON.stringify({
      database: process.env.DB_NAME,
      table_status: status || null,
      row_summary: maxRow || null,
      columns,
      create_table: createSql
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Claim table diagnostic failed:', error.message);
  process.exitCode = 1;
});
