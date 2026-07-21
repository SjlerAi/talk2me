const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function nullable(value, max = 5000) {
  const result = clean(value, max);
  return result || null;
}

function normaliseSaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? digits : null;
}

function birthdayFromSaId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const currentYY = new Date().getFullYear() % 100;
  const year = yy > currentYY ? 1900 + yy : 2000 + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

async function loadPotentialClientDuplicate(phone, email) {
  if (!phone && !email) return null;
  const [[row]] = await db.execute(`SELECT id,client_name,cell_number,email,lifecycle_status
    FROM clients
    WHERE (:phone IS NOT NULL AND cell_number_normalised=:phone)
       OR (:email IS NOT NULL AND LOWER(email)=:email)
    ORDER BY is_active DESC,id DESC LIMIT 1`, { phone, email });
  return row || null;
}

router.get('/os/potential-client/new', requireAuth, (req, res) => {
  res.render('os-potential-client', {
    layout: false,
    title: 'Add Potential Client',
    error: null,
    saved: false,
    existing: null,
    client: null,
    values: {
      client_name: clean(req.query.client_name, 200),
      cell_number: clean(req.query.cell_number, 40),
      email: clean(req.query.email, 255),
      lead_source: 'Customer search'
    }
  });
});

router.post('/os/potential-client', requireAuth, async (req, res, next) => {
  const values = req.body || {};
  try {
    const clientName = clean(values.client_name, 200);
    const cellNumber = clean(values.cell_number, 40);
    const email = clean(values.email, 255).toLowerCase();
    const phone = cellNumber ? normaliseSaPhone(cellNumber) : null;
    if (!clientName) throw new Error('Enter the potential client name.');
    if (!cellNumber && !email) throw new Error('Enter at least a cellphone number or email address.');
    if (cellNumber && !phone) throw new Error('Enter a valid South African cellphone number.');

    const existing = await loadPotentialClientDuplicate(phone, email || null);
    if (existing) {
      return res.status(409).render('os-potential-client', {
        layout: false,
        title: 'Add Potential Client',
        error: 'A matching customer or potential client already exists. Open the existing record instead of creating a duplicate.',
        saved: false,
        existing,
        client: null,
        values
      });
    }

    const customerType = ['individual', 'business', 'unknown'].includes(values.customer_type) ? values.customer_type : 'unknown';
    const idNumber = nullable(values.id_number, 30);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(`INSERT INTO clients
        (client_name,cell_number,cell_number_normalised,email,city_town,id_number,birthday,customer_type,
         lifecycle_status,lead_source,lead_status,line_status,notes,created_by_staff_id,is_active)
        VALUES (:clientName,:cellNumber,:phone,:email,:cityTown,:idNumber,:birthday,:customerType,
         'prospect',:leadSource,'new','unknown',:notes,:createdBy,1)`, {
        clientName,
        cellNumber: cellNumber || null,
        phone,
        email: email || null,
        cityTown: nullable(values.city_town, 150),
        idNumber,
        birthday: birthdayFromSaId(idNumber),
        customerType,
        leadSource: nullable(values.lead_source, 150) || 'Customer search',
        notes: nullable(values.notes),
        createdBy: req.session.user.id
      });

      await conn.execute(`INSERT INTO client_assignments
        (client_id,account_number,assigned_staff_id,assigned_by,is_active)
        VALUES (:clientId,'',:staffId,:staffId,1)`, {
        clientId: result.insertId,
        staffId: req.session.user.id
      });
      await conn.commit();

      const [[client]] = await db.execute(`SELECT id,client_name,cell_number,email,lifecycle_status
        FROM clients WHERE id=:id LIMIT 1`, { id: result.insertId });
      return res.status(201).render('os-potential-client', {
        layout: false,
        title: 'Add Potential Client',
        error: null,
        saved: true,
        existing: null,
        client,
        values
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const phone = normaliseSaPhone(values.cell_number);
      const existing = await loadPotentialClientDuplicate(phone, clean(values.email, 255).toLowerCase() || null);
      return res.status(409).render('os-potential-client', {
        layout: false,
        title: 'Add Potential Client',
        error: 'A matching customer or potential client already exists.',
        saved: false,
        existing,
        client: null,
        values
      });
    }
    if (error.message && !error.code) {
      return res.status(400).render('os-potential-client', {
        layout: false,
        title: 'Add Potential Client',
        error: error.message,
        saved: false,
        existing: null,
        client: null,
        values
      });
    }
    next(error);
  }
});

async function loadCustomerNoteContext(clientId) {
  const [[client]] = await db.execute(`SELECT id,client_name,cell_number,email,account_number
    FROM clients WHERE id=:id LIMIT 1`, { id: clientId });
  if (!client) return null;
  const [staff] = await db.query(`SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name`);
  const [[assignment]] = await db.execute(`SELECT assigned_staff_id
    FROM client_assignments
    WHERE is_active=1 AND (client_id=:id OR (:account<>'' AND account_number=:account))
    ORDER BY (client_id=:id) DESC,updated_at DESC LIMIT 1`, {
    id: clientId,
    account: client.account_number || ''
  });
  return { client, staff, assignedStaffId: assignment?.assigned_staff_id || null };
}

router.get('/customers/:id/notes/new', requireAuth, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const context = await loadCustomerNoteContext(clientId);
    if (!context) return res.status(404).render('error', { title: 'Customer not found', message: 'The customer could not be found.' });
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
  } catch (error) { next(error); }
});

