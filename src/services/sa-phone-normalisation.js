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

  // Be forgiving with imported numbers that users may type as 0 + 27xxxxxxxxx.
  // Canonical storage/search remains 27xxxxxxxxx. Bare 9-digit numbers remain invalid.
  if (/^027[6-8]\d{8}$/.test(digits)) digits = digits.slice(1);
  if (/^0[6-8]\d{8}$/.test(digits)) digits = `27${digits.slice(1)}`;

  return /^27[6-8]\d{8}$/.test(digits) ? digits : '';
}

function formatSouthAfricanMobile(value) {
  const normalised = normaliseSouthAfricanMobile(value);
  return normalised ? `0${normalised.slice(2)}` : String(value ?? '').trim();
}

module.exports = { normaliseSouthAfricanMobile, formatSouthAfricanMobile, MOBILE_PHONE_FIELDS };
