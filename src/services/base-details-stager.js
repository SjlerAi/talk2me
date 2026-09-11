'use strict';

const db = require('../config/db');
const { normaliseSouthAfricanMobile } = require('./sa-phone-normalisation');
const { normaliseAccountCore } = require('./base-details-reconciliation');

const STAGE_ACTION_PREFIX = 'stage_base_';

function parsedJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function nullIfBlank(value) {
  return value === '' || value === undefined ? null : value;
}

function sourcePayload(parsed) {
  return parsed && typeof parsed.sourceFields === 'object' && parsed.sourceFields
    ? parsed.sourceFields
    : parsed;
}

function valuesFor(row) {
  const parsed = parsedJson(row.raw_data_json);
  const b = parsed.baseDetails || {};
  const phone = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised || b.msisdn);
  const accountCode = String(row.account_number || b.accountCode || '').trim().toUpperCase();
  const accountCore = normaliseAccountCore(accountCode);
  if (!phone) throw new Error(`Base Details row #${row.id} has no valid South African MSISDN.`);
  if (!accountCode || !accountCore) throw new Error(`Base Details row #${row.id} has no valid Account Code.`);
  return {
    rowId: Number(row.id), batchId: Number(row.batch_id), fingerprint: row.row_fingerprint,
    clientId: row.proposed_client_id ? Number(row.proposed_client_id) : null,
    accountId: row.proposed_account_id ? Number(row.proposed_account_id) : null,
    businessUnit: nullIfBlank(b.businessUnit), accountCode, accountCore,
    accountName: nullIfBlank(b.accountName), idNumber: nullIfBlank(b.idNumber),
    firstName: nullIfBlank(b.firstName), surname: nullIfBlank(b.surname),
    msisdnOriginal: nullIfBlank(row.phone_original || b.msisdn), msisdnNormalised: phone,
    emailAddress: nullIfBlank(b.emailAddress), masterAccountHolder: nullIfBlank(b.masterAccountHolder),
    subscriptionRevenueExclVat: b.subscriptionRevenueExclVat ?? null,
    customerRevenueM3: b.customerRevenueM3 ?? null, customerRevenueM2: b.customerRevenueM2 ?? null,
    customerRevenueM1: b.customerRevenueM1 ?? null, inBundleRevenue: b.inBundleRevenue ?? null,
    outBundleRevenue: b.outBundleRevenue ?? null, dataContentRevenue: b.dataContentRevenue ?? null,
    aveSubscriptionRevenue: b.aveSubscriptionRevenue ?? null, netSubscriptionRevenue: b.netSubscriptionRevenue ?? null,
    connectionDate: nullIfBlank(b.connectionDate), lastActiveDate: nullIfBlank(b.lastActiveDate),
    active30Day: nullIfBlank(b.active30Day), lastUpgradeDate: nullIfBlank(b.lastUpgradeDate),
    deviceManufacturer: nullIfBlank(b.deviceManufacturer), deviceName: nullIfBlank(b.deviceName),
    pricePlanCategory: nullIfBlank(b.pricePlanCategory), pricePlan: nullIfBlank(b.pricePlan),
    tariffName: nullIfBlank(b.tariffName), cbuSegment: nullIfBlank(b.cbuSegment),
    j4uAttached: nullIfBlank(b.j4uAttached), accountInArrears: nullIfBlank(b.accountInArrears),
    contractStatus: nullIfBlank(b.contractStatus), contractPeriod: nullIfBlank(b.contractPeriod),
    voiceOobUsage: nullIfBlank(b.voiceOobUsage), dataOobUsage: nullIfBlank(b.dataOobUsage),
    networkTenureMonths: b.networkTenureMonths ?? null, contractTenureMonths: b.contractTenureMonths ?? null,
    baseDealerName: nullIfBlank(b.baseDealerName), simSizeDescription: nullIfBlank(b.simSizeDescription),
    optOutIndicator: nullIfBlank(b.optOutIndicator), churnRiskInd: nullIfBlank(b.churnRiskInd),
    deviceInsurance: nullIfBlank(b.deviceInsurance), simInsurance: nullIfBlank(b.simInsurance),
    iccId: nullIfBlank(b.iccId), imsi: nullIfBlank(b.imsi),
    recommendation1: nullIfBlank(b.recommendation1), recommendation2: nullIfBlank(b.recommendation2),
    recommendation3: nullIfBlank(b.recommendation3), recommendation4: nullIfBlank(b.recommendation4),
    portfolioScore: nullIfBlank(b.portfolioScore), linesUpgradable: b.linesUpgradable ?? null,
    eligibleUpgradeDate: nullIfBlank(b.eligibleUpgradeDate), eligibleUpgradeFlag: nullIfBlank(b.eligibleUpgradeFlag),
    upgradeInProgress: nullIfBlank(b.upgradeInProgress), dataUsageM1Mb: b.dataUsageM1Mb ?? null,
    dataUsageM2Mb: b.dataUsageM2Mb ?? null, dataUsageM3Mb: b.dataUsageM3Mb ?? null,
    rawJson: JSON.stringify(sourcePayload(parsed))
  };
}

