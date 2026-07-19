const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

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

    if (String(client.account_number || '').trim() && client.account_id) {
      const account = encodeURIComponent(String(client.account_number).trim());
      const destination = managementRoles.includes(req.session.user.role)
        ? `${res.locals.basePath}/fixed/services/new?account_number=${account}`
        : `${res.locals.basePath}/fixed/services/request-new?account_number=${account}`;
      return res.redirect(`${destination}${isPanelRequest(req) ? '&panel=1' : ''}`);
    }

    return renderForm(req, res, client);
  } catch (error) {
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

    if (String(lockedClient.account_number || '').trim() && lockedClient.account_id) {
      await conn.rollback();
      conn.release();
      const account = encodeURIComponent(String(lockedClient.account_number).trim());
      const destination = managementRoles.includes(req.session.user.role)
        ? `${res.locals.basePath}/fixed/services/new?account_number=${account}`
        : `${res.locals.basePath}/fixed/services/request-new?account_number=${account}`;
      return res.redirect(`${destination}${isPanelRequest(req) ? '&panel=1' : ''}`);
    }

    const proposed = {
      provisional_client_ids: [lockedClient.id],
      client_name: lockedClient.client_name,
      requested_account_number: null,
      fixed_service: values
    };

    const [request] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,
       required_approval_role,status,requested_by)
      VALUES ('assign_account_number','clients',:recordId,:clientId,NULL,:summary,:reason,:json,
       'manager','pending_manager',:requestedBy)`, {
      recordId: lockedClient.id,
      clientId: lockedClient.id,
      summary: `Assign account number and add fixed service for ${lockedClient.client_name || 'customer'}`,
      reason: 'Fixed service captured while the customer was present. Management must allocate the official account number.',
      json: JSON.stringify(proposed),
      requestedBy: req.session.user.id
    });

    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification','Account number required',:message,'high',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','manager','admin')`, {
      message: `${req.session.user.full_name} captured a provisional fixed service for ${lockedClient.client_name || 'a customer'}. Open Approvals, assign the official account number and approve request #${request.insertId}.`,
      createdBy: req.session.user.id,
      clientId: lockedClient.id
    });

    await conn.commit();
    conn.release();
    const suffix = isPanelRequest(req) ? '&panel=1' : '';
    return res.redirect(`${res.locals.basePath}/customers/${lockedClient.id}/360?change_requested=fixed-account-number${suffix}`);
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('Provisional fixed service save failed:', error);
    return renderForm(
      req,
      res,
      client,
      'The fixed service could not be saved. No database changes were kept. Please check the details and try again.',
      values,
      400
    );
  }
});

module.exports = router;
