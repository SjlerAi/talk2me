const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const managementRoles = ['owner', 'admin', 'manager'];

function normaliseSaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? digits : null;
}

function clean(value) {
  return String(value || '').trim() || null;
}

async function notifyManagement(conn, user, clientId, message) {
  await conn.execute(`INSERT INTO staff_tasks
    (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
    SELECT 'notification','Account number required',:message,'high',s.id,:createdBy,NOW(),:clientId,'not_configured'
    FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','manager','admin')`, {
    message, createdBy: user.id, clientId
  });
}

router.get('/customers/:id/add-fixed', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[client]] = await db.execute('SELECT id,client_name,email,cell_number,account_number,account_id FROM clients WHERE id=:id LIMIT 1', { id });
    if (!client) return res.status(404).render('error', { title: 'Customer not found', message: 'The customer could not be found.' });
    if (String(client.account_number || '').trim() && client.account_id) return next();
    res.render('provisional-fixed-service', { title: 'Add Fixed Service Now', client, error: null });
  } catch (error) { next(error); }
});

router.post('/customers/:id/request-provisional-fixed-service', requireAuth, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [[client]] = await conn.execute('SELECT * FROM clients WHERE id=:id FOR UPDATE', { id });
    if (!client) throw new Error('Customer not found.');
    const fixedService = {
      branch_name: clean(req.body.branch_name),
      solution_id: clean(req.body.solution_id),
      order_number: clean(req.body.order_number),
      router_model: clean(req.body.router_model),
      mac_address: clean(req.body.mac_address),
      sim_number: clean(req.body.sim_number),
      package_name: clean(req.body.package_name),
      activation_date: req.body.activation_date || null,
      service_status: ['active','pending','suspended','cancelled','unknown'].includes(req.body.service_status) ? req.body.service_status : 'pending',
      installation_address: clean(req.body.installation_address),
      technical_notes: clean(req.body.technical_notes)
    };
    if (!fixedService.branch_name && !fixedService.installation_address) throw new Error('Enter a branch/site or installation address.');
    const proposed = {
      provisional_client_ids: [client.id],
      client_name: client.client_name,
      requested_account_number: null,
      fixed_service: fixedService
    };
    const [request] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by)
      VALUES ('assign_account_number','clients',:recordId,:clientId,NULL,:summary,:reason,:json,'manager','pending_manager',:requestedBy)`, {
      recordId: client.id,
      clientId: client.id,
      summary: `Assign account number and add fixed service for ${client.client_name || 'customer'}`,
      reason: 'Fixed service captured while the customer was present. Management must allocate the official account number.',
      json: JSON.stringify(proposed),
      requestedBy: req.session.user.id
    });
    await notifyManagement(conn, req.session.user, client.id,
      `${req.session.user.full_name} captured a provisional fixed service for ${client.client_name || 'a customer'}. Open Approvals, assign the official account number and approve request #${request.insertId}.`);
    await conn.commit();
    res.redirect(`${res.locals.basePath}/customers/${client.id}/360?change_requested=fixed-account-number`);
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally { conn.release(); }
});

router.post('/customers/:id/request-provisional-mobile-line', requireAuth, async (req, res, next) => {
  try {
    const phone = normaliseSaPhone(req.body.cell_number);
    if (!phone) return next();
    const [[duplicate]] = await db.execute(`SELECT c.id,c.client_name,c.cell_number,c.account_number,c.email,c.line_status,
      COALESCE(s.full_name,'Unassigned') assigned_staff_name
      FROM clients c
      LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2 WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number)) ORDER BY (a2.client_id=c.id) DESC LIMIT 1)
      LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE c.cell_number_normalised=:phone LIMIT 1`, { phone });
    if (!duplicate) return next();
    const [categories] = await db.query('SELECT id,category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order,category_name');
    return res.status(409).render('duplicate-number', {
      title: 'Duplicate Number Found', duplicate, categories,
      attempted: { client_name: clean(req.body.client_name), cell_number: clean(req.body.cell_number), email: clean(req.body.email), package_name: clean(req.body.package_name), handset: clean(req.body.handset) }
    });
  } catch (error) { next(error); }
});

