const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { sendTaskEmail } = require('../services/mailer');
const { hasPermission, requirePermission, requireRole } = require('../middleware/permissions');
const { audit } = require('../services/audit');

const router = express.Router();

const testPasswords = {
  'owner@talk2me.local': 'Talk2Me@2026',
  'jonathan@talk-online.co.za': 'test1',
  'sias@talk-online.co.za': 'test2',
  'annazel@talk-online.co.za': 'test3',
  'sales3@talk-online.co.za': 'test4',
  'sales4@talk-online.co.za': 'test5',
  'johnny': 'test1',
  'sias': 'test2',
  'annazel': 'test3',
  'brabant': 'test4',
  'vanzyl': 'test5'
};

function isOwnerRole(user) {
  return user && ['owner','admin','manager'].includes(user.role);
}

function requireOwnerRole(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!isOwnerRole(req.session.user)) return res.status(403).render('error', { title: 'Access denied', message: 'This case control area is only available to owner, manager or admin users.' });
  next();
}

function defaultLanding(user) {
  if (!user) return '/login';
  return '/workspace';
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 45) || null;
}

function sessionAuditValues(req) {
  return {
    ipAddress: requestIp(req),
    userAgent: String(req.get('user-agent') || '').slice(0, 1000) || null
  };
}


function normaliseStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  const map = {
    open: 'open',
    resolved: 'resolved',
    follow_up: 'follow_up',
    followup: 'follow_up',
    'follow-up': 'follow_up',
    waiting_customer: 'waiting_customer',
    waiting_network: 'waiting_network',
    waiting_supplier: 'waiting_supplier',
    cancelled: 'cancelled'
  };
  return map[raw] || 'resolved';
}

function completedAtForStatus(status) {
  return status === 'resolved' || status === 'cancelled' ? new Date() : null;
}


async function getCustomerSnapshot(clientId) {
  const [[client]] = await db.execute(`SELECT id, account_number, client_name, cell_number, alt_number, email, id_number, customer_type, package_name, handset, monthly_invoice_amount, upgrade_date, cancellation_date
    FROM clients WHERE id = :clientId LIMIT 1`, { clientId });
  if (!client) return null;

  const params = {
    account_number: client.account_number || null,
    id_number: client.id_number || null,
    email: client.email || null,
    cell_number: client.cell_number || null
  };

  const [relatedLines] = await db.execute(`SELECT id, account_number, client_name, cell_number, package_name, handset, monthly_invoice_amount, upgrade_date, cancellation_date
    FROM clients
    WHERE
      (:account_number IS NOT NULL AND :account_number <> '' AND account_number = :account_number)
      OR (:id_number IS NOT NULL AND :id_number <> '' AND id_number = :id_number)
      OR (:email IS NOT NULL AND :email <> '' AND email = :email)
      OR (:cell_number IS NOT NULL AND :cell_number <> '' AND cell_number = :cell_number)
    ORDER BY
      CASE WHEN id = :clientId THEN 0 ELSE 1 END,
      upgrade_date IS NULL,
      upgrade_date ASC,
      client_name ASC
    LIMIT 25`, { ...params, clientId });

  const inquiryWhere = `
      i.client_id = :clientId
      OR (:cell_number IS NOT NULL AND :cell_number <> '' AND i.cell_number = :cell_number)
      OR (:email IS NOT NULL AND :email <> '' AND i.email = :email)
    `;
  const inquiryParams = { clientId, cell_number: client.cell_number || null, email: client.email || null };

  const [[lastContact]] = await db.execute(`SELECT i.id, i.created_at, i.updated_at, i.completed_at, i.follow_up_at, i.status,
      i.query_text, i.result_found, i.action_taken, i.owner_note, i.owner_note_updated_at, i.priority, ic.category_name,
      COALESCE(s.full_name, 'Unassigned') staff_member, COALESCE(ass.full_name, '') assigned_staff_member,
      COALESCE(cb.full_name, '') completed_by_name
    FROM inquiries i
    LEFT JOIN inquiry_categories ic ON ic.id = i.category_id
    LEFT JOIN staff_users s ON s.id = i.staff_id
    LEFT JOIN staff_users ass ON ass.id = i.assigned_staff_id
    LEFT JOIN staff_users cb ON cb.id = i.completed_by
    WHERE ${inquiryWhere}
    ORDER BY i.created_at DESC
    LIMIT 1`, inquiryParams);

  const [history] = await db.execute(`SELECT i.id, i.created_at, i.updated_at, i.completed_at, i.follow_up_at, i.status,
      i.query_text, i.result_found, i.action_taken, i.owner_note, i.owner_note_updated_at, i.priority, ic.category_name,
      COALESCE(s.full_name, 'Unassigned') staff_member, COALESCE(ass.full_name, '') assigned_staff_member
    FROM inquiries i
    LEFT JOIN inquiry_categories ic ON ic.id = i.category_id
    LEFT JOIN staff_users s ON s.id = i.staff_id
    LEFT JOIN staff_users ass ON ass.id = i.assigned_staff_id
    WHERE ${inquiryWhere}
    ORDER BY i.created_at DESC
    LIMIT 5`, inquiryParams);

  const [openFollowUps] = await db.execute(`SELECT i.id, i.created_at, i.updated_at, i.follow_up_at, i.status,
      i.query_text, i.action_taken, i.owner_note, i.owner_note_updated_at, i.priority, ic.category_name,
      COALESCE(s.full_name, 'Unassigned') staff_member, COALESCE(ass.full_name, '') assigned_staff_member
    FROM inquiries i
    LEFT JOIN inquiry_categories ic ON ic.id = i.category_id
    LEFT JOIN staff_users s ON s.id = i.staff_id
    LEFT JOIN staff_users ass ON ass.id = i.assigned_staff_id
    WHERE (${inquiryWhere})
      AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')
    ORDER BY
      CASE WHEN i.follow_up_at IS NULL THEN 1 ELSE 0 END,
      i.follow_up_at ASC,
      i.created_at DESC
    LIMIT 5`, inquiryParams);

  const [[contactStats]] = await db.execute(`SELECT COUNT(*) total_contacts
    FROM inquiries i
    WHERE ${inquiryWhere}`, inquiryParams);

  return {
    client,
    line_count: relatedLines.length || 1,
    related_lines: relatedLines,
    last_contact: lastContact || null,
    history,
    open_followups: openFollowUps,
    total_contacts: contactStats.total_contacts || 0
  };
}


router.use(async (req, res, next) => {
  res.locals.unreadTaskCount = 0;
  if (!req.session.user) return next();
  try {
    if (req.session.loginSessionId && (!req.session.activityPingAt || Date.now() - req.session.activityPingAt > 5 * 60 * 1000)) {
      await db.execute(`UPDATE staff_login_sessions SET last_activity_at=NOW()
        WHERE id=:id AND staff_id=:staffId AND session_status='active'`, {
        id:req.session.loginSessionId, staffId:req.session.user.id
      });
      req.session.activityPingAt = Date.now();
    }
    const [[row]] = await db.execute(`SELECT COUNT(*) total FROM staff_tasks
      WHERE assigned_to=:staffId AND status IN ('unread','seen','in_progress')`, { staffId:req.session.user.id });
    res.locals.unreadTaskCount = row.total || 0;
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') console.error(error);
  }
  next();
});

router.use(require('./fixed'));

router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  res.redirect(`${res.locals.basePath}${defaultLanding(req.session.user)}`);
});

router.get('/login', (req, res) => res.render('login', { title: 'Login', error: null }));

router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body.email || '').trim();
    const password = req.body.password;
    const loginKey = login.toLowerCase();
    const [rows] = await db.execute(`SELECT * FROM staff_users
      WHERE is_active = 1 AND (LOWER(email) = :loginKey OR LOWER(username) = :loginKey OR LOWER(full_name) = :loginKey)
      LIMIT 1`, { loginKey });
    const user = rows[0];
    let ok = false;
    if (user && user.password_hash) ok = await bcrypt.compare(password, user.password_hash);
    if (user && !user.password_hash && testPasswords[loginKey] === password) ok = true;
    if (!user || !ok) return res.status(401).render('login', { title: 'Login', error: 'Invalid login details.' });
    const sessionUser = { id: user.id, full_name: user.full_name, email: user.email, role: user.role, username: user.username || user.full_name };
    req.session.regenerate(async error => {
      if (error) return next(error);
      try {
        const auditValues=sessionAuditValues(req);
        await db.execute(`UPDATE staff_login_sessions SET session_status='replaced', logout_at=NOW(), logout_reason='new_login'
          WHERE staff_id=:staffId AND session_status='active'`,{staffId:user.id});
        const [loginRecord]=await db.execute(`INSERT INTO staff_login_sessions
          (staff_id,session_token,login_at,last_activity_at,expires_at,session_status,ip_address,user_agent)
          VALUES (:staffId,:token,NOW(),NOW(),DATE_ADD(NOW(),INTERVAL 8 HOUR),'active',:ipAddress,:userAgent)`,{
          staffId:user.id,token:crypto.randomBytes(32).toString('hex'),...auditValues
        });
        req.session.user=sessionUser;
        req.session.loginSessionId=loginRecord.insertId;
        req.session.activityPingAt=Date.now();
        req.session.cookie.maxAge=8 * 60 * 60 * 1000;
        await db.execute('UPDATE staff_users SET last_login_at=NOW() WHERE id=:id', { id:user.id });
        req.session.save(saveError => saveError ? next(saveError) : res.redirect(`${res.locals.basePath}${defaultLanding(sessionUser)}`));
      } catch(e){ next(e); }
    });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res) => {
  try {
    if(req.session.loginSessionId && req.session.user){
      await db.execute(`UPDATE staff_login_sessions SET logout_at=NOW(),last_activity_at=NOW(),session_status='logged_out',logout_reason='manual'
        WHERE id=:id AND staff_id=:staffId AND session_status='active'`,{id:req.session.loginSessionId,staffId:req.session.user.id});
    }
  } catch(error){ console.error('Could not record logout',error); }
  req.session.destroy(() => res.redirect(`${res.locals.basePath}/login`));
});

router.get('/dashboard', requireAuth, async (req, res, next) => {
  if (!['owner','admin','manager'].includes(req.session.user.role)) return res.redirect(`${res.locals.basePath}/queries/new`);
  try {
    const [[today]] = await db.query("SELECT COUNT(*) total FROM inquiries WHERE DATE(created_at)=CURRENT_DATE()");
    const [[yesterday]] = await db.query("SELECT COUNT(*) total FROM inquiries WHERE DATE(created_at)=DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)");
    const [[openCases]] = await db.query("SELECT COUNT(*) total FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')");
    const [[completedToday]] = await db.query("SELECT COUNT(*) total FROM inquiries WHERE DATE(COALESCE(completed_at, updated_at))=CURRENT_DATE() AND status IN ('resolved','cancelled')");
    const [[followupsDue]] = await db.query("SELECT COUNT(*) total FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND follow_up_at IS NOT NULL AND DATE(follow_up_at) <= CURRENT_DATE()");
    const [[clients]] = await db.query("SELECT COUNT(*) total FROM clients");
    const [activity] = await db.query(`SELECT i.id, i.created_at, i.client_name, i.cell_number, i.status, c.category_name, COALESCE(s.full_name,'Unassigned') staff_member
      FROM inquiries i LEFT JOIN inquiry_categories c ON c.id=i.category_id LEFT JOIN staff_users s ON s.id=i.staff_id
      ORDER BY i.created_at DESC LIMIT 25`);
    const [byStaff] = await db.query(`SELECT COALESCE(s.full_name,'Unassigned') staff_member, COUNT(*) total
      FROM inquiries i LEFT JOIN staff_users s ON s.id=i.staff_id WHERE DATE(i.created_at)=CURRENT_DATE()
      GROUP BY s.full_name ORDER BY total DESC`);
    const [openCaseRows] = await db.query(`SELECT i.id, i.created_at, i.updated_at, i.completed_at, i.follow_up_at, i.status, i.client_name, i.cell_number, i.query_text, i.action_taken, i.owner_note, i.priority,
      c.category_name, COALESCE(s.full_name,'Unassigned') staff_member, COALESCE(ass.full_name,'') assigned_staff_member
      FROM inquiries i
      LEFT JOIN inquiry_categories c ON c.id=i.category_id
      LEFT JOIN staff_users s ON s.id=i.staff_id
      LEFT JOIN staff_users ass ON ass.id=i.assigned_staff_id
      WHERE i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')
      ORDER BY
        CASE WHEN i.priority = 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN i.follow_up_at IS NULL THEN 1 ELSE 0 END,
        i.follow_up_at ASC,
        i.created_at DESC
      LIMIT 25`);
    const [categorySummary] = await db.query(`SELECT COALESCE(c.category_name,'Uncategorised') category_name, COUNT(*) total
      FROM inquiries i LEFT JOIN inquiry_categories c ON c.id=i.category_id
      WHERE DATE(i.created_at)=CURRENT_DATE()
      GROUP BY c.category_name ORDER BY total DESC`);

    const [birthdays] = await db.query(`SELECT id, client_name, cell_number, email, birthday,
      CASE
        WHEN MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE()) THEN 'today'
        ELSE 'tomorrow'
      END AS birthday_window
      FROM clients
      WHERE birthday IS NOT NULL
        AND (
          (MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE()))
          OR
          (MONTH(birthday)=MONTH(DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AND DAY(birthday)=DAY(DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)))
        )
      ORDER BY birthday_window='tomorrow', client_name`);

    const [upgrades] = await db.query(`SELECT id, account_number, client_name, cell_number, email, handset, package_name, upgrade_date,
      DATEDIFF(DATE(upgrade_date), CURRENT_DATE()) AS days_until_upgrade
      FROM clients
      WHERE upgrade_date IS NOT NULL
        AND DATE(upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)
      ORDER BY DATE(upgrade_date), client_name, cell_number`);

    res.render('dashboard', { title: 'Dashboard', stats: { today: today.total, yesterday: yesterday.total, followups: openCases.total, openCases: openCases.total, completedToday: completedToday.total, followupsDue: followupsDue.total, clients: clients.total }, activity, byStaff, openCases: openCaseRows, categorySummary, birthdays, upgrades });
  } catch (e) { next(e); }
});

router.get('/clients/search', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q}%`;
    const phone = normaliseSaPhone(q);
    const [rows] = await db.execute(`SELECT id, account_number, client_name, cell_number, email, id_number, package_name, handset, monthly_invoice_amount, upgrade_date, cancellation_date, customer_type
      FROM clients
      WHERE (:phone IS NOT NULL AND cell_number_normalised=:phone)
         OR client_name LIKE :like OR cell_number LIKE :like OR email LIKE :like OR account_number LIKE :like OR id_number LIKE :like
      ORDER BY CASE WHEN :phone IS NOT NULL AND cell_number_normalised=:phone THEN 0 ELSE 1 END, client_name ASC LIMIT 15`, { like, phone });
    res.json(rows);
  } catch (e) { next(e); }
});


router.post('/clients/quick', requireAuth, async (req, res, next) => {
  try {
    const clientName = String(req.body.client_name || '').trim();
    const cellNumber = String(req.body.cell_number || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const altNumber = String(req.body.alt_number || '').trim();

    if (!clientName) return res.status(400).json({ ok: false, message: 'Please enter the contact name.' });
    if (!cellNumber) return res.status(400).json({ ok: false, message: 'Please enter the cellphone number.' });

    const normalisedPhone = normaliseSaPhone(cellNumber);
    const [matches] = await db.execute(`SELECT id, account_number, client_name, cell_number, email, alt_number
      FROM clients
      WHERE (:phone IS NOT NULL AND cell_number_normalised = :phone)
         OR (:email <> '' AND LOWER(email)=:email)
      ORDER BY id DESC LIMIT 1`, { phone: normalisedPhone, email });

    if (matches[0]) {
      return res.json({ ok: true, existing: true, message: 'This contact already exists and has been selected.', client: matches[0] });
    }

    const [created] = await db.execute(`INSERT INTO clients
      (client_name,cell_number,cell_number_normalised,alt_number,email,customer_type,lifecycle_status,lead_source,lead_status,created_by_staff_id,is_active)
      VALUES (:client_name,:cell_number,:cell_number_normalised,:alt_number,:email,'unknown','prospect','Quick inquiry capture','new',:created_by,1)`, {
      client_name: clientName,
      cell_number: cellNumber,
      cell_number_normalised: normalisedPhone,
      alt_number: altNumber || null,
      email: email || null,
      created_by: req.session.user.id
    });

    await saveClientAssignment(created.insertId, null, req.session.user.id, req.session.user.id);

    const [[client]] = await db.execute(`SELECT id, account_number, client_name, cell_number, email, alt_number
      FROM clients WHERE id=:id LIMIT 1`, { id: created.insertId });

    res.status(201).json({ ok: true, existing: false, message: 'Potential client added and assigned to you. You can continue with the inquiry.', client });
  } catch (e) { next(e); }
});

router.get('/clients/:id/snapshot', requireAuth, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!clientId) return res.status(400).json({ error: 'Invalid client id' });
    const snapshot = await getCustomerSnapshot(clientId);
    if (!snapshot) return res.status(404).json({ error: 'Client not found' });
    res.json(snapshot);
  } catch (e) { next(e); }
});

router.get('/queries/new', requireAuth, async (req, res, next) => {
  try {
    const [categories] = await db.query('SELECT id, category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order ASC');
    const [workstations] = await db.query('SELECT id, workstation_name FROM workstations WHERE is_active=1 ORDER BY workstation_name ASC');
    res.render('query-new', { title: 'New Query', categories, workstations });
  } catch (e) { next(e); }
});

router.post('/queries', requireAuth, async (req, res, next) => {
  try {
    const {
      client_id, fixed_account_id, fixed_service_id, service_type, workstation_id, walkin_or_call, client_name, cell_number, email,
      category_id, category_other, query_text, result_found, action_taken, status, follow_up_at,
      save_as_prospect, prospect_city_town, prospect_id_number, prospect_customer_type, prospect_lead_source
    } = req.body;
    const cleanStatus = normaliseStatus(status);
    const completedAt = completedAtForStatus(cleanStatus);
    let linkedClientId = client_id ? Number(client_id) : null;
    let createdProspect = false;

    if (!linkedClientId && save_as_prospect === '1') {
      const phone = String(cell_number || '').trim();
      const mail = String(email || '').trim().toLowerCase();
      let existing = null;
      if (phone || mail) {
        const [matches] = await db.execute(`SELECT id FROM clients
          WHERE (:phone <> '' AND REPLACE(REPLACE(REPLACE(cell_number,' ',''),'-',''),'(', '') = REPLACE(REPLACE(REPLACE(:phone,' ',''),'-',''),'(', ''))
             OR (:mail <> '' AND LOWER(email)=:mail)
          ORDER BY id DESC LIMIT 1`, { phone, mail });
        existing = matches[0] || null;
      }
      if (existing) {
        linkedClientId = existing.id;
      } else {
        const [created] = await db.execute(`INSERT INTO clients
          (client_name,cell_number,email,city_town,id_number,birthday,customer_type,lifecycle_status,lead_source,lead_status,created_by_staff_id,is_active)
          VALUES (:client_name,:cell_number,:email,:city_town,:id_number,:birthday,:customer_type,'prospect',:lead_source,'new',:created_by,1)`, {
          client_name: String(client_name || 'Potential client').trim(),
          cell_number: phone || null,
          email: mail || null,
          city_town: prospect_city_town || null,
          id_number: prospect_id_number || null,
          birthday: birthdayFromSaId(prospect_id_number),
          customer_type: ['individual','business','unknown'].includes(prospect_customer_type) ? prospect_customer_type : 'unknown',
          lead_source: prospect_lead_source || 'Shop inquiry',
          created_by: req.session.user.id
        });
        linkedClientId = created.insertId;
        createdProspect = true;
      }
    }

    const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.headers['content-type']?.includes('application/json');
    if (!category_id) {
      const message = 'Please choose an inquiry category.';
      if (wantsJson) return res.status(400).json({ ok:false, message });
      return res.redirect(`${res.locals.basePath}/queries/new?error=${encodeURIComponent(message)}`);
    }
    if (!linkedClientId && !String(client_name || '').trim() && !String(cell_number || '').trim()) {
      const message = 'Please select a client or enter at least a contact name or cellphone number.';
      if (wantsJson) return res.status(400).json({ ok:false, message });
      return res.redirect(`${res.locals.basePath}/queries/new?error=${encodeURIComponent(message)}`);
    }

    const [result] = await db.execute(`INSERT INTO inquiries
      (client_id, service_type, fixed_account_id, fixed_service_id, staff_id, workstation_id, walkin_or_call, client_name, cell_number, email, category_id, category_other, query_text, result_found, action_taken, status, follow_up_at, completed_at, completed_by)
      VALUES (:client_id, :service_type, :fixed_account_id, :fixed_service_id, :staff_id, :workstation_id, :walkin_or_call, :client_name, :cell_number, :email, :category_id, :category_other, :query_text, :result_found, :action_taken, :status, :follow_up_at, :completed_at, :completed_by)`, {
      client_id: Number.isFinite(linkedClientId) && linkedClientId > 0 ? linkedClientId : null,
      service_type: service_type === 'fixed' || fixed_account_id ? 'fixed' : (linkedClientId ? 'mobile' : 'general'),
      fixed_account_id: fixed_account_id ? Number(fixed_account_id) : null,
      fixed_service_id: fixed_service_id ? Number(fixed_service_id) : null,
      staff_id: req.session.user && req.session.user.id ? Number(req.session.user.id) : null,
      workstation_id: workstation_id ? Number(workstation_id) : null,
      walkin_or_call: String(walkin_or_call || 'walk_in'),
      client_name: String(client_name || '').trim() || null,
      cell_number: String(cell_number || '').trim() || null,
      email: String(email || '').trim().toLowerCase() || null,
      category_id: category_id ? Number(category_id) : null,
      category_other: String(category_other || '').trim() || null,
      query_text: String(query_text || '').trim() || null,
      result_found: String(result_found || '').trim() || null,
      action_taken: String(action_taken || '').trim() || null,
      status: String(cleanStatus || 'open'),
      follow_up_at: follow_up_at || null,
      completed_at: completedAt || null,
      completed_by: completedAt && req.session.user && req.session.user.id ? Number(req.session.user.id) : null
    });

    if (createdProspect) {
      await db.execute('UPDATE clients SET created_from_inquiry_id=:inquiryId WHERE id=:clientId', { inquiryId: result.insertId, clientId: linkedClientId });
      await saveClientAssignment(linkedClientId, null, req.session.user.id, req.session.user.id);
    }

    if (wantsJson) {
      return res.json({
        ok: true,
        inquiry_id: result.insertId,
        message: createdProspect ? 'Inquiry saved and potential client added to the database.' : 'Inquiry saved successfully.',
        reset_after_seconds: 60,
        client_id: linkedClientId,
        created_prospect: createdProspect
      });
    }

    res.redirect(`${res.locals.basePath}${defaultLanding(req.session.user)}?saved=1`);
  } catch (e) { next(e); }
});


router.post('/inquiries/:id/close', requireAuth, async (req, res, next) => {
  try {
    const inquiryId = Number(req.params.id);
    if (!inquiryId) return res.status(400).json({ ok: false, message: 'Invalid inquiry id.' });

    const [result] = await db.execute(`UPDATE inquiries
      SET status = 'resolved', completed_at = NOW(), completed_by = :completed_by, updated_at = NOW()
      WHERE id = :inquiry_id
        AND status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')`, {
      inquiry_id: inquiryId,
      completed_by: req.session.user.id
    });

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Inquiry is already closed or could not be found.' });
    }

    res.json({ ok: true, message: 'Inquiry closed successfully.' });
  } catch (e) { next(e); }
});


router.get('/dashboard/cases', requireAuth, requireOwnerRole, (req, res) => res.redirect(`${res.locals.basePath}/dashboard`));

router.get('/backoffice-old', requireAuth, requireOwnerRole, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open').trim();
    const statusWhere = status === 'all' ? '1=1' :
      status === 'completed_today' ? "i.status IN ('resolved','cancelled') AND DATE(COALESCE(i.completed_at, i.updated_at)) = CURRENT_DATE()" :
      status === 'followups' ? "i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND i.follow_up_at IS NOT NULL" :
      "i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";

    const [[stats]] = await db.query(`SELECT
      SUM(DATE(created_at)=CURRENT_DATE()) today_total,
      SUM(status IN ('resolved','cancelled') AND DATE(COALESCE(completed_at, updated_at))=CURRENT_DATE()) completed_today,
      SUM(status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')) open_total,
      SUM(status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND follow_up_at IS NOT NULL AND follow_up_at <= NOW()) overdue_total,
      COUNT(*) all_total
      FROM inquiries`);

    const [cases] = await db.query(`SELECT i.id, i.created_at, i.updated_at, i.completed_at, i.follow_up_at, i.status, i.client_name, i.cell_number, i.query_text, i.action_taken, i.owner_note, i.priority,
      c.category_name, COALESCE(s.full_name,'Unassigned') staff_member, COALESCE(ass.full_name,'') assigned_staff_member
      FROM inquiries i
      LEFT JOIN inquiry_categories c ON c.id=i.category_id
      LEFT JOIN staff_users s ON s.id=i.staff_id
      LEFT JOIN staff_users ass ON ass.id=i.assigned_staff_id
      WHERE ${statusWhere}
      ORDER BY
        CASE WHEN i.priority = 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN i.follow_up_at IS NULL THEN 1 ELSE 0 END,
        i.follow_up_at ASC,
        i.created_at DESC
      LIMIT 100`);

    const [categorySummary] = await db.query(`SELECT COALESCE(c.category_name,'Uncategorised') category_name, COUNT(*) total
      FROM inquiries i LEFT JOIN inquiry_categories c ON c.id=i.category_id
      WHERE DATE(i.created_at)=CURRENT_DATE()
      GROUP BY c.category_name ORDER BY total DESC`);

    res.render('backoffice', { title: 'Back Office', stats, cases, categorySummary, activeStatus: status });
  } catch (e) { next(e); }
});

router.get('/backoffice/inquiries/:id', requireAuth, requireOwnerRole, (req, res) => res.redirect(`${res.locals.basePath}/dashboard/inquiries/${req.params.id}`));

router.get('/dashboard/inquiries/:id', requireAuth, requireOwnerRole, async (req, res, next) => {
  try {
    const inquiryId = Number(req.params.id);
    const [[inq]] = await db.execute(`SELECT i.*, c.category_name, cl.account_number, cl.package_name, cl.handset, cl.upgrade_date, cl.monthly_invoice_amount,
      COALESCE(s.full_name,'Unassigned') staff_member, COALESCE(cb.full_name,'') completed_by_name, COALESCE(ass.full_name,'') assigned_staff_member
      FROM inquiries i
      LEFT JOIN inquiry_categories c ON c.id=i.category_id
      LEFT JOIN clients cl ON cl.id=i.client_id
      LEFT JOIN staff_users s ON s.id=i.staff_id
      LEFT JOIN staff_users cb ON cb.id=i.completed_by
      LEFT JOIN staff_users ass ON ass.id=i.assigned_staff_id
      WHERE i.id=:inquiryId LIMIT 1`, { inquiryId });
    if (!inq) return res.status(404).render('error', { title: 'Not found', message: 'Inquiry could not be found.' });
    const [categories] = await db.query('SELECT id, category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order ASC');
    const [staff] = await db.query("SELECT id, full_name FROM staff_users WHERE is_active=1 ORDER BY full_name ASC");
    const [notes] = await db.execute(`SELECT n.*, COALESCE(s.full_name,'Unassigned') staff_member
      FROM inquiry_notes n LEFT JOIN staff_users s ON s.id=n.staff_id
      WHERE n.inquiry_id=:inquiryId ORDER BY n.created_at DESC`, { inquiryId });
    res.render('backoffice-case', { title: `Case #${inquiryId}`, inquiry: inq, categories, staff, notes, saved: req.query.saved });
  } catch (e) { next(e); }
});

router.post('/backoffice/inquiries/:id', requireAuth, requireOwnerRole, (req, res) => res.redirect(307, `${res.locals.basePath}/dashboard/inquiries/${req.params.id}`));

router.post('/dashboard/inquiries/:id', requireAuth, requireOwnerRole, async (req, res, next) => {
  try {
    const inquiryId = Number(req.params.id);
    const {
      category_id, status, follow_up_at, result_found, action_taken,
      owner_note, priority, assigned_staff_id, note_text
    } = req.body;
    const cleanStatus = normaliseStatus(status);
    const isCompleted = cleanStatus === 'resolved' || cleanStatus === 'cancelled';

    await db.execute(`UPDATE inquiries SET
      category_id=:category_id,
      status=:status,
      follow_up_at=:follow_up_at,
      result_found=:result_found,
      action_taken=:action_taken,
      owner_note=:owner_note,
      owner_note_updated_by=:owner_note_updated_by,
      owner_note_updated_at=CASE WHEN COALESCE(owner_note,'') <> COALESCE(:owner_note,'') THEN NOW() ELSE owner_note_updated_at END,
      priority=:priority,
      assigned_staff_id=:assigned_staff_id,
      completed_at=CASE WHEN :isCompleted = 1 THEN COALESCE(completed_at, NOW()) ELSE NULL END,
      completed_by=CASE WHEN :isCompleted = 1 THEN COALESCE(completed_by, :completed_by) ELSE NULL END,
      updated_at=NOW()
      WHERE id=:inquiry_id`, {
      inquiry_id: inquiryId,
      category_id: category_id || null,
      status: cleanStatus,
      follow_up_at: follow_up_at || null,
      result_found: result_found || null,
      action_taken: action_taken || null,
      owner_note: owner_note || null,
      owner_note_updated_by: req.session.user.id,
      priority: priority === 'urgent' ? 'urgent' : 'normal',
      assigned_staff_id: assigned_staff_id || null,
      isCompleted: isCompleted ? 1 : 0,
      completed_by: req.session.user.id
    });

    if (String(note_text || '').trim()) {
      await db.execute(`INSERT INTO inquiry_notes (inquiry_id, staff_id, note) VALUES (:inquiry_id, :staff_id, :note)`, {
        inquiry_id: inquiryId,
        staff_id: req.session.user.id,
        note: String(note_text).trim()
      });
    }

    res.redirect(`${res.locals.basePath}/dashboard/inquiries/${inquiryId}?saved=1`);
  } catch (e) { next(e); }
});


const privateUploadRoot = process.env.PRIVATE_UPLOAD_DIR || path.join(process.cwd(), 'private_uploads');
fs.mkdirSync(privateUploadRoot, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const staffFolder = path.join(privateUploadRoot, 'staff', String(req.params.id || 'new'));
    fs.mkdirSync(staffFolder, { recursive: true });
    cb(null, staffFolder);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  }
});
const staffUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Unsupported file type.'), allowed.includes(file.mimetype));
  }
}).fields([{ name:'profile_photo', maxCount:1 }, { name:'id_document', maxCount:1 }]);

function staffFields(body) {
  return {
    first_name: body.first_name || null,
    surname: body.surname || null,
    full_name: body.full_name,
    email: String(body.email || '').trim().toLowerCase(),
    username: String(body.username || '').trim().toLowerCase() || null,
    contact_number: body.contact_number || null,
    alternate_contact_number: body.alternate_contact_number || null,
    id_number: body.id_number || null,
    date_of_birth: body.date_of_birth || null,
    job_title: body.job_title || null,
    branch_name: body.branch_name || null,
    employment_start_date: body.employment_start_date || null,
    role: ['owner','admin','manager','staff'].includes(body.role) ? body.role : 'staff',
    is_active: String(body.is_active) === '0' ? 0 : 1,
    internal_notes: body.internal_notes || null
  };
}

async function saveStaffUploads(staffId, files, uploaderId) {
  if (!files) return;
  const entries = [];
  if (files.profile_photo?.[0]) entries.push(['profile_photo', files.profile_photo[0]]);
  if (files.id_document?.[0]) entries.push(['id_document', files.id_document[0]]);
  for (const [type, file] of entries) {
    await db.execute(`INSERT INTO staff_documents
      (staff_id, document_type, original_filename, stored_filename, storage_path, mime_type, size_bytes, uploaded_by)
      VALUES (:staff_id,:document_type,:original_filename,:stored_filename,:storage_path,:mime_type,:size_bytes,:uploaded_by)`, {
      staff_id: staffId, document_type: type, original_filename: file.originalname, stored_filename: file.filename,
      storage_path: file.path, mime_type: file.mimetype, size_bytes: file.size, uploaded_by: uploaderId
    });
    if (type === 'profile_photo') await db.execute('UPDATE staff_users SET profile_photo_path=:path WHERE id=:id', { path:file.path, id:staffId });
  }
}

router.get('/backoffice', requireAuth, requireOwnerRole, (req, res) => res.render('backoffice-home', { title:'Back Office' }));

router.get('/backoffice/staff', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const [staff] = await db.query(`SELECT id, full_name, email, username, role, job_title, contact_number, profile_photo_path, is_active, last_login_at
      FROM staff_users ORDER BY is_active DESC, full_name ASC`);
    res.render('staff-list', { title:'Staff Management', staff });
  } catch(e){ next(e); }
});

router.get('/backoffice/staff/new', requireAuth, requireRole('owner','manager'), (req,res) => res.render('staff-edit', {
  title:'Add Staff Member', isNew:true, staff:{ role:'staff', is_active:1 }, documents:[], saved:false
}));

router.post('/backoffice/staff', requireAuth, requireRole('owner','manager'), staffUpload, async (req,res,next) => {
  try {
    const fields=staffFields(req.body);
    const passwordHash=await bcrypt.hash(req.body.password,10);
    const [result]=await db.execute(`INSERT INTO staff_users
      (first_name,surname,full_name,email,username,contact_number,alternate_contact_number,id_number,date_of_birth,job_title,branch_name,employment_start_date,role,is_active,internal_notes,password_hash)
      VALUES (:first_name,:surname,:full_name,:email,:username,:contact_number,:alternate_contact_number,:id_number,:date_of_birth,:job_title,:branch_name,:employment_start_date,:role,:is_active,:internal_notes,:password_hash)`, {...fields,password_hash:passwordHash});
    await saveStaffUploads(result.insertId, req.files, req.session.user.id);
    res.redirect(`${res.locals.basePath}/backoffice/staff/${result.insertId}?saved=1`);
  } catch(e){ next(e); }
});

router.get('/backoffice/staff/:id', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const [[staff]]=await db.execute('SELECT * FROM staff_users WHERE id=:id LIMIT 1',{id:Number(req.params.id)});
    if(!staff) return res.status(404).render('error',{title:'Not found',message:'Staff member not found.'});
    const [documents]=await db.execute('SELECT * FROM staff_documents WHERE staff_id=:id ORDER BY uploaded_at DESC',{id:staff.id});
    res.render('staff-edit',{title:staff.full_name,isNew:false,staff,documents,saved:req.query.saved});
  } catch(e){ next(e); }
});

router.post('/backoffice/staff/:id', requireAuth, requireRole('owner','manager'), staffUpload, async (req,res,next) => {
  try {
    const id=Number(req.params.id); const fields=staffFields(req.body);
    await db.execute(`UPDATE staff_users SET first_name=:first_name,surname=:surname,full_name=:full_name,email=:email,username=:username,
      contact_number=:contact_number,alternate_contact_number=:alternate_contact_number,id_number=:id_number,date_of_birth=:date_of_birth,
      job_title=:job_title,branch_name=:branch_name,employment_start_date=:employment_start_date,role=:role,is_active=:is_active,internal_notes=:internal_notes
      WHERE id=:id`, {...fields,id});
    if(String(req.body.password||'').trim()) await db.execute('UPDATE staff_users SET password_hash=:hash WHERE id=:id',{hash:await bcrypt.hash(req.body.password,10),id});
    await saveStaffUploads(id,req.files,req.session.user.id);
    res.redirect(`${res.locals.basePath}/backoffice/staff/${id}?saved=1`);
  } catch(e){ next(e); }
});

router.get('/backoffice/staff/:id/photo', requireAuth, requireOwnerRole, async (req,res,next) => {
  try { const [[row]]=await db.execute('SELECT profile_photo_path FROM staff_users WHERE id=:id',{id:Number(req.params.id)}); if(!row?.profile_photo_path || !fs.existsSync(row.profile_photo_path)) return res.sendStatus(404); res.sendFile(path.resolve(row.profile_photo_path)); } catch(e){ next(e); }
});
router.get('/backoffice/staff/:staffId/documents/:documentId', requireAuth, requireOwnerRole, async (req,res,next) => {
  try { const [[doc]]=await db.execute('SELECT * FROM staff_documents WHERE id=:documentId AND staff_id=:staffId',{documentId:Number(req.params.documentId),staffId:Number(req.params.staffId)}); if(!doc || !fs.existsSync(doc.storage_path)) return res.sendStatus(404); res.download(path.resolve(doc.storage_path),doc.original_filename); } catch(e){ next(e); }
});

router.get('/backoffice/clients', requireAuth, async (req,res,next) => {
  try {
    const q=String(req.query.q||'').trim();
    const view=['all','prospects','incomplete','unassigned','archived'].includes(String(req.query.view||'')) ? String(req.query.view) : 'all';
    let clients=[];
    const [staff]=await db.query(`SELECT id,full_name,email FROM staff_users WHERE is_active=1 ORDER BY full_name`);
    const where=[];
    const params={};
    if(q){ params.like=`%${q}%`; where.push(`(c.client_name LIKE :like OR c.cell_number LIKE :like OR c.email LIKE :like OR c.account_number LIKE :like OR c.id_number LIKE :like)`); }
    if(view==='prospects') where.push(`c.lifecycle_status='prospect' AND c.is_active=1`);
    if(view==='incomplete') where.push(`c.lifecycle_status='prospect' AND c.is_active=1 AND (c.email IS NULL OR c.email='' OR c.city_town IS NULL OR c.city_town='' OR c.id_number IS NULL OR c.id_number='')`);
    if(view==='unassigned') where.push(`c.is_active=1 AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.is_active=1 AND (ca.client_id=c.id OR (c.account_number IS NOT NULL AND c.account_number<>'' AND ca.account_number=c.account_number)))`);
    if(view==='archived') where.push(`(c.lifecycle_status='archived' OR c.is_active=0)`);
    if(view==='all') where.push(`c.is_active=1`);
    const sqlWhere=where.length ? `WHERE ${where.join(' AND ')}` : '';
    [clients]=await db.execute(`SELECT
      c.id,c.account_number,c.client_name,c.cell_number,c.email,c.lifecycle_status,c.lead_status,c.created_at,
      COALESCE(c.city_town,NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.raw_import_json, '$.city_town'))), ''),'') AS city_town,
      c.handset,c.upgrade_date,c.previous_upgrade_date,c.next_upgrade_date,c.line_status,c.birthday,
      (SELECT COUNT(*) FROM clients x WHERE
        (c.account_number IS NOT NULL AND c.account_number<>'' AND x.account_number=c.account_number)
        OR (c.id_number IS NOT NULL AND c.id_number<>'' AND x.id_number=c.id_number)
      ) AS line_count,
      (SELECT a.assigned_staff_id FROM client_assignments a
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_id,
      (SELECT su.full_name FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_name,
      (SELECT i.query_text FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_inquiry,
      (SELECT i.action_taken FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_action
      FROM clients c ${sqlWhere}
      ORDER BY CASE WHEN c.lifecycle_status='prospect' THEN 0 ELSE 1 END,c.created_at DESC,c.client_name ASC LIMIT 200`,params);
    const [[counts]]=await db.execute(`SELECT
      SUM(is_active=1) active_count,
      SUM(is_active=1 AND lifecycle_status='prospect') prospect_count,
      SUM(is_active=1 AND lifecycle_status='prospect' AND (email IS NULL OR email='' OR city_town IS NULL OR city_town='' OR id_number IS NULL OR id_number='')) incomplete_count,
      SUM(is_active=0 OR lifecycle_status='archived') archived_count
      FROM clients`);
    const [[unassigned]]=await db.execute(`SELECT COUNT(*) total FROM clients c WHERE c.is_active=1 AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.is_active=1 AND (ca.client_id=c.id OR (c.account_number IS NOT NULL AND c.account_number<>'' AND ca.account_number=c.account_number)))`);
    res.render('clients-admin',{title:'Client Administration',q,view,clients,staff,saved:req.query.saved,counts:{...(counts||{}),unassigned_count:unassigned?.total||0}});
  } catch(e){ next(e); }
});

router.post('/backoffice/clients/:id/assign', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const clientId=Number(req.params.id); const staffId=Number(req.body.assigned_staff_id||0)||null;
    const [[client]]=await db.execute('SELECT id,account_number,client_name FROM clients WHERE id=:id LIMIT 1',{id:clientId});
    if(!client) return res.status(400).render('error',{title:'Invalid assignment',message:'The selected client could not be found.'});
    const [[before]]=await db.execute(`SELECT a.assigned_staff_id,s.full_name assigned_staff_name FROM client_assignments a JOIN staff_users s ON s.id=a.assigned_staff_id WHERE a.is_active=1 AND (a.client_id=:clientId OR (:accountNumber<>'' AND a.account_number=:accountNumber)) ORDER BY (a.client_id=:clientId) DESC,a.updated_at DESC LIMIT 1`,{clientId,accountNumber:client.account_number||''});
    let afterName='Unassigned';
    if(staffId){const [[staff]]=await db.execute('SELECT id,full_name FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',{id:staffId});if(!staff)return res.status(400).render('error',{title:'Invalid assignment',message:'Select a valid active staff member.'});afterName=staff.full_name;}
    if(client.account_number)await ensureCustomerAccount(client.account_number,client.client_name);
    await saveClientAssignment(clientId,client.account_number,staffId,req.session.user.id);
    await audit(req,{actionType:'client_assignment_changed',entityType:'clients',entityId:clientId,description:`Assignment for ${client.client_name} changed from ${before?.assigned_staff_name||'Unassigned'} to ${afterName}`,before:{assigned_staff_id:before?.assigned_staff_id||null,assigned_staff_name:before?.assigned_staff_name||'Unassigned'},after:{assigned_staff_id:staffId,assigned_staff_name:afterName,scope:client.account_number?'account':'client'}});
    const back=String(req.body.return_q||'').trim();
    const returnTo=String(req.body.return_to||'');
    if(returnTo==='customer360') return res.redirect(`${res.locals.basePath}/customers/${clientId}/360?assigned=1`);
    res.redirect(`${res.locals.basePath}/backoffice/clients?q=${encodeURIComponent(back)}&saved=1`);
  } catch(e){ next(e); }
});


router.get('/api/tasks/unread-latest', requireAuth, async (req,res,next) => {
  try {
    const [[task]] = await db.execute(`SELECT t.id,t.type,t.title,t.message,t.priority,t.due_at,t.created_at,
      creator.full_name created_by_name
      FROM staff_tasks t
      JOIN staff_users creator ON creator.id=t.created_by
      WHERE t.assigned_to=:staffId AND t.status='unread'
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        t.created_at DESC
      LIMIT 1`, { staffId:req.session.user.id });
    if (!task) return res.json({ task:null });
    res.json({ task:{
      id:task.id,
      type:task.type,
      title:task.title,
      message:task.message,
      priority:task.priority,
      due_at:task.due_at,
      created_at:task.created_at,
      created_by_name:task.created_by_name,
      url:`${res.locals.basePath}/tasks/${task.id}`
    }});
  } catch(e){ next(e); }
});

