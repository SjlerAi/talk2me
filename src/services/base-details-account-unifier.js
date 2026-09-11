'use strict';

const db = require('../config/db');
const { normaliseAccountCore } = require('./base-details-reconciliation');

function normaliseAccountNumber(value) {
  return String(value ?? '').trim().toUpperCase();
}

async function unifyBaseAccounts({ userId = null } = {}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [accounts] = await connection.query(`
      SELECT id,account_number,account_number_normalised,display_name
      FROM customer_accounts
      ORDER BY id
      FOR UPDATE
    `);
    const byCore = new Map();
    for (const account of accounts) {
      const core = normaliseAccountCore(account.account_number || account.account_number_normalised);
      if (!core) continue;
      const list = byCore.get(core) || [];
      list.push(account);
      byCore.set(core, list);
    }

    const [baseAccounts] = await connection.query(`
      SELECT account_code,account_code_core,MAX(NULLIF(TRIM(account_name),'')) account_name,COUNT(*) line_count
      FROM mobile_base_current
      WHERE account_code_core IS NOT NULL AND account_code_core<>''
      GROUP BY account_code,account_code_core
      ORDER BY account_code_core,account_code
      FOR UPDATE
    `);

    let linkedExisting = 0;
    let createdAccounts = 0;
    let linkedCreated = 0;
    let aliasConflicts = 0;
    const conflictCores = [];

    for (const base of baseAccounts) {
      const core = normaliseAccountCore(base.account_code_core || base.account_code);
      if (!core) continue;
      const candidates = byCore.get(core) || [];

      if (candidates.length === 1) {
        const accountId = Number(candidates[0].id);
        const [result] = await connection.execute(`
          UPDATE mobile_base_current
          SET account_id=:accountId,updated_at=CURRENT_TIMESTAMP
          WHERE account_code_core=:core AND (account_id IS NULL OR account_id<>:accountId)
        `, { accountId, core });
        linkedExisting += Number(result.affectedRows || 0);
        continue;
      }

      if (candidates.length > 1) {
        aliasConflicts += 1;
        conflictCores.push({
          core,
          baseAccountCode: base.account_code,
          candidateIds: candidates.map(item => Number(item.id)),
          candidateNumbers: candidates.map(item => item.account_number)
        });
        continue;
      }

      const accountNumber = normaliseAccountNumber(base.account_code);
      if (!accountNumber) continue;
      const [created] = await connection.execute(`
        INSERT INTO customer_accounts
          (account_number,account_number_normalised,display_name,account_status)
        VALUES (:accountNumber,:accountNumber,:displayName,'active')
        ON DUPLICATE KEY UPDATE
          id=LAST_INSERT_ID(id),
          display_name=COALESCE(NULLIF(TRIM(display_name),''),VALUES(display_name)),
          updated_at=CURRENT_TIMESTAMP
      `, {
        accountNumber,
        displayName: base.account_name || null
      });
      const accountId = Number(created.insertId);
      if (!accountId) throw new Error(`Could not resolve customer account ${accountNumber}.`);
      const [[account]] = await connection.execute(`
        SELECT id,account_number,account_number_normalised,display_name
        FROM customer_accounts WHERE id=:id FOR UPDATE
      `, { id: accountId });
      byCore.set(core, [account]);
      if (Number(created.affectedRows || 0) === 1) createdAccounts += 1;

      const [linked] = await connection.execute(`
        UPDATE mobile_base_current
        SET account_id=:accountId,updated_at=CURRENT_TIMESTAMP
        WHERE account_code_core=:core AND (account_id IS NULL OR account_id<>:accountId)
      `, { accountId, core });
      linkedCreated += Number(linked.affectedRows || 0);
    }

    await connection.execute(`
      INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,after_json)
      VALUES (:userId,'base_details_accounts_unified','customer_accounts',NULL,:description,:afterJson)
    `, {
      userId: userId || null,
      description: `Base Details account unification linked unique account cores and created only genuinely missing accounts. ${aliasConflicts} ambiguous legacy account core(s) were left unresolved.`,
      afterJson: JSON.stringify({ linkedExisting, createdAccounts, linkedCreated, aliasConflicts, conflictCores })
    });

    await connection.commit();
    return { linkedExisting, createdAccounts, linkedCreated, aliasConflicts, conflictCores };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { normaliseAccountNumber, unifyBaseAccounts };
