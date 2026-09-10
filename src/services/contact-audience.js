const db = require('../config/db');

const CATEGORY_LABELS = {
  all: 'All customers',
  mobile: 'Mobile / contracts',
  prepaid: 'Prepaid',
  fixed: 'Fixed / fibre',
  fibre: 'Fibre only',
  upgrades: 'Upgrades'
};

function ymd(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function shiftDate(base, amount, unit) {
  const d = new Date(`${base}T12:00:00Z`);
  if (unit === 'day') d.setUTCDate(d.getUTCDate() - amount);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() - amount);
  if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() - amount);
  return d.toISOString().slice(0, 10);
}

function resolveRange({ preset = '6m', from = '', to = '' } = {}) {
  const today = ymd(new Date());
  const clean = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
  if (preset === 'all') return { preset, from: null, to: null, label: 'All time' };
  if (preset === 'custom') {
    const cleanFrom = clean(from);
    const cleanTo = clean(to);
    if (!cleanFrom || !cleanTo || cleanFrom > cleanTo) throw new Error('Choose a valid From and To date.');
    return { preset, from: cleanFrom, to: cleanTo, label: `${cleanFrom} to ${cleanTo}` };
  }
  const presets = {
    today: [0, 'day', 'Today'],
    '7d': [6, 'day', 'Last 7 days'],
    '30d': [29, 'day', 'Last 30 days'],
    '3m': [3, 'month', 'Last 3 months'],
    '6m': [6, 'month', 'Last 6 months'],
    '12m': [1, 'year', 'Last 12 months']
  };
  const config = presets[preset] || presets['6m'];
  return { preset: presets[preset] ? preset : '6m', from: shiftDate(today, config[0], config[1]), to: today, label: config[2] };
}

function normaliseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalisePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  if (/^27\d{9}$/.test(digits)) return digits;
  return null;
}

function dateClause(field, range, params, prefix) {
  if (!range.from || !range.to) return '';
  params[`${prefix}From`] = range.from;
  params[`${prefix}To`] = range.to;
  return ` AND DATE(${field}) BETWEEN :${prefix}From AND :${prefix}To`;
}

async function mobileRows(category, range) {
  const params = {};
  let where = ' WHERE COALESCE(c.is_active,1)=1';
  let dateField = 'c.created_at';
  if (category === 'prepaid') where += " AND LOWER(COALESCE(c.package_name,'')) LIKE '%prepaid%'";
  if (category === 'mobile') where += " AND LOWER(COALESCE(c.package_name,'')) NOT LIKE '%prepaid%'";
  if (category === 'upgrades') {
    where += ' AND c.upgrade_date IS NOT NULL';
    dateField = 'c.upgrade_date';
  }
  where += dateClause(dateField, range, params, 'mobile');
  const [rows] = await db.execute(`SELECT c.id source_id,c.client_name contact_name,c.email,c.cell_number mobile_number,
      c.account_number,c.package_name,c.upgrade_date,DATE(${dateField}) contact_date,
      'mobile' source_type,
      CASE WHEN LOWER(COALESCE(c.package_name,'')) LIKE '%prepaid%' THEN 'Prepaid'
           WHEN :category='upgrades' THEN 'Upgrade'
           ELSE 'Mobile / contract' END category_label
    FROM clients c
    ${where}
    ORDER BY contact_name, mobile_number`, { ...params, category });
  return rows;
}

async function fixedRows(category, range) {
  const params = {};
  let where = " WHERE COALESCE(fa.account_status,'active') <> 'cancelled'";
  if (category === 'fibre') where += " AND (LOWER(COALESCE(fs.package_name,'')) LIKE '%fibre%' OR LOWER(COALESCE(fs.package_name,'')) LIKE '%fiber%' OR LOWER(COALESCE(fs.service_title,'')) LIKE '%fibre%' OR LOWER(COALESCE(fs.service_title,'')) LIKE '%fiber%')";
  where += dateClause('fs.activation_date', range, params, 'fixed');
  const [rows] = await db.execute(`SELECT fa.id source_id,fa.customer_name contact_name,fa.email,fa.contact_number mobile_number,
      fa.account_number,fs.package_name,NULL upgrade_date,DATE(fs.activation_date) contact_date,
      'fixed' source_type,
      CASE WHEN LOWER(COALESCE(fs.package_name,'')) LIKE '%fibre%' OR LOWER(COALESCE(fs.package_name,'')) LIKE '%fiber%' THEN 'Fibre' ELSE 'Fixed' END category_label
    FROM fixed_accounts fa
    LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
    ${where}
    ORDER BY contact_name, mobile_number`, params);
  return rows;
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const email = normaliseEmail(row.email);
    const mobile = normalisePhone(row.mobile_number);
    const key = email ? `e:${email}` : mobile ? `m:${mobile}` : `r:${row.source_type}:${row.source_id}`;
    if (!map.has(key)) map.set(key, { ...row, email, mobile_number: mobile });
    else {
      const existing = map.get(key);
      if (!existing.email && email) existing.email = email;
      if (!existing.mobile_number && mobile) existing.mobile_number = mobile;
    }
  }
  return [...map.values()];
}

async function loadAudience({ category = 'all', preset = '6m', from = '', to = '' } = {}) {
  if (!CATEGORY_LABELS[category]) category = 'all';
  const range = resolveRange({ preset, from, to });
  const rows = [];
  if (['all', 'mobile', 'prepaid', 'upgrades'].includes(category)) rows.push(...await mobileRows(category, range));
  if (['all', 'fixed', 'fibre'].includes(category)) rows.push(...await fixedRows(category, range));
  const contacts = dedupeRows(rows);
  const emails = [...new Set(contacts.map(x => x.email).filter(Boolean))];
  const mobiles = [...new Set(contacts.map(x => x.mobile_number).filter(Boolean))];
  const dateBasis = category === 'upgrades' ? 'Upgrade date' : ['fixed', 'fibre'].includes(category) ? 'Activation date' : category === 'all' ? 'Customer added / fixed activation date' : 'Customer added date';
  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    range,
    dateBasis,
    contacts,
    emails,
    mobiles,
    counts: { contacts: contacts.length, emails: emails.length, mobiles: mobiles.length }
  };
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function audienceCsv(audience) {
  const header = ['Name','Email','Mobile','Account Number','Category','Package','Relevant Date','Source'];
  const lines = audience.contacts.map(row => [row.contact_name,row.email,row.mobile_number,row.account_number,row.category_label,row.package_name,row.contact_date,row.source_type].map(csvEscape).join(','));
  return [header.join(','), ...lines].join('\r\n');
}

module.exports = { CATEGORY_LABELS, resolveRange, normaliseEmail, normalisePhone, loadAudience, audienceCsv };