router.get('/tasks', requireAuth, async (req,res,next) => {
  try {
    const isOwner = isOwnerRole(req.session.user);
    const requestedView=String(req.query.view||'active');
    const view=['active','sent','all','archive'].includes(requestedView)?requestedView:'active';
    const ownerView=isOwner&&view==='all',sentView=view==='sent',archiveView=view==='archive';
    const q=String(req.query.q||'').trim();
    const staffFilter=isOwner?(Number(req.query.staff_id||0)||null):null;
    const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?String(req.query.from):'';
    const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?String(req.query.to):'';
    const params={staffId:req.session.user.id,q:`%${q}%`,staffFilter,from,to};const where=[];
    if(archiveView){
      where.push("t.status IN ('completed','cancelled')");
      if(!isOwner)where.push('(t.assigned_to=:staffId OR t.created_by=:staffId)');
    }else{
      where.push("t.status IN ('unread','seen','in_progress')");
      if(sentView)where.push('t.created_by=:staffId');else if(!ownerView)where.push('t.assigned_to=:staffId');
    }
    if(staffFilter)where.push('(t.assigned_to=:staffFilter OR t.created_by=:staffFilter)');
    if(q)where.push('(t.title LIKE :q OR t.message LIKE :q OR ass.full_name LIKE :q OR creator.full_name LIKE :q OR cl.client_name LIKE :q OR fa.customer_name LIKE :q OR fa.account_number LIKE :q)');
    if(from)where.push('t.created_at>=:from');if(to)where.push('t.created_at<DATE_ADD(:to,INTERVAL 1 DAY)');
    const [tasks] = await db.execute(`SELECT t.*, ass.full_name assigned_name, ass.email assigned_email,
      creator.full_name created_by_name, cl.client_name related_client_name, fa.customer_name related_fixed_name, fa.account_number related_fixed_account
      FROM staff_tasks t
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id
      LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE t.status WHEN 'unread' THEN 0 WHEN 'seen' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        t.due_at IS NULL, t.due_at ASC, t.created_at DESC
      LIMIT 1000`,params);
    const [staff]=isOwner?await db.query('SELECT id,full_name FROM staff_users ORDER BY full_name'):[[]];
    const title=archiveView?'Completed Archive':ownerView?'All Staff Active':sentView?'Sent by Me — Active':'My Active Messages & Tasks';
    res.render('tasks-list',{title,tasks,view,ownerView,sentView,archiveView,isOwner,staff,filters:{q,staffFilter,from,to}});
  } catch(e){ next(e); }
});

router.get('/tasks/new', requireAuth, async (req,res,next) => {
  try {
    const [staff] = await db.query("SELECT id,full_name,email,role FROM staff_users WHERE is_active=1 ORDER BY full_name");
    const [openCases] = await db.query(`SELECT i.id,i.client_id,i.client_name,i.query_text,i.status,c.category_name
      FROM inquiries i LEFT JOIN inquiry_categories c ON c.id=i.category_id
      WHERE i.status IN ('open','follow-up','in_progress')
      ORDER BY i.follow_up_at IS NULL, i.follow_up_at ASC, i.created_at DESC LIMIT 250`);
    let selectedFixed=null;
    if(req.query.fixed_account_id){const [[row]]=await db.execute('SELECT id,customer_name,account_number FROM fixed_accounts WHERE id=:id',{id:Number(req.query.fixed_account_id)});selectedFixed=row||null;}
    res.render('task-new',{title:'Create Task or Notification',staff,openCases,error:null,selectedFixed});
  } catch(e){ next(e); }
});

router.post('/tasks', requireAuth, async (req,res,next) => {
  try {
    const { type,title,message,priority,assigned_to,due_at,related_client_id,related_inquiry_id,related_fixed_account_id,related_fixed_service_id,send_email } = req.body;
    const [staff] = await db.query("SELECT id,full_name,email,role FROM staff_users WHERE is_active=1 ORDER BY full_name");
    const [openCases] = await db.query(`SELECT i.id,i.client_id,i.client_name,i.query_text,i.status,c.category_name
      FROM inquiries i LEFT JOIN inquiry_categories c ON c.id=i.category_id
      WHERE i.status IN ('open','follow-up','in_progress')
      ORDER BY i.follow_up_at IS NULL, i.follow_up_at ASC, i.created_at DESC LIMIT 250`);

    if (!title || !message || !assigned_to) {
      return res.status(400).render('task-new',{title:'Create Task or Notification',staff,openCases,error:'Title, message and recipient are required.'});
    }

    const [[recipient]] = await db.execute('SELECT id,full_name,email FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',{id:Number(assigned_to)});
    if (!recipient) return res.status(400).render('task-new',{title:'Create Task or Notification',staff,openCases,error:'The selected staff member could not be found.'});

    let relatedClientId = null;
    if (related_client_id) {
      const [[client]] = await db.execute('SELECT id FROM clients WHERE id=:id LIMIT 1',{id:Number(related_client_id)});
      if (!client) return res.status(400).render('task-new',{title:'Create Task or Notification',staff,openCases,error:'Please select a valid client from the search results.'});
      relatedClientId = client.id;
    }

    let relatedInquiryId = null;
    if (related_inquiry_id) {
      const [[inquiry]] = await db.execute('SELECT id,client_id FROM inquiries WHERE id=:id LIMIT 1',{id:Number(related_inquiry_id)});
      if (!inquiry) return res.status(400).render('task-new',{title:'Create Task or Notification',staff,openCases,error:'The selected case could not be found.'});
      if (relatedClientId && inquiry.client_id && Number(inquiry.client_id)!==Number(relatedClientId)) {
        return res.status(400).render('task-new',{title:'Create Task or Notification',staff,openCases,error:'The selected case does not belong to the selected client.'});
      }
      relatedInquiryId = inquiry.id;
      if (!relatedClientId && inquiry.client_id) relatedClientId = inquiry.client_id;
    }

    let relatedFixedAccountId=null;
    if(related_fixed_account_id){const [[fixed]]=await db.execute('SELECT id FROM fixed_accounts WHERE id=:id',{id:Number(related_fixed_account_id)});if(fixed)relatedFixedAccountId=fixed.id;}
    let relatedFixedServiceId=null;
    if(related_fixed_service_id){const [[service]]=await db.execute('SELECT id,fixed_account_id FROM fixed_services WHERE id=:id',{id:Number(related_fixed_service_id)});if(service){relatedFixedServiceId=service.id;relatedFixedAccountId=relatedFixedAccountId||service.fixed_account_id;}}

    const cleanType=type==='notification'?'notification':'task';
    const cleanPriority=['normal','high','urgent'].includes(priority)?priority:'normal';
    const [result] = await db.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,related_fixed_account_id,related_fixed_service_id,related_inquiry_id,email_status)
      VALUES (:type,:title,:message,:priority,:assigned_to,:created_by,:due_at,:related_client_id,:related_fixed_account_id,:related_fixed_service_id,:related_inquiry_id,:email_status)`,{
      type:cleanType, title:String(title).trim(), message:String(message).trim(), priority:cleanPriority,
      assigned_to:recipient.id, created_by:req.session.user.id, due_at:due_at||null,
      related_client_id:relatedClientId, related_inquiry_id:relatedInquiryId,
      related_fixed_account_id:relatedFixedAccountId, related_fixed_service_id:relatedFixedServiceId,
      email_status:send_email==='1'?'pending':'not_configured'
    });

    const taskId=result.insertId;
    if (send_email === '1') {
      let emailResult;
      try {
        emailResult=await sendTaskEmail({
          to:recipient.email, staffName:recipient.full_name,
          task:{id:taskId,type:cleanType,title:String(title).trim(),message:String(message).trim(),priority:cleanPriority,due_at:due_at||null,created_by_name:req.session.user.full_name},
          appUrl:process.env.APP_URL || `${req.protocol}://${req.get('host')}${res.locals.basePath}`
        });
      } catch (emailError) {
        emailResult={sent:false,error:emailError.message||'Email delivery failed.'};
      }
      await db.execute(`UPDATE staff_tasks SET email_status=:status,email_sent_at=:sentAt,email_error=:error WHERE id=:id`,{
        id:taskId,
        status:emailResult.sent?'sent':(String(emailResult.error||'').includes('not configured')?'not_configured':'failed'),
        sentAt:emailResult.sent?new Date():null,
        error:emailResult.sent?null:String(emailResult.error||'').slice(0,500)
      });
    }

    res.redirect(`${res.locals.basePath}/tasks/${taskId}?created=1`);
  } catch(e){ next(e); }
});

router.get('/tasks/:id', requireAuth, async (req,res,next) => {
  try {
    const id=Number(req.params.id);
    const [[task]]=await db.execute(`SELECT t.*, ass.full_name assigned_name, ass.email assigned_email,
      creator.full_name created_by_name, cl.client_name related_client_name, fa.customer_name related_fixed_name, fa.account_number related_fixed_account
      FROM staff_tasks t JOIN staff_users ass ON ass.id=t.assigned_to JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id WHERE t.id=:id LIMIT 1`,{id});
    if(!task) return res.status(404).render('error',{title:'Not found',message:'Task could not be found.'});
    if(!isOwnerRole(req.session.user) && task.assigned_to!==req.session.user.id && task.created_by!==req.session.user.id) return res.status(403).render('error',{title:'Access denied',message:'This message was not sent by or assigned to you.'});
    if(task.assigned_to===req.session.user.id && task.status==='unread') await db.execute("UPDATE staff_tasks SET status='seen',seen_at=NOW() WHERE id=:id",{id});
    const [comments]=await db.execute(`SELECT c.*,s.full_name FROM staff_task_comments c JOIN staff_users s ON s.id=c.staff_id WHERE c.task_id=:id ORDER BY c.created_at DESC`,{id});
    const effectiveStatus=task.status==='unread'&&task.assigned_to===req.session.user.id?'seen':task.status;
    const archived=['completed','cancelled'].includes(effectiveStatus);
    const canControl=isOwnerRole(req.session.user)||task.assigned_to===req.session.user.id;
    res.render('task-detail',{title:`Task #${id}`,task:{...task,status:effectiveStatus},comments,isOwner:isOwnerRole(req.session.user),canUpdate:canControl&&!archived,canReopen:canControl&&archived,isArchived:archived,created:req.query.created});
  } catch(e){ next(e); }
});

router.post('/tasks/:id/status', requireAuth, async (req,res,next) => {
  try {
    const id=Number(req.params.id); const status=String(req.body.status||'');
    const allowed=['seen','in_progress','completed','cancelled'];
    if(!allowed.includes(status)) return res.status(400).render('error',{title:'Invalid status',message:'Invalid task status.'});
    const [[task]]=await db.execute('SELECT * FROM staff_tasks WHERE id=:id LIMIT 1',{id});
    if(!task) return res.sendStatus(404);
    if(!isOwnerRole(req.session.user) && task.assigned_to!==req.session.user.id) return res.sendStatus(403);
    await db.execute(`UPDATE staff_tasks SET status=:status,
      seen_at=CASE WHEN :status IN ('seen','in_progress','completed') THEN COALESCE(seen_at,NOW()) ELSE seen_at END,
      started_at=CASE WHEN :status='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,
      completed_at=CASE WHEN :status='completed' THEN NOW() WHEN :status<>'completed' THEN NULL ELSE completed_at END,
      completion_note=CASE WHEN :status='completed' THEN :note ELSE completion_note END
      WHERE id=:id`,{id,status,note:req.body.completion_note||null});
    await db.execute('INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:id,:staffId,:comment)',{id,staffId:req.session.user.id,comment:`Status changed from ${task.status} to ${status}${req.body.completion_note?' — '+String(req.body.completion_note).trim():''}`});
    res.redirect(`${res.locals.basePath}/tasks/${id}`);
  } catch(e){ next(e); }
});

router.post('/tasks/:id/reopen',requireAuth,async(req,res,next)=>{
  try{
    const id=Number(req.params.id);const [[task]]=await db.execute('SELECT * FROM staff_tasks WHERE id=:id LIMIT 1',{id});
    if(!task)return res.sendStatus(404);
    if(!isOwnerRole(req.session.user)&&task.assigned_to!==req.session.user.id)return res.sendStatus(403);
    if(!['completed','cancelled'].includes(task.status))return res.redirect(`${res.locals.basePath}/tasks/${id}`);
    await db.execute("UPDATE staff_tasks SET status='seen',completed_at=NULL,completion_note=NULL WHERE id=:id",{id});
    await db.execute('INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:id,:staffId,:comment)',{id,staffId:req.session.user.id,comment:`Reopened from ${task.status}`});
    res.redirect(`${res.locals.basePath}/tasks/${id}`);
  }catch(e){next(e)}
});

router.post('/tasks/:id/comments', requireAuth, async (req,res,next) => {
  try {
    const id=Number(req.params.id); const comment=String(req.body.comment||'').trim();
    const [[task]]=await db.execute('SELECT * FROM staff_tasks WHERE id=:id LIMIT 1',{id});
    if(!task) return res.sendStatus(404);
    if(!isOwnerRole(req.session.user) && task.assigned_to!==req.session.user.id && task.created_by!==req.session.user.id) return res.sendStatus(403);
    if(comment) await db.execute('INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:id,:staffId,:comment)',{id,staffId:req.session.user.id,comment});
    res.redirect(`${res.locals.basePath}/tasks/${id}`);
  } catch(e){ next(e); }
});



