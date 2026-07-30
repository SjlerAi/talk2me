'use strict';

function normaliseSouthAfricanMobile(value) {
  let digits = String(value ?? '').trim().replace(/^\+/, '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) digits = `27${digits.slice(1)}`;
  return /^27[6-8]\d{8}$/.test(digits) ? digits : '';
}

module.exports = { normaliseSouthAfricanMobile };
