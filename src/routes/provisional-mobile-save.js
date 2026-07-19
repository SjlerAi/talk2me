const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function clean(value) {
  return String(value || '').trim() || null;
}

function normaliseSaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? digits : null;
}

function addMonths(dateValue, months) {
  if (!dateValue) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

async function loadDuplicate(phone) {
  const [[duplicate]] = await db.execute(`SELECT c.id,c.client_name,c.cell_number,c.account_number,c.email,c.line_status,
      COALESCE(s.full_name,'Unassigned') assigned_staff_name
    FROM clients c
    LEFT JOIN client_assignments a ON a.id=(
      SELECT a2.id FROM client_assignments a2
      WHERE a2.is_active=1
        AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number))
      ORDER BY (a2.client_id=c.id) DESC,a2.updated_at DESC LIMIT 1
    )
    LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
    WHERE c.cell_number_normalised=:phone
    ORDER BY c.id LIMIT 1`, { phone });
  return duplicate || null;
}

router.post('/customers/:id/request-provisional-mobile-line', requireAuth, async (req, res, next) => {
  const parentId = Number(req.params.id);
  const cell = clean(req.body.cell_number);
  const phone = normaliseSaPhone(cell);

  try {
    const [[parent]] = await db.execute(
      'SELECT id,client_name,email,account_number,account_id FROM clients WHERE id=:id LIMIT 1',
      { id: parentId }
    );
    if (!parent) {
      return res.status(404).render('error', { title: 'Customer not found', message: 'The customer could not be found.' });
    }

    if (!cell || !phone) {
      return res.status(400).render('mobile-line-request', {
        title: 'Add Provisional Mobile Line',
        client: { ...parent, canonical_account_number: 'Pending manager allocation' },
        provisional: true,
        formAction: `${res.locals.basePath}/customers/${parentId}/request-provisional-mobile-line`,
        backUrl: `${res.locals.basePath}/customers/${parentId}/360`,
        error: 'Enter a valid South African cellphone number.'
      });
    }

    const duplicate = await loadDuplicate(phone);
    if (duplicate) {
      const [categories] = await db.query('SELECT id,category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order,category_name');
      return res.status(409).render('duplicate-number', {
        title: 'Duplicate Number Found',
        duplicate,
        categories,
        attempted: {
          client_name: clean(req.body.client_name),
          cell_number: cell,
          email: clean(req.body.email),
          package_name: clean(req.body.package_name),
          handset: clean(req.body.handset)
        }
      });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[lockedParent]] = await conn.execute('SELECT * FROM clients WHERE id=:id FOR UPDATE', { id: parentId });
      if (!lockedParent) throw new Error('Customer not found.');

      const [[raceDuplicate]] = await conn.execute(
        'SELECT id FROM clients WHERE cell_number_normalised=:phone LIMIT 1 FOR UPDATE',
        { phone }
      );
      if (raceDuplicate) {
        await conn.rollback();
        conn.release();
        const found = await loadDuplicate(phone);
        const [categories] = await db.query('SELECT id,category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order,category_name');
        return res.status(409).render('duplicate-number', {
          title: 'Duplicate Number Found',
          duplicate: found,
          categories,
          attempted: {
            client_name: clean(req.body.client_name),
            cell_number: cell,
            email: clean(req.body.email),
            package_name: clean(req.body.package_name),
            handset: clean(req.body.handset)
          }
        });
      }

      const previous = clean(req.body.previous_upgrade_date);
      const term = Number(req.body.contract_term_months) === 36 ? 36 : 24;
      const nextUpgrade = addMonths(previous, term);
      const clientName = clean(req.body.client_name) || lockedParent.client_name || 'Provisional customer';
      const email = clean(req.body.email) || lockedParent.email || null;

      const [created] = await conn.execute(`INSERT INTO clients
        (account_id,account_number,client_name,cell_number,cell_number_normalised,email,package_name,handset,
         previous_upgrade_date,contract_term_months,next_upgrade_date,upgrade_date,customer_type,lifecycle_status,
         line_status,created_by_staff_id,is_active,notes)
        VALUES (NULL,NULL,:clientName,:cell,:phone,:email,:packageName,:handset,:previous,:term,:nextUpgrade,
         :nextUpgrade,'unknown','client','active',:createdBy,1,:notes)`, {
        clientName,
        cell,
        phone,
        email: email ? String(email).toLowerCase() : null,
        packageName: clean(req.body.package_name),
        handset: clean(req.body.handset),
        previous,
        term,
        nextUpgrade,
        createdBy: req.session.user.id,
        notes: `Provisional mobile line awaiting account number. Parent client ID ${lockedParent.id}.`
      });

      await conn.execute(`INSERT INTO client_assignments
        (client_id,account_number,assigned_staff_id,assigned_by,is_active)
        VALUES (:clientId,'',:staffId,:staffId,1)
        ON DUPLICATE KEY UPDATE assigned_staff_id=VALUES(assigned_staff_id),assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
        clientId: created.insertId,
        staffId: req.session.user.id
      });

      const proposed = {
        provisional_client_ids: [lockedParent.id, created.insertId],
        provisional_line_id: created.insertId,
        client_name: lockedParent.client_name || clientName,
        cell_number: cell,
        requested_account_number: null
      };

      const [request] = await conn.execute(`INSERT INTO data_change_requests
        (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,
         required_approval_role,status,requested_by)
        VALUES ('assign_account_number','clients',:recordId,:clientId,NULL,:summary,:reason,:json,
         'manager','pending_manager',:requestedBy)`, {
        recordId: created.insertId,
        clientId: lockedParent.id,
        summary: `Assign account number for ${lockedParent.client_name || cell}`,
        reason: 'Mobile line captured while customer was present. Account number must be completed by management.',
        json: JSON.stringify(proposed),
        requestedBy: req.session.user.id
      });

      await conn.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
        SELECT 'notification','Account number required',:message,'high',s.id,:createdBy,NOW(),:clientId,'not_configured'
        FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','manager','admin')`, {
        message: `${req.session.user.full_name} captured provisional mobile line ${cell} for ${lockedParent.client_name || clientName}. Open Approvals and assign the official account number. Request #${request.insertId}.`,
        createdBy: req.session.user.id,
        clientId: lockedParent.id
      });

      await conn.commit();
      conn.release();
      return res.redirect(`${res.locals.basePath}/customers/${lockedParent.id}/360?change_requested=account-number`);
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      conn.release();
      console.error('Provisional mobile line save failed:', error);
      return res.status(400).render('mobile-line-request', {
        title: 'Add Provisional Mobile Line',
        client: { ...parent, canonical_account_number: 'Pending manager allocation' },
        provisional: true,
        formAction: `${res.locals.basePath}/customers/${parentId}/request-provisional-mobile-line`,
        backUrl: `${res.locals.basePath}/customers/${parentId}/360`,
        error: 'The line could not be saved. No database changes were kept. Please check the details and try again.'
      });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