function birthdayFromSaId(idNumber) {
  const digits = String(idNumber || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const currentYear = new Date().getFullYear();
  const currentYY = currentYear % 100;
  const year = yy > currentYY ? 1900 + yy : 2000 + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${String(year).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}

function cleanDate(value) {
  const v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function cleanMoney(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normaliseSaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? digits : null;
}
function clientPayload(body) {
  const lifecycle = ['prospect','client','inactive','lost'].includes(body.lifecycle_status) ? body.lifecycle_status : 'prospect';
  const lead = ['new','contacted','qualified','converted','not_interested'].includes(body.lead_status) ? body.lead_status : null;
  const type = ['individual','business','unknown'].includes(body.customer_type) ? body.customer_type : 'unknown';
  return {
    account_number: body.account_number || null,
    first_name: body.first_name || null,
    surname: body.surname || null,
    company_name: body.company_name || null,
    client_name: String(body.client_name || '').trim(),
    cell_number: body.cell_number || null,
    cell_number_normalised: normaliseSaPhone(body.cell_number),
    alt_number: body.alt_number || null,
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    city_town: body.city_town || null,
    id_number: body.id_number || null,
    birthday: birthdayFromSaId(body.id_number) || cleanDate(body.birthday),
    customer_type: type,
    lifecycle_status: lifecycle,
    lead_source: body.lead_source || null,
    lead_status: lead,
    package_name: body.package_name || null,
    handset: body.handset || null,
    monthly_invoice_amount: cleanMoney(body.monthly_invoice_amount),
    upgrade_date: cleanDate(body.previous_upgrade_date || body.upgrade_date),
    previous_upgrade_date: cleanDate(body.previous_upgrade_date || body.upgrade_date),
    contract_term_months: Number(body.contract_term_months) === 36 ? 36 : 24,
    line_status: ['active','inactive','cancelled','suspended','unknown'].includes(body.line_status) ? body.line_status : 'unknown',
    main_contact_name: body.main_contact_name || null,
    main_contact_number: body.main_contact_number || null,
    main_contact_number_normalised: normaliseSaPhone(body.main_contact_number),
    account_authority_status: ['unknown','confirmed','not_authorised'].includes(body.account_authority_status) ? body.account_authority_status : 'unknown',
    authority_notes: body.authority_notes || null,
    cancellation_date: cleanDate(body.cancellation_date),
    notes: body.notes || null,
    is_active: String(body.is_active || '1') === '0' ? 0 : 1
  };
}


router.get('/backoffice/reports/new-contacts', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||'')) ? String(req.query.from) : defaultFrom;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||'')) ? String(req.query.to) : today.toISOString().slice(0,10);
    const staffId = Number(req.query.staff_id||0) || null;
    const params = { from, to, staffId };
    const staffFilter = staffId ? ' AND c.created_by_staff_id=:staffId ' : '';

    const [rows] = await db.execute(`SELECT c.id,c.client_name,c.cell_number,c.email,c.lifecycle_status,c.lead_status,c.lead_source,c.created_at,
      su.full_name created_by_name,
      i.id inquiry_id,i.walkin_or_call,i.query_text,i.result_found,i.action_taken,i.status inquiry_status,i.created_at inquiry_created_at,
      ic.category_name inquiry_category,
      COALESCE(a.assigned_staff_id,NULL) assigned_staff_id,
      assigned.full_name assigned_staff_name
      FROM clients c
      LEFT JOIN staff_users su ON su.id=c.created_by_staff_id
      LEFT JOIN inquiries i ON i.id=(SELECT i2.id FROM inquiries i2 WHERE i2.client_id=c.id ORDER BY i2.created_at ASC LIMIT 1)
      LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2 WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number IS NOT NULL AND a2.account_number<>'' AND a2.account_number=c.account_number)) ORDER BY (a2.client_id=c.id) DESC,a2.updated_at DESC LIMIT 1)
      LEFT JOIN staff_users assigned ON assigned.id=a.assigned_staff_id
      WHERE c.lifecycle_status='prospect'
        AND (c.lead_source IN ('Quick inquiry capture','Shop inquiry') OR c.created_from_inquiry_id IS NOT NULL)
        AND DATE(c.created_at) BETWEEN :from AND :to
        ${staffFilter}
      ORDER BY c.created_at DESC`, params);

    const [summary] = await db.execute(`SELECT COALESCE(su.full_name,'Unknown') staff_name,COUNT(*) total,
      SUM(c.lead_status='new') new_count,
      SUM(c.lead_status='contacted') contacted_count,
      SUM(c.lead_status='qualified') qualified_count,
      SUM(c.lead_status='converted') converted_count
      FROM clients c LEFT JOIN staff_users su ON su.id=c.created_by_staff_id
      WHERE c.lifecycle_status='prospect'
        AND (c.lead_source IN ('Quick inquiry capture','Shop inquiry') OR c.created_from_inquiry_id IS NOT NULL)
        AND DATE(c.created_at) BETWEEN :from AND :to
        ${staffFilter}
      GROUP BY su.id,su.full_name ORDER BY total DESC`, params);

    const [[totals]] = await db.execute(`SELECT COUNT(*) total,
      SUM(lead_status='new') new_count,SUM(lead_status='contacted') contacted_count,
      SUM(lead_status='qualified') qualified_count,SUM(lead_status='converted') converted_count
      FROM clients c WHERE c.lifecycle_status='prospect'
        AND (c.lead_source IN ('Quick inquiry capture','Shop inquiry') OR c.created_from_inquiry_id IS NOT NULL)
        AND DATE(c.created_at) BETWEEN :from AND :to ${staffFilter}`, params);
    const [staff] = await db.query(`SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name`);
    res.render('report-new-contacts',{title:'New Walk-in Contacts',rows,summary,totals:totals||{},staff,filters:{from,to,staff_id:staffId}});
  } catch(e){ next(e); }
});

async function saveClientAssignment(clientId, accountNumber, staffId, assignedBy) {
  if (!staffId) {
    await db.execute(`UPDATE client_assignments SET is_active=0,updated_at=NOW()
      WHERE is_active=1 AND (client_id=:clientId OR (:accountNumber IS NOT NULL AND :accountNumber<>'' AND account_number=:accountNumber))`,{clientId,accountNumber:accountNumber||null});
    if(accountNumber) await db.execute(`UPDATE customer_accounts SET assigned_staff_id=NULL,assigned_by=:assignedBy,assignment_confirmed_at=NULL WHERE account_number_normalised=UPPER(REPLACE(TRIM(:accountNumber),' ',''))`,{accountNumber,assignedBy});
    return;
  }
  const [[staff]] = await db.execute('SELECT id FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',{id:staffId});
  if (!staff) throw new Error('Invalid staff assignment');
  await db.execute(`UPDATE client_assignments SET is_active=0,updated_at=NOW()
    WHERE is_active=1 AND (client_id=:clientId OR (:accountNumber IS NOT NULL AND :accountNumber<>'' AND account_number=:accountNumber))`,{clientId,accountNumber:accountNumber||null});
  await db.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
    VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)`,{clientId,accountNumber:accountNumber||null,staffId,assignedBy});
  if(accountNumber) await db.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,assignment_confirmed_at=NOW() WHERE account_number_normalised=UPPER(REPLACE(TRIM(:accountNumber),' ',''))`,{accountNumber,staffId,assignedBy});
}

async function ensureCustomerAccount(accountNumber, displayName) {
  const value=String(accountNumber||'').trim();if(!value)return null;
  const normalised=value.replace(/\s+/g,'').toUpperCase();
  await db.execute(`INSERT INTO customer_accounts (account_number,account_number_normalised,display_name) VALUES (:account,:normalised,:displayName) ON DUPLICATE KEY UPDATE display_name=COALESCE(NULLIF(customer_accounts.display_name,''),VALUES(display_name))`,{account:value,normalised,displayName:displayName||value});
  const [[account]]=await db.execute('SELECT id,account_number,assigned_staff_id FROM customer_accounts WHERE account_number_normalised=:normalised',{normalised});return account||null;
}

async function saveAccountAuthority(clientId, accountNumber, data, verifiedBy) {
  const params = {
    clientId, accountNumber: accountNumber || null,
    main_contact_name: data.main_contact_name,
    main_contact_number: data.main_contact_number,
    main_contact_number_normalised: data.main_contact_number_normalised,
    account_authority_status: data.account_authority_status,
    authority_notes: data.authority_notes,
    verifiedBy: data.account_authority_status === 'confirmed' ? verifiedBy : null
  };
  await db.execute(`UPDATE clients SET
      main_contact_name=:main_contact_name,main_contact_number=:main_contact_number,
      main_contact_number_normalised=:main_contact_number_normalised,
      account_authority_status=:account_authority_status,authority_notes=:authority_notes,
      authority_verified_at=CASE WHEN :account_authority_status='confirmed' THEN NOW() ELSE NULL END,
      authority_verified_by=:verifiedBy
    WHERE id=:clientId OR (:accountNumber IS NOT NULL AND :accountNumber<>'' AND account_number=:accountNumber)`, params);
}


router.post('/backoffice/clients/:id/delete', requireAuth, requireRole('owner'), async (req,res,next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).render('error',{title:'Invalid client',message:'The client record could not be identified.'});
    const reason=String(req.body.delete_reason||'').trim(),password=String(req.body.owner_password||'');
    if(!reason||!password)return res.status(400).render('error',{title:'Protected action',message:'Owner password and a deletion/archive reason are required.'});
    const [[owner]]=await db.execute('SELECT password_hash FROM staff_users WHERE id=:id AND role=\'owner\' AND is_active=1',{id:req.session.user.id});
    if(!owner?.password_hash||!(await bcrypt.compare(password,owner.password_hash)))return res.status(403).render('error',{title:'Password not confirmed',message:'The owner password was incorrect. Nothing was changed.'});
    const [[client]] = await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1',{id});
    if (!client) return res.status(404).render('error',{title:'Not found',message:'The client record could not be found.'});
    await db.execute(`UPDATE clients SET is_active=0,lifecycle_status='inactive',updated_at=NOW() WHERE id=:id`,{id});
    await db.execute(`UPDATE client_assignments SET is_active=0,updated_at=NOW() WHERE client_id=:id`,{id});
    await audit(req,{actionType:'client_archived',entityType:'clients',entityId:id,description:`Owner archived ${client.client_name}. Reason: ${reason}`,before:client,after:{is_active:0,lifecycle_status:'inactive'}});
    const back = String(req.body.return_to || '').trim();
    if (back) return res.redirect(`${res.locals.basePath}${back}`);
    return res.redirect(`${res.locals.basePath}/backoffice/reports/new-contacts?deleted=1`);
  } catch(e){ next(e); }
});

router.get('/backoffice/clients/new', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const inquiryId = Number(req.query.inquiry_id || 0) || null;
    let prefill = { client_name:req.query.client_name || '', cell_number:req.query.cell_number || '', email:req.query.email || '', account_number:req.query.account_number||'' };
    if (inquiryId) {
      const [[inq]] = await db.execute('SELECT client_name,cell_number,email FROM inquiries WHERE id=:id LIMIT 1',{id:inquiryId});
      if (inq) prefill = inq;
    }
    const [staff] = await db.query(`SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name`);
    const account=prefill.account_number?await ensureCustomerAccount(prefill.account_number,prefill.client_name):null;
    res.render('client-edit',{title:'Add Client / Potential Client',client:null,prefill,inquiryId,saved:false,staff,assignedStaffId:account?.assigned_staff_id||null});
  } catch(e){ next(e); }
});

router.post('/backoffice/clients', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const data=clientPayload(req.body);
    if(!data.client_name) return res.status(400).render('error',{title:'Client name required',message:'Enter a client or company name.'});
    const [result]=await db.execute(`INSERT INTO clients
      (account_number,first_name,surname,company_name,client_name,cell_number,cell_number_normalised,alt_number,email,city_town,id_number,birthday,customer_type,lifecycle_status,lead_source,lead_status,package_name,handset,monthly_invoice_amount,upgrade_date,previous_upgrade_date,contract_term_months,next_upgrade_date,cancellation_date,line_status,main_contact_name,main_contact_number,main_contact_number_normalised,account_authority_status,authority_notes,notes,created_from_inquiry_id,created_by_staff_id,is_active)
      VALUES (:account_number,:first_name,:surname,:company_name,:client_name,:cell_number,:cell_number_normalised,:alt_number,:email,:city_town,:id_number,:birthday,:customer_type,:lifecycle_status,:lead_source,:lead_status,:package_name,:handset,:monthly_invoice_amount,DATE_ADD(:previous_upgrade_date,INTERVAL :contract_term_months MONTH),:previous_upgrade_date,:contract_term_months,DATE_ADD(:previous_upgrade_date,INTERVAL :contract_term_months MONTH),:cancellation_date,:line_status,:main_contact_name,:main_contact_number,:main_contact_number_normalised,:account_authority_status,:authority_notes,:notes,:inquiry_id,:created_by,:is_active)`,{
      ...data,inquiry_id:Number(req.body.inquiry_id||0)||null,created_by:req.session.user.id
    });
    if(req.body.inquiry_id) await db.execute('UPDATE inquiries SET client_id=:clientId WHERE id=:inquiryId',{clientId:result.insertId,inquiryId:Number(req.body.inquiry_id)});
    const account=await ensureCustomerAccount(data.account_number,data.client_name);if(account)await db.execute('UPDATE clients SET account_id=:accountId WHERE id=:id',{accountId:account.id,id:result.insertId});
    await saveClientAssignment(result.insertId,data.account_number,Number(req.body.assigned_staff_id||0)||null,req.session.user.id);
    await audit(req,{actionType:'client_created',entityType:'clients',entityId:result.insertId,description:`Client ${data.client_name} created and assigned to staff ID ${Number(req.body.assigned_staff_id||0)||'Unassigned'}`,after:{client_name:data.client_name,account_number:data.account_number,assigned_staff_id:Number(req.body.assigned_staff_id||0)||null}});
    await saveAccountAuthority(result.insertId,data.account_number,data,req.session.user.id);
    res.redirect(`${res.locals.basePath}/backoffice/clients/${result.insertId}/edit?saved=1`);
  } catch(e){ next(e); }
});

router.get('/backoffice/clients/:id/edit', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const id=Number(req.params.id); const [[client]]=await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1',{id});
    if(!client) return res.status(404).render('error',{title:'Not found',message:'Client record could not be found.'});
    const [staff] = await db.query(`SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name`);
    const [[assignment]] = await db.execute(`SELECT assigned_staff_id FROM client_assignments
      WHERE is_active=1 AND (client_id=:id OR (account_number IS NOT NULL AND account_number<>'' AND account_number=:accountNumber))
      ORDER BY (client_id=:id) DESC,updated_at DESC LIMIT 1`,{id,accountNumber:client.account_number||''});
    res.render('client-edit',{title:`Edit ${client.client_name}`,client,prefill:null,inquiryId:null,saved:req.query.saved,staff,assignedStaffId:assignment?.assigned_staff_id||null});
  } catch(e){ next(e); }
});

