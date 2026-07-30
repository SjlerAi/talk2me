'use strict';

const MOBILE_PHONE_FIELDS = Object.freeze([
  'cell_number_normalised',
  'cell_number',
  'main_contact_number_normalised',
  'main_contact_number',
  'alt_number'
]);

function normaliseSouthAfricanMobile(value) {
  let digits = String(value ?? '').trim().replace(/^\+/, '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) digits = `27${digits.slice(1)}`;
  return /^27[6-8]\d{8}$/.test(digits) ? digits : '';
}

module.exports = { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS };
