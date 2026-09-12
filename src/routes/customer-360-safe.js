const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function logSectionFailure(section, clientId, error) {
  console.error(`[customer-360] ${section} failed for client ${clientId}:`, error && error.message ? error.message : error);
}

async function optionalSection(section, clientId, fallback, loader) {
  try {
    return await loader();
  } catch (error) {
    logSectionFailure(section, clientId, error);
    return fallback;
  }
}

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

async function loadCustomerNoteContext(clientId) {
  const [[client]] = await db.execute(
    'SELECT id,client_name,cell_number,email,account_number FROM clients WHERE id=:id LIMIT 1',
    { id: clientId }
  );
  if (!client) return null;

  const [staff] = await db.query(
    'SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name'
  );

  const assignment = await optionalSection('customer note assignment', clientId, null, async () => {
    const [[row]] = await db.execute(
      `SELECT assigned_staff_id
       FROM client_assignments
       WHERE is_active=1
         AND (client_id=:id OR (:account<>'' AND account_number=:account))
       ORDER BY (client_id=:id) DESC,updated_at DESC LIMIT 1`,
      { id: clientId, account: client.account_number || '' }
    );
    return row || null;
  });

  return {
    client,
    staff,
    assignedStaffId: assignment?.assigned_staff_id || null
  };
}

router.get('/customers/:id/notes/new', requireAuth, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).render('error', {
        title: 'Invalid customer',
        message: 'The customer record could not be identified.'
      });
    }

    const context = await loadCustomerNoteContext(clientId);
    if (!context) {
      return res.status(404).render('error', {
        title: 'Customer not found',
        message: 'The customer could not be found.'
      });
    }

    res.render('customer-note-add', {
      layout: false,
      title: 'Add Customer Note',
      ...context,
      error: null,
      values: {
        assigned_staff_id: context.assignedStaffId || req.session.user.id,
        note_type: 'inquiry',
        contact_method: 'walk_in'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/customers/:id/notes', requireAuth, async (req, res, next) => {
  const clientId = Number(req.params.id);
  const values = req.body || {};

  try {
    const context = await loadCustomerNoteContext(clientId);
    if (!context) {
      return res.status(404).render('error', {
        title: 'Customer not found',
        message: 'The customer could not be found.'
      });
    }

    const subject = clean(values.subject, 255);
    const noteText = clean(values.note_text);
    const assignedStaffId = Number(values.assigned_staff_id || 0) || req.session.user.id;
    const followUpRequired = values.follow_up_required === '1';
    const followUpAt = values.follow_up_at || null;
    const noteTypes = {
      inquiry: 'Customer Inquiry',
      call: 'Customer Call',
      walk_in: 'Walk-in Interaction',
      complaint: 'Customer Complaint',
      information: 'Customer Information',
      sales: 'Sales Opportunity',
      other: 'Customer Note'
    };
    const noteType = noteTypes[values.note_type] || noteTypes.other;
    const contactMethods = {
      walk_in: 'walk_in',
      phone: 'phone_call',
      phone_call: 'phone_call',
      email: 'email',
      whatsapp: 'whatsapp',
      other: 'other'
    };
    const contactMethod = contactMethods[values.contact_method] || 'other';

    if (!subject) throw new Error('Enter a subject for the customer note.');
    if (!noteText) throw new Error('Enter the customer note or inquiry details.');
    if (followUpRequired && !followUpAt) throw new Error('Select a follow-up date and time.');

    const [[handler]] = await db.execute(
      'SELECT id FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',
      { id: assignedStaffId }
    );
    if (!handler) throw new Error('Select a valid staff member to handle this interaction.');

    const status = followUpRequired ? 'follow_up' : 'resolved';
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.execute(
        `INSERT INTO inquiries
          (client_id,service_type,staff_id,assigned_staff_id,walkin_or_call,client_name,cell_number,email,
           category_id,category_other,query_text,action_taken,status,follow_up_at,completed_at,completed_by)
         VALUES (:clientId,'general',:capturedBy,:assignedTo,:contactMethod,:clientName,:cellNumber,:email,
           :categoryId,:categoryOther,:subject,:noteText,:status,:followUpAt,:completedAt,:completedBy)`,
        {
          clientId,
          capturedBy: req.session.user.id,
          assignedTo: assignedStaffId,
          contactMethod,
          clientName: context.client.client_name,
          cellNumber: context.client.cell_number || null,
          email: context.client.email || null,
          categoryId: 11,
          categoryOther: noteType,
          subject,
          noteText,
          status,
          followUpAt: followUpRequired ? followUpAt : null,
          completedAt: followUpRequired ? null : new Date(),
          completedBy: followUpRequired ? null : req.session.user.id
        }
      );

      if (followUpRequired) {
        await conn.execute(
          `INSERT INTO staff_tasks
            (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,related_inquiry_id,email_status)
           VALUES ('task',:title,:message,'normal','unread',:assignedTo,:createdBy,:dueAt,:clientId,:inquiryId,'not_configured')`,
          {
            title: `Follow up: ${subject}`.slice(0, 200),
            message: noteText,
            assignedTo: assignedStaffId,
            createdBy: req.session.user.id,
            dueAt: followUpAt,
            clientId,
            inquiryId: result.insertId
          }
        );
      }

      await conn.commit();
      return res.redirect(`${res.locals.basePath}/customers/${clientId}/360?note_saved=1`);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error.message && !error.code) {
      const context = await loadCustomerNoteContext(clientId);
      if (!context) return next(error);
      return res.status(400).render('customer-note-add', {
        layout: false,
        title: 'Add Customer Note',
        ...context,
        error: error.message,
        values
      });
    }
    next(error);
  }
});

router.get('/customers/:id/360', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('error', { title: 'Invalid customer', message: 'The customer record could not be identified.' });
    }

    const [[client]] = await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1', { id });
    if (!client) {
      return res.status(404).render('error', { title: 'Not found', message: 'Client line could not be found.' });
    }

    const accountNumber = String(client.account_number || '').trim();

    const lines = await optionalSection('account lines', id, [client], async () => {
      const [rows] = await db.execute(
        `SELECT * FROM clients
         WHERE id=:id OR (:account<>'' AND account_number=:account)
         ORDER BY line_status='active' DESC,next_upgrade_date,cell_number`,
        { id, account: accountNumber }
      );
      return rows.length ? rows : [client];
    });

    const lineIds = lines.map(line => Number(line.id)).filter(Boolean);
    const phoneNumbers = [...new Set(lines.map(line => String(line.cell_number || '').trim()).filter(Boolean))];

    const history = await optionalSection('interaction history', id, [], async () => {
      if (!lineIds.length) return [];
      const clauses = [`i.client_id IN (${lineIds.map(() => '?').join(',')})`];
      const params = [...lineIds];
      if (phoneNumbers.length) {
        clauses.push(`i.cell_number IN (${phoneNumbers.map(() => '?').join(',')})`);
        params.push(...phoneNumbers);
      }
      const [rows] = await db.query(
        `SELECT i.*,ic.category_name,COALESCE(a.full_name,s.full_name,'Unassigned') responsible_name
         FROM inquiries i
         LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
         LEFT JOIN staff_users a ON a.id=i.assigned_staff_id
         LEFT JOIN staff_users s ON s.id=i.staff_id
         WHERE ${clauses.join(' OR ')}
         ORDER BY i.created_at DESC LIMIT 100`,
        params
      );
      return rows;
    });

    const tasks = await optionalSection('related tasks', id, [], async () => {
      if (!lineIds.length) return [];
      const [rows] = await db.query(
        `SELECT t.*,s.full_name assigned_name
         FROM staff_tasks t
         JOIN staff_users s ON s.id=t.assigned_to
         WHERE t.related_client_id IN (${lineIds.map(() => '?').join(',')})
         ORDER BY t.created_at DESC LIMIT 50`,
        lineIds
      );
      return rows;
    });

    const assignment = await optionalSection('assignment', id, null, async () => {
      const [[row]] = await db.execute(
        `SELECT su.full_name,su.id
         FROM client_assignments a
         JOIN staff_users su ON su.id=a.assigned_staff_id
         WHERE a.is_active=1
           AND (a.client_id=:id OR (:account<>'' AND a.account_number=:account))
         ORDER BY (a.client_id=:id) DESC,a.updated_at DESC LIMIT 1`,
        { id, account: accountNumber }
      );
      return row || null;
    });

    const assignmentStaff = ['owner','manager','admin'].includes(req.session.user.role)
      ? await optionalSection('assignment staff', id, [], async () => {
          const [rows] = await db.query('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
          return rows;
        })
      : [];

    const accountRecord = await optionalSection('customer account', id, null, async () => {
      if (client.account_id) {
        const [[row]] = await db.execute(
          `SELECT a.*,s.full_name assigned_staff_name
           FROM customer_accounts a
           LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
           WHERE a.id=:accountId LIMIT 1`,
          { accountId: client.account_id }
        );
        return row || null;
      }
      if (!accountNumber) return null;
      const [[row]] = await db.execute(
        `SELECT a.*,s.full_name assigned_staff_name
         FROM customer_accounts a
         LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
         WHERE a.account_number_normalised=UPPER(REPLACE(TRIM(:account),' ','')) LIMIT 1`,
        { account: accountNumber }
      );
      return row || null;
    });

    const pendingClaim = await optionalSection('pending claim', id, null, async () => {
      if (!accountRecord || !lineIds.length) return null;
      const [[row]] = await db.query(
        `SELECT r.id,r.requested_by,u.full_name requested_by_name,r.created_at
         FROM data_change_requests r
         JOIN staff_users u ON u.id=r.requested_by
         WHERE r.request_type IN ('claim_account','claim_client')
           AND (r.record_id=? OR r.client_id IN (${lineIds.map(() => '?').join(',')}))
           AND r.status IN ('pending_manager','pending_owner')
         ORDER BY r.created_at LIMIT 1`,
        [accountRecord.id, ...lineIds]
      );
      return row || null;
    });

    const pendingAccountRequest = await optionalSection('pending account request', id, null, async () => {
      const [[row]] = await db.execute(
        `SELECT r.id,r.created_at,r.status,u.full_name requested_by_name
         FROM data_change_requests r
         LEFT JOIN staff_users u ON u.id=r.requested_by
         WHERE r.request_type='assign_account_number'
           AND r.status IN ('pending_manager','pending_owner')
           AND (r.client_id=:id OR r.record_id=:id)
         ORDER BY r.created_at LIMIT 1`,
        { id }
      );
      return row || null;
    });

    const fixedAccounts = await optionalSection('fixed services', id, [], async () => {
      if (!accountNumber) return [];
      const [rows] = await db.execute(
        `SELECT fa.*,COUNT(fs.id) fixed_service_count
         FROM fixed_accounts fa
         LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
         WHERE fa.account_number=:account OR fa.linked_mobile_account_number=:account
         GROUP BY fa.id`,
        { account: accountNumber }
      );
      return rows;
    });

    const currentMobileServices = [];
    const mobileEvents = [];
    const currentMobileDataReady = false;

    res.render('customer-360', {
      title: client.client_name || 'Customer Workspace',
      client,
      lines,
      history,
      tasks,
      assignment,
      assignmentStaff,
      accountRecord,
      pendingClaim,
      pendingAccountRequest,
      fixedAccounts,
      currentMobileDataReady,
      currentMobileServices,
      mobileEvents,
      assigned: req.query.assigned,
      noteSaved: String(req.query.note_saved || '') === '1',
      claimRequested: req.query.claim_requested,
      claimConflict: req.query.claim_conflict,
      claimOwner: String(req.query.claim_owner || '').trim().slice(0, 255),
      changeRequested: req.query.change_requested,
      detailsSaved: String(req.query.details_saved || '') === '1',
      converted: String(req.query.converted || '') === '1'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