router.post('/backoffice/clients/:id', requireAuth, requireRole('owner','manager'), async (req,res,next) => {
  try {
    const id=Number(req.params.id); const data=clientPayload(req.body);
    if(!data.client_name) return res.status(400).render('error',{title:'Client name required',message:'Enter a client or company name.'});
    const [[beforeAssignment]]=await db.execute(`SELECT a.assigned_staff_id,s.full_name assigned_staff_name FROM client_assignments a JOIN staff_users s ON s.id=a.assigned_staff_id WHERE a.is_active=1 AND (a.client_id=:id OR (:account<>'' AND a.account_number=:account)) ORDER BY (a.client_id=:id) DESC,a.updated_at DESC LIMIT 1`,{id,account:data.account_number||''});
    await db.execute(`UPDATE clients SET
      account_number=:account_number,first_name=:first_name,surname=:surname,company_name=:company_name,client_name=:client_name,
      cell_number=:cell_number,cell_number_normalised=:cell_number_normalised,alt_number=:alt_number,email=:email,city_town=:city_town,id_number=:id_number,birthday=:birthday,
      customer_type=:customer_type,lifecycle_status=:lifecycle_status,lead_source=:lead_source,lead_status=:lead_status,
      package_name=:package_name,handset=:handset,monthly_invoice_amount=:monthly_invoice_amount,upgrade_date=DATE_ADD(:previous_upgrade_date,INTERVAL :contract_term_months MONTH),
      previous_upgrade_date=:previous_upgrade_date,contract_term_months=:contract_term_months,next_upgrade_date=DATE_ADD(:previous_upgrade_date,INTERVAL :contract_term_months MONTH),
      cancellation_date=:cancellation_date,line_status=:line_status,main_contact_name=:main_contact_name,main_contact_number=:main_contact_number,
      main_contact_number_normalised=:main_contact_number_normalised,account_authority_status=:account_authority_status,authority_notes=:authority_notes,
      notes=:notes,is_active=:is_active,updated_at=NOW() WHERE id=:id`,{...data,id});
    const account=await ensureCustomerAccount(data.account_number,data.client_name);await db.execute('UPDATE clients SET account_id=:accountId WHERE id=:id',{accountId:account?.id||null,id});
    await saveClientAssignment(id,data.account_number,Number(req.body.assigned_staff_id||0)||null,req.session.user.id);
    const newStaffId=Number(req.body.assigned_staff_id||0)||null;
    if(Number(beforeAssignment?.assigned_staff_id||0)!==Number(newStaffId||0)){
      const [[newStaff]]=newStaffId?await db.execute('SELECT full_name FROM staff_users WHERE id=:id',{id:newStaffId}):[[]];
      await audit(req,{actionType:'client_assignment_changed',entityType:'clients',entityId:id,description:`Assignment for ${data.client_name} changed from ${beforeAssignment?.assigned_staff_name||'Unassigned'} to ${newStaff?.full_name||'Unassigned'}`,before:{assigned_staff_id:beforeAssignment?.assigned_staff_id||null,assigned_staff_name:beforeAssignment?.assigned_staff_name||'Unassigned'},after:{assigned_staff_id:newStaffId,assigned_staff_name:newStaff?.full_name||'Unassigned',scope:data.account_number?'account':'client'}});
    }
    await saveAccountAuthority(id,data.account_number,data,req.session.user.id);
    res.redirect(`${res.locals.basePath}/backoffice/clients/${id}/edit?saved=1`);
  } catch(e){ next(e); }
});


router.get('/backoffice/reports/birthday-corrections', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const [rows] = await db.query(`SELECT bc.id,bc.client_id,c.client_name,c.cell_number,c.id_number,
      bc.previous_birthday,bc.derived_birthday,bc.corrected_at
      FROM birthday_corrections bc
      JOIN clients c ON c.id=bc.client_id
      ORDER BY bc.corrected_at DESC LIMIT 500`);
    res.render('report-birthday-corrections',{title:'Birthday Corrections',rows});
  } catch(e){ next(e); }
});


router.get('/backoffice/inquiries', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const categoryId = Number(req.query.category_id || 0) || null;
    const staffId = Number(req.query.staff_id || 0) || null;
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const where = ['1=1'];
    const params = {};
    if (from) { where.push('DATE(i.created_at) >= :from'); params.from = from; }
    if (to) { where.push('DATE(i.created_at) <= :to'); params.to = to; }
    if (categoryId) { where.push('i.category_id = :categoryId'); params.categoryId = categoryId; }
    if (staffId) { where.push('i.staff_id = :staffId'); params.staffId = staffId; }
    if (status) { where.push('i.status = :status'); params.status = status; }
    if (q) {
      where.push('(i.client_name LIKE :q OR i.cell_number LIKE :q OR i.email LIKE :q OR i.query_text LIKE :q OR i.action_taken LIKE :q)');
      params.q = `%${q}%`;
    }
    const whereSql = where.join(' AND ');
    const [categories] = await db.query('SELECT id,category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order,category_name');
    const [staff] = await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name');
    const [rows] = await db.execute(`SELECT i.id,i.created_at,i.client_id,i.client_name,i.cell_number,i.email,
      i.query_text,i.result_found,i.action_taken,i.status,i.follow_up_at,
      ic.category_name,COALESCE(s.full_name,'Unassigned') staff_name
      FROM inquiries i
      LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      LEFT JOIN staff_users s ON s.id=i.staff_id
      WHERE ${whereSql}
      ORDER BY i.created_at DESC LIMIT 1000`, params);
    const [[totals]] = await db.execute(`SELECT COUNT(*) total,
      SUM(i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')) open_count,
      SUM(i.status IN ('resolved','cancelled')) completed_count,
      SUM(i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW() AND i.status NOT IN ('resolved','cancelled')) overdue_count,
      SUM(i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE() AND i.status NOT IN ('resolved','cancelled')) due_today_count
      FROM inquiries i WHERE ${whereSql}`, params);
    const [categorySummary] = await db.execute(`SELECT COALESCE(ic.category_name,'Uncategorised') category_name,
      COUNT(*) total,
      SUM(i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')) open_count,
      SUM(i.status IN ('resolved','cancelled')) completed_count,
      SUM(i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW() AND i.status NOT IN ('resolved','cancelled')) overdue_count
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      WHERE ${whereSql}
      GROUP BY ic.id,ic.category_name ORDER BY total DESC,category_name`, params);
    const [staffSummary] = await db.execute(`SELECT COALESCE(s.full_name,'Unassigned') staff_name,
      COUNT(*) total,
      SUM(i.status IN ('resolved','cancelled')) completed_count,
      SUM(i.status NOT IN ('resolved','cancelled')) outstanding_count,
      SUM(i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW() AND i.status NOT IN ('resolved','cancelled')) overdue_count
      FROM inquiries i LEFT JOIN staff_users s ON s.id=i.staff_id
      WHERE ${whereSql}
      GROUP BY s.id,s.full_name ORDER BY total DESC,staff_name`, params);
    res.render('inquiry-reports',{title:'Inquiry Reporting Centre',rows,totals:totals||{},categories,staff,categorySummary,staffSummary,
      filters:{from,to,category_id:categoryId||'',staff_id:staffId||'',status,q}});
  } catch(e){ next(e); }
});

router.get('/backoffice/inquiries.csv', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const where=['1=1']; const params={};
    const from=String(req.query.from||'').trim(),to=String(req.query.to||'').trim(),q=String(req.query.q||'').trim(),status=String(req.query.status||'').trim();
    const categoryId=Number(req.query.category_id||0)||null,staffId=Number(req.query.staff_id||0)||null;
    if(from){where.push('DATE(i.created_at)>=:from');params.from=from} if(to){where.push('DATE(i.created_at)<=:to');params.to=to}
    if(categoryId){where.push('i.category_id=:categoryId');params.categoryId=categoryId} if(staffId){where.push('COALESCE(i.assigned_staff_id,i.staff_id)=:staffId');params.staffId=staffId}
    if(status){where.push('i.status=:status');params.status=status} if(q){where.push('(i.client_name LIKE :q OR i.cell_number LIKE :q OR i.email LIKE :q OR i.query_text LIKE :q OR i.action_taken LIKE :q)');params.q=`%${q}%`}
    const [rows] = await db.execute(`SELECT i.created_at,i.client_name,i.cell_number,COALESCE(ic.category_name,'Uncategorised') category_name,
      i.query_text,i.action_taken,COALESCE(s.full_name,'Unassigned') staff_name,i.status,i.follow_up_at
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
      WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC`,params);
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const lines = [['Date','Client','Telephone','Category','Inquiry','Action Taken','Staff','Status','Follow-up'].map(esc).join(',')];
    for (const r of rows) lines.push([r.created_at,r.client_name,r.cell_number,r.category_name,r.query_text,r.action_taken,r.staff_name,r.status,r.follow_up_at].map(esc).join(','));
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="talk2me-inquiries.csv"');
    res.send('\ufeff'+lines.join('\n'));
  } catch(e){ next(e); }
});

// Phase 2 rebuild: operational command centre, customer 360, work and upgrade centres.
router.get('/command-centre', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const openStatuses = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
    const [[stats]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses}) open_inquiries,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND follow_up_at<NOW()) overdue_inquiries,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND DATE(follow_up_at)=CURRENT_DATE()) due_today,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND COALESCE(assigned_staff_id,staff_id) IS NULL) unassigned_work,
      (SELECT COUNT(*) FROM staff_tasks WHERE status IN ('unread','seen','in_progress')) open_tasks,
      (SELECT COUNT(*) FROM staff_tasks WHERE status IN ('unread','seen','in_progress') AND due_at<NOW()) overdue_tasks,
      (SELECT COUNT(*) FROM clients WHERE line_status<>'cancelled' AND next_upgrade_date=CURRENT_DATE()) upgrades_today,
      (SELECT COUNT(*) FROM clients WHERE line_status<>'cancelled' AND next_upgrade_date<CURRENT_DATE()) overdue_upgrades,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(id_number,''),CONCAT('client:',id))) FROM clients WHERE birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())) birthdays_today,
      (SELECT COUNT(*) FROM clients WHERE DATE(created_at)=CURRENT_DATE() AND lifecycle_status='prospect') walkins_today,
      (SELECT COUNT(*) FROM clients c WHERE c.is_active=1 AND NOT EXISTS(SELECT 1 FROM client_assignments a WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)))) unassigned_clients,
      (SELECT COUNT(*) FROM fixed_services WHERE service_status='active') active_fixed_services,
      (SELECT COUNT(*) FROM fixed_accounts WHERE assigned_staff_id IS NULL) unassigned_fixed_accounts,
      (SELECT COUNT(*) FROM data_change_requests WHERE request_type='claim_account' AND status IN ('pending_manager','pending_owner')) pending_claims`);
    const [attention] = await db.query(`
      SELECT 'inquiry' item_type,i.id item_id,i.client_id,i.client_name,i.cell_number,
        COALESCE(ass.full_name,cap.full_name,'Unassigned') owner_name,
        CASE WHEN i.follow_up_at<NOW() THEN 'Overdue inquiry' WHEN DATE(i.follow_up_at)=CURRENT_DATE() THEN 'Follow-up due today' ELSE 'Open inquiry' END reason,
        i.follow_up_at due_at,i.priority,i.status
      FROM inquiries i LEFT JOIN staff_users ass ON ass.id=i.assigned_staff_id LEFT JOIN staff_users cap ON cap.id=i.staff_id
      WHERE i.status IN ${openStatuses}
      UNION ALL
      SELECT 'task',t.id,t.related_client_id,COALESCE(c.client_name,t.title),c.cell_number,s.full_name,
        CASE WHEN t.due_at<NOW() THEN 'Overdue task' ELSE 'Task due today' END,t.due_at,t.priority,t.status
      FROM staff_tasks t JOIN staff_users s ON s.id=t.assigned_to LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.status IN ('unread','seen','in_progress') AND (t.due_at<NOW() OR DATE(t.due_at)=CURRENT_DATE())
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,due_at IS NULL,due_at LIMIT 30`);
    const [upgrades] = await db.query(`SELECT c.id,c.client_name,c.cell_number,c.account_number,c.handset,c.next_upgrade_date,
      DATEDIFF(c.next_upgrade_date,CURRENT_DATE()) days_until,COALESCE(s.full_name,'Unassigned') assigned_name
      FROM clients c LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2 WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number)) ORDER BY (a2.client_id=c.id) DESC LIMIT 1)
      LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE c.line_status<>'cancelled' AND c.next_upgrade_date BETWEEN DATE_SUB(CURRENT_DATE(),INTERVAL 30 DAY) AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)
      ORDER BY c.next_upgrade_date LIMIT 20`);
    const [birthdays] = await db.query(`SELECT MIN(id) id,MAX(client_name) client_name,MAX(cell_number) cell_number,MAX(email) email,MAX(birthday) birthday,COUNT(*) line_count
      FROM clients WHERE birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())
      GROUP BY COALESCE(NULLIF(id_number,''),CONCAT('client:',id)) ORDER BY client_name LIMIT 20`);
    res.render('command-centre',{title:'Command Centre',stats:stats||{},attention,upgrades,birthdays});
  } catch(e){ next(e); }
});

router.get(['/workspace','/staff-workspace','/my-command-centre'], requireAuth, async (req,res,next) => {
  try {
    const id=req.session.user.id;
    const [work]=await db.execute(`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.status,i.priority,i.follow_up_at,ic.category_name
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:id AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')
      ORDER BY i.follow_up_at IS NULL,i.follow_up_at,i.created_at DESC`,{id});
    const [tasks]=await db.execute(`SELECT * FROM staff_tasks WHERE assigned_to=:id AND status IN ('unread','seen','in_progress') ORDER BY due_at IS NULL,due_at`,{id});
    const [upgrades]=await db.execute(`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.account_number,c.next_upgrade_date FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:id AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) WHERE c.line_status<>'cancelled' AND c.next_upgrade_date<=DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY) ORDER BY c.next_upgrade_date LIMIT 50`,{id});
    const [birthdays]=await db.execute(`SELECT MIN(c.id) id,MAX(c.client_name) client_name,MAX(c.cell_number) cell_number,MAX(c.email) email,MAX(c.birthday) birthday,COUNT(*) line_count FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:id AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) WHERE c.birthday IS NOT NULL AND MONTH(c.birthday)=MONTH(CURRENT_DATE()) AND DAY(c.birthday)=DAY(CURRENT_DATE()) GROUP BY COALESCE(NULLIF(c.id_number,''),CONCAT('client:',c.id)) ORDER BY client_name`,{id});
    const [fixedAccounts]=await db.execute(`SELECT fa.id,fa.customer_name,fa.account_number,fa.contact_number,COUNT(fs.id) service_count FROM fixed_accounts fa LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id WHERE fa.assigned_staff_id=:id AND fa.account_status='active' GROUP BY fa.id ORDER BY fa.customer_name`,{id});
    const [[changes]]=await db.execute(`SELECT COUNT(*) total FROM data_change_requests WHERE requested_by=:id AND status IN ('pending_manager','pending_owner')`,{id});
    const stats={open:work.length,overdue:work.filter(x=>x.follow_up_at&&new Date(x.follow_up_at)<new Date()).length,tasks:tasks.length,taskOverdue:tasks.filter(x=>x.due_at&&new Date(x.due_at)<new Date()).length,upgrades:upgrades.length,birthdays:birthdays.length,fixed:fixedAccounts.length,pendingChanges:changes?.total||0};
    res.render('staff-workspace',{title:'Operational Workspace',work,tasks,upgrades,birthdays,fixedAccounts,stats});
  } catch(e){next(e);}
});

router.get('/api/workspace/summary', requireAuth, async (req,res,next) => {
  try {
    const id=req.session.user.id;
    const openStatuses="('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
    const [[summary]]=await db.execute(`SELECT
      (SELECT COUNT(*) FROM inquiries WHERE COALESCE(assigned_staff_id,staff_id)=:id AND status IN ${openStatuses}) open_inquiries,
      (SELECT COUNT(*) FROM inquiries WHERE COALESCE(assigned_staff_id,staff_id)=:id AND status IN ${openStatuses} AND follow_up_at<NOW()) overdue_inquiries,
      (SELECT COUNT(*) FROM staff_tasks WHERE assigned_to=:id AND status IN ('unread','seen','in_progress')) open_tasks,
      (SELECT COUNT(*) FROM staff_tasks WHERE assigned_to=:id AND status IN ('unread','seen','in_progress') AND due_at<NOW()) overdue_tasks,
      (SELECT COALESCE(MAX(id),0) FROM staff_tasks WHERE assigned_to=:id) latest_task_id`,{id});
    res.json({summary,server_time:new Date().toISOString()});
  } catch(e){next(e);}
});

router.get('/customers/:id/360', requireAuth, async (req,res,next) => {
  try {
    const id=Number(req.params.id); const [[client]]=await db.execute('SELECT * FROM clients WHERE id=:id',{id});
    if(!client) return res.status(404).render('error',{title:'Not found',message:'Client line could not be found.'});
    const [lines]=await db.execute(`SELECT * FROM clients WHERE id=:id OR (:account<>'' AND account_number=:account) ORDER BY line_status='active' DESC,next_upgrade_date,cell_number`,{id,account:client.account_number||''});
    const [history]=await db.execute(`SELECT i.*,ic.category_name,COALESCE(a.full_name,s.full_name,'Unassigned') responsible_name FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users a ON a.id=i.assigned_staff_id LEFT JOIN staff_users s ON s.id=i.staff_id WHERE i.client_id IN (${lines.map(()=>'?').join(',')}) OR i.cell_number IN (${lines.map(()=>'?').join(',')}) ORDER BY i.created_at DESC LIMIT 100`,[...lines.map(x=>x.id),...lines.map(x=>x.cell_number)]);
    const [tasks]=await db.execute(`SELECT t.*,s.full_name assigned_name FROM staff_tasks t JOIN staff_users s ON s.id=t.assigned_to WHERE t.related_client_id IN (${lines.map(()=>'?').join(',')}) ORDER BY t.created_at DESC LIMIT 50`,lines.map(x=>x.id));
    const [[assignment]]=await db.execute(`SELECT su.full_name,su.id FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id WHERE a.is_active=1 AND (a.client_id=:id OR (:account<>'' AND a.account_number=:account)) ORDER BY (a.client_id=:id) DESC LIMIT 1`,{id,account:client.account_number||''});
    const [assignmentStaff]=['owner','manager'].includes(req.session.user.role)?await db.query(`SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name`):[[]];
    const [[accountRecord]]=client.account_number?await db.execute(`SELECT a.*,s.full_name assigned_staff_name FROM customer_accounts a LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE a.account_number_normalised=UPPER(REPLACE(TRIM(:account),' ','')) LIMIT 1`,{account:client.account_number}):[[]];
    const [[pendingClaim]]=accountRecord?await db.execute(`SELECT r.id,r.requested_by,u.full_name requested_by_name,r.created_at FROM data_change_requests r JOIN staff_users u ON u.id=r.requested_by WHERE r.request_type='claim_account' AND r.record_id=:accountId AND r.status IN ('pending_manager','pending_owner') ORDER BY r.created_at LIMIT 1`,{accountId:accountRecord.id}):[[]];
    const [fixedAccounts]=await db.execute(`SELECT fa.*,COUNT(fs.id) fixed_service_count FROM fixed_accounts fa LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id WHERE (:account<>'' AND (fa.account_number=:account OR fa.linked_mobile_account_number=:account)) OR fa.linked_client_id=:id GROUP BY fa.id`,{id,account:client.account_number||''});
    res.render('customer-360',{title:client.client_name||'Customer Workspace',client,lines,history,tasks,assignment:assignment||null,assignmentStaff,accountRecord:accountRecord||null,pendingClaim:pendingClaim||null,fixedAccounts,assigned:req.query.assigned,claimRequested:req.query.claim_requested,changeRequested:req.query.change_requested});
  } catch(e){next(e);}
});

router.get('/upgrade-centre', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const window=String(req.query.window||'overdue'); const q=String(req.query.q||'').trim();
    const where=["c.line_status<>'cancelled'",'c.next_upgrade_date IS NOT NULL']; const params={q:`%${q}%`};
    if(window==='today') where.push('c.next_upgrade_date=CURRENT_DATE()');
    else if(window==='week') where.push('c.next_upgrade_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)');
    else if(window==='month') where.push('YEAR(c.next_upgrade_date)=YEAR(CURRENT_DATE()) AND MONTH(c.next_upgrade_date)=MONTH(CURRENT_DATE())');
    else if(window==='future') where.push('c.next_upgrade_date>CURRENT_DATE()');
    else where.push('c.next_upgrade_date<CURRENT_DATE()');
    if(q) where.push('(c.cell_number LIKE :q OR c.account_number LIKE :q OR c.client_name LIKE :q OR c.package_name LIKE :q)');
    const [rows]=await db.execute(`SELECT c.*,DATEDIFF(c.next_upgrade_date,CURRENT_DATE()) days_until,
      (SELECT COUNT(*) FROM clients x WHERE x.account_number=c.account_number AND c.account_number<>'') line_count,
      COALESCE(s.full_name,'Unassigned') assigned_name FROM clients c
      LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2 WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number)) ORDER BY (a2.client_id=c.id) DESC LIMIT 1)
      LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE ${where.join(' AND ')} ORDER BY c.next_upgrade_date,c.client_name LIMIT 2000`,params);
    res.render('upgrade-centre',{title:'Upgrade Centre',rows,filters:{window,q}});
  } catch(e){next(e);}
});

router.get('/upgrade-centre.csv', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const window=String(req.query.window||'overdue'),q=String(req.query.q||'').trim(); const where=["line_status<>'cancelled'",'next_upgrade_date IS NOT NULL']; const params={q:`%${q}%`};
    if(window==='today')where.push('next_upgrade_date=CURRENT_DATE()');else if(window==='week')where.push('next_upgrade_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)');else if(window==='month')where.push('YEAR(next_upgrade_date)=YEAR(CURRENT_DATE()) AND MONTH(next_upgrade_date)=MONTH(CURRENT_DATE())');else if(window==='future')where.push('next_upgrade_date>CURRENT_DATE()');else where.push('next_upgrade_date<CURRENT_DATE()');
    if(q)where.push('(cell_number LIKE :q OR account_number LIKE :q OR client_name LIKE :q OR package_name LIKE :q)');
    const [rows]=await db.execute(`SELECT client_name,account_number,cell_number,package_name,handset,previous_upgrade_date,contract_term_months,next_upgrade_date,last_upgrade_consultant,line_status FROM clients WHERE ${where.join(' AND ')} ORDER BY next_upgrade_date,client_name`,params);
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`; const lines=[['Client','Account','Cellphone','Package','Handset','Previous Upgrade','Term Months','Next Upgrade','Previous Consultant','Line Status'].map(esc).join(',')]; rows.forEach(x=>lines.push(Object.values(x).map(esc).join(',')));
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="talk2me-upgrades.csv"');res.send('\ufeff'+lines.join('\n'));
  }catch(e){next(e)}
});

