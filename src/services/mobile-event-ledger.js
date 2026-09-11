'use strict';

const db = require('../config/db');
const { normaliseSouthAfricanMobile } = require('./sa-phone-normalisation');
const { normaliseExternalCode, resolveStaffByExternalCode } = require('./staff-external-codes');

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function first(obj, names) {
  for (const name of names) {
    const value = obj?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

async function syncMobileEvents({ batchId = null, userId = null } = {}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const params = {};
    let batchFilter = '';
    if (batchId !== null) {
      const id = Number(batchId);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('A valid monthly import batch id is required.');
      params.batchId = id;
      batchFilter = 'AND b.id=:batchId';
    }

    const [rows] = await connection.execute(`
      SELECT r.*,b.import_type,b.source_system,
        m.proposed_client_id,m.proposed_account_id,
        a.target_entity_type,a.target_entity_id,a.applied_status,
        mb.id mobile_base_current_id,mb.client_id base_client_id,mb.account_id base_account_id
      FROM monthly_import_rows r
      JOIN monthly_import_batches b ON b.id=r.batch_id
      LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
      LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
      LEFT JOIN mobile_base_current mb ON mb.msisdn_normalised=r.phone_normalised
      WHERE b.import_type IN ('activation','upgrade')
        AND b.status='confirmed' AND r.import_status='confirmed' ${batchFilter}
      ORDER BY b.id,r.id
      FOR UPDATE
    `, params);

    let insertedOrUpdated = 0;
    let staffMatched = 0;
    let staffUnmapped = 0;
    const unmappedCodes = new Set();

    for (const row of rows) {
      const raw = parseJson(row.raw_data_json);
      const agentCode = normaliseExternalCode(row.agent_code || first(raw, ['agentCode', 'agent', 'createdBy']));
      const staffResolution = agentCode
        ? await resolveStaffByExternalCode(connection, agentCode)
        : { status: 'missing', staff: null };
      const staffId = staffResolution.status === 'matched' ? Number(staffResolution.staff.id) : null;
      if (staffId) staffMatched += 1;
      else if (agentCode) {
        staffUnmapped += 1;
        unmappedCodes.add(agentCode);
      }

      let clientId = row.base_client_id || row.proposed_client_id || null;
      let accountId = row.base_account_id || row.proposed_account_id || null;
      if (row.applied_status === 'applied' && row.target_entity_type === 'clients' && row.target_entity_id) {
        clientId = Number(row.target_entity_id);
      }
      if (clientId && !accountId) {
        const [[client]] = await connection.execute('SELECT account_id FROM clients WHERE id=:id LIMIT 1', { id: clientId });
        accountId = client?.account_id || null;
      }

      const channel = first(raw, ['channel', 'Channel']);
      const commissionScore = first(raw, ['commissionScore', 'Commission Score', 'commission_score']);
      const averageSpend = numeric(first(raw, ['averageSpend', 'Average Spend', 'Avg Spend', 'avgSpend']));
      const phone = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);

      await connection.execute(`
        INSERT INTO mobile_events
          (import_row_id,batch_id,mobile_base_current_id,client_id,account_id,staff_id,event_type,event_date,
           msisdn_original,msisdn_normalised,source_system,agent_code,imei,package_name,deal_sheet_number,
           description,channel,commission_score,average_spend,source_row_fingerprint,raw_data_json)
        VALUES
          (:rowId,:batchId,:mobileBaseId,:clientId,:accountId,:staffId,:eventType,:eventDate,
           :phoneOriginal,:phone,:sourceSystem,:agentCode,:imei,:packageName,:dealSheetNumber,
           :description,:channel,:commissionScore,:averageSpend,:fingerprint,:rawJson)
        ON DUPLICATE KEY UPDATE
          batch_id=VALUES(batch_id),mobile_base_current_id=VALUES(mobile_base_current_id),
          client_id=VALUES(client_id),account_id=VALUES(account_id),staff_id=VALUES(staff_id),
          event_type=VALUES(event_type),event_date=VALUES(event_date),msisdn_original=VALUES(msisdn_original),
          msisdn_normalised=VALUES(msisdn_normalised),source_system=VALUES(source_system),agent_code=VALUES(agent_code),
          imei=VALUES(imei),package_name=VALUES(package_name),deal_sheet_number=VALUES(deal_sheet_number),
          description=VALUES(description),channel=VALUES(channel),commission_score=VALUES(commission_score),
          average_spend=VALUES(average_spend),source_row_fingerprint=VALUES(source_row_fingerprint),
          raw_data_json=VALUES(raw_data_json),updated_at=CURRENT_TIMESTAMP
      `, {
        rowId: Number(row.id), batchId: Number(row.batch_id), mobileBaseId: row.mobile_base_current_id || null,
        clientId: clientId || null, accountId: accountId || null, staffId,
        eventType: row.import_type, eventDate: row.transaction_date || null,
        phoneOriginal: row.phone_original || null, phone: phone || null, sourceSystem: row.source_system,
        agentCode: agentCode || null, imei: row.imei || null, packageName: row.package_name || null,
        dealSheetNumber: row.deal_sheet_number || null, description: row.description || null,
        channel: channel ? String(channel).slice(0, 120) : null,
        commissionScore: commissionScore ? String(commissionScore).slice(0, 120) : null,
        averageSpend, fingerprint: row.row_fingerprint || null,
        rawJson: row.raw_data_json || null
      });
      insertedOrUpdated += 1;
    }

    await connection.execute(`
      INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,after_json)
      VALUES (:userId,'mobile_event_ledger_synced','mobile_events',NULL,:description,:afterJson)
    `, {
      userId: userId || null,
      description: `Mobile event ledger synchronised ${insertedOrUpdated} confirmed activation/upgrade import rows without changing CRM customer records.`,
      afterJson: JSON.stringify({
        total: insertedOrUpdated, staffMatched, staffUnmapped,
        unmappedCodes: [...unmappedCodes].sort()
      })
    });

    await connection.commit();
    return { total: insertedOrUpdated, staffMatched, staffUnmapped, unmappedCodes: [...unmappedCodes].sort() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { parseJson, numeric, first, syncMobileEvents };
