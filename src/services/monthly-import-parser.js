const crypto = require('crypto');
const { normaliseSouthAfricanMobile } = require('./sa-phone-normalisation');

function clean(value, max = 2000) { return String(value ?? '').trim().slice(0, max); }
function label(value) { return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function phone(value) {
  return normaliseSouthAfricanMobile(clean(value, 50));
}
function date(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = clean(value, 80);
  const exact = text.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
  const excelSerial = Number(text);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(excelSerial));
    return epoch.toISOString().slice(0, 10);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function number(value) {
  const text = clean(value, 80).replace(/,/g, '');
  if (!text || text === '-' || text.toLowerCase() === 'n/a') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value) {
  const parsed = number(value);
  return parsed === null ? null : Math.trunc(parsed);
}
function code(value, max = 160) { return clean(value, max).replace(/\s+/g, ' ').toUpperCase(); }
function headers(row) {
  const map = new Map();
  row.forEach((value, index) => { const key = label(value); if (key) map.set(key, index); });
  return map;
}
function column(map, names) {
  for (const name of names) if (map.has(label(name))) return map.get(label(name));
  for (const [key, index] of map) if (names.some(name => key.includes(label(name)))) return index;
  return -1;
}
function at(row, index) { return index >= 0 ? row[index] : null; }
function field(map, row, names) { return at(row, column(map, names)); }
function isBlankRow(row) { return !row.some(value => clean(value, 200)); }
function rowText(row) { return row.map(value => label(value)).filter(Boolean).join(' | '); }
function sourceFields(headerRow, row) {
  const result = {};
  headerRow.forEach((heading, index) => {
    const key = clean(heading, 255) || `Column ${index + 1}`;
    const value = row[index];
    result[key] = value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value;
  });
  return result;
}
function isPresentationRow(row, report) {
  const text = rowText(row);
  if (!text) return true;
  if (text.includes('total sales for')) return true;
  if (text.includes('dealership total')) return true;
  if (text.includes('total number of upgrades performed for period')) return true;
  if (text.includes('total number of upgrades fulfilled for period')) return true;
  if (report.importType === 'activation' && text.includes('cell nr') && text.includes('activation date')) return true;
  if (report.importType === 'upgrade' && text.includes('handset no') && text.includes('order date')) return true;
  if (report.importType === 'fixed_base' && text.includes('account number') && text.includes('router model')) return true;
  if (report.importType === 'base_details' && text.includes('account code') && text.includes('msisdn')) return true;
  const populated = row.filter(value => clean(value, 200)).length;
  if (populated === 1 && !/\d{9,}/.test(text)) return true;
  return false;
}
function detect(matrix, filename) {
  const text = `${label(filename)} ${matrix.slice(0, 12).flat().map(label).join(' ')}`;
  const baseDetails = text.includes('account code') && text.includes('msisdn')
    && text.includes('eligible upgrade flag') && text.includes('subscription revenue excl vat');
  const fixed = text.includes('account number') && text.includes('router model') && text.includes('mac');
  const upgrade = text.includes('upgrades performed report') || text.includes('handset no');
  const activation = text.includes('activations per dealer') || text.includes('activation date');
  if (baseDetails) return { importType: 'base_details', sourceSystem: 'VODACOM_BASE' };
  const sourceSystem = fixed ? 'FIXED_BASE' : (text.includes('siebel') || text.includes('channel') ? 'SIEBEL' : 'B12');
  if (fixed) return { importType: 'fixed_base', sourceSystem };
  if (upgrade) return { importType: 'upgrade', sourceSystem };
  if (activation) return { importType: 'activation', sourceSystem };
  throw new Error('The workbook is not a recognised B12, Siebel, Fixed Base or Base Details report.');
}
function headerIndex(matrix, type) {
  const required = type === 'fixed_base'
    ? ['account number', 'router model']
    : type === 'upgrade'
      ? ['handset no', 'order date']
      : type === 'base_details'
        ? ['account code', 'msisdn', 'contract status', 'eligible upgrade flag']
        : ['cell nr', 'activation date'];
  const index = matrix.findIndex(row => required.every(key => row.map(label).some(item => item.includes(key))));
  if (index < 0) throw new Error('The report header row could not be identified.');
  return index;
}
function fingerprint(row) {
  const source = row.importType === 'activation'
    ? [row.sourceSystem, row.phoneNormalised || row.phoneOriginal, row.transactionDate, row.dealSheetNumber, row.sourceRowNumber]
    : row.importType === 'upgrade'
      ? [row.sourceSystem, row.phoneNormalised || row.phoneOriginal, row.transactionDate, row.dealSheetNumber, row.imei, row.sourceRowNumber]
      : row.importType === 'base_details'
        ? [row.sourceSystem, row.phoneNormalised || row.phoneOriginal, row.accountNumber, JSON.stringify(row.sourceFields || {})]
        : [row.macAddress || row.solutionId || row.orderNumber || row.simNumber || row.accountNumber, row.sourceRowNumber];
  return crypto.createHash('sha256').update(source.join('|')).digest('hex');
}
function validate(result, required) {
  const missing = required.filter(([key]) => !result[key]).map(([, message]) => message);
  return { ...result, warningText: missing.length ? missing.join(' ') : null, isException: missing.length > 0 };
}
function buildBaseDetails(report, map, row, sourceRowNumber, headerRow) {
  const phoneOriginal = clean(field(map, row, ['MSISDN']), 80);
  const accountNumber = code(field(map, row, ['Account Code']), 120);
  const tariffName = clean(field(map, row, ['Tariff Name']), 255);
  const pricePlan = clean(field(map, row, ['Price Plan']), 255);
  const baseDetails = {
    businessUnit: clean(field(map, row, ['Business Unit']), 160),
    accountCode: accountNumber,
    accountName: clean(field(map, row, ['Account Name']), 255),
    idNumber: clean(field(map, row, ['ID Number']), 80),
    firstName: clean(field(map, row, ['FirstName', 'First Name']), 120),
    surname: clean(field(map, row, ['Surname']), 120),
    msisdn: phoneOriginal,
    emailAddress: clean(field(map, row, ['Email Address']), 255),
    masterAccountHolder: clean(field(map, row, ['Master Account Holder']), 40),
    subscriptionRevenueExclVat: number(field(map, row, ['Subscription Revenue Excl VAT'])),
    customerRevenueM3: number(field(map, row, ['Customer Revenue M3'])),
    customerRevenueM2: number(field(map, row, ['Customer Revenue M2'])),
    customerRevenueM1: number(field(map, row, ['Customer Revenue M1'])),
    inBundleRevenue: number(field(map, row, ['In Bundle Revenue'])),
    outBundleRevenue: number(field(map, row, ['Out Bundle Revenue'])),
    dataContentRevenue: number(field(map, row, ['Data Content Revenue'])),
    aveSubscriptionRevenue: number(field(map, row, ['Ave Subscription Revenue'])),
    netSubscriptionRevenue: number(field(map, row, ['Net Subscription Revenue'])),
    connectionDate: date(field(map, row, ['Connection Date'])),
    lastActiveDate: date(field(map, row, ['Last Active Date'])),
    active30Day: clean(field(map, row, ['30 Day Active']), 20),
    lastUpgradeDate: date(field(map, row, ['Last Upgrade Date'])),
    deviceManufacturer: clean(field(map, row, ['Device Manufacturer']), 180),
    deviceName: clean(field(map, row, ['Device Name']), 255),
    pricePlanCategory: clean(field(map, row, ['Price Plan Category']), 180),
    pricePlan,
    tariffName,
    cbuSegment: clean(field(map, row, ['CBU Segemnt', 'CBU Segment']), 180),
    j4uAttached: clean(field(map, row, ['J4U Attached']), 40),
    accountInArrears: clean(field(map, row, ['Account In Arrears']), 40),
    contractStatus: clean(field(map, row, ['Contract Status']), 120),
    contractPeriod: clean(field(map, row, ['Contract Period']), 120),
    voiceOobUsage: clean(field(map, row, ['Voice OOB Usage']), 40),
    dataOobUsage: clean(field(map, row, ['Data OOB Usage']), 40),
    networkTenureMonths: integer(field(map, row, ['Network Tenure Months'])),
    contractTenureMonths: integer(field(map, row, ['Contract Tenure Months'])),
    baseDealerName: clean(field(map, row, ['Base Dealer Name']), 255),
    simSizeDescription: clean(field(map, row, ['SIM Size Description']), 180),
    optOutIndicator: clean(field(map, row, ['OPT Out Indicator']), 40),
    churnRiskInd: clean(field(map, row, ['Churn Risk Ind']), 40),
    deviceInsurance: clean(field(map, row, ['Device Insurance']), 80),
    simInsurance: clean(field(map, row, ['SIM Insurance']), 80),
    iccId: code(field(map, row, ['Icc_Id', 'ICC ID', 'ICCID']), 120),
    imsi: code(field(map, row, ['Imsi', 'IMSI']), 120),
    recommendation1: clean(field(map, row, ['recommendation_1']), 4000),
    recommendation2: clean(field(map, row, ['recommendation_2']), 4000),
    recommendation3: clean(field(map, row, ['recommendation_3']), 4000),
    recommendation4: clean(field(map, row, ['recommendation_4']), 4000),
    portfolioScore: clean(field(map, row, ['Portfolio Score']), 120),
    linesUpgradable: integer(field(map, row, ['# Lines Upgradable', 'Lines Upgradable'])),
    eligibleUpgradeDate: date(field(map, row, ['Eligible Upgrade Dt', 'Eligible Upgrade Date'])),
    eligibleUpgradeFlag: clean(field(map, row, ['Eligible Upgrade Flag']), 40),
    upgradeInProgress: clean(field(map, row, ['Upgrade in Progress']), 40),
    dataUsageM1Mb: number(field(map, row, ['Data Usage M1 (MB)', 'Data Usage M1 MB'])),
    dataUsageM2Mb: number(field(map, row, ['Data Usage M2 (MB)', 'Data Usage M2 MB'])),
    dataUsageM3Mb: number(field(map, row, ['Data Usage M3 (MB)', 'Data Usage M3 MB']))
  };
  return validate({
    ...report,
    sourceRowNumber,
    phoneOriginal,
    phoneNormalised: phone(phoneOriginal),
    accountNumber,
    customerName: baseDetails.accountName,
    transactionDate: null,
    packageName: tariffName || pricePlan,
    simNumber: baseDetails.iccId,
    description: baseDetails.contractStatus,
    sourceFields: sourceFields(headerRow, row),
    baseDetails
  }, [['phoneNormalised', 'Invalid or missing MSISDN.'], ['accountNumber', 'Account Code is missing.']]);
}
function build(report, map, row, sourceRowNumber, headerRow) {
  if (report.importType === 'base_details') {
    return buildBaseDetails(report, map, row, sourceRowNumber, headerRow);
  }
  if (report.importType === 'activation') {
    const phoneOriginal = clean(at(row, column(map, ['Cell Nr', 'Cell Number'])), 80);
    return validate({ ...report, sourceRowNumber, phoneOriginal, phoneNormalised: phone(phoneOriginal), customerName: clean(at(row, column(map, ['Customer'])), 255), transactionDate: date(at(row, column(map, ['Activation Date']))), packageName: clean(at(row, column(map, ['Package'])), 255), agentCode: clean(at(row, column(map, ['Created By', 'Agent'])), 120), imei: code(at(row, column(map, ['IMEI', 'IMEI Number'])), 80), dealSheetNumber: code(at(row, column(map, ['Deal Sheet', 'Deal sheet number'])), 120), description: clean(at(row, column(map, ['Deal Sheet Description', 'Deal description'])), 4000) }, [['phoneNormalised', 'Invalid or missing cellphone number.'], ['customerName', 'Customer name is missing.'], ['transactionDate', 'Activation date is missing or invalid.']]);
  }
  if (report.importType === 'upgrade') {
    const phoneOriginal = clean(at(row, column(map, ['Handset No', 'Cell Nr'])), 80);
    return validate({ ...report, sourceRowNumber, phoneOriginal, phoneNormalised: phone(phoneOriginal), customerName: '', transactionDate: date(at(row, column(map, ['Order Date']))), packageName: clean(at(row, column(map, ['Current Package'])), 255), agentCode: clean(at(row, column(map, ['Agent'])), 120), imei: code(at(row, column(map, ['IMEI Number', 'IMEI'])), 80), dealSheetNumber: code(at(row, column(map, ['Deal sheet number', 'Deal Sheet'])), 120), description: clean(at(row, column(map, ['Deal description', 'Upgrade Description', 'Upgrade Tariff Name'])), 4000) }, [['phoneNormalised', 'Invalid or missing cellphone number.'], ['transactionDate', 'Order date is missing or invalid.']]);
  }
  const branchName = clean(at(row, column(map, ['Branch'])), 255);
  const routerModel = clean(at(row, column(map, ['Router Model'])), 255);
  return validate({
    ...report, sourceRowNumber,
    accountNumber: code(at(row, column(map, ['Account number'])), 120),
    customerName: clean(at(row, column(map, ['Title'])), 255),
    transactionDate: date(at(row, column(map, ['Activation Date']))),
    packageName: clean(at(row, column(map, ['Package'])), 255),
    orderNumber: code(at(row, column(map, ['Order Number'])), 120),
    macAddress: code(at(row, column(map, ['MAC'])), 120).replace(/[^A-Z0-9]/g, ''),
    solutionId: code(at(row, column(map, ['Solutution ID', 'Solution ID'])), 120),
    simNumber: code(at(row, column(map, ['Sim Number', 'SIM Number'])), 120),
    branchName, routerModel, description: branchName || routerModel
  }, [['accountNumber', 'Account number is missing.'], ['orderNumber', 'Order number is missing.']]);
}
function parse(buffer, filename) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The workbook contains no worksheet.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const report = detect(matrix, filename);
  const index = headerIndex(matrix, report.importType);
  const headerRow = matrix[index];
  const map = headers(headerRow);
  const rows = matrix.slice(index + 1)
    .map((row, offset) => ({ row, sourceRowNumber: index + offset + 2 }))
    .filter(item => !isBlankRow(item.row) && !isPresentationRow(item.row, report))
    .map(item => build(report, map, item.row, item.sourceRowNumber, headerRow))
    .map(row => ({ ...row, rowFingerprint: fingerprint(row) }));
  if (!rows.length) throw new Error('No data rows were found.');
  return { ...report, rows };
}
module.exports = { parse, phone, date, detect, fingerprint };