router.post('/customers/:id/notes', requireAuth, async (req, res, next) => {
  const clientId = Number(req.params.id);
  const values = req.body || {};
  try {
    const context = await loadCustomerNoteContext(clientId);
    if (!context) return res.status(404).render('error', { title: 'Customer not found', message: 'The customer could not be found.' });

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
    const contactMethod = ['walk_in', 'phone', 'email', 'whatsapp', 'other'].includes(values.contact_method)
      ? values.contact_method
      : 'other';

    if (!subject) throw new Error('Enter a subject for the customer note.');
    if (!noteText) throw new Error('Enter the customer note or inquiry details.');
    if (followUpRequired && !followUpAt) throw new Error('Select a follow-up date and time.');

    const [[handler]] = await db.execute(`SELECT id FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1`, { id: assignedStaffId });
    if (!handler) throw new Error('Select a valid staff member to handle this interaction.');

    const status = followUpRequired ? 'follow_up' : 'resolved';
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(`INSERT INTO inquiries
        (client_id,service_type,staff_id,assigned_staff_id,walkin_or_call,client_name,cell_number,email,
         category_id,category_other,query_text,action_taken,status,follow_up_at,completed_at,completed_by)
        VALUES (:clientId,'general',:capturedBy,:assignedTo,:contactMethod,:clientName,:cellNumber,:email,
         NULL,:categoryOther,:subject,:noteText,:status,:followUpAt,:completedAt,:completedBy)`, {
        clientId,
        capturedBy: req.session.user.id,
        assignedTo: assignedStaffId,
        contactMethod,
        clientName: context.client.client_name,
        cellNumber: context.client.cell_number || null,
        email: context.client.email || null,
        categoryOther: noteType,
        subject,
        noteText,
        status,
        followUpAt: followUpRequired ? followUpAt : null,
        completedAt: followUpRequired ? null : new Date(),
        completedBy: followUpRequired ? null : req.session.user.id
      });

      if (followUpRequired) {
        await conn.execute(`INSERT INTO staff_tasks
          (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,related_inquiry_id,email_status)
          VALUES ('task',:title,:message,'normal','unread',:assignedTo,:createdBy,:dueAt,:clientId,:inquiryId,'not_configured')`, {
          title: `Follow up: ${subject}`.slice(0, 200),
          message: noteText,
          assignedTo: assignedStaffId,
          createdBy: req.session.user.id,
          dueAt: followUpAt,
          clientId,
          inquiryId: result.insertId
        });
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

module.exports = router;
