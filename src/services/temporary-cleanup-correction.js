'use strict';
const crypto = require('crypto');
const FIELDS = Object.freeze(['client_name','account_number','cell_number','email','previous_upgrade_date','next_upgrade_date','package_name','line_status']);
const STATUSES = new Set(['active','inactive','cancelled','suspended','unknown']);
function dateText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  return String(value).slice(0,10);
}
function snapshot(row) {
  const result = {};
  for (const field of FIELDS) result[field] = field.endsWith('_date') ? dateText(row[field]) : (row[field] == null ? '' : String(row[field]));
  result.upgrade_date = dateText(row.upgrade_date);
  result.account_id = row.account_id == null ? null : Number(row.account_id);
  result.cell_number_normalised = String(row.cell_number_normalised || '');
  result.is_active = Number(row.is_active || 0);
  return result;
}
function rowHash(row) { return crypto.createHash('sha256').update(JSON.stringify(snapshot(row))).digest('hex'); }
function csrfValid(req) {
  const given = String(req.body.csrf || '');
  const stored = String(req.session.tempCleanupToken || '');
  return /^[a-f0-9]{64}$/.test(given) && given.length===stored.length &&
    crypto.timingSafeEqual(Buffer.from(given),Buffer.from(stored));
}
function normalisePhone(value) {
  let digits=String(value||'').replace(/[^0-9]/g,'');
  if (/^0[0-9]{9}$/.test(digits)) digits='27'+digits.slice(1);
  return /^27[0-9]{9}$/.test(digits)?digits:null;
}
function cleanDate(value) {
  const v=String(value||'').trim();
  if (v==='') return null;
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))throw new Error('Use YYYY-MM-DD for upgrade dates.');
  const test=new Date(v+'T00:00:00Z');
  if(Number.isNaN(test.getTime()) || test.toISOString().slice(0,10)!==v)throw new Error('Invalid upgrade date.');
  return v;
}
function formValues(body) {
  const client_name=String(body.client_name||'').trim().slice(0,255);
  const account_number=String(body.account_number||'').trim().slice(0,80).toUpperCase();
  const inputPhone=String(body.cell_number||'').trim();
  const phone=normalisePhone(inputPhone);
  const email=String(body.email||'').trim().slice(0,180);
  const package_name=String(body.package_name||'').trim().slice(0,255);
  const line_status=String(body.line_status||'').trim().toLowerCase();
  if(!client_name || client_name.length>255)throw new Error('Customer name is required.');
  if(!account_number)throw new Error('Account number is required.');
  if(!phone)throw new Error('Cellphone number must be a valid South African mobile number.');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Email address is invalid.');
  if(!STATUSES.has(line_status))throw new Error('Invalid line status.');
  return {client_name,account_number,cell_number:'0'+phone.slice(2),cell_number_normalised:phone,email:email||null,
    previous_upgrade_date:cleanDate(body.previous_upgrade_date),next_upgrade_date:cleanDate(body.next_upgrade_date),
    package_name:package_name||null,line_status};
}
module.exports={FIELDS,snapshot,rowHash,csrfValid,normalisePhone,formValues};
