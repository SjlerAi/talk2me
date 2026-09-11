'use strict';

const assert = require('assert');
const XLSX = require('xlsx');
const { parse, date } = require('../src/services/monthly-import-parser');

const headers = [
  'Business Unit','Account Code','Account Name','ID Number','FirstName','Surname','MSISDN','Email Address',
  'Master Account Holder','Subscription Revenue Excl VAT','Customer Revenue M3','Customer Revenue M2','Customer Revenue M1',
  'In Bundle Revenue','Out Bundle Revenue','Data Content Revenue','Ave Subscription Revenue','Net Subscription Revenue',
  'Connection Date','Last Active Date','30 Day Active','Last Upgrade Date','Device Manufacturer','Device Name',
  'Price Plan Category','Price Plan','Tariff Name','CBU Segemnt','J4U Attached','Account In Arrears','Contract Status',
  'Contract Period','Voice OOB Usage','Data OOB Usage','Network Tenure Months','Contract Tenure Months','Base Dealer Name',
  'SIM Size Description','OPT Out Indicator','Churn Risk Ind','Device Insurance','SIM Insurance','Icc_Id','Imsi',
  'recommendation_1','recommendation_2','recommendation_3','recommendation_4','Portfolio Score','# Lines Upgradable',
  'Eligible Upgrade Dt','Eligible Upgrade Flag','Upgrade in Progress','Data Usage M1 (MB)','Data Usage M2 (MB)','Data Usage M3 (MB)'
];
const values = [
  'Enterprise Business Unit','B0174076','EXAMPLE BUSINESS','8001015009087','JAN','TEST','27821234567','test@example.co.za',
  'Y','499.99','510','505','500','450','50','0','499','499','2024-01-15','2026-09-09','Y','2025-08-01',
  'Apple','iPhone 16','Voice','RED','RED Business','Business','N','N','In Contract','36 Month Contract','N','N',
  '31','13','CHATZ CONNECT - WESTDENE','64K TRIO SIM','N','N','Y','N','89304600000000000000','655010000000000',
  'Rec 1','Rec 2','Rec 3','Rec 4','P0700','2','2028-08-01','N','N','123.45','234.56','345.67'
];
assert.strictEqual(headers.length, 56);
assert.strictEqual(values.length, 56);

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet([headers, values]);
XLSX.utils.book_append_sheet(workbook, worksheet, 'MyWorkSheet-1');
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const parsed = parse(buffer, 'Base Details _ Excluding OPT Out Customers.xlsx');

assert.strictEqual(parsed.importType, 'base_details');
assert.strictEqual(parsed.sourceSystem, 'VODACOM_BASE');
assert.strictEqual(parsed.rows.length, 1);
const row = parsed.rows[0];
assert.strictEqual(row.phoneNormalised, '27821234567');
assert.strictEqual(row.accountNumber, 'B0174076');
assert.strictEqual(row.customerName, 'EXAMPLE BUSINESS');
assert.strictEqual(row.baseDetails.iccId, '89304600000000000000');
assert.strictEqual(row.baseDetails.imsi, '655010000000000');
assert.strictEqual(row.baseDetails.subscriptionRevenueExclVat, 499.99);
assert.strictEqual(row.baseDetails.linesUpgradable, 2);
assert.strictEqual(row.baseDetails.eligibleUpgradeDate, '2028-08-01');
assert.strictEqual(row.baseDetails.optOutIndicator, 'N');
assert.strictEqual(Object.keys(row.sourceFields).length, 56);
assert.strictEqual(row.sourceFields['CBU Segemnt'], 'Business');
assert.ok(/^[a-f0-9]{64}$/.test(row.rowFingerprint));
assert.strictEqual(row.isException, false);
assert.strictEqual(date('44664'), '2022-04-13');

console.log('Base Details foundation validation passed.');
