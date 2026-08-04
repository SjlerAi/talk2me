const crypto = require('crypto');

const WORKFLOW_ROLES = new Set(['owner', 'manager', 'admin']);
const GENERAL_APPROVER_ROLES = new Set(['owner', 'manager']);

function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function roleOf(user) {
  return String(user?.role || '').trim().toLowerCase();
}

function canAccessProvisionalApproval(user) {
  return WORKFLOW_ROLES.has(roleOf(user));
}

function canAccessGeneralApprovals(user) {
  return GENERAL_APPROVER_ROLES.has(roleOf(user));
}

function parseProposal(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function isProvisionalAccountRequest(request, proposal = parseProposal(request?.proposed_data_json)) {
  if (String(request?.request_type || '') !== 'assign_account_number') return false;
  if (String(request?.entity_type || '') !== 'clients') return false;
  return Boolean(
    Number(proposal.monthly_import_row_id)
    || Number(proposal.provisional_line_id)
    || (Array.isArray(proposal.provisional_client_ids) && proposal.provisional_client_ids.length)
    || (proposal.fixed_service && typeof proposal.fixed_service === 'object')
  );
}

function provisionalRequestType(proposal = {}) {
  return proposal.fixed_service && typeof proposal.fixed_service === 'object' ? 'fixed service' : 'mobile line';
}

function normaliseOfficialAccountNumber(value) {
  const entered = String(value ?? '').trim();
  if (!entered) throw new Error('Official account number required.');
  const normalised = entered.replace(/\s+/g, '').toUpperCase();
  if (!normalised) throw new Error('Official account number required.');
  if (normalised.length > 80) throw new Error('The official account number cannot exceed 80 characters.');
  if (!/^[A-Z0-9][A-Z0-9._\/-]*$/.test(normalised)) {
    throw new Error('Enter a valid official account number using letters, numbers, hyphens, slashes or full stops.');
  }
  return normalised;
}

function uniquePositiveIds(values) {
  return [...new Set(values.map(Number).filter(value => Number.isInteger(value) && value > 0))];
}

function normalisedStoredAccount(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

function assertClientsCanLink(clients, account) {
  for (const client of clients) {
    if (!client.is_active) throw new Error(`Customer/service #${client.id} is no longer active.`);
    if (client.account_id && Number(client.account_id) !== Number(account.id)) {
      throw new Error(`Customer/service #${client.id} is already linked to a different trusted account.`);
    }
    const current = normalisedStoredAccount(client.account_number);
    if (current && current !== account.account_number_normalised) {
      throw new Error(`Customer/service #${client.id} already has a different trusted account number.`);
    }
  }
}

async function loadOrCreateAccount(connection, request, proposal, officialAccountNumber, assignedStaffId, approverId) {
  let [[account]] = await connection.execute(
    'SELECT * FROM customer_accounts WHERE account_number_normalised=:normalised FOR UPDATE',
    { normalised: officialAccountNumber }
  );
  if (account) {
    if (['cancelled', 'inactive'].includes(String(account.account_status || '').toLowerCase())) {
      throw new Error('The existing official account is not active and cannot be linked automatically.');
    }
    return { account, created: false };
  }

  try {
    const [created] = await connection.execute(`INSERT INTO customer_accounts
      (account_number,account_number_normalised,display_name,assigned_staff_id,assigned_by,assignment_confirmed_at)
      VALUES (:number,:normalised,:displayName,:assignedStaffId,:approverId,NOW())`, {
      number: officialAccountNumber,
      normalised: officialAccountNumber,
      displayName: clean(proposal.client_name || request.summary || officialAccountNumber, 180),
      assignedStaffId,
      approverId
    });
    [[account]] = await connection.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: created.insertId });
    if (!account) throw new Error('The official account could not be revalidated after creation.');
    return { account, created: true };
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    [[account]] = await connection.execute(
      'SELECT * FROM customer_accounts WHERE account_number_normalised=:normalised FOR UPDATE',
      { normalised: officialAccountNumber }
    );
    if (!account) throw error;
    return { account, created: false };
  }
}

