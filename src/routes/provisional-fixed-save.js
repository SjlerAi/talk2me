const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { readLinkedAccount } = require('../services/customer-account-link');

const router = express.Router();
const managementRoles = ['owner', 'manager', 'admin'];

function clean(value) {
  return String(value || '').trim() || null;
}

function isPanelRequest(req) {
  return String(req.query.panel || req.body?.panel || '') === '1';
}

function renderForm(req, res, client, error = null, values = {}, status = 200) {
  return res.status(status).render('provisional-fixed-service', {
    title: 'Add Fixed Service Now',
    client,
    error,
    values,
    panelMode: isPanelRequest(req)
  });
}

router.get('/customers/:id/add-fixed', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[client]] = await db.execute(
      'SELECT id,client_name,email,cell_number,account_number,account_id FROM clients WHERE id=:id LIMIT 1',
      { id }
    );

    if (!client) {
      return res.status(404).render('error', {
        title: 'Customer not found',
        message: 'The customer could not be found.'
      });
    }

    const linked = await readLinkedAccount(db, client);
    if (linked) {
      const account = encodeURIComponent(linked.account_number);
      const destination = managementRoles.includes(req.session.user.role)
        ? `${res.locals.basePath}/fixed/services/new?account_number=${account}`
        : `${res.locals.basePath}/fixed/services/request-new?account_number=${account}`;
      return res.redirect(`${destination}${isPanelRequest(req) ? '&panel=1' : ''}`);
    }

    return renderForm(req, res, client);
  } catch (error) {
    if (error.code === 'ACCOUNT_LINK_REVIEW_REQUIRED') return res.status(409).render('error', { title: 'Account review required', message: error.message });
    next(error);
  }
});

router.post('/customers/:id/request-provisional-fixed-service', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  const values = {
    branch_name: clean(req.body.branch_name),
    solution_id: clean(req.body.solution_id),
    order_number: clean(req.body.order_number),
    router_model: clean(req.body.router_model),
    mac_address: clean(req.body.mac_address),
    sim_number: clean(req.body.sim_number),
    package_name: clean(req.body.package_name),
    activation_date: clean(req.body.activation_date),
    service_status: ['active', 'pending', 'suspended', 'cancelled', 'unknown'].includes(req.body.service_status)
      ? req.body.service_status
      : 'pending',
    installation_address: clean(req.body.installation_address),
    technical_notes: clean(req.body.technical_notes)
  };

  let client;
  try {
    [[client]] = await db.execute(
      'SELECT id,client_name,email,cell_number,account_number,account_id FROM clients WHERE id=:id LIMIT 1',
      { id }
    );
  } catch (error) {
    return next(error);
  }

  if (!client) {
    return res.status(404).render('error', {
      title: 'Customer not found',
      message: 'The customer could not be found.'
    });
  }

  if (!values.branch_name && !values.installation_address) {
    return renderForm(
      req,
      res,
      client,
      'Enter either a branch/site name or an installation address before saving the fixed service.',
      values,
      400
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[lockedClient]] = await conn.execute('SELECT * FROM clients WHERE id=:id FOR UPDATE', { id });
    if (!lockedClient) throw new Error('Customer not found.');

    // The account may have been linked while the form was open. Keep the
    // captured service details in the same approval transaction instead of
    // redirecting to a blank form. No staff approval rights are bypassed.
    const linked = await readLinkedAccount(conn, lockedClient);
    const capturedAccount = clean(linked?.account_number || lockedClient.account_number);

    const proposed = {
      provisional_client_ids: [lockedClient.id],
      client_name: lockedClient.client_name,
      requested_account_number: capturedAccount,
      fixed_service: values
    };

    const [request] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,
       required_approval_role,status,requested_by)
      VALUES ('assign_account_number','clients',:recordId,:clientId,:accountNumber,:summary,:reason,:json,
       'manager','pending_manager',:requestedBy)`, {
      recordId: lockedClient.id,
      clientId: lockedClient.id,
      accountNumber: capturedAccount,
      summary: capturedAccount ? `Confirm existing account and add fixed service for ${lockedClient.client_name || 'customer'}` : `Assign account number and add fixed service for ${lockedClient.client_name || 'customer'}`,
      reason: capturedAccount ? 'Fixed service captured against an existing account number. Management must confirm the link and approve the service.' : 'Fixed service captured while the customer was present. Management must allocate the official account number.',
      json: JSON.stringify(proposed),
      requestedBy: req.session.user.id
    });

    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification',:title,:message,'high',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','manager','admin')`, {
      title: capturedAccount ? 'Fixed service approval required' : 'Account number required',
      message: capturedAccount ? `${req.session.user.full_name} captured a fixed service against an existing account number. Open Approvals, confirm the account link and approve request #${request.insertId}.` : `${req.session.user.full_name} captured a provisional fixed service for ${lockedClient.client_name || 'a customer'}. Open Approvals, assign the official account number and approve request #${request.insertId}.`,
      createdBy: req.session.user.id,
      clientId: lockedClient.id
    });

    await conn.commit();
    conn.release();
    const suffix = isPanelRequest(req) ? '&panel=1' : '';
    return res.redirect(`${res.locals.basePath}/customers/${lockedClient.id}/360?change_requested=${capturedAccount ? 'fixed-account-link' : 'fixed-account-number'}${suffix}`);
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('Provisional fixed service save failed:', error);
    return renderForm(
      req,
      res,
      client,
      error.code === 'ACCOUNT_LINK_REVIEW_REQUIRED' ? error.message : 'The fixed service could not be saved. No database changes were kept. Please check the details and try again.',
      values,
      400
    );
  }
});

module.exports = router;
