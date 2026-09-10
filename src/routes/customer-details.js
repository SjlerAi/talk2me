const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');

const router = express.Router();
const MANAGEMENT = new Set(['owner', 'manager', 'admin']);

function text(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function dateOrNull(value) {
  const clean = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

function decimalOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalisePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('27') && digits.length === 11) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `27${digits.slice(1)}`;
  return digits;
}

function birthdayFromSaId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const now = new Date();
  const year = yy > now.getUTCFullYear() % 100 ? 1900 + yy : 2000 + yy;
  const check = new Date(Date.UTC(year, mm - 1, dd));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== mm - 1 || check.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

async function getClient(id) {
  const [[client]] = await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1', { id });
  return client || null;
}

async function duplicateMatches(id, { cell_number, email, id_number, account_number }) {
  const phone = normalisePhone(cell_number);
  const mail = text(email).toLowerCase();
  const identity = text(id_number, 30);
  const account = text(account_number, 100);
  const [rows] = await db.execute(`SELECT id,client_name,cell_number,email,id_number,account_number,lifecycle_status
    FROM clients
    WHERE id<>:id AND (
      (:phone IS NOT NULL AND cell_number_normalised=:phone)
      OR (:mail<>'' AND LOWER(email)=:mail)
      OR (:identity<>'' AND id_number=:identity)
      OR (:account<>'' AND account_number=:account)
    )
    ORDER BY id DESC LIMIT 10`, { id, phone, mail, identity, account });
  return rows;
}

router.get('/customers/:id/details', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).render('error', { title:'Invalid customer', message:'The customer record could not be identified.' });
    const client = await getClient(id);
    if (!client) return res.status(404).render('error', { title:'Not found', message:'Customer could not be found.' });
    res.render('customer-details', {
      title:'Edit Customer Details',
      client,
      isManagement: MANAGEMENT.has(String(req.session.user.role || '').toLowerCase()),
      saved: String(req.query.saved || '') === '1',
      converted: String(req.query.converted || '') === '1',
      duplicates: [],
      error: null
    });
  } catch (error) { next(error); }
});

router.post('/customers/:id/details', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const client = await getClient(id);
    if (!client) return res.status(404).render('error', { title:'Not found', message:'Customer could not be found.' });
    const isManagement = MANAGEMENT.has(String(req.session.user.role || '').toLowerCase());
    const values = {
      client_name: text(req.body.client_name, 255),
      first_name: text(req.body.first_name, 120),
      surname: text(req.body.surname, 120),
      company_name: text(req.body.company_name, 255),
      cell_number: text(req.body.cell_number, 50),
      alt_number: text(req.body.alt_number, 50),
      email: text(req.body.email, 255).toLowerCase(),
      city_town: text(req.body.city_town, 150),
      id_number: text(req.body.id_number, 30),
      birthday: dateOrNull(req.body.birthday),
      customer_type: ['unknown','individual','business'].includes(req.body.customer_type) ? req.body.customer_type : 'unknown',
      package_name: text(req.body.package_name, 255),
      handset: text(req.body.handset, 255),
      monthly_invoice_amount: decimalOrNull(req.body.monthly_invoice_amount),
      previous_upgrade_date: dateOrNull(req.body.previous_upgrade_date),
      contract_term_months: Number(req.body.contract_term_months) === 36 ? 36 : 24,
      cancellation_date: dateOrNull(req.body.cancellation_date),
      notes: text(req.body.notes, 5000),
      account_number: isManagement ? text(req.body.account_number, 100) : text(client.account_number, 100),
      lifecycle_status: isManagement && ['prospect','client','inactive','lost'].includes(req.body.lifecycle_status) ? req.body.lifecycle_status : (client.lifecycle_status || 'prospect'),
      line_status: isManagement && ['unknown','active','inactive','cancelled','suspended'].includes(req.body.line_status) ? req.body.line_status : (client.line_status || 'unknown')
    };
    if (!values.client_name) values.client_name = client.client_name || `Customer ${id}`;
    if (!values.birthday && values.id_number) values.birthday = birthdayFromSaId(values.id_number);

    const duplicates = await duplicateMatches(id, values);
    if (duplicates.length && String(req.body.confirm_duplicate || '') !== '1') {
      return res.status(409).render('customer-details', {
        title:'Possible Duplicate Customer', client:{...client,...values}, isManagement, saved:false, converted:false,
        duplicates, error:'Talk2Me found another customer with matching contact, ID or account information. Check the records below before saving.'
      });
    }

    const phone = normalisePhone(values.cell_number);
    await db.execute(`UPDATE clients SET
      client_name=:client_name,first_name=:first_name,surname=:surname,company_name=:company_name,
      cell_number=:cell_number,cell_number_normalised=:phone,alt_number=:alt_number,email=:email,city_town=:city_town,
      id_number=:id_number,birthday=:birthday,customer_type=:customer_type,package_name=:package_name,handset=:handset,
      monthly_invoice_amount=:monthly_invoice_amount,previous_upgrade_date=:previous_upgrade_date,
      next_upgrade_date=CASE WHEN :previous_upgrade_date IS NULL THEN next_upgrade_date ELSE DATE_ADD(:previous_upgrade_date, INTERVAL :term MONTH) END,
      contract_term_months=:term,cancellation_date=:cancellation_date,notes=:notes,
      account_number=:account_number,lifecycle_status=:lifecycle_status,line_status=:line_status,updated_at=NOW()
      WHERE id=:id`, { ...values, phone, term: values.contract_term_months, id });

    try { await audit(req, 'customer_details_updated', 'clients', id, { lifecycle_status:values.lifecycle_status }); } catch (_) {}
    res.redirect(`${res.locals.basePath}/customers/${id}/360?details_saved=1`);
  } catch (error) { next(error); }
});

router.post('/customers/:id/convert-to-client', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const client = await getClient(id);
    if (!client) return res.status(404).render('error', { title:'Not found', message:'Customer could not be found.' });
    await db.execute(`UPDATE clients SET lifecycle_status='client',lead_status='converted',is_active=1,updated_at=NOW() WHERE id=:id`, { id });
    try { await audit(req, 'prospect_converted_to_client', 'clients', id, { previous_status:client.lifecycle_status || null }); } catch (_) {}
    res.redirect(`${res.locals.basePath}/customers/${id}/360?converted=1`);
  } catch (error) { next(error); }
});

module.exports = router;
