'use strict';

const db = require('../config/db');

function clean(value, max = 255) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function contractTerm(value) {
  const match = String(value || '').match(/\b(12|24|36)\b/);
  const months = match ? Number(match[1]) : 24;
  return months === 36 ? 36 : months === 12 ? 12 : 24;
}

function lineStatus(value) {
  return /cancel|terminat|disconnect/i.test(String(value || '')) ? 'cancelled' : 'active';
}

function baseClientValues(line, userId) {
  const fullName = clean([line.first_name, line.surname].filter(Boolean).join(' '), 255);
  const accountName = clean(line.account_name, 255);
  const clientName = accountName || fullName || clean(line.msisdn_original || line.msisdn_normalised, 255) || 'Imported customer';
  const handset = clean([line.device_manufacturer, line.device_name].filter(Boolean).join(' '), 255);
  const packageName = clean(line.tariff_name || line.price_plan, 255);
  const term = contractTerm(line.contract_period);

  return {
    accountId: line.account_id ? Number(line.account_id) : null,
    accountNumber: clean(line.account_code, 120),
    firstName: clean(line.first_name, 120),
    surname: clean(line.surname, 120),
    companyName: accountName,
    clientName,
    cellNumber: clean(line.msisdn_original || line.msisdn_normalised, 30),
    phone: clean(line.msisdn_normalised, 20),
    email: clean(line.email_address, 180),
    idNumber: clean(line.id_number, 80),
    packageName,
    handset,
    previousUpgrade: line.last_upgrade_date || null,
    eligibleUpgrade: line.eligible_upgrade_date || null,
    term,
    lineStatus: lineStatus(line.contract_status),
    createdBy: Number(userId) || null
  };
}

async function updateExistingClient(connection, clientId, values) {
  await connection.execute(`
    UPDATE clients SET
      account_id=COALESCE(account_id,:accountId),
      account_number=CASE WHEN account_number IS NULL OR TRIM(account_number)='' THEN :accountNumber ELSE account_number END,
      first_name=CASE WHEN first_name IS NULL OR TRIM(first_name)='' THEN :firstName ELSE first_name END,
      surname=CASE WHEN surname IS NULL OR TRIM(surname)='' THEN :surname ELSE surname END,
      company_name=CASE WHEN company_name IS NULL OR TRIM(company_name)='' THEN :companyName ELSE company_name END,
      email=CASE WHEN email IS NULL OR TRIM(email)='' THEN :email ELSE email END,
      id_number=CASE WHEN id_number IS NULL OR TRIM(id_number)='' THEN :idNumber ELSE id_number END,
      package_name=CASE WHEN package_name IS NULL OR TRIM(package_name)='' THEN :packageName ELSE package_name END,
      handset=CASE WHEN handset IS NULL OR TRIM(handset)='' THEN :handset ELSE handset END,
      previous_upgrade_date=COALESCE(previous_upgrade_date,:previousUpgrade),
      contract_term_months=COALESCE(contract_term_months,:term),
      next_upgrade_date=COALESCE(next_upgrade_date,:eligibleUpgrade,DATE_ADD(:previousUpgrade,INTERVAL :term MONTH)),
      upgrade_date=COALESCE(upgrade_date,:eligibleUpgrade,DATE_ADD(:previousUpgrade,INTERVAL :term MONTH)),
      lifecycle_status=CASE WHEN lifecycle_status='prospect' THEN 'client' ELSE lifecycle_status END,
      line_status=COALESCE(NULLIF(TRIM(line_status),''),:lineStatus),
      is_active=1,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=:clientId
  `, { ...values, clientId });
}