async function loadOrCreateFixedAccount(connection, account, request, proposal, assignedStaffId) {
  const [matches] = await connection.execute(`SELECT * FROM fixed_accounts
    WHERE account_id=:accountId OR account_number_normalised=:normalised
    ORDER BY id FOR UPDATE`, {
    accountId: account.id,
    normalised: account.account_number_normalised
  });
  if (matches.length > 1) throw new Error('Multiple fixed accounts match this official account; manual review is required.');

  let fixedAccount = matches[0];
  if (fixedAccount) {
    if (['cancelled', 'inactive'].includes(String(fixedAccount.account_status || '').toLowerCase())) {
      throw new Error('The matching fixed account is not active and cannot receive this service automatically.');
    }
    if (fixedAccount.account_id && Number(fixedAccount.account_id) !== Number(account.id)) {
      throw new Error('The matching fixed account is linked to a different trusted customer account.');
    }
    if (normalisedStoredAccount(fixedAccount.account_number) !== account.account_number_normalised) {
      throw new Error('The matching fixed account has a conflicting trusted account number.');
    }
    const linkedMobileAccount = normalisedStoredAccount(fixedAccount.linked_mobile_account_number);
    if (linkedMobileAccount && linkedMobileAccount !== account.account_number_normalised) {
      throw new Error('The matching fixed account already has a different trusted mobile-account relationship.');
    }
    await connection.execute(`UPDATE fixed_accounts SET
      account_id=COALESCE(account_id,:accountId),
      linked_mobile_account_number=COALESCE(NULLIF(TRIM(linked_mobile_account_number),''),:accountNumber),
      linked_client_id=COALESCE(linked_client_id,:clientId),updated_at=NOW()
      WHERE id=:id`, {
      accountId: account.id,
      accountNumber: account.account_number,
      clientId: request.client_id,
      id: fixedAccount.id
    });
    return { fixedAccount, created: false };
  }

  const [created] = await connection.execute(`INSERT INTO fixed_accounts
    (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,
     linked_client_id,assigned_staff_id,account_status,source_system)
    VALUES (:number,:normalised,:accountId,:customerName,:number,:clientId,:assignedStaffId,'active','Talk2Me CRM')`, {
    number: account.account_number,
    normalised: account.account_number_normalised,
    accountId: account.id,
    customerName: clean(proposal.client_name || account.display_name || account.account_number, 180),
    clientId: request.client_id,
    assignedStaffId
  });
  [[fixedAccount]] = await connection.execute('SELECT * FROM fixed_accounts WHERE id=:id FOR UPDATE', { id: created.insertId });
  if (!fixedAccount) throw new Error('The fixed account could not be revalidated after creation.');
  return { fixedAccount, created: true };
}

async function loadOrCreateFixedService(connection, fixedAccount, request, proposal) {
  const service = proposal.fixed_service;
  if (!service || typeof service !== 'object') return { fixedService: null, created: false };

  const hash = crypto.createHash('sha256').update(`provisional-account-approval:${request.id}`).digest('hex');
  const conditions = ['source_row_hash=:hash'];
  const params = { hash };
  if (clean(service.order_number, 80)) {
    conditions.push('order_number=:orderNumber');
    params.orderNumber = clean(service.order_number, 80);
  }
  if (clean(service.solution_id, 80)) {
    conditions.push('solution_id=:solutionId');
    params.solutionId = clean(service.solution_id, 80);
  }
  const [duplicates] = await connection.execute(`SELECT * FROM fixed_services
    WHERE ${conditions.join(' OR ')} ORDER BY id FOR UPDATE`, params);
  if (duplicates.length) {
    if (duplicates.length > 1) throw new Error('Multiple fixed services match these identifiers; manual review is required.');
    const conflicting = duplicates.find(row => Number(row.fixed_account_id) !== Number(fixedAccount.id));
    if (conflicting) throw new Error(`Fixed service #${conflicting.id} already uses one of these trusted identifiers under another account.`);
    if (String(duplicates[0].service_status || '').toLowerCase() === 'cancelled') {
      throw new Error(`Fixed service #${duplicates[0].id} is cancelled and cannot be linked automatically.`);
    }
    return { fixedService: duplicates[0], created: false };
  }

  const [created] = await connection.execute(`INSERT INTO fixed_services
    (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,
     solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,cancellation_date,
     installation_address,technical_notes,source_row_hash,source_system,raw_import_json)
    VALUES (:fixedAccountId,:title,:branch,:orderNumber,:router,:mac,
     UPPER(REPLACE(REPLACE(:mac,':',''),'-','')),:solutionId,:sim,:packageName,UPPER(TRIM(:packageName)),
     :activationDate,:serviceStatus,:cancellationDate,:installationAddress,:technicalNotes,:hash,'Talk2Me CRM',:rawImport)`, {
    fixedAccountId: fixedAccount.id,
    title: clean(proposal.client_name || service.branch_name || 'Fixed service', 180),
    branch: clean(service.branch_name, 180) || null,
    orderNumber: clean(service.order_number, 80) || null,
    router: clean(service.router_model, 120) || null,
    mac: clean(service.mac_address, 40) || null,
    solutionId: clean(service.solution_id, 80) || null,
    sim: clean(service.sim_number, 30) || null,
    packageName: clean(service.package_name, 180) || null,
    activationDate: clean(service.activation_date, 20) || null,
    serviceStatus: ['active', 'pending', 'suspended', 'cancelled', 'unknown'].includes(service.service_status)
      ? service.service_status : 'pending',
    cancellationDate: clean(service.cancellation_date, 20) || null,
    installationAddress: clean(service.installation_address, 255) || null,
    technicalNotes: clean(service.technical_notes, 5000) || null,
    hash,
    rawImport: JSON.stringify({ approval_request_id: Number(request.id), provisional: true })
  });
  const [[fixedService]] = await connection.execute('SELECT * FROM fixed_services WHERE id=:id FOR UPDATE', { id: created.insertId });
  if (!fixedService) throw new Error('The fixed service could not be revalidated after creation.');
  return { fixedService, created: true };
}