router.post('/os/duplicate-number/inquiry', requireAuth, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const clientId = Number(req.body.client_id);
    const categoryId = Number(req.body.category_id);
    const [[client]] = await conn.execute('SELECT id,client_name,cell_number,email FROM clients WHERE id=:id LIMIT 1', { id: clientId });
    if (!client || !categoryId) throw new Error('Select the existing customer and an inquiry category.');
    const queryText = clean(req.body.query_text) || 'Duplicate number detected while capturing a new interaction.';
    const [result] = await conn.execute(`INSERT INTO inquiries
      (client_id,service_type,staff_id,walkin_or_call,client_name,cell_number,email,category_id,query_text,action_taken,status,follow_up_at)
      VALUES (:clientId,'mobile',:staffId,:source,:clientName,:cell,:email,:categoryId,:queryText,:actionTaken,'open',:followUp)`, {
      clientId: client.id,
      staffId: req.session.user.id,
      source: clean(req.body.walkin_or_call) || 'walk_in',
      clientName: client.client_name,
      cell: client.cell_number,
      email: client.email,
      categoryId,
      queryText,
      actionTaken: clean(req.body.action_taken) || 'Interaction retained against the existing customer. No duplicate line record was created.',
      followUp: req.body.follow_up_at || null
    });
    if (req.body.report_conflict === '1') {
      const proposed = {
        existing_client_id: client.id,
        existing_number: client.cell_number,
        reported_name: clean(req.body.reported_name),
        reported_notes: clean(req.body.conflict_notes),
        inquiry_id: result.insertId
      };
      await conn.execute(`INSERT INTO data_change_requests
        (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by)
        VALUES ('duplicate_number_review','clients',:recordId,:clientId,NULL,:summary,:reason,:json,'manager','pending_manager',:requestedBy)`, {
        recordId: client.id,
        clientId: client.id,
        summary: `Review duplicate cellphone number ${client.cell_number || ''}`,
        reason: 'Staff reported that the number may belong to a different or recycled customer.',
        json: JSON.stringify(proposed),
        requestedBy: req.session.user.id
      });
    }
    await conn.commit();
    res.redirect(`${res.locals.basePath}/customers/${client.id}/360?change_requested=duplicate-inquiry`);
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally { conn.release(); }
});

