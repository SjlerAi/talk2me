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

  // Be forgiving with imported numbers that