async function applyProvisionalAccountApproval(connection, context) {
  const { request, proposal, officialAccountNumber, user, ipAddress, userAgent, historyUrl } = context;
  if (!isProvisionalAccountRequest(request, proposal)) throw new Error('This is not a provisional mobile/fixed account approval.');
  const accountNumber = normaliseOfficialAccountNumber(officialAccountNumber);
  const clientIds = uniquePositiveIds([
    ...(Array.isArray(proposal.provisional_client_ids) ? proposal.provisional_client_ids : []),
    request.client_id,
    request.record_id,
    proposal.provisional_line_id
  ]);
  if (!clientIds.length) throw new Error('No provisional mobile line or fixed-service customer is attached to this request.');

  const placeholders = clientIds.map(() => '?').join(',');
  const [clients] = await connection.query(`SELECT id,account_id,account_number,client_name,is_active
    FROM clients WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, clientIds);
  if (clients.length !== clientIds.length) throw new Error('One or more affected provisional records no longer exist.');

  const [assignments] = await connection.query(`SELECT client_id,account_number,assigned_staff_id,assigned_by,is_active
    FROM client_assignments WHERE client_id IN (${placeholders}) ORDER BY client_id FOR UPDATE`, clientIds);
  for (const assignment of assignments) {
    const assignedAccount = normalisedStoredAccount(assignment.account_number);
    if (assignedAccount && assignedAccount !== accountNumber) {
      throw new Error(`Customer/service #${assignment.client_id} has a trusted assignment to a different account.`);
    }
  }
  const activeStaffIds = [...new Set(assignments.filter(row => row.is_active).map(row => Number(row.assigned_staff_id)).filter(Boolean))];
  const assignedStaffId = activeStaffIds.length === 1 ? activeStaffIds[0] : Number(request.requested_by);
  const accountResult = await loadOrCreateAccount(
    connection, request, proposal, accountNumber, assignedStaffId, Number(user.id)
  );
  const account = accountResult.account;
  if (normalisedStoredAccount(account.account_number) !== accountNumber
      || normalisedStoredAccount(account.account_number_normalised) !== accountNumber) {
    throw new Error('The target account changed while this approval was being processed.');
  }
  assertClientsCanLink(clients, account);

  for (const client of clients) {
    await connection.execute(`UPDATE clients SET account_id=:accountId,account_number=:accountNumber,updated_at=NOW()
      WHERE id=:clientId`, { accountId: account.id, accountNumber: account.account_number, clientId: client.id });
    await connection.execute(`INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,:accountNumber,:assignedStaffId,:assignedBy,1)
      ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),updated_at=NOW()`, {
      clientId: client.id,
      accountNumber: account.account_number,
      assignedStaffId,
      assignedBy: Number(user.id)
    });
  }

  let fixedAccountResult = { fixedAccount: null, created: false };
  let fixedServiceResult = { fixedService: null, created: false };
  if (proposal.fixed_service && typeof proposal.fixed_service === 'object') {
    fixedAccountResult = await loadOrCreateFixedAccount(connection, account, request, proposal, assignedStaffId);
    fixedServiceResult = await loadOrCreateFixedService(connection, fixedAccountResult.fixedAccount, request, proposal);
  }

  const appliedProposal = {
    ...proposal,
    requested_account_number: proposal.requested_account_number ?? null,
    official_account_number: account.account_number,
    account_number: account.account_number,
    account_id: Number(account.id),
    provisional_client_ids: clientIds,
    fixed_account_id: fixedAccountResult.fixedAccount ? Number(fixedAccountResult.fixedAccount.id) : null,
    fixed_service_id: fixedServiceResult.fixedService ? Number(fixedServiceResult.fixedService.id) : null
  };
  const [updated] = await connection.execute(`UPDATE data_change_requests SET
    status='applied',account_number=:accountNumber,reviewed_by=:reviewedBy,reviewed_at=NOW(),
    review_comment=:comment,applied_at=NOW(),record_id=COALESCE(:recordId,record_id),proposed_data_json=:proposal
    WHERE id=:requestId AND status IN ('pending_manager','pending_owner')`, {
    accountNumber: account.account_number,
    reviewedBy: Number(user.id),
    comment: clean(context.comment, 2000) || null,
    recordId: fixedServiceResult.fixedService ? Number(fixedServiceResult.fixedService.id) : null,
    proposal: JSON.stringify(appliedProposal),
    requestId: Number(request.id)
  });
  if (Number(updated.affectedRows) !== 1) throw new Error('This request is no longer pending.');

  const affected = {
    approval_request_id: Number(request.id),
    customer_ids: clientIds,
    mobile_line_ids: proposal.fixed_service
      ? []
      : uniquePositiveIds([proposal.provisional_line_id, request.record_id]),
    account_id: Number(account.id),
    fixed_account_id: appliedProposal.fixed_account_id,
    fixed_service_id: appliedProposal.fixed_service_id
  };
  const result = accountResult.created ? 'created_account' : 'linked_existing_account';
  const timestamp = new Date().toISOString();
  const previousValues = [...new Set([
    request.account_number,
    proposal.requested_account_number,
    ...clients.map(row => row.account_number),
    ...assignments.map(row => row.account_number)
  ].map(value => clean(value, 80)).filter(Boolean))];
  const previousValue = previousValues.length > 1 ? previousValues : (previousValues[0] || null);
  await connection.execute(`INSERT INTO audit_log
    (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES (:staffId,'provisional_account_approved','data_change_requests',:requestId,:description,:beforeJson,:afterJson,:ip,:userAgent)`, {
    staffId: Number(user.id),
    requestId: Number(request.id),
    description: `Official account ${account.account_number} assigned to provisional ${provisionalRequestType(proposal)} request #${request.id}`,
    beforeJson: JSON.stringify({
      previous_value: previousValue,
      affected,
      status: request.status
    }),
    afterJson: JSON.stringify({
      official_account_number_entered_by: { id: Number(user.id), name: user.full_name || null },
      approved_by: { id: Number(user.id), name: user.full_name || null },
      previous_value: previousValue,
      new_official_value: account.account_number,
      affected,
      role: roleOf(user),
      timestamp,
      ip: clean(ipAddress, 64) || null,
      user_agent: clean(userAgent, 255) || null,
      result
    }),
    ip: clean(ipAddress, 64) || null,
    userAgent: clean(userAgent, 255) || null
  });

  if (['admin', 'manager'].includes(roleOf(user))) {
    const customerName = clean(proposal.client_name || clients[0]?.client_name || account.display_name || 'Customer', 180);
    const completedAt = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    const message = `${user.full_name || 'A management user'} approved provisional ${provisionalRequestType(proposal)} for ${customerName}. Official account number: ${account.account_number}. Completed: ${completedAt}. History: ${historyUrl}`;
    await connection.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification','Provisional account approval completed',:message,'normal',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role='owner' AND s.id<>:createdBy`, {
      message,
      createdBy: Number(user.id),
      clientId: request.client_id || clients[0].id
    });
  }

  return { account, affected, result, appliedProposal };
}

module.exports = {
  applyProvisionalAccountApproval,
  canAccessGeneralApprovals,
  canAccessProvisionalApproval,
  isProvisionalAccountRequest,
  normaliseOfficialAccountNumber,
  parseProposal,
  provisionalRequestType,
  roleOf
};