async function writeCurrent(connection, v) {
  await connection.execute(`
    INSERT INTO mobile_base_current
      (client_id,account_id,source_batch_id,source_row_id,source_row_fingerprint,
       business_unit,account_code,account_code_core,account_name,id_number,first_name,surname,
       msisdn_original,msisdn_normalised,email_address,master_account_holder,
       subscription_revenue_excl_vat,customer_revenue_m3,customer_revenue_m2,customer_revenue_m1,
       in_bundle_revenue,out_bundle_revenue,data_content_revenue,ave_subscription_revenue,net_subscription_revenue,
       connection_date,last_active_date,active_30_day,last_upgrade_date,device_manufacturer,device_name,
       price_plan_category,price_plan,tariff_name,cbu_segment,j4u_attached,account_in_arrears,contract_status,
       contract_period,voice_oob_usage,data_oob_usage,network_tenure_months,contract_tenure_months,base_dealer_name,
       sim_size_description,opt_out_indicator,churn_risk_ind,device_insurance,sim_insurance,icc_id,imsi,
       recommendation_1,recommendation_2,recommendation_3,recommendation_4,portfolio_score,lines_upgradable,
       eligible_upgrade_date,eligible_upgrade_flag,upgrade_in_progress,data_usage_m1_mb,data_usage_m2_mb,data_usage_m3_mb,
       raw_data_json,source_captured_at)
    VALUES
      (:clientId,:accountId,:batchId,:rowId,:fingerprint,
       :businessUnit,:accountCode,:accountCore,:accountName,:idNumber,:firstName,:surname,
       :msisdnOriginal,:msisdnNormalised,:emailAddress,:masterAccountHolder,
       :subscriptionRevenueExclVat,:customerRevenueM3,:customerRevenueM2,:customerRevenueM1,
       :inBundleRevenue,:outBundleRevenue,:dataContentRevenue,:aveSubscriptionRevenue,:netSubscriptionRevenue,
       :connectionDate,:lastActiveDate,:active30Day,:lastUpgradeDate,:deviceManufacturer,:deviceName,
       :pricePlanCategory,:pricePlan,:tariffName,:cbuSegment,:j4uAttached,:accountInArrears,:contractStatus,
       :contractPeriod,:voiceOobUsage,:dataOobUsage,:networkTenureMonths,:contractTenureMonths,:baseDealerName,
       :simSizeDescription,:optOutIndicator,:churnRiskInd,:deviceInsurance,:simInsurance,:iccId,:imsi,
       :recommendation1,:recommendation2,:recommendation3,:recommendation4,:portfolioScore,:linesUpgradable,
       :eligibleUpgradeDate,:eligibleUpgradeFlag,:upgradeInProgress,:dataUsageM1Mb,:dataUsageM2Mb,:dataUsageM3Mb,
       :rawJson,NOW())
    ON DUPLICATE KEY UPDATE
      client_id=VALUES(client_id),account_id=VALUES(account_id),source_batch_id=VALUES(source_batch_id),
      source_row_id=VALUES(source_row_id),source_row_fingerprint=VALUES(source_row_fingerprint),
      business_unit=VALUES(business_unit),account_code=VALUES(account_code),account_code_core=VALUES(account_code_core),
      account_name=VALUES(account_name),id_number=VALUES(id_number),first_name=VALUES(first_name),surname=VALUES(surname),
      msisdn_original=VALUES(msisdn_original),email_address=VALUES(email_address),master_account_holder=VALUES(master_account_holder),
      subscription_revenue_excl_vat=VALUES(subscription_revenue_excl_vat),customer_revenue_m3=VALUES(customer_revenue_m3),
      customer_revenue_m2=VALUES(customer_revenue_m2),customer_revenue_m1=VALUES(customer_revenue_m1),
      in_bundle_revenue=VALUES(in_bundle_revenue),out_bundle_revenue=VALUES(out_bundle_revenue),
      data_content_revenue=VALUES(data_content_revenue),ave_subscription_revenue=VALUES(ave_subscription_revenue),
      net_subscription_revenue=VALUES(net_subscription_revenue),connection_date=VALUES(connection_date),
      last_active_date=VALUES(last_active_date),active_30_day=VALUES(active_30_day),last_upgrade_date=VALUES(last_upgrade_date),
      device_manufacturer=VALUES(device_manufacturer),device_name=VALUES(device_name),price_plan_category=VALUES(price_plan_category),
      price_plan=VALUES(price_plan),tariff_name=VALUES(tariff_name),cbu_segment=VALUES(cbu_segment),j4u_attached=VALUES(j4u_attached),
      account_in_arrears=VALUES(account_in_arrears),contract_status=VALUES(contract_status),contract_period=VALUES(contract_period),
      voice_oob_usage=VALUES(voice_oob_usage),data_oob_usage=VALUES(data_oob_usage),network_tenure_months=VALUES(network_tenure_months),
      contract_tenure_months=VALUES(contract_tenure_months),base_dealer_name=VALUES(base_dealer_name),
      sim_size_description=VALUES(sim_size_description),opt_out_indicator=VALUES(opt_out_indicator),churn_risk_ind=VALUES(churn_risk_ind),
      device_insurance=VALUES(device_insurance),sim_insurance=VALUES(sim_insurance),icc_id=VALUES(icc_id),imsi=VALUES(imsi),
      recommendation_1=VALUES(recommendation_1),recommendation_2=VALUES(recommendation_2),recommendation_3=VALUES(recommendation_3),
      recommendation_4=VALUES(recommendation_4),portfolio_score=VALUES(portfolio_score),lines_upgradable=VALUES(lines_upgradable),
      eligible_upgrade_date=VALUES(eligible_upgrade_date),eligible_upgrade_flag=VALUES(eligible_upgrade_flag),
      upgrade_in_progress=VALUES(upgrade_in_progress),data_usage_m1_mb=VALUES(data_usage_m1_mb),data_usage_m2_mb=VALUES(data_usage_m2_mb),
      data_usage_m3_mb=VALUES(data_usage_m3_mb),raw_data_json=VALUES(raw_data_json),source_captured_at=VALUES(source_captured_at),
      updated_at=CURRENT_TIMESTAMP
  `, v);
  const [[current]] = await connection.execute(
    'SELECT id FROM mobile_base_current WHERE msisdn_normalised=:phone LIMIT 1',
    { phone: v.msisdnNormalised }
  );
  return Number(current.id);
}

