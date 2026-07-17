const mysql = require('mysql2/promise');
let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      decimalNumbers: true,
      dateStrings: true,
      timezone: '+02:00',
      charset: 'utf8mb4'
    });
  }
  return pool;
}
async function query(sql, params = []) { const [rows] = await getPool().execute(sql, params); return rows; }
module.exports = { getPool, query };
