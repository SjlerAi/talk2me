const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function canonicalEmail(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, '');
}

async function main() {
  loadEnvFile();
  const query = String(process.argv[2] || 'info@bo').trim();
  const broad = query.includes('@') ? query.slice(0, query.indexOf('@') + 2) : query.slice(0, 2);

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
    const [metaRows] = await connection.execute(`
      SELECT id, client_name, email,
             CHAR_LENGTH(email) AS char_length,
             LENGTH(email) AS byte_length,
             HEX(email) AS email_hex,
             email LIKE ? AS direct_like,
             LOWER(email) LIKE LOWER(?) AS lower_like
      FROM clients
      WHERE is_active = 1 AND email LIKE ?
      ORDER BY id
      LIMIT 50
    `, [`%${query}%`, `%${query}%`, `%${broad}%`]);

    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`Exact query: ${JSON.stringify(query)}`);
    console.log(`Broad query: ${JSON.stringify(broad)}`);
    console.log(`Rows found by broad SQL: ${metaRows.length}`);
    console.log('');

    for (const row of metaRows) {
      const canonical = canonicalEmail(row.email);
      console.log(JSON.stringify({
        id: row.id,
        client_name: row.client_name,
        email: row.email,
        char_length: row.char_length,
        byte_length: row.byte_length,
        email_hex: row.email_hex,
        mysql_direct_like: Boolean(row.direct_like),
        mysql_lower_like: Boolean(row.lower_like),
        node_canonical: canonical,
        node_starts_with_query: canonical.startsWith(canonicalEmail(query))
      }, null, 2));
    }

    const [directRows] = await connection.execute(`
      SELECT id, client_name, email
      FROM clients
      WHERE is_active = 1 AND email LIKE ?
      ORDER BY id
      LIMIT 50
    `, [`%${query}%`]);

    console.log('');
    console.log(`Direct SQL result count for ${JSON.stringify(query)}: ${directRows.length}`);
    console.log(JSON.stringify(directRows, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Search diagnostic failed:', error.message);
  process.exitCode = 1;
});