router.get('/work-centre', requireAuth, requireOwnerRole, async (req,res,next) => {
  try {
    const view=String(req.query.view||'overdue'); const where=["i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')"];
    if(view==='today') where.push('DATE(i.follow_up_at)=CURRENT_DATE()'); else if(view==='unassigned') where.push('COALESCE(i.assigned_staff_id,i.staff_id) IS NULL'); else if(view==='all'){} else where.push('i.follow_up_at<NOW()');
    const [rows]=await db.query(`SELECT i.*,ic.category_name,COALESCE(a.full_name,s.full_name,'Unassigned') responsible_name FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users a ON a.id=i.assigned_staff_id LEFT JOIN staff_users s ON s.id=i.staff_id WHERE ${where.join(' AND ')} ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,i.follow_up_at LIMIT 1000`);
    res.render('work-centre',{title:'Work Centre',rows,view});
  } catch(e){next(e);}
});

// Version 3 approvals. Staff propose; managers approve normal changes; owners approve protected changes.
router.get('/customers/:id/propose-change', requireAuth, async(req,res,next)=>{
  try{const [[client]]=await db.execute('SELECT * FROM clients WHERE id=:id',{id:Number(req.params.id)});if(!client)return res.sendStatus(404);res.render('propose-change',{title:'Propose Customer Change',client,saved:req.query.saved});}catch(e){next(e)}
});

router.post('/customers/:id/propose-change', requireAuth, async(req,res,next)=>{
  try{
    const id=Number(req.params.id);const [[client]]=await db.execute('SELECT * FROM clients WHERE id=:id',{id});if(!client)return res.sendStatus(404);
    const allowed=['client_name','cell_number','email','city_town','package_name','handset','line_status','account_number','id_number','previous_upgrade_date','contract_term_months','main_contact_name','main_contact_number','account_authority_status'];
    const proposed={};for(const key of allowed){if(Object.prototype.hasOwnProperty.call(req.body,key)&&String(req.body[key]??'')!==String(client[key]??''))proposed[key]=req.body[key]}
    if(!Object.keys(proposed).length)return res.redirect(`${res.locals.basePath}/customers/${id}/propose-change?saved=none`);
    const sensitive=['account_number','id_number','previous_upgrade_date','contract_term_months','main_contact_name','main_contact_number','account_authority_status'];
    const ownerRequired=Object.keys(proposed).some(x=>sensitive.includes(x));
    const [result]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by)
      VALUES (:type,'clients',:id,:id,:account,:summary,:reason,:json,:role,:status,:userId)`,{type:ownerRequired?'update_client':'update_client',id,account:client.account_number||null,summary:`Update ${client.client_name||client.cell_number}`,reason:req.body.reason||null,json:JSON.stringify(proposed),role:ownerRequired?'owner':'manager',status:ownerRequired?'pending_owner':'pending_manager',userId:req.session.user.id});
    await audit(req,{actionType:'change_requested',entityType:'data_change_requests',entityId:result.insertId,description:`Customer change requested for ${client.client_name}`,after:proposed});
    res.redirect(`${res.locals.basePath}/customers/${id}/propose-change?saved=1`);
  }catch(e){next(e)}
});

router.get('/approvals',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{
  try{const where="r.status IN ('pending_owner','pending_manager')";const [rows]=await db.query(`SELECT r.*,c.client_name,c.cell_number,u.full_name requested_by_name FROM data_change_requests r LEFT JOIN clients c ON c.id=r.client_id JOIN staff_users u ON u.id=r.requested_by WHERE ${where} ORDER BY r.created_at`);res.render('approvals',{title:'Approvals',rows});}catch(e){next(e)}
});

router.post('/customers/:id/request-claim',requireAuth,async(req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.status(403).render('error',{title:'Claim not available',message:'Owners and managers assign clients directly.'});
    const clientId=Number(req.params.id);const [[client]]=await db.execute('SELECT id,client_name,account_number FROM clients WHERE id=:id',{id:clientId});
    if(!client?.account_number)return res.status(400).render('error',{title:'Account required',message:'An account number must be captured before this customer can be claimed.'});
    const [[account]]=await db.execute(`SELECT * FROM customer_accounts WHERE account_number_normalised=UPPER(REPLACE(TRIM(:account),' ',''))`,{account:client.account_number});
    if(!account)return res.status(400).render('error',{title:'Account not migrated',message:'Run the v3.2.0 database migration before requesting a claim.'});
    if(account.assigned_staff_id)return res.status(409).render('error',{title:'Already assigned',message:'This account is already assigned and cannot be claimed.'});
    const [[existing]]=await db.execute(`SELECT id FROM data_change_requests WHERE request_type='claim_account' AND record_id=:accountId AND status IN ('pending_manager','pending_owner') LIMIT 1`,{accountId:account.id});
    if(existing)return res.redirect(`${res.locals.basePath}/customers/${clientId}/360?claim_requested=existing`);
    const proposed={account_id:account.id,account_number:account.account_number,assigned_staff_id:req.session.user.id,assigned_staff_name:req.session.user.full_name};
    const [result]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by) VALUES ('claim_account','customer_accounts',:accountId,:clientId,:accountNumber,:summary,:reason,:json,'manager','pending_manager',:requestedBy)`,{accountId:account.id,clientId,accountNumber:account.account_number,summary:`Claim ${account.account_number} — ${client.client_name}`,reason:String(req.body.reason||'').trim()||'Staff requested responsibility for this account.',json:JSON.stringify(proposed),requestedBy:req.session.user.id});
    await audit(req,{actionType:'account_claim_requested',entityType:'customer_accounts',entityId:account.id,description:`${req.session.user.full_name} requested claim of ${account.account_number}`,after:proposed});
    res.redirect(`${res.locals.basePath}/customers/${clientId}/360?claim_requested=1`);
  }catch(e){next(e)}
});

router.get('/customers/:id/request-mobile-line',requireAuth,async(req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.redirect(`${res.locals.basePath}/backoffice/clients/new`);
    const [[client]]=await db.execute(`SELECT c.*,a.id account_id,a.account_number canonical_account_number FROM clients c JOIN customer_accounts a ON a.id=c.account_id WHERE c.id=:id`,{id:Number(req.params.id)});
    if(!client)return res.status(404).render('error',{title:'Account not found',message:'This customer is not linked to a unique account.'});
    res.render('mobile-line-request',{title:'Request Mobile Line',client,error:null});
  }catch(e){next(e)}
});