router.post('/approvals/:id/decision', requireAuth, async (req, res, next) => {
  const [[kind]] = await db.execute('SELECT request_type FROM data_change_requests WHERE id=:id LIMIT 1', { id: Number(req.params.id) });
  if (!kind || kind.request_type !== 'assign_account_number') return next();
  if (!managementRoles.includes(req.session.user.role)) return res.status(403).render('error', { title: 'Access denied', message: 'Only management can assign account numbers.' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute('SELECT * FROM data_change_requests WHERE id=:id FOR UPDATE', { id: Number(req.params.id) });
    if (!request || !['pending_manager','pending_owner'].includes(request.status)) throw new Error('This request is no longer pending.');
    if (req.body.decision === 'reject') {
      await conn.execute("UPDATE data_change_requests SET status='rejected',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment WHERE id=:id", { user:req.session.user.id, comment:req.body.comment||null, id:request.id });
      await conn.commit();
      return res.redirect(`${res.locals.basePath}/approvals`);
    }
    const accountNumber = clean(req.body.account_number);
    if (!accountNumber) throw new Error('Enter the official account number before approving.');
    const normalised = accountNumber.replace(/\s+/g, '').toUpperCase();
    const proposed = JSON.parse(request.proposed_data_json || '{}');
    const clientIds = [...new Set((proposed.provisional_client_ids || [request.client_id,request.record_id]).map(Number).filter(Boolean))];
    await conn.execute(`INSERT INTO customer_accounts (account_number,account_number_normalised,display_name,assigned_staff_id,assigned_by,assignment_confirmed_at)
      VALUES (:account,:normalised,:displayName,:staffId,:assignedBy,NOW())
      ON DUPLICATE KEY UPDATE display_name=COALESCE(NULLIF(customer_accounts.display_name,''),VALUES(display_name)),assigned_staff_id=COALESCE(customer_accounts.assigned_staff_id,VALUES(assigned_staff_id)),assigned_by=COALESCE(customer_accounts.assigned_by,VALUES(assigned_by)),assignment_confirmed_at=COALESCE(customer_accounts.assignment_confirmed_at,NOW())`, {
      account:accountNumber, normalised, displayName:proposed.client_name||accountNumber, staffId:request.requested_by, assignedBy:req.session.user.id
    });
    const [[account]] = await conn.execute('SELECT * FROM customer_accounts WHERE account_number_normalised=:normalised LIMIT 1', { normalised });
    if (clientIds.length) {
      const placeholders = clientIds.map(() => '?').join(',');
      await conn.query(`UPDATE clients SET account_id=?,account_number=?,updated_at=NOW() WHERE id IN (${placeholders})`, [account.id,account.account_number,...clientIds]);
      for (const clientId of clientIds) {
        await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
          VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
          ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
          clientId, accountNumber:account.account_number, staffId:request.requested_by, assignedBy:req.session.user.id
        });
      }
    }
    if (proposed.fixed_service) {
      let [[fixedAccount]] = await conn.execute('SELECT id FROM fixed_accounts WHERE account_id=:id OR account_number_normalised=:normalised LIMIT 1', { id:account.id, normalised });
      if (!fixedAccount) {
        const [created] = await conn.execute(`INSERT INTO fixed_accounts
          (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,assigned_staff_id,account_status,source_system)
          VALUES (:number,:normalised,:accountId,:name,:number,:staffId,'active','Talk2Me CRM')`, {
          number:account.account_number, normalised, accountId:account.id, name:proposed.client_name||account.account_number, staffId:request.requested_by
        });
        fixedAccount = { id:created.insertId };
      }
      const f = proposed.fixed_service;
      const hash = crypto.createHash('sha256').update(`${account.id}|${f.solution_id||''}|${f.order_number||''}|${request.id}`).digest('hex');
      await conn.execute(`INSERT INTO fixed_services
        (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,installation_address,technical_notes,source_row_hash,source_system)
        VALUES (:fixedAccountId,:title,:branch,:orderNumber,:router,:mac,UPPER(REPLACE(REPLACE(:mac,':',''),'-','')),:solutionId,:sim,:packageName,UPPER(TRIM(:packageName)),:activationDate,:serviceStatus,:installationAddress,:technicalNotes,:hash,'Talk2Me CRM')`, {
        fixedAccountId:fixedAccount.id, title:proposed.client_name||account.account_number, branch:f.branch_name, orderNumber:f.order_number, router:f.router_model,
        mac:f.mac_address, solutionId:f.solution_id, sim:f.sim_number, packageName:f.package_name, activationDate:f.activation_date,
        serviceStatus:f.service_status||'pending', installationAddress:f.installation_address, technicalNotes:f.technical_notes, hash
      });
    }
    await conn.execute("UPDATE data_change_requests SET status='applied',account_number=:accountNumber,reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id", {
      accountNumber:account.account_number, user:req.session.user.id, comment:req.body.comment||null, id:request.id
    });
    await conn.execute(`INSERT INTO staff_tasks (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      VALUES ('notification','Account number assigned',:message,'normal',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
      message:`Account ${account.account_number} was assigned to ${proposed.client_name||'the customer'}${proposed.fixed_service?' and the fixed service was created':''}.`,
      assignedTo:request.requested_by, createdBy:req.session.user.id, clientId:request.client_id
    });
    await conn.commit();
    res.redirect(`${res.locals.basePath}/approvals`);
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally { conn.release(); }
});

module.exports = router;
