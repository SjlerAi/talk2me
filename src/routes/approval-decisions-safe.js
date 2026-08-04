const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');
const {
  applyProvisionalAccountApproval,
  canAccessGeneralApprovals,
  canAccessProvisionalApproval,
  isProvisionalAccountRequest
} = require('../services/provisional-account-approval');

const router = express.Router();
const PENDING_STATUSES = new Set(['pending_manager', 'pending_owner']);

function isManagement(user) {
  return canAccessProvisionalApproval(user);
}

function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseProposal(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function normaliseAccount(value) {
  return clean(value, 120).replace(/\s+/g, '').toUpperCase();
}

function redirectBack(req, res, tab = 'all', updated = '1') {
  const query = new URLSearchParams({ tab, updated });
  if (String(req.body?.panel || req.query?.panel || '') === '1') query.set('panel', '1');
  return res.redirect(`${res.locals.basePath}/approvals?${query.toString()}`);
}

async function safeAudit(req, payload) {
  try {
    await audit(req, payload);
  } catch (error) {
    console.error('Approval applied but audit logging failed', error);
  }
}

async function markApplied(conn, request, req, extra = {}) {
  await conn.execute(`UPDATE data_change_requests SET status='applied',reviewed_by=:reviewedBy,
    reviewed_at=NOW(),review_comment=:comment,applied_at=NOW(),
    record_id=COALESCE(:recordId,record_id),proposed_data_json=COALESCE(:proposal,proposed_data_json)
    WHERE id=:requestId`, {
    reviewedBy: req.session.user.id,
    comment: clean(req.body.comment, 2000) || null,
    recordId: extra.recordId || null,
    proposal: extra.proposal ? JSON.stringify(extra.proposal) : null,
    requestId: request.id
  });
}

async function approveLegacyAccountClaim(conn, request, proposed, req) {
  const accountId = positiveId(request.record_id || proposed.account_id);
  let account = null;
  if (accountId) {
    [[account]] = await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: accountId });
  }
  if (!account && request.account_number) {
    [[account]] = await conn.execute(`SELECT * FROM customer_accounts
      WHERE account_number_normalised=:normalised FOR UPDATE`, {
      normalised: normaliseAccount(request.account_number)
    });
  }
  if (!account) throw new Error('Customer account not found.');
  if (account.assigned_staff_id && Number(account.assigned_staff_id) !== Number(request.requested_by)) {
    throw new Error('This account has already been assigned.');
  }

  const [clients] = await conn.execute(`SELECT id,account_number FROM clients
    WHERE is_active=1 AND (account_id=:accountId
      OR UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised)
    ORDER BY id FOR UPDATE`, {
    accountId: account.id,
    normalised: account.account_number_normalised || normaliseAccount(account.account_number)
  });
  if (!clients.length) throw new Error('No active client lines are linked to this account.');

  const normalised = account.account_number_normalised || normaliseAccount(account.account_number);
  await conn.execute(`UPDATE client_assignments SET is_active=0,updated_at=NOW()
    WHERE is_active=1 AND UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised`, { normalised });

  for (const client of clients) {
    await conn.execute(`INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
      ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),
        assigned_staff_id=VALUES(assigned_staff_id),assigned_by=VALUES(assigned_by),
        is_active=1,updated_at=NOW()`, {
      clientId: client.id,
      accountNumber: account.account_number,
      staffId: request.requested_by,
      assignedBy: req.session.user.id
    });
  }

  await conn.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,
    assignment_confirmed_at=NOW() WHERE id=:id`, {
    staffId: request.requested_by,
    assignedBy: req.session.user.id,
    id: account.id
  });
  await conn.execute(`UPDATE fixed_accounts SET assigned_staff_id=:staffId,updated_at=NOW()
    WHERE account_id=:accountId
      OR UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised
      OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=:normalised`, {
    staffId: request.requested_by,
    accountId: account.id,
    normalised
  });

  const appliedProposal = {
    ...proposed,
    account_id: account.id,
    account_number: account.account_number,
    assigned_staff_id: request.requested_by,
    linked_client_ids: clients.map(row => Number(row.id)),
    linked_line_count: clients.length,
    scope: 'account'
  };
  await markApplied(conn, request, req, { proposal: appliedProposal });
  return { account, clients, appliedProposal };
}

router.post('/approvals/:id/decision', requireAuth, async (req, res, next) => {
  if (!isManagement(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only owners, managers and administrators can review approvals.' });
  }

  const requestId = positiveId(req.params.id);
  if (!requestId) return next();

  const conn = await db.getConnection();
  let auditPayload = null;
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute('SELECT * FROM data_change_requests WHERE id=:id FOR UPDATE', { id: requestId });
    if (!request) throw new Error('Approval request not found.');
    const decision = clean(req.body.decision, 20).toLowerCase();
    const comment = clean(req.body.comment, 2000) || null;
    const proposed = parseProposal(request.proposed_data_json);
    const provisionalAccountApproval = isProvisionalAccountRequest(request, proposed);
    if (!provisionalAccountApproval && !canAccessGeneralApprovals(req.session.user)) {
      await conn.rollback();
      return res.status(403).render('error', {
        title: 'Access denied',
        message: 'Administrators can only complete provisional mobile/fixed account-number approvals.'
      });
    }
    if (!PENDING_STATUSES.has(String(request.status || ''))) {
      if (provisionalAccountApproval && request.status === 'applied' && decision === 'approve') {
        await conn.rollback();
        return redirectBack(req, res, 'history', 'already-applied');
      }
      throw new Error('This request has already been reviewed.');
    }

    if (decision === 'reject') {
      await conn.execute(`UPDATE data_change_requests SET status='rejected',reviewed_by=:reviewedBy,
        reviewed_at=NOW(),review_comment=:comment WHERE id=:requestId`, {
        reviewedBy: req.session.user.id,
        comment,
        requestId
      });
      await conn.commit();
      await safeAudit(req, {
        actionType: 'change_rejected',
        entityType: 'data_change_requests',
        entityId: request.id,
        description: `${request.request_type || 'Change'} rejected`,
        after: { comment }
      });
      return redirectBack(req, res, 'all', 'rejected');
    }
    if (decision !== 'approve') throw new Error('Choose approve or reject.');

    if (provisionalAccountApproval) {
      await applyProvisionalAccountApproval(conn, {
        request,
        proposal: proposed,
        officialAccountNumber: req.body.account_number,
        comment,
        user: req.session.user,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        historyUrl: `${res.locals.basePath}/approvals?tab=history&q=${request.id}`
      });
      await conn.commit();
      return redirectBack(req, res, 'account_changes');
    }

    if (request.request_type === 'claim_account') {
      const result = await approveLegacyAccountClaim(conn, request, proposed, req);
      auditPayload = {
        actionType: 'account_claim_approved',
        entityType: 'customer_accounts',
        entityId: result.account.id,
        description: `Claim approved for account ${result.account.account_number} and ${result.clients.length} linked line${result.clients.length === 1 ? '' : 's'}`,
        after: result.appliedProposal
      };
      await conn.commit();
      await safeAudit(req, auditPayload);
      return redirectBack(req, res, 'client_claims');
    }

    if (request.request_type === 'add_line') {
      const [[account]] = await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: proposed.account_id });
      if (!account) throw new Error('Customer account not found.');
      const [[duplicate]] = await conn.execute(`SELECT id FROM clients
        WHERE account_id=:accountId AND cell_number_normalised=:phone LIMIT 1`, {
        accountId: account.id,
        phone: proposed.cell_number_normalised
      });
      if (duplicate) throw new Error('This mobile line already exists.');
      const previous = proposed.previous_upgrade_date || null;
      const term = Number(proposed.contract_term_months) === 36 ? 36 : 24;
      const [created] = await conn.execute(`INSERT INTO clients
        (account_id,account_number,client_name,cell_number,cell_number_normalised,email,package_name,handset,
         previous_upgrade_date,contract_term_months,next_upgrade_date,upgrade_date,customer_type,lifecycle_status,
         line_status,created_by_staff_id,is_active)
        VALUES (:accountId,:accountNumber,:clientName,:cell,:phone,:email,:packageName,:handset,
         :previous,:term,DATE_ADD(:previous,INTERVAL :term MONTH),DATE_ADD(:previous,INTERVAL :term MONTH),
         'unknown','client','active',:createdBy,1)`, {
        accountId: account.id,
        accountNumber: account.account_number,
        clientName: proposed.client_name,
        cell: proposed.cell_number,
        phone: proposed.cell_number_normalised,
        email: proposed.email || null,
        packageName: proposed.package_name || null,
        handset: proposed.handset || null,
        previous,
        term,
        createdBy: request.requested_by
      });
      if (account.assigned_staff_id) {
        await conn.execute(`INSERT INTO client_assignments
          (client_id,account_number,assigned_staff_id,assigned_by,is_active)
          VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)`, {
          clientId: created.insertId,
          accountNumber: account.account_number,
          staffId: account.assigned_staff_id,
          assignedBy: req.session.user.id
        });
      }
      await markApplied(conn, request, req, { recordId: created.insertId });
      auditPayload = { actionType: 'mobile_line_approved', entityType: 'clients', entityId: created.insertId, description: `Mobile line approved for ${account.account_number}`, after: proposed };
      await conn.commit();
      await safeAudit(req, auditPayload);
      return redirectBack(req, res, 'customer_changes');
    }

    if (request.request_type === 'update_fixed_service') {
      const [[before]] = await conn.execute('SELECT * FROM fixed_services WHERE id=:id FOR UPDATE', { id: request.record_id });
      if (!before) throw new Error('Fixed service not found.');
      const allowed = ['branch_name','order_number','solution_id','router_model','mac_address','sim_number','package_name','activation_date','service_status','cancellation_date','installation_address','technical_notes'];
      const keys = Object.keys(proposed).filter(key => allowed.includes(key));
      if (!keys.length) throw new Error('No approved fixed-service fields.');
      const set = keys.map(key => `\`${key}\`=:${key}`);
      if (keys.includes('mac_address')) set.push("mac_address_normalised=UPPER(REPLACE(REPLACE(:mac_address,':',''),'-',''))");
      if (keys.includes('package_name')) set.push('package_name_normalised=UPPER(TRIM(:package_name))');
      set.push('updated_at=NOW()');
      await conn.execute(`UPDATE fixed_services SET ${set.join(',')} WHERE id=:id`, { ...before, ...proposed, id: request.record_id });
      await markApplied(conn, request, req);
      auditPayload = { actionType: 'fixed_service_change_approved', entityType: 'fixed_services', entityId: request.record_id, description: 'Approved fixed-service change applied', before, after: proposed };
      await conn.commit();
      await safeAudit(req, auditPayload);
      return redirectBack(req, res, 'customer_changes');
    }

    if (request.request_type === 'add_fixed_service') {
      const [[account]] = await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: proposed.account_id });
      if (!account) throw new Error('Customer account not found.');
      let [[fixedAccount]] = await conn.execute(`SELECT id FROM fixed_accounts
        WHERE account_id=:id OR account_number_normalised=:normalised LIMIT 1`, {
        id: account.id,
        normalised: account.account_number_normalised
      });
      if (!fixedAccount) {
        const [createdAccount] = await conn.execute(`INSERT INTO fixed_accounts
          (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,
           assigned_staff_id,account_status,source_system)
          VALUES (:number,:normalised,:accountId,:name,:number,:staffId,'active','Talk2Me CRM')`, {
          number: account.account_number,
          normalised: account.account_number_normalised,
          accountId: account.id,
          name: account.display_name || account.account_number,
          staffId: account.assigned_staff_id || null
        });
        fixedAccount = { id: createdAccount.insertId };
      }
      const hash = crypto.createHash('sha256').update(`${account.id}|${proposed.solution_id || ''}|${proposed.order_number || ''}|${request.id}`).digest('hex');
      const [service] = await conn.execute(`INSERT INTO fixed_services
        (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,
         solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,cancellation_date,
         installation_address,technical_notes,source_row_hash,source_system)
        VALUES (:fixedAccountId,:title,:branch,:orderNumber,:router,:mac,
         UPPER(REPLACE(REPLACE(:mac,':',''),'-','')),:solutionId,:sim,:packageName,UPPER(TRIM(:packageName)),
         :activationDate,:serviceStatus,:cancellationDate,:installationAddress,:technicalNotes,:hash,'Talk2Me CRM')`, {
        fixedAccountId: fixedAccount.id,
        title: account.display_name || account.account_number,
        branch: proposed.branch_name,
        orderNumber: proposed.order_number || null,
        router: proposed.router_model || null,
        mac: proposed.mac_address || null,
        solutionId: proposed.solution_id || null,
        sim: proposed.sim_number || null,
        packageName: proposed.package_name || null,
        activationDate: proposed.activation_date || null,
        serviceStatus: proposed.service_status || 'active',
        cancellationDate: proposed.cancellation_date || null,
        installationAddress: proposed.installation_address || null,
        technicalNotes: proposed.technical_notes || null,
        hash
      });
      await markApplied(conn, request, req, { recordId: service.insertId });
      auditPayload = { actionType: 'fixed_service_approved', entityType: 'fixed_services', entityId: service.insertId, description: `Fixed service approved for ${account.account_number}`, after: proposed };
      await conn.commit();
      await safeAudit(req, auditPayload);
      return redirectBack(req, res, 'customer_changes');
    }

    if (request.request_type === 'assign_account_number') {
      const accountNumber = clean(req.body.account_number, 120);
      if (!accountNumber) throw new Error('Enter the official account number.');
      proposed.account_number = accountNumber;
    }

    const allowed = ['client_name','cell_number','email','city_town','package_name','handset','line_status','account_number','id_number','previous_upgrade_date','contract_term_months','main_contact_name','main_contact_number','account_authority_status'];
    const keys = Object.keys(proposed).filter(key => allowed.includes(key));
    if (!keys.length) throw new Error('No approved customer fields were supplied.');
    if (!request.client_id) throw new Error('This request is not linked to a customer record.');
    const set = keys.map(key => `\`${key}\`=:${key}`);
    if (keys.includes('cell_number')) set.push("cell_number_normalised=REPLACE(REPLACE(REPLACE(REPLACE(:cell_number,' ',''),'-',''),'(',''),')','')");
    set.push('updated_at=NOW()');
    await conn.execute(`UPDATE clients SET ${set.join(',')} WHERE id=:id`, { ...proposed, id: request.client_id });
    if (keys.includes('previous_upgrade_date') || keys.includes('contract_term_months')) {
      await conn.execute(`UPDATE clients SET next_upgrade_date=DATE_ADD(previous_upgrade_date,INTERVAL contract_term_months MONTH),
        upgrade_date=DATE_ADD(previous_upgrade_date,INTERVAL contract_term_months MONTH) WHERE id=:id`, { id: request.client_id });
    }
    await markApplied(conn, request, req, { proposal: proposed });
    auditPayload = { actionType: 'change_approved', entityType: 'clients', entityId: request.client_id, description: 'Approved customer change applied', after: proposed };
    await conn.commit();
    await safeAudit(req, auditPayload);
    return redirectBack(req, res, request.request_type.includes('account') ? 'account_changes' : 'customer_changes');
  } catch (error) {
    await conn.rollback();
    if (!error.code) {
      return res.status(409).render('error', { title: 'Approval could not be completed', message: error.message });
    }
    next(error);
  } finally {
    conn.release();
  }
});

module.exports = router;
