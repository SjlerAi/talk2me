'use strict';

const db = require('../config/db');
const { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS } = require('./sa-phone-normalisation');

const SIM_CONTRACT_MONTHS = 36;
const AUTO_APPROVED_ACTIONS = new Set(['link_mobile_client', 'link_fixed_service']);
const FINALISABLE_NEW_ACTIONS = new Set(['create_mobile_record', 'create_fixed_service']);

function json(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function effectiveContractTerm(value) {
  const term = Number(value);
  return Number.isInteger(term) && term > 0 ? term : SIM_CONTRACT_MONTHS;
}

function matchingClientIds(clients, canonicalPhone) {
  const canonical = normaliseSouthAfricanMobile(canonicalPhone);
  if (!canonical) return [];
  return [...new Set(clients
    .filter(client => MOBILE_PHONE_FIELDS.some(field => normaliseSouthAfricanMobile(client[field]) === canonical))
    .map(client => Number(client.id))
    .filter(Number.isFinite))];
}

function requireUniqueMobileTarget(clients, canonicalPhone, targetId) {
  const canonical = normaliseSouthAfricanMobile(canonicalPhone);
  const candidateIds = matchingClientIds(clients, canonical);
  if (candidateIds.length > 1) {
    throw new Error(`Mobile ${canonical} now matches multiple clients and requires conflict review.`);
  }
  if (candidateIds.length !== 1 || candidateIds[0] !== Number(targetId)) {
    throw new Error(`Client #${targetId} no longer has the imported canonical phone.`);
  }
  return candidateIds[0];
}

function resolvedMobileCandidateIds(candidateJson) {
  let candidates;
  try {
    const parsed = typeof candidateJson === 'string' ? JSON.parse(candidateJson) : candidateJson;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) throw new Error('invalid');
    candidates = parsed.clients;
  } catch {
    throw new Error('The stored mobile conflict candidates are invalid. Re-run Process Monthly Import and review the conflict again.');
  }
  const ids = [...new Set(candidates
    .map(candidate => Number(candidate?.id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (ids.length < 2) {
    throw new Error('The stored mobile conflict candidates are invalid. Re-run Process Monthly Import and review the conflict again.');
  }
  return ids;
}

function requireResolvedMobileTarget(action, selectedClient, canonicalPhone) {
  if (action.action_type !== 'resolve_mobile_conflict' || action.classification !== 'conflict') {
    throw new Error(`Mobile action #${action.id} is not a manager-resolved conflict.`);
  }
  if (action.review_status !== 'approved' || action.approval_status !== 'approved') {
    throw new Error('This mobile conflict is not approved for finalisation.');
  }
  if (action.applied_status !== 'not_applied') {
    throw new Error('This mobile conflict action has already been applied.');
  }
  if (action.target_entity_type !== 'clients') {
    throw new Error('The resolved mobile conflict target type must be clients.');
  }
  const targetId = Number(action.target_entity_id);
  const proposedClientId = Number(action.proposed_client_id);
  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    throw new Error(`Mobile action #${action.id} has no selected client.`);
  }
  if (!Number.isSafeInteger(proposedClientId) || proposedClientId !== targetId) {
    throw new Error('The resolved mobile conflict target disagrees with the stored manager selection.');
  }
  if (!resolvedMobileCandidateIds(action.candidate_json).includes(targetId)) {
    throw new Error('The selected client was not an allowed candidate for this mobile conflict.');
  }
  if (!selectedClient || Number(selectedClient.id) !== targetId) {
    throw new Error(`The selected client #${targetId} no longer exists. Re-run Process Monthly Import and review the conflict again.`);
  }
  if (!matchingClientIds([selectedClient], canonicalPhone).includes(targetId)) {
    throw new Error('The selected client no longer matches this imported phone. Re-run Process Monthly Import and review the conflict again.');
  }
  return targetId;
}

function isFinalisableAction(action) {
  if (action.applied_status !== 'not_applied') return false;
  return action.approval_status === 'approved'
    || (action.approval_status === 'pending' && FINALISABLE_NEW_ACTIONS.has(action.action_type));
}

function auditValues(context, actionType, entityType, entityId, description, before, after) {
  return {
    staffId: context.userId,
    actionType,
    entityType,
    entityId: entityId || null,
    description,
    beforeJson: before == null ? null : JSON.stringify(before),
    afterJson: after == null ? null : JSON.stringify(after),
    ip: String(context.ip || '').slice(0, 64) || null,
    userAgent: String(context.userAgent || '').slice(0, 255) || null
  };
}

async function writeAudit(connection, context, actionType, entityType, entityId, description, before, after) {
  await connection.execute(`
    INSERT INTO audit_log
      (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES
      (:staffId,:actionType,:entityType,:entityId,:description,:beforeJson,:afterJson,:ip,:userAgent)
  `, auditValues(context, actionType, entityType, entityId, description, before, after));
}

async function autoApproveDeterministicMatches(context) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`
      SELECT a.id,a.match_id,a.action_type,a.approval_status,m.review_status,m.classification,
        m.confidence_score,m.proposed_client_id,m.proposed_fixed_service_id
      FROM monthly_import_actions a
      JOIN monthly_import_matches m ON m.id=a.match_id
      WHERE a.applied_status='not_applied'
        AND a.approval_status='pending'
        AND m.review_status='pending'
        AND m.classification='exact_match'
        AND m.confidence_score=100
        AND a.action_type IN ('link_mobile_client','link_fixed_service')
      FOR UPDATE
    `);
    let approved = 0;
    for (const row of rows) {
      if (!AUTO_APPROVED_ACTIONS.has(row.action_type)) continue;
      const deterministicTarget = row.action_type === 'link_mobile_client'
        ? row.proposed_client_id
        : row.proposed_fixed_service_id;
      if (!deterministicTarget) continue;
      await connection.execute(`
        UPDATE monthly_import_matches
        SET review_status='approved',reviewed_by=:userId,reviewed_at=NOW(),
          review_notes='Automatically approved: deterministic unique exact match.'
        WHERE id=:matchId
      `, { userId: context.userId, matchId: row.match_id });
      await connection.execute(`
        UPDATE monthly_import_actions
        SET approval_status='approved',approved_by=:userId,approved_at=NOW(),error_text=NULL
        WHERE id=:id
      `, { userId: context.userId, id: row.id });
      await writeAudit(
        connection, context, 'monthly_import_exact_auto_approved', 'monthly_import_matches', row.match_id,
        `Deterministic exact monthly-import match #${row.match_id} was automatically approved.`,
        { reviewStatus: row.review_status, approvalStatus: row.approval_status },
        { reviewStatus: 'approved', approvalStatus: 'approved', actionType: row.action_type, targetId: deterministicTarget }
      );
      approved += 1;
    }
    await connection.commit();
    return approved;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function previewFinalisation(connection = db) {
  const [[counts]] = await connection.query(`
    SELECT
      SUM(a.applied_status='applied') finalised,
      SUM(a.applied_status='failed') failed,
      SUM(a.applied_status='not_applied' AND a.approval_status='approved') approved_ready,
      SUM(a.applied_status='not_applied' AND a.approval_status IN ('pending','approved')
        AND a.action_type IN ('create_mobile_record','create_fixed_service')) proposed_new,
      SUM(a.applied_status='not_applied' AND (
        (a.approval_status='pending'
          AND (m.classification='conflict' OR a.action_type IN ('resolve_mobile_conflict','resolve_fixed_conflict')))
        OR (a.action_type='create_fixed_account_and_service'
          AND a.approval_status NOT IN ('rejected','deferred'))
      )) unresolved,
      SUM(a.applied_status='not_applied' AND a.approval_status IN ('rejected','deferred')) excluded,
      SUM(a.applied_status='not_applied' AND a.approval_status='approved'
        AND a.action_type IN ('link_mobile_client','resolve_mobile_conflict')) mobile_updates,
      SUM(a.applied_status='not_applied' AND a.approval_status='approved'
        AND a.action_type IN ('link_fixed_service','resolve_fixed_conflict')) fixed_updates,
      SUM(a.applied_status='not_applied' AND a.approval_status IN ('pending','approved')
        AND a.action_type='create_mobile_record') provisional_mobile,
      SUM(a.applied_status='not_applied' AND a.approval_status IN ('pending','approved')
        AND a.action_type='create_fixed_service') fixed_creates
    FROM monthly_import_actions a
    JOIN monthly_import_matches m ON m.id=a.match_id
  `);
  return Object.fromEntries(Object.entries(counts || {}).map(([key, value]) => [key, Number(value || 0)]));
}

async function loadCanonicalPhoneCandidates(connection) {
  const [clients] = await connection.execute(`
    SELECT id,cell_number_normalised,cell_number,
      main_contact_number_normalised,main_contact_number,alt_number
    FROM clients
    WHERE COALESCE(cell_number_normalised,cell_number,
      main_contact_number_normalised,main_contact_number,alt_number) IS NOT NULL
    FOR UPDATE
  `);
  return clients;
}

async function updateMobile(connection, action, row, context) {
  const canonical = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
  const manuallyResolved = action.action_type === 'resolve_mobile_conflict';
  const targetId = Number(action.target_entity_id);
  if (!targetId) throw new Error(`Mobile action #${action.id} has no selected client.`);
  if (!manuallyResolved) {
    if (action.action_type !== 'link_mobile_client' || action.classification !== 'exact_match') {
      throw new Error(`Mobile action #${action.id} is not a deterministic exact match.`);
    }
    if (action.target_entity_type !== 'clients') {
      throw new Error(`Mobile action #${action.id} does not target a client.`);
    }
    if (Number(action.proposed_client_id) !== targetId) {
      throw new Error(`Mobile action #${action.id} target disagrees with its deterministic match.`);
    }
    requireUniqueMobileTarget(await loadCanonicalPhoneCandidates(connection), canonical, targetId);
  }
  const [[before]] = await connection.execute('SELECT * FROM clients WHERE id=:id FOR UPDATE', { id: targetId });
  if (manuallyResolved) {
    requireResolvedMobileTarget(action, before, canonical);
  } else {
    if (!before) throw new Error(`Client #${targetId} no longer exists.`);
    requireUniqueMobileTarget([before], canonical, targetId);
  }
  const isUpgrade = row.import_type === 'upgrade';
  await connection.execute(`
    UPDATE clients SET
      package_name=COALESCE(NULLIF(TRIM(package_name),''),:packageName),
      previous_upgrade_date=CASE WHEN :isUpgrade=1 THEN COALESCE(previous_upgrade_date,:transactionDate) ELSE previous_upgrade_date END,
      contract_term_months=CASE WHEN :isUpgrade=1
        THEN CASE WHEN contract_term_months IS NULL OR contract_term_months<=0 THEN :defaultTerm ELSE contract_term_months END
        ELSE contract_term_months END,
      next_upgrade_date=CASE WHEN :isUpgrade=1 THEN COALESCE(next_upgrade_date,
        DATE_ADD(:transactionDate,INTERVAL
          (CASE WHEN contract_term_months IS NULL OR contract_term_months<=0 THEN :defaultTerm ELSE contract_term_months END) MONTH))
        ELSE next_upgrade_date END,
      upgrade_date=CASE WHEN :isUpgrade=1 THEN COALESCE(upgrade_date,
        DATE_ADD(:transactionDate,INTERVAL
          (CASE WHEN contract_term_months IS NULL OR contract_term_months<=0 THEN :defaultTerm ELSE contract_term_months END) MONTH))
        ELSE upgrade_date END,
      last_upgrade_consultant=CASE WHEN :isUpgrade=1 THEN COALESCE(NULLIF(TRIM(last_upgrade_consultant),''),:agentCode) ELSE last_upgrade_consultant END,
      updated_at=NOW()
    WHERE id=:id
  `, {
    id: targetId,
    packageName: row.package_name || null,
    isUpgrade: isUpgrade ? 1 : 0,
    transactionDate: row.transaction_date || null,
    agentCode: row.agent_code || null,
    defaultTerm: SIM_CONTRACT_MONTHS
  });
  const [[after]] = await connection.execute('SELECT * FROM clients WHERE id=:id', { id: targetId });
  const auditDescription = manuallyResolved
    ? `Monthly import action #${action.id} applied the manually resolved mobile conflict to selected client #${targetId}; other matching client records were not changed.`
    : `Monthly import action #${action.id} safely updated uniquely matched mobile client #${targetId}.`;
  await writeAudit(connection, context, 'monthly_import_mobile_updated', 'clients', targetId,
    auditDescription, before, after);
  return { targetType: 'clients', targetId, before, after };
}

async function createProvisionalMobile(connection, action, row, context) {
  const canonical = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
  if (!canonical) throw new Error(`Mobile action #${action.id} does not contain a valid South African mobile number.`);
  const duplicateIds = matchingClientIds(await loadCanonicalPhoneCandidates(connection), canonical);
  if (duplicateIds.length > 1) throw new Error(`Mobile ${canonical} now matches multiple clients and requires conflict review.`);
  if (duplicateIds.length === 1) {
    throw new Error(`Mobile ${canonical} now matches client #${duplicateIds[0]}. Re-run Process Monthly Import before finalising.`);
  }

  const isUpgrade = row.import_type === 'upgrade';
  const clientName = String(row.customer_name || `Provisional mobile ${canonical}`).trim().slice(0, 255);
  const [created] = await connection.execute(`
    INSERT INTO clients
      (client_name,cell_number,cell_number_normalised,package_name,previous_upgrade_date,contract_term_months,
       next_upgrade_date,upgrade_date,last_upgrade_consultant,customer_type,lifecycle_status,line_status,
       created_by_staff_id,notes,is_active)
    VALUES
      (:clientName,:cell,:phone,:packageName,:previousDate,:contractTerm,
       DATE_ADD(:previousDate,INTERVAL :contractTerm MONTH),DATE_ADD(:previousDate,INTERVAL :contractTerm MONTH),:agentCode,
       'unknown','client','active',:userId,:notes,1)
  `, {
    clientName,
    cell: canonical,
    phone: canonical,
    packageName: row.package_name || null,
    previousDate: isUpgrade ? row.transaction_date : null,
    agentCode: isUpgrade ? (row.agent_code || null) : null,
    contractTerm: SIM_CONTRACT_MONTHS,
    userId: context.userId,
    notes: `Provisional mobile created by Monthly Import row #${row.row_id}; official account number still requires the existing safe assignment workflow.`
  });
  const clientId = Number(created.insertId);
  const [assignment] = await connection.execute(`
    INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
    VALUES (:clientId,NULL,:userId,:userId,1)
  `, { clientId, userId: context.userId });
  const [request] = await connection.execute(`
    INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,
       required_approval_role,status,requested_by)
    VALUES
      ('assign_account_number','clients',:clientId,:clientId,NULL,:summary,:reason,:proposed,
       'manager','pending_manager',:userId)
  `, {
    clientId,
    summary: `Assign official account number to ${clientName}`.slice(0, 255),
    reason: `Created safely from Monthly Import row #${row.row_id}; no account ownership was inferred.`,
    proposed: JSON.stringify({
      account_number: null,
      monthly_import_row_id: Number(row.row_id),
      phone: canonical,
      source_system: row.source_system,
      raw_import: json(row.raw_data_json)
    }),
    userId: context.userId
  });
  const [[after]] = await connection.execute('SELECT * FROM clients WHERE id=:id', { id: clientId });
  await writeAudit(connection, context, 'monthly_import_provisional_mobile_created', 'clients', clientId,
    `Monthly import action #${action.id} created provisional mobile client #${clientId} through the safe account-assignment workflow.`,
    null, after);
  await writeAudit(connection, context, 'monthly_import_client_assignment_created', 'client_assignments', assignment.insertId,
    `Monthly import action #${action.id} assigned provisional mobile client #${clientId} to the finalising manager.`,
    null, { clientId, assignedStaffId: context.userId, accountNumber: null });
  await writeAudit(connection, context, 'monthly_import_account_assignment_requested', 'data_change_requests', request.insertId,
    `Monthly import action #${action.id} opened the existing safe account-number assignment workflow for client #${clientId}.`,
    null, { clientId, requestType: 'assign_account_number', status: 'pending_manager' });
  return { targetType: 'clients', targetId: clientId, before: null, after };
}

function normaliseMac(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

async function findExistingFixedService(connection, row, excludedId = null) {
  const params = {
    hash: row.row_fingerprint,
    orderNumber: row.order_number || null,
    solutionId: row.solution_id || null,
    excludedId: excludedId || 0
  };
  const [rows] = await connection.execute(`
    SELECT * FROM fixed_services
    WHERE id<>:excludedId AND (
      source_row_hash=:hash
      OR (:orderNumber IS NOT NULL AND order_number=:orderNumber)
      OR (:solutionId IS NOT NULL AND solution_id=:solutionId)
    )
    ORDER BY id
    LIMIT 2
    FOR UPDATE
  `, params);
  return rows;
}

async function updateFixedService(connection, action, row, context) {
  const targetId = Number(action.target_entity_id || action.proposed_fixed_service_id);
  if (!targetId) throw new Error(`Fixed action #${action.id} has no selected service.`);
  const [[before]] = await connection.execute('SELECT * FROM fixed_services WHERE id=:id FOR UPDATE', { id: targetId });
  if (!before) throw new Error(`Fixed service #${targetId} no longer exists.`);
  const collisions = await findExistingFixedService(connection, row, targetId);
  if (collisions.length) throw new Error(`Imported fixed identifiers now belong to service #${collisions[0].id}.`);
  const imported = json(row.raw_data_json);
  const rawImport = JSON.stringify(imported);
  await connection.execute(`
    UPDATE fixed_services SET
      branch_name=COALESCE(NULLIF(TRIM(branch_name),''),:branch),
      order_number=COALESCE(NULLIF(TRIM(order_number),''),:orderNumber),
      router_model=COALESCE(NULLIF(TRIM(router_model),''),:routerModel),
      solution_id=COALESCE(NULLIF(TRIM(solution_id),''),:solutionId),
      mac_address=COALESCE(NULLIF(TRIM(mac_address),''),:mac),
      mac_address_normalised=COALESCE(NULLIF(TRIM(mac_address_normalised),''),:macNormalised),
      sim_number=COALESCE(NULLIF(TRIM(sim_number),''),:simNumber),
      package_name=COALESCE(NULLIF(TRIM(package_name),''),:packageName),
      package_name_normalised=COALESCE(NULLIF(TRIM(package_name_normalised),''),UPPER(TRIM(:packageName))),
      activation_date=COALESCE(activation_date,:activationDate),
      raw_import_json=COALESCE(raw_import_json,:rawImport),
      updated_at=NOW()
    WHERE id=:id
  `, {
    id: targetId,
    branch: imported.branchName || row.description || null,
    orderNumber: row.order_number || null,
    routerModel: imported.routerModel || null,
    solutionId: row.solution_id || null,
    mac: row.mac_address || null,
    macNormalised: normaliseMac(row.mac_address),
    simNumber: row.sim_number || null,
    packageName: row.package_name || null,
    activationDate: row.transaction_date || null,
    rawImport
  });
  const [[after]] = await connection.execute('SELECT * FROM fixed_services WHERE id=:id', { id: targetId });
  await writeAudit(connection, context, 'monthly_import_fixed_service_updated', 'fixed_services', targetId,
    `Monthly import action #${action.id} safely updated matched fixed service #${targetId}.`, before, after);
  return { targetType: 'fixed_services', targetId, before, after };
}

async function createFixedService(connection, action, row, context) {
  const accountId = Number(action.target_entity_type === 'customer_accounts' ? action.target_entity_id : action.proposed_account_id);
  if (!accountId) throw new Error(`Fixed action #${action.id} has no resolved customer account.`);
  const [[account]] = await connection.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: accountId });
  if (!account) throw new Error(`Customer account #${accountId} no longer exists.`);
  const collisions = await findExistingFixedService(connection, row);
  if (collisions.length) {
    throw new Error(`Imported fixed identifiers now match service #${collisions[0].id}. Re-run Process Monthly Import before finalising.`);
  }

  const [fixedAccounts] = await connection.execute(`
    SELECT * FROM fixed_accounts
    WHERE account_id=:accountId OR account_number_normalised=:normalised
    ORDER BY id LIMIT 2 FOR UPDATE
  `, { accountId, normalised: account.account_number_normalised });
  if (fixedAccounts.length > 1) {
    throw new Error(`Customer account #${accountId} now maps to multiple fixed accounts and requires conflict review.`);
  }
  let fixedAccount = fixedAccounts[0] || null;
  if (!fixedAccount) {
    const [createdAccount] = await connection.execute(`
      INSERT INTO fixed_accounts
        (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,
         assigned_staff_id,account_status,source_system,raw_import_json)
      VALUES
        (:number,:normalised,:accountId,:name,:number,:staffId,'active','Monthly Import',:rawImport)
    `, {
      number: account.account_number,
      normalised: account.account_number_normalised,
      accountId,
      name: account.display_name || row.customer_name || account.account_number,
      staffId: account.assigned_staff_id || null,
      rawImport: JSON.stringify(json(row.raw_data_json))
    });
    fixedAccount = { id: Number(createdAccount.insertId) };
    await writeAudit(connection, context, 'monthly_import_fixed_account_created', 'fixed_accounts', fixedAccount.id,
      `Monthly import action #${action.id} created a fixed account under customer account #${accountId}.`,
      null, { id: fixedAccount.id, accountId, accountNumber: account.account_number });
  }
  const imported = json(row.raw_data_json);
  const rawImport = JSON.stringify(imported);
  const [created] = await connection.execute(`
    INSERT INTO fixed_services
      (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,
       solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,
       source_row_hash,source_system,raw_import_json)
    VALUES
      (:fixedAccountId,:title,:branch,:orderNumber,:routerModel,:mac,:macNormalised,:solutionId,:simNumber,
       :packageName,UPPER(TRIM(:packageName)),:activationDate,'active',:sourceHash,'Monthly Import',:rawImport)
  `, {
    fixedAccountId: fixedAccount.id,
    title: row.customer_name || account.display_name || account.account_number,
    branch: imported.branchName || row.description || null,
    orderNumber: row.order_number || null,
    routerModel: imported.routerModel || null,
    mac: row.mac_address || null,
    macNormalised: normaliseMac(row.mac_address),
    solutionId: row.solution_id || null,
    simNumber: row.sim_number || null,
    packageName: row.package_name || null,
    activationDate: row.transaction_date || null,
    sourceHash: row.row_fingerprint,
    rawImport
  });
  const serviceId = Number(created.insertId);
  const [[after]] = await connection.execute('SELECT * FROM fixed_services WHERE id=:id', { id: serviceId });
  await writeAudit(connection, context, 'monthly_import_fixed_service_created', 'fixed_services', serviceId,
    `Monthly import action #${action.id} created fixed service #${serviceId} under matched customer account #${accountId}.`,
    null, after);
  return { targetType: 'fixed_services', targetId: serviceId, before: null, after };
}

async function applyAction(connection, action, context) {
  const row = action;
  if (['link_mobile_client', 'resolve_mobile_conflict'].includes(action.action_type)) {
    return updateMobile(connection, action, row, context);
  }
  if (action.action_type === 'create_mobile_record') {
    return createProvisionalMobile(connection, action, row, context);
  }
  if (action.action_type === 'link_fixed_service') {
    return updateFixedService(connection, action, row, context);
  }
  if (action.action_type === 'resolve_fixed_conflict') {
    if (action.target_entity_type === 'fixed_services') return updateFixedService(connection, action, row, context);
    return createFixedService(connection, action, row, context);
  }
  if (action.action_type === 'create_fixed_service') {
    return createFixedService(connection, action, row, context);
  }
  throw new Error(`Action ${action.action_type} is not safe for monthly finalisation.`);
}

async function finaliseMonthlyImport(context) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const preview = await previewFinalisation(connection);
    if (preview.unresolved > 0) {
      throw new Error(`${preview.unresolved} conflict or exception item(s) must be approved, rejected or deferred before finalisation.`);
    }
    const [actions] = await connection.execute(`
      SELECT
        a.id action_id,a.import_row_id,a.match_id,a.action_type,a.target_entity_type,a.target_entity_id,
        a.before_json,a.proposed_json,a.approval_status,a.approved_by,a.approved_at,
        a.applied_status,a.applied_by,a.applied_at,a.error_text,
        m.classification,m.review_status,m.reviewed_by,m.reviewed_at,m.review_notes,m.candidate_json,
        m.proposed_client_id,m.proposed_account_id,m.proposed_fixed_account_id,m.proposed_fixed_service_id,
        r.id row_id,r.batch_id,r.source_row_number,r.row_fingerprint,r.import_status,
        r.phone_original,r.phone_normalised,r.account_number,r.customer_name,r.transaction_date,
        r.agent_code,r.deal_sheet_number,r.imei,r.order_number,r.mac_address,r.solution_id,
        r.sim_number,r.package_name,r.description,r.raw_data_json,r.warning_text,
        b.import_type,b.source_system
      FROM monthly_import_actions a
      JOIN monthly_import_matches m ON m.id=a.match_id
      JOIN monthly_import_rows r ON r.id=a.import_row_id
      JOIN monthly_import_batches b ON b.id=r.batch_id
      WHERE a.applied_status='not_applied'
        AND (
          a.approval_status='approved'
          OR (a.approval_status='pending' AND a.action_type IN ('create_mobile_record','create_fixed_service'))
        )
      ORDER BY a.id
      FOR UPDATE
    `);
    let applied = 0;
    for (const storedAction of actions) {
      const action = { ...storedAction, id: Number(storedAction.action_id), row_id: Number(storedAction.row_id) };
      if (!isFinalisableAction(action)) {
        throw new Error(`Action #${action.id} is not approved for finalisation.`);
      }
      const actionBefore = {
        approvalStatus: action.approval_status,
        appliedStatus: action.applied_status,
        targetEntityType: action.target_entity_type,
        targetEntityId: action.target_entity_id
      };
      const result = await applyAction(connection, action, context);
      await connection.execute(`
        UPDATE monthly_import_actions
        SET approval_status='approved',
          approved_by=COALESCE(approved_by,:userId),approved_at=COALESCE(approved_at,NOW()),
          target_entity_type=:targetType,target_entity_id=:targetId,before_json=:beforeJson,
          applied_status='applied',applied_by=:userId,applied_at=NOW(),error_text=NULL
        WHERE id=:id AND applied_status='not_applied'
      `, {
        userId: context.userId,
        targetType: result.targetType,
        targetId: result.targetId,
        beforeJson: result.before == null ? null : JSON.stringify(result.before),
        id: action.id
      });
      await connection.execute(`
        UPDATE monthly_import_matches
        SET review_status='approved',reviewed_by=COALESCE(reviewed_by,:userId),
          reviewed_at=COALESCE(reviewed_at,NOW()),
          review_notes=COALESCE(review_notes,'Approved during explicit Monthly Import finalisation.')
        WHERE id=:matchId
      `, { userId: context.userId, matchId: action.match_id });
      await writeAudit(connection, context, 'monthly_import_action_applied', 'monthly_import_actions', action.id,
        `Monthly import action #${action.id} was applied after its live write completed.`,
        actionBefore,
        { approvalStatus: 'approved', appliedStatus: 'applied', targetEntityType: result.targetType, targetEntityId: result.targetId });
      applied += 1;
    }
    await writeAudit(connection, context, 'monthly_import_finalised', 'monthly_import_actions', null,
      `Monthly Import finalisation applied ${applied} action(s) transactionally.`,
      preview, { ...preview, appliedThisRun: applied });
    await connection.commit();
    return { applied, alreadyFinalised: preview.finalised };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  autoApproveDeterministicMatches,
  previewFinalisation,
  finaliseMonthlyImport,
  effectiveContractTerm,
  matchingClientIds,
  requireUniqueMobileTarget,
  resolvedMobileCandidateIds,
  requireResolvedMobileTarget,
  isFinalisableAction,
  SIM_CONTRACT_MONTHS,
  MOBILE_PHONE_FIELDS,
  AUTO_APPROVED_ACTIONS,
  FINALISABLE_NEW_ACTIONS
};
