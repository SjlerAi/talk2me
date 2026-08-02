'use strict';

const express = require('express');
const { withTransaction } = require('./core/transactions');
const { appendAudit } = require('./core/audit');
const { transitionWorkItem } = require('./core/work-items');
const { requirePermission } = require('./core/permissions');

function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function normalisePhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('27') && phone.length === 11) phone = `0${phone.slice(2)}`;
  return phone;
}
function requestContext(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}

module.exports = function createIntegratedRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.get('/api/os2/customers/search', async (req, res) => {
    const query = text(req.query.q, 180);
    if (!query || query.length < 2) return res.json({ ok: true, customers: [] });
    try {
      const like = `%${query}%`;
      const canonical = normalisePhone(query);
      const [rows] = await pool.execute(`
        SELECT mc.id, mc.customer_type, mc.display_name, mc.responsible_person,
               mc.primary_mobile, mc.primary_email, mc.town, mc.status,
               o.assigned_staff_id, su.full_name AS owner_name,
               GROUP_CONCAT(DISTINCT a.account_number ORDER BY a.account_number SEPARATOR ', ') AS account_numbers,
               COUNT(DISTINCT ml.id) AS mobile_line_count,
               COUNT(DISTINCT fs.id) AS fixed_service_count
          FROM os2_master_customers mc
          LEFT JOIN os2_customer_accounts a ON a.master_customer_id=mc.id AND a.archived_at IS NULL
          LEFT JOIN os2_mobile_lines ml ON ml.master_customer_id=mc.id AND ml.archived_at IS NULL
          LEFT JOIN os2_fixed_accounts fa ON fa.master_customer_id=mc.id AND fa.archived_at IS NULL
          LEFT JOIN os2_fixed_services fs ON fs.fixed_account_id=fa.id AND fs.archived_at IS NULL
          LEFT JOIN os2_customer_ownership o ON o.master_customer_id=mc.id AND o.is_current=1
          LEFT JOIN staff_users su ON su.id=o.assigned_staff_id
         WHERE mc.archived_at IS NULL AND (
               mc.display_name LIKE :like OR mc.responsible_person LIKE :like OR
               mc.primary_mobile LIKE :like OR mc.primary_email LIKE :like OR mc.town LIKE :like OR
               EXISTS (SELECT 1 FROM os2_customer_accounts ca WHERE ca.master_customer_id=mc.id AND ca.account_number LIKE :like AND ca.archived_at IS NULL) OR
               EXISTS (SELECT 1 FROM os2_mobile_lines x WHERE x.master_customer_id=mc.id AND (x.mobile_number LIKE :like OR x.sim_number LIKE :like OR x.imei LIKE :like) AND x.archived_at IS NULL) OR
               EXISTS (SELECT 1 FROM os2_fixed_accounts y WHERE y.master_customer_id=mc.id AND y.fixed_account_number LIKE :like AND y.archived_at IS NULL) OR
               EXISTS (SELECT 1 FROM os2_fixed_services z JOIN os2_fixed_accounts q ON q.id=z.fixed_account_id WHERE q.master_customer_id=mc.id AND (z.mac_address LIKE :like OR z.solution_id LIKE :like OR z.order_number LIKE :like) AND z.archived_at IS NULL)
             )
         GROUP BY mc.id, o.assigned_staff_id, su.full_name
         ORDER BY (mc.primary_mobile=:canonical) DESC, mc.display_name
         LIMIT 25`, { like, canonical });
      res.json({ ok: true, customers: rows });
    } catch (error) {
      console.error('Integrated customer search failed', error.code || error.message);
      res.status(500).json({ ok: false, error: 'CUSTOMER_SEARCH_FAILED' });
    }
  });

  router.post('/api/os2/customers/quick-onboard', requirePermission('customer.create'), async (req, res) => {
    const displayName = text(req.body.displayName, 200);
    const responsiblePerson = text(req.body.responsiblePerson, 200);
    const primaryMobile = normalisePhone(req.body.primaryMobile);
    const primaryEmail = text(req.body.primaryEmail, 254)?.toLowerCase() || null;
    const accountNumber = text(req.body.accountNumber, 100);
    const customerType = req.body.customerType === 'business' ? 'business' : 'individual';
    const assignedStaffId = positiveId(req.body.assignedStaffId) || Number(req.user.id);
    if (!displayName || !primaryMobile || !accountNumber) {
      return res.status(400).json({ ok: false, error: 'NAME_MOBILE_ACCOUNT_REQUIRED' });
    }
    try {
      const result = await withTransaction(pool, async connection => {
        const [duplicates] = await connection.execute(`
          SELECT mc.id, mc.display_name, mc.primary_mobile, mc.primary_email,
                 GROUP_CONCAT(DISTINCT ca.account_number SEPARATOR ', ') account_numbers
            FROM os2_master_customers mc
            LEFT JOIN os2_customer_accounts ca ON ca.master_customer_id=mc.id AND ca.archived_at IS NULL
           WHERE mc.archived_at IS NULL AND (
                 mc.primary_mobile=:primaryMobile OR
                 (:primaryEmail IS NOT NULL AND mc.primary_email=:primaryEmail) OR
                 ca.normalised_account_number=UPPER(REPLACE(REPLACE(:accountNumber,' ',''),'-',''))
               )
           GROUP BY mc.id FOR UPDATE`, { primaryMobile, primaryEmail, accountNumber });
        if (duplicates.length) {
          const error = new Error('POSSIBLE_DUPLICATE_REQUIRES_CONFIRMATION');
          error.statusCode = 409;
          error.details = duplicates;
          throw error;
        }
        const [customerInsert] = await connection.execute(`
          INSERT INTO os2_master_customers
            (customer_type, display_name, responsible_person, primary_mobile, primary_email, town,
             short_note, status, created_by, updated_by, created_at, updated_at)
          VALUES
            (:customerType,:displayName,:responsiblePerson,:primaryMobile,:primaryEmail,:town,
             :shortNote,'active',:actor,:actor,NOW(),NOW())`, {
          customerType, displayName, responsiblePerson, primaryMobile, primaryEmail,
          town: text(req.body.town, 150), shortNote: text(req.body.shortNote, 1000), actor: Number(req.user.id)
        });
        const masterCustomerId = Number(customerInsert.insertId);
        const [accountInsert] = await connection.execute(`
          INSERT INTO os2_customer_accounts
            (master_customer_id, account_number, normalised_account_number, account_type,
             expected_line_count, created_by, updated_by, created_at, updated_at)
          VALUES
            (:masterCustomerId,:accountNumber,UPPER(REPLACE(REPLACE(:accountNumber,' ',''),'-','')),
             :customerType,:lineCount,:actor,:actor,NOW(),NOW())`, {
          masterCustomerId, accountNumber, customerType,
          lineCount: positiveId(req.body.numberOfLines), actor: Number(req.user.id)
        });
        await connection.execute(`
          INSERT INTO os2_customer_ownership
            (master_customer_id, assigned_staff_id, ownership_reason, is_current,
             effective_from, created_by, created_at)
          VALUES (:masterCustomerId,:assignedStaffId,'quick_onboarding',1,NOW(),:actor,NOW())`, {
          masterCustomerId, assignedStaffId, actor: Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId: req.user.id,
          actionType: 'master_customer_created',
          entityType: 'os2_master_customers',
          entityId: masterCustomerId,
          masterCustomerId,
          description: `Created Master Customer ${displayName}`,
          after: { account_id: Number(accountInsert.insertId), account_number: accountNumber, assigned_staff_id: assignedStaffId },
          requestContext: requestContext(req)
        });
        return { masterCustomerId, accountId: Number(accountInsert.insertId) };
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (error.message === 'POSSIBLE_DUPLICATE_REQUIRES_CONFIRMATION') {
        return res.status(409).json({ ok: false, error: error.message, candidates: error.details });
      }
      console.error('Quick onboarding failed', error.code || error.message);
      res.status(error.statusCode || 500).json({ ok: false, error: error.statusCode ? error.message : 'QUICK_ONBOARDING_FAILED' });
    }
  });

  router.get('/api/os2/customers/:id/360', async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'INVALID_CUSTOMER_ID' });
    try {
      const [[customer]] = await pool.execute(`
        SELECT mc.*, o.assigned_staff_id, su.full_name owner_name
          FROM os2_master_customers mc
          LEFT JOIN os2_customer_ownership o ON o.master_customer_id=mc.id AND o.is_current=1
          LEFT JOIN staff_users su ON su.id=o.assigned_staff_id
         WHERE mc.id=:id AND mc.archived_at IS NULL`, { id });
      if (!customer) return res.status(404).json({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
      const [accounts, mobileLines, fixedServices, contacts, representatives, restrictions, documents, workItems, audit] = await Promise.all([
        pool.execute('SELECT * FROM os2_customer_accounts WHERE master_customer_id=:id AND archived_at IS NULL ORDER BY is_primary DESC, account_number', { id }).then(([r]) => r),
        pool.execute('SELECT * FROM os2_mobile_lines WHERE master_customer_id=:id AND archived_at IS NULL ORDER BY mobile_number', { id }).then(([r]) => r),
        pool.execute(`SELECT fs.*,fa.fixed_account_number FROM os2_fixed_services fs JOIN os2_fixed_accounts fa ON fa.id=fs.fixed_account_id WHERE fa.master_customer_id=:id AND fs.archived_at IS NULL AND fa.archived_at IS NULL ORDER BY fs.service_name`, { id }).then(([r]) => r),
        pool.execute('SELECT * FROM os2_customer_contacts WHERE master_customer_id=:id AND archived_at IS NULL ORDER BY is_primary DESC, full_name', { id }).then(([r]) => r),
        pool.execute('SELECT * FROM os2_authorised_representatives WHERE master_customer_id=:id AND revoked_at IS NULL ORDER BY full_name', { id }).then(([r]) => r),
        pool.execute('SELECT * FROM os2_customer_restrictions WHERE master_customer_id=:id AND is_active=1 ORDER BY restriction_type', { id }).then(([r]) => r),
        pool.execute('SELECT id,document_type,original_filename,mime_type,file_size,verification_status,created_at FROM os2_customer_documents WHERE master_customer_id=:id AND archived_at IS NULL ORDER BY created_at DESC', { id }).then(([r]) => r),
        pool.execute(`SELECT * FROM os2_work_items WHERE master_customer_id=:id AND lifecycle_state<>'archived' ORDER BY COALESCE(due_at,start_at,created_at), priority DESC`, { id }).then(([r]) => r),
        pool.execute('SELECT action_type,entity_type,entity_id,description,created_at,actor_staff_id FROM os2_audit_log WHERE master_customer_id=:id ORDER BY created_at DESC LIMIT 100', { id }).then(([r]) => r)
      ]);
      res.json({ ok: true, customer, accounts, mobileLines, fixedServices, contacts, representatives, restrictions, documents, workItems, audit });
    } catch (error) {
      console.error('Customer 360 failed', error.code || error.message);
      res.status(500).json({ ok: false, error: 'CUSTOMER_360_FAILED' });
    }
  });

  router.get('/api/os2/work-items', async (req, res) => {
    const assignee = req.query.scope === 'team' && ['owner','manager','admin'].includes(req.user.role) ? null : Number(req.user.id);
    const state = text(req.query.state, 30);
    const where = ['w.archived_at IS NULL'];
    const params = {};
    if (assignee) { where.push('w.assigned_staff_id=:assignee'); params.assignee = assignee; }
    if (state) { where.push('w.lifecycle_state=:state'); params.state = state; }
    const [rows] = await pool.execute(`
      SELECT w.*, mc.display_name customer_name, su.full_name assignee_name
        FROM os2_work_items w
        LEFT JOIN os2_master_customers mc ON mc.id=w.master_customer_id
        LEFT JOIN staff_users su ON su.id=w.assigned_staff_id
       WHERE ${where.join(' AND ')}
       ORDER BY FIELD(w.priority,'urgent','high','normal','low'), COALESCE(w.due_at,w.start_at,w.created_at)`, params);
    res.json({ ok: true, workItems: rows });
  });

  router.post('/api/os2/work-items', async (req, res) => {
    const title = text(req.body.title, 240);
    const type = text(req.body.type, 40) || 'task';
    if (!title) return res.status(400).json({ ok: false, error: 'TITLE_REQUIRED' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [insert] = await connection.execute(`
          INSERT INTO os2_work_items
            (work_type,title,description,priority,lifecycle_state,created_by,owner_staff_id,
             assigned_staff_id,master_customer_id,account_id,inquiry_id,start_at,due_at,reminder_at,
             recurrence_rule,created_at,updated_at)
          VALUES
            (:type,:title,:description,:priority,'created',:actor,:owner,:assignee,:customerId,
             :accountId,:inquiryId,:startAt,:dueAt,:reminderAt,:recurrenceRule,NOW(),NOW())`, {
          type, title, description: text(req.body.description, 5000),
          priority: ['low','normal','high','urgent'].includes(req.body.priority) ? req.body.priority : 'normal',
          actor: Number(req.user.id), owner: Number(req.user.id),
          assignee: positiveId(req.body.assignedStaffId) || Number(req.user.id),
          customerId: positiveId(req.body.masterCustomerId), accountId: positiveId(req.body.accountId),
          inquiryId: positiveId(req.body.inquiryId), startAt: req.body.startAt || null,
          dueAt: req.body.dueAt || null, reminderAt: req.body.reminderAt || null,
          recurrenceRule: text(req.body.recurrenceRule, 500)
        });
        const id = Number(insert.insertId);
        await connection.execute(`INSERT INTO os2_work_item_history (work_item_id,from_state,to_state,note,changed_by,created_at) VALUES (:id,NULL,'created','Work item created',:actor,NOW())`, { id, actor: Number(req.user.id) });
        await appendAudit(connection, { actorStaffId:req.user.id, actionType:'work_item_created', entityType:'os2_work_items', entityId:id, masterCustomerId:positiveId(req.body.masterCustomerId), description:`Created ${type}: ${title}`, after:req.body, requestContext:requestContext(req) });
        return id;
      });
      res.status(201).json({ ok: true, workItemId: result });
    } catch (error) {
      console.error('Create work item failed', error.code || error.message);
      res.status(500).json({ ok: false, error: 'WORK_ITEM_CREATE_FAILED' });
    }
  });

  router.post('/api/os2/work-items/:id/transition', async (req, res) => {
    try {
      const result = await withTransaction(pool, connection => transitionWorkItem(connection, {
        workItemId: req.params.id, toState: text(req.body.toState, 30), note: text(req.body.note, 5000),
        actorStaffId: req.user.id, requestContext: requestContext(req)
      }));
      res.json({ ok: true, transition: result });
    } catch (error) {
      const known = ['WORK_ITEM_NOT_FOUND','INVALID_WORK_ITEM_TRANSITION'].includes(error.message);
      res.status(known ? 400 : 500).json({ ok: false, error: known ? error.message : 'WORK_ITEM_TRANSITION_FAILED', details: error.details });
    }
  });

  router.get('/api/os2/sticky-notes', async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM os2_sticky_notes WHERE staff_id=:staffId AND archived_at IS NULL ORDER BY is_pinned DESC, updated_at DESC', { staffId:Number(req.user.id) });
    res.json({ ok:true, notes:rows });
  });
  router.post('/api/os2/sticky-notes', async (req, res) => {
    const body = text(req.body.body, 10000);
    if (!body) return res.status(400).json({ ok:false, error:'NOTE_BODY_REQUIRED' });
    const [result] = await pool.execute(`INSERT INTO os2_sticky_notes (staff_id,title,body,colour,category,is_pinned,is_minimised,position_x,position_y,width_px,height_px,master_customer_id,remind_at,created_at,updated_at) VALUES (:staffId,:title,:body,:colour,:category,:pinned,:minimised,:x,:y,:width,:height,:customerId,:remindAt,NOW(),NOW())`, {
      staffId:Number(req.user.id), title:text(req.body.title,200), body, colour:text(req.body.colour,30)||'yellow', category:text(req.body.category,100), pinned:req.body.isPinned?1:0, minimised:req.body.isMinimised?1:0, x:Number(req.body.positionX||40), y:Number(req.body.positionY||80), width:Number(req.body.widthPx||320), height:Number(req.body.heightPx||220), customerId:positiveId(req.body.masterCustomerId), remindAt:req.body.remindAt||null
    });
    res.status(201).json({ ok:true, noteId:Number(result.insertId) });
  });
  router.patch('/api/os2/sticky-notes/:id', async (req, res) => {
    const id = positiveId(req.params.id);
    const [result] = await pool.execute(`UPDATE os2_sticky_notes SET title=:title,body=:body,colour=:colour,category=:category,is_pinned=:pinned,is_minimised=:minimised,position_x=:x,position_y=:y,width_px=:width,height_px=:height,master_customer_id=:customerId,remind_at=:remindAt,updated_at=NOW() WHERE id=:id AND staff_id=:staffId AND archived_at IS NULL`, {
      id, staffId:Number(req.user.id), title:text(req.body.title,200), body:text(req.body.body,10000), colour:text(req.body.colour,30)||'yellow', category:text(req.body.category,100), pinned:req.body.isPinned?1:0, minimised:req.body.isMinimised?1:0, x:Number(req.body.positionX||40), y:Number(req.body.positionY||80), width:Number(req.body.widthPx||320), height:Number(req.body.heightPx||220), customerId:positiveId(req.body.masterCustomerId), remindAt:req.body.remindAt||null
    });
    res.json({ ok:true, updated:result.affectedRows===1 });
  });
  router.delete('/api/os2/sticky-notes/:id', async (req, res) => {
    const [result] = await pool.execute('UPDATE os2_sticky_notes SET archived_at=NOW(),updated_at=NOW() WHERE id=:id AND staff_id=:staffId AND archived_at IS NULL', { id:positiveId(req.params.id), staffId:Number(req.user.id) });
    res.json({ ok:true, archived:result.affectedRows===1 });
  });

  router.get('/api/os2/calendar', async (req, res) => {
    const start = req.query.start || new Date().toISOString().slice(0,10);
    const end = req.query.end || new Date(Date.now()+31*86400000).toISOString().slice(0,10);
    const team = req.query.scope === 'team' && ['owner','manager','admin'].includes(req.user.role);
    const [rows] = await pool.execute(`SELECT w.*,mc.display_name customer_name,su.full_name assignee_name FROM os2_work_items w LEFT JOIN os2_master_customers mc ON mc.id=w.master_customer_id LEFT JOIN staff_users su ON su.id=w.assigned_staff_id WHERE w.archived_at IS NULL AND (:team=1 OR w.assigned_staff_id=:staffId) AND COALESCE(w.start_at,w.due_at,w.reminder_at) >= :start AND COALESCE(w.start_at,w.due_at,w.reminder_at) < DATE_ADD(:end,INTERVAL 1 DAY) ORDER BY COALESCE(w.start_at,w.due_at,w.reminder_at)`, { team:team?1:0, staffId:Number(req.user.id), start, end });
    res.json({ ok:true, events:rows });
  });

  return router;
};