async function writeSnapshot(connection, v, currentId) {
  await connection.execute(`
    INSERT INTO mobile_base_snapshots
      (mobile_base_current_id,batch_id,import_row_id,source_row_number,row_fingerprint,
       msisdn_original,msisdn_normalised,account_code,account_code_core,raw_data_json,captured_at)
    SELECT :currentId,r.batch_id,r.id,r.source_row_number,r.row_fingerprint,
      r.phone_original,:phone,:accountCode,:accountCore,:rawJson,NOW()
    FROM monthly_import_rows r WHERE r.id=:rowId
    ON DUPLICATE KEY UPDATE
      mobile_base_current_id=VALUES(mobile_base_current_id),account_code=VALUES(account_code),
      account_code_core=VALUES(account_code_core),raw_data_json=VALUES(raw_data_json)
  `, {
    currentId, rowId: v.rowId, phone: v.msisdnNormalised, accountCode: v.accountCode,
    accountCore: v.accountCore, rawJson: v.rawJson
  });
}

async function stageBaseDetailsBatch({ batchId, userId = null } = {}) {
  const id = Number(batchId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('A valid Base Details batch id is required.');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[batch]] = await connection.execute(
      'SELECT * FROM monthly_import_batches WHERE id=:id FOR UPDATE', { id }
    );
    if (!batch) throw new Error('Base Details batch not found.');
    if (batch.import_type !== 'base_details' || batch.source_system !== 'VODACOM_BASE') {
      throw new Error('Only a confirmed VODACOM_BASE Base Details batch can be staged.');
    }
    if (batch.status !== 'confirmed') throw new Error('Base Details batch must be confirmed before staging.');

    const [rows] = await connection.execute(`
      SELECT r.*,m.classification,m.proposed_client_id,m.proposed_account_id,
        a.id action_id,a.action_type,a.approval_status,a.applied_status
      FROM monthly_import_rows r
      LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
      LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
      WHERE r.batch_id=:id AND r.import_status='confirmed'
      ORDER BY r.source_row_number,r.id
      FOR UPDATE
    `, { id });
    if (!rows.length) throw new Error('Base Details batch has no confirmed rows to stage.');
    const missingMatch = rows.find(row => !row.action_id);
    if (missingMatch) throw new Error(`Base Details row #${missingMatch.id} has not been reconciled yet.`);
    const unsafeAction = rows.find(row => !String(row.action_type || '').startsWith(STAGE_ACTION_PREFIX));
    if (unsafeAction) throw new Error(`Base Details row #${unsafeAction.id} has unsafe action ${unsafeAction.action_type}. Re-run matching before staging.`);

    let exact = 0; let possible = 0; let newRecords = 0; let conflicts = 0;
    for (const row of rows) {
      const v = valuesFor(row);
      const currentId = await writeCurrent(connection, v);
      await writeSnapshot(connection, v, currentId);
      if (row.classification === 'exact_match') exact += 1;
      else if (row.classification === 'possible_match') possible += 1;
      else if (row.classification === 'new_record') newRecords += 1;
      else if (row.classification === 'conflict') conflicts += 1;
    }

    await connection.execute(`
      INSERT INTO audit_log
        (staff_id,action_type,entity_type,entity_id,description,after_json)
      VALUES
        (:userId,'base_details_batch_staged','monthly_import_batches',:batchId,:description,:afterJson)
    `, {
      userId: userId || null,
      batchId: id,
      description: `Base Details batch #${id} staged ${rows.length} current service rows and immutable source snapshots without creating or overwriting CRM customers.`,
      afterJson: JSON.stringify({ total: rows.length, exact_match: exact, possible_match: possible, new_record: newRecords, conflict: conflicts })
    });
    await connection.commit();
    return { total: rows.length, exact_match: exact, possible_match: possible, new_record: newRecords, conflict: conflicts };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { STAGE_ACTION_PREFIX, parsedJson, sourcePayload, valuesFor, stageBaseDetailsBatch };
