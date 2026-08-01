'use strict';

async function withTransaction(pool, work, options = {}) {
  if (!pool) throw new Error('DATABASE_NOT_CONFIGURED');
  const connection = await pool.getConnection();
  try {
    if (options.isolationLevel) {
      const allowed = new Set(['READ UNCOMMITTED','READ COMMITTED','REPEATABLE READ','SERIALIZABLE']);
      if (!allowed.has(options.isolationLevel)) throw new Error('INVALID_ISOLATION_LEVEL');
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
    }
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (rollbackError) {
      console.error('OS2 transaction rollback failed', rollbackError.code || rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function withSavepoint(connection, name, work) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('INVALID_SAVEPOINT_NAME');
  await connection.query(`SAVEPOINT ${name}`);
  try {
    const result = await work(connection);
    await connection.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await connection.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await connection.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

module.exports = { withTransaction, withSavepoint };