router.post('/customers/:id/request-mobile-line',requireAuth,async(req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.status(403).render('error',{title:'Access denied',message:'Use Add Mobile Line from the management account screen.'});
    const [[client]]=await db.execute(`SELECT c.client_name,c.email,a.id account_id,a.account_number FROM clients c JOIN customer_accounts a ON a.id=c.account_id WHERE c.id=:id`,{id:Number(req.params.id)});if(!client)return res.sendStatus(404);
    const cell=String(req.body.cell_number||'').trim();if(!cell)return res.status(400).render('error',{title:'Cellphone required',message:'Enter the mobile line number.'});
    const normalised=normaliseSaPhone(cell);const [[duplicate]]=await db.execute('SELECT id FROM clients WHERE cell_number_normalised=:phone AND account_id=:accountId LIMIT 1',{phone:normalised,accountId:client.account_id});if(duplicate)return res.status(409).render('error',{title:'Line already exists',message:'This cellphone number is already recorded on the account.'});
    const proposed={account_id:client.account_id,account_number:client.account_number,client_name:String(req.body.client_name||client.client_name).trim(),cell_number:cell,cell_number_normalised:normalised,email:String(req.body.email||client.email||'').trim().toLowerCase()||null,package_name:String(req.body.package_name||'').trim()||null,handset:String(req.body.handset||'').trim()||null,previous_upgrade_date:req.body.previous_upgrade_date||null,contract_term_months:Number(req.body.contract_term_months)===36?36:24};
    const [result]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by) VALUES ('add_line','customer_accounts',:accountId,:clientId,:accountNumber,:summary,'Staff requested a new mobile line',:json,'manager','pending_manager',:requestedBy)`,{accountId:client.account_id,clientId:Number(req.params.id),accountNumber:client.account_number,summary:`Add mobile line ${cell} to ${client.account_number}`,json:JSON.stringify(proposed),requestedBy:req.session.user.id});
    await audit(req,{actionType:'mobile_line_requested',entityType:'customer_accounts',entityId:client.account_id,description:`Mobile line ${cell} requested for ${client.account_number}`,after:proposed});
    res.redirect(`${res.locals.basePath}/customers/${req.params.id}/360?change_requested=mobile`);
  }catch(e){next(e)}
});

router.post('/approvals/:id/decision',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[request]]=await conn.execute('SELECT * FROM data_change_requests WHERE id=:id FOR UPDATE',{id:Number(req.params.id)});if(!request)throw new Error('Approval request not found');
    if(!['pending_manager','pending_owner'].includes(request.status))throw new Error('This request has already been reviewed');const decision=req.body.decision;
    if(decision==='reject'){await conn.execute("UPDATE data_change_requests SET status='rejected',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment WHERE id=:id",{user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'change_rejected',entityType:'data_change_requests',entityId:request.id,description:'Customer change rejected'});return res.redirect(`${res.locals.basePath}/approvals`)}
    const proposed=JSON.parse(request.proposed_data_json);
    if(request.request_type==='claim_account'){
      const [[account]]=await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE',{id:request.record_id});if(!account)throw new Error('Customer account not found');if(account.assigned_staff_id)throw new Error('This account has already been assigned');
      const [[client]]=await conn.execute('SELECT id FROM clients WHERE account_id=:accountId ORDER BY id LIMIT 1',{accountId:account.id});
      await conn.execute('UPDATE client_assignments SET is_active=0,updated_at=NOW() WHERE account_number=:accountNumber AND is_active=1',{accountNumber:account.account_number});
      if(client)await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active) VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)`,{clientId:client.id,accountNumber:account.account_number,staffId:request.requested_by,assignedBy:req.session.user.id});
      await conn.execute('UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,assignment_confirmed_at=NOW() WHERE id=:id',{id:account.id,staffId:request.requested_by,assignedBy:req.session.user.id});
      await conn.execute("UPDATE data_change_requests SET status='applied',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id",{user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'account_claim_approved',entityType:'customer_accounts',entityId:account.id,description:`Claim approved for account ${account.account_number}`,after:proposed});return res.redirect(`${res.locals.basePath}/approvals`);
    }
    if(request.request_type==='add_line'){
      const [[account]]=await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE',{id:proposed.account_id});if(!account)throw new Error('Customer account not found');
      const [[duplicate]]=await conn.execute('SELECT id FROM clients WHERE account_id=:accountId AND cell_number_normalised=:phone LIMIT 1',{accountId:account.id,phone:proposed.cell_number_normalised});if(duplicate)throw new Error('This mobile line already exists');
      const previous=proposed.previous_upgrade_date||null,term=Number(proposed.contract_term_months)===36?36:24;
      const [created]=await conn.execute(`INSERT INTO clients (account_id,account_number,client_name,cell_number,cell_number_normalised,email,package_name,handset,previous_upgrade_date,contract_term_months,next_upgrade_date,upgrade_date,customer_type,lifecycle_status,line_status,created_by_staff_id,is_active) VALUES (:accountId,:accountNumber,:clientName,:cell,:phone,:email,:packageName,:handset,:previous,:term,DATE_ADD(:previous,INTERVAL :term MONTH),DATE_ADD(:previous,INTERVAL :term MONTH),'unknown','client','active',:createdBy,1)`,{accountId:account.id,accountNumber:account.account_number,clientName:proposed.client_name,cell:proposed.cell_number,phone:proposed.cell_number_normalised,email:proposed.email||null,packageName:proposed.package_name||null,handset:proposed.handset||null,previous,term,createdBy:request.requested_by});
      if(account.assigned_staff_id)await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active) VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)`,{clientId:created.insertId,accountNumber:account.account_number,staffId:account.assigned_staff_id,assignedBy:req.session.user.id});
      await conn.execute("UPDATE data_change_requests SET status='applied',record_id=:recordId,reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id",{recordId:created.insertId,user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'mobile_line_approved',entityType:'clients',entityId:created.insertId,description:`Mobile line approved for ${account.account_number}`,after:proposed});return res.redirect(`${res.locals.basePath}/approvals`);
    }
    if(request.request_type==='update_fixed_service'){
      const [[before]]=await conn.execute('SELECT * FROM fixed_services WHERE id=:id FOR UPDATE',{id:request.record_id});if(!before)throw new Error('Fixed service not found');
      const allowed=['branch_name','order_number','solution_id','router_model','mac_address','sim_number','package_name','activation_date','service_status','cancellation_date','installation_address','technical_notes'];const keys=Object.keys(proposed).filter(k=>allowed.includes(k));if(!keys.length)throw new Error('No approved fixed-service fields');
      const set=keys.map(k=>`\`${k}\`=:${k}`).concat(["mac_address_normalised=UPPER(REPLACE(REPLACE(:mac_address,':',''),'-',''))","package_name_normalised=UPPER(TRIM(:package_name))","updated_at=NOW()"]).join(',');
      await conn.execute(`UPDATE fixed_services SET ${set} WHERE id=:id`,{...before,...proposed,id:request.record_id});
      await conn.execute("UPDATE data_change_requests SET status='applied',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id",{user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'fixed_service_change_approved',entityType:'fixed_services',entityId:request.record_id,description:'Approved fixed-service change applied',before,after:proposed});return res.redirect(`${res.locals.basePath}/approvals`);
    }
    if(request.request_type==='add_fixed_service'){
      const [[account]]=await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE',{id:proposed.account_id});if(!account)throw new Error('Customer account not found');
      let [[fixedAccount]]=await conn.execute('SELECT id FROM fixed_accounts WHERE account_id=:id OR account_number_normalised=:normalised LIMIT 1',{id:account.id,normalised:account.account_number_normalised});if(!fixedAccount){const [fa]=await conn.execute(`INSERT INTO fixed_accounts (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,assigned_staff_id,account_status,source_system) VALUES (:number,:normalised,:accountId,:name,:number,:staffId,'active','Talk2Me CRM')`,{number:account.account_number,normalised:account.account_number_normalised,accountId:account.id,name:account.display_name||account.account_number,staffId:account.assigned_staff_id||null});fixedAccount={id:fa.insertId};}
      const hash=crypto.createHash('sha256').update(`${account.id}|${proposed.solution_id||''}|${proposed.order_number||''}|${request.id}`).digest('hex');
      const [service]=await conn.execute(`INSERT INTO fixed_services (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,cancellation_date,installation_address,technical_notes,source_row_hash,source_system) VALUES (:fixedAccountId,:title,:branch,:orderNumber,:router,:mac,UPPER(REPLACE(REPLACE(:mac,':',''),'-','')),:solutionId,:sim,:packageName,UPPER(TRIM(:packageName)),:activationDate,:serviceStatus,:cancellationDate,:installationAddress,:technicalNotes,:hash,'Talk2Me CRM')`,{fixedAccountId:fixedAccount.id,title:account.display_name||account.account_number,branch:proposed.branch_name,orderNumber:proposed.order_number||null,router:proposed.router_model||null,mac:proposed.mac_address||null,solutionId:proposed.solution_id||null,sim:proposed.sim_number||null,packageName:proposed.package_name||null,activationDate:proposed.activation_date||null,serviceStatus:proposed.service_status||'active',cancellationDate:proposed.cancellation_date||null,installationAddress:proposed.installation_address||null,technicalNotes:proposed.technical_notes||null,hash});
      await conn.execute("UPDATE data_change_requests SET status='applied',record_id=:recordId,reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id",{recordId:service.insertId,user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'fixed_service_approved',entityType:'fixed_services',entityId:service.insertId,description:`Fixed service approved for ${account.account_number}`,after:proposed});return res.redirect(`${res.locals.basePath}/approvals`);
    }
    const allowed=['client_name','cell_number','email','city_town','package_name','handset','line_status','account_number','id_number','previous_upgrade_date','contract_term_months','main_contact_name','main_contact_number','account_authority_status'];const keys=Object.keys(proposed).filter(k=>allowed.includes(k));if(!keys.length)throw new Error('No approved fields');
    const set=keys.map(k=>`\`${k}\`=:${k}`).join(',');const params={...proposed,id:request.client_id};if(keys.includes('previous_upgrade_date')||keys.includes('contract_term_months'))set.concat('');
    await conn.execute(`UPDATE clients SET ${set},updated_at=NOW() WHERE id=:id`,params);
    if(keys.includes('previous_upgrade_date')||keys.includes('contract_term_months'))await conn.execute('UPDATE clients SET next_upgrade_date=DATE_ADD(previous_upgrade_date,INTERVAL contract_term_months MONTH),upgrade_date=DATE_ADD(previous_upgrade_date,INTERVAL contract_term_months MONTH) WHERE id=:id',{id:request.client_id});
    await conn.execute("UPDATE data_change_requests SET status='applied',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id",{user:req.session.user.id,comment:req.body.comment||null,id:request.id});await conn.commit();await audit(req,{actionType:'change_approved',entityType:'clients',entityId:request.client_id,description:'Approved customer change applied',after:proposed});res.redirect(`${res.locals.basePath}/approvals`);
  }catch(e){await conn.rollback();next(e)}finally{conn.release()}
});

router.get('/audit',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{try{const [rows]=await db.query(`SELECT a.*,s.full_name FROM audit_log a LEFT JOIN staff_users s ON s.id=a.staff_id ORDER BY a.created_at DESC LIMIT 2000`);res.render('audit-log',{title:'Audit History',rows});}catch(e){next(e)}});

function attendanceFilters(req){
  const staffId=Number(req.query.staff_id||0)||null;
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?String(req.query.from):new Date().toISOString().slice(0,10);
  const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?String(req.query.to):from;
  return {staffId,from,to};
}

async function loadAttendance(req){
  const filters=attendanceFilters(req);
  await db.execute(`UPDATE staff_login_sessions SET session_status='expired',logout_reason='timeout',logout_at=expires_at
    WHERE session_status='active' AND expires_at<=NOW()`);
  const params={staffId:filters.staffId,from:filters.from,to:filters.to};
  const where=[`l.login_at >= :from`,`l.login_at < DATE_ADD(:to,INTERVAL 1 DAY)`];
  if(filters.staffId)where.push('l.staff_id=:staffId');
  const [rows]=await db.execute(`SELECT l.*,s.full_name,s.email,s.role,
      TIMESTAMPDIFF(SECOND,l.login_at,COALESCE(l.logout_at,LEAST(l.last_activity_at,l.expires_at))) duration_seconds
    FROM staff_login_sessions l JOIN staff_users s ON s.id=l.staff_id
    WHERE ${where.join(' AND ')} ORDER BY l.login_at DESC LIMIT 5000`,params);
  const [summary]=await db.execute(`SELECT s.id,s.full_name,s.role,MIN(l.login_at) first_login,
      MAX(l.last_activity_at) last_activity,MAX(l.logout_at) last_logout,COUNT(*) login_count,
      SUM(TIMESTAMPDIFF(SECOND,l.login_at,COALESCE(l.logout_at,LEAST(l.last_activity_at,l.expires_at)))) total_seconds,
      SUM(l.session_status='active') active_sessions
    FROM staff_login_sessions l JOIN staff_users s ON s.id=l.staff_id
    WHERE ${where.join(' AND ')} GROUP BY s.id,s.full_name,s.role ORDER BY s.full_name`,params);
  const [staff]=await db.query(`SELECT id,full_name FROM staff_users ORDER BY full_name`);
  return {filters,rows,summary,staff};
}

router.get('/backoffice/attendance',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{
  try{res.render('attendance',{title:'Login & Attendance',...(await loadAttendance(req))});}catch(e){next(e)}
});

router.get('/backoffice/attendance.csv',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{
  try{
    const {rows}=await loadAttendance(req);const csvCell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const lines=[['Staff','Role','Login','Last activity','Logout','Status','Logout reason','Duration minutes','IP address','Browser / device'].map(csvCell).join(',')];
    for(const r of rows)lines.push([r.full_name,r.role,r.login_at,r.last_activity_at,r.logout_at,r.session_status,r.logout_reason,Math.round(Number(r.duration_seconds||0)/60),r.ip_address,r.user_agent].map(csvCell).join(','));
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="talk2me-login-attendance.csv"');res.send('\ufeff'+lines.join('\n'));
  }catch(e){next(e)}
});

router.get('/my-change-requests',requireAuth,async(req,res,next)=>{try{const [rows]=await db.execute(`SELECT r.*,c.client_name,c.cell_number,reviewer.full_name reviewed_by_name FROM data_change_requests r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by WHERE r.requested_by=:id ORDER BY r.created_at DESC LIMIT 500`,{id:req.session.user.id});res.render('my-change-requests',{title:'My Change Requests',rows});}catch(e){next(e)}});

router.get('/reports',requireAuth,requireRole('owner','manager'),async(req,res,next)=>{
  try{const type=String(req.query.type||'birthdays'),window=String(req.query.window||'today'),q=String(req.query.q||'').trim();let rows=[];
    if(type==='birthdays'){const where=['c.birthday IS NOT NULL'];const params={q:`%${q}%`};if(window==='today')where.push('MONTH(c.birthday)=MONTH(CURRENT_DATE()) AND DAY(c.birthday)=DAY(CURRENT_DATE())');else if(window==='week')where.push("DAYOFYEAR(c.birthday) BETWEEN DAYOFYEAR(CURRENT_DATE()) AND DAYOFYEAR(DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY))");else if(window==='month')where.push('MONTH(c.birthday)=MONTH(CURRENT_DATE())');else if(window==='missing')where[0]='c.birthday IS NULL';if(q)where.push('(c.client_name LIKE :q OR c.cell_number LIKE :q OR c.account_number LIKE :q OR c.email LIKE :q)');[rows]=await db.execute(`SELECT MIN(c.id) id,MAX(c.client_name) client_name,MAX(c.cell_number) cell_number,MAX(c.email) email,MAX(c.city_town) city_town,MAX(c.birthday) birthday,MAX(c.main_contact_name) main_contact_name,COUNT(*) line_count,COALESCE(MAX(s.full_name),'Unassigned') assigned_name FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE ${where.join(' AND ')} GROUP BY COALESCE(NULLIF(c.id_number,''),CONCAT('client:',c.id)) ORDER BY MONTH(MAX(c.birthday)),DAY(MAX(c.birthday)),client_name LIMIT 2000`,params)}
    res.render('reports',{title:'Reports',type,window,q,rows});
  }catch(e){next(e)}
});

module.exports = router;