async function createClient(connection, values) {
  const [created] = await connection.execute(`
    INSERT INTO clients
      (account_id,account_number,first_name,surname,company_name,client_name,cell_number,cell_number_normalised,
       email,id_number,package_name,handset,previous_upgrade_date,contract_term_months,next_upgrade_date,upgrade_date,
       customer_type,lifecycle_status,line_status,lead_source,lead_status,created_by_staff_id,is_active)
    VALUES
      (:accountId,:accountNumber,:firstName,:surname,:companyName,:clientName,:cellNumber,:phone,
       :email,:idNumber,:packageName,:handset,:previousUpgrade,:term,
       COALESCE(:eligibleUpgrade,DATE_ADD(:previousUpgrade,INTERVAL :term MONTH)),
       COALESCE(:eligibleUpgrade,DATE_ADD(:previousUpgrade,INTERVAL :term MONTH)),
       'unknown','client',:lineStatus,'Base Details import','new',:createdBy,1)
  `, values);
  return Number(created.insertId);
}

async function materializeBaseAccount({ baseId, userId = null } = {}) {
  const id = Number(baseId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('A valid Base Details service id is required.');

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [[target]] = await connection.execute(
      'SELECT * FROM mobile_base_current WHERE id=:id FOR UPDATE',
      { id }
    );
    if (!target) throw new Error('The imported Base Details service could not be found.');

    let lines;
    if (target.account_id) {
      [lines] = await connection.execute(
        'SELECT * FROM mobile_base_current WHERE account_id=:accountId ORDER BY id FOR UPDATE',
        { accountId: target.account_id }
      );
    } else {
      [lines] = await connection.execute(
        'SELECT * FROM mobile_base_current WHERE account_code=:accountCode ORDER BY id FOR UPDATE',
        { accountCode: target.account_code }
      );
    }

    let targetClientId = target.client_id ? Number(target.client_id) : null;
    let createdCount = 0;
    let linkedExistingCount = 0;
    const materialized = [];

    for (const line of lines) {
      const values = baseClientValues(line, userId);
      if (!values.phone) continue;

      let clientId = line.client_id ? Number(line.client_id) : null;
      let existing = null;

      if (clientId) {
        [[existing]] = await connection.execute('SELECT id FROM clients WHERE id=:id LIMIT 1 FOR UPDATE', { id: clientId });
        if (!existing) clientId = null;
      }

      if (!clientId) {
        [[existing]] = await connection.execute(
          `SELECT id FROM clients
           WHERE cell_number_normalised=:phone
           ORDER BY is_active DESC,id ASC LIMIT 1 FOR UPDATE`,
          { phone: values.phone }
        );
        if (existing) {
          clientId = Number(existing.id);
          linkedExistingCount += 1;
        }
      }

      if (clientId) {
        await updateExistingClient(connection, clientId, values);
      } else {
        clientId = await createClient(connection, values);
        createdCount += 1;
      }

      await connection.execute(
        `UPDATE mobile_base_current
         SET client_id=:clientId,updated_at=CURRENT_TIMESTAMP
         WHERE id=:baseId`,
        { clientId, baseId: line.id }
      );

      await connection.execute(
        `UPDATE mobile_events
         SET client_id=:clientId,
             account_id=COALESCE(account_id,:accountId),
             updated_at=CURRENT_TIMESTAMP
         WHERE mobile_base_current_id=:baseId OR msisdn_normalised=:phone`,
        { clientId, accountId: values.accountId, baseId: line.id, phone: values.phone }
      );

      materialized.push({ baseId: Number(line.id), clientId, phone: values.phone });
      if (Number(line.id) === id) targetClientId = clientId;
    }

    if (!targetClientId) throw new Error('The imported service could not be linked to a CRM customer.');

    await connection.execute(`
      INSERT INTO audit_log
        (staff_id,action_type,entity_type,entity_id,description,after_json)
      VALUES
        (:userId,'base_details_crm_materialized','mobile_base_current',:baseId,:description,:afterJson)
    `, {
      userId: Number(userId) || null,
      baseId: id,
      description: `Imported Base Details account opened in CRM: ${createdCount} CRM line(s) created and ${linkedExistingCount} existing line(s) linked without changing source snapshots.`,
      afterJson: JSON.stringify({ targetClientId, createdCount, linkedExistingCount, materialized })
    });

    await connection.commit();
    return { clientId: targetClientId, createdCount, linkedExistingCount, materialized };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { materializeBaseAccount };
