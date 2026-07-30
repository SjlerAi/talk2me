const crypto = require('crypto');

function clean(value, max = 2000) { return String(value ?? '').trim().slice(0, max); }
function label(value) { return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function phone(value) {
  let digits = clean(value, 50).replace(/\D/g, '');
  if (digits.startsWith('27') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9) digits = `0${digits}`;
  return /^0\d{9}$/.test(digits) ? digits : '';
}
function date(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = clean(value, 80);
  const exact = text.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
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
function detect(matrix, filename) {
  const text = `${label(filename)} ${matrix.slice(0, 12).flat().map(label).join(' ')}`;
  const fixed = text.includes('account number') && text.includes('router model') && text.includes('mac');
  const upgrade = text.includes('upgrades performed report') || text.includes('handset no');
  const activation = text.includes('activations per dealer') || text.includes('activation date');
  const sourceSystem = fixed ? 'FIXED_BASE' : (text.includes('siebel') || text.includes('channel') ? 'SIEBEL' : 'B12');
  if (fixed) return { importType: 'fixed_base', sourceSystem };
  if (upgrade) return { importType: 'upgrade', sourceSystem };
  if (activation) return { importType: 'activation', sourceSystem };
  throw new Error('The workbook is not a recognised B12, Siebel or Fixed Base report.');
}
function headerIndex(matrix, type) {
  const required = type === 'fixed_base' ? ['account number', 'router model'] : type === 'upgrade' ? ['handset no', 'order date'] : ['cell nr', 'activation date'];
  const index = matrix.findIndex(row => required.every(key => row.map(label).some(item => item.includes(key))));
  if (index < 0) throw new Error('The report header row could not be identified.');
  return index;
}
function fingerprint(row) {
  const source = row.importType === 'activation'
    ? [row.sourceSystem, row.phoneNormalised, row.transactionDate, row.dealSheetNumber]
    : row.importType === 'upgrade'
      ? [row.sourceSystem, row.phoneNormalised, row.transactionDate, row.dealSheetNumber, row.imei]
      : [row.macAddress || row.solutionId || row.orderNumber || row.simNumber || row.accountNumber];
  return crypto.createHash('sha256').update(source.join('|')).digest('hex');
}
function build(report, map, row, sourceRowNumber) {
  if (report.importType === 'activation') {
    const phoneOriginal = clean(at(row, column(map, ['Cell Nr', 'Cell Number'])), 80);
    const result = { ...report, sourceRowNumber, phoneOriginal, phoneNormalised: phone(phoneOriginal), customerName: clean(at(row, column(map, ['Customer'])), 255), transactionDate: date(at(row, column(map, ['Activation Date']))), packageName: clean(at(row, column(map, ['Package'])), 255), agentCode: clean(at(row, column(map, ['Created By', 'Agent'])), 120), imei: code(at(row, column(map, ['IMEI', 'IMEI Number'])), 80), dealSheetNumber: code(at(row, column(map, ['Deal Sheet', 'Deal sheet number'])), 120), description: clean(at(row, column(map, ['Deal Sheet Description', 'Deal description'])), 4000) };
    return result.phoneNormalised && result.customerName && result.transactionDate ? result : null;
  }
  if (report.importType === 'upgrade') {
    const phoneOriginal = clean(at(row, column(map, ['Handset No', 'Cell Nr'])), 80);
    const result = { ...report, sourceRowNumber, phoneOriginal, phoneNormalised: phone(phoneOriginal), customerName: '', transactionDate: date(at(row, column(map, ['Order Date']))), packageName: clean(at(row, column(map, ['Current Package'])), 255), agentCode: clean(at(row, column(map, ['Agent'])), 120), imei: code(at(row, column(map, ['IMEI Number', 'IMEI'])), 80), dealSheetNumber: code(at(row, column(map, ['Deal sheet number', 'Deal Sheet'])), 120), description: clean(at(row, column(map, ['Deal description', 'Upgrade Description', 'Upgrade Tariff Name'])), 4000) };
    return result.phoneNormalised && result.transactionDate ? result : null;
  }
  const result = { ...report, sourceRowNumber, accountNumber: code(at(row, column(map, ['Account number'])), 120), customerName: clean(at(row, column(map, ['Title'])), 255), transactionDate: date(at(row, column(map, ['Activation Date']))), packageName: clean(at(row, column(map, ['Package'])), 255), orderNumber: code(at(row, column(map, ['Order Number'])), 120), macAddress: code(at(row, column(map, ['MAC'])), 120).replace(/[^A-Z0-9]/g, ''), solutionId: code(at(row, column(map, ['Solutution ID', 'Solution ID'])), 120), simNumber: code(at(row, column(map, ['Sim Number', 'SIM Number'])), 120), description: clean(at(row, column(map, ['Branch', 'Router Model'])), 4000) };
  return result.accountNumber && (result.orderNumber || result.macAddress || result.solutionId) ? result : null;
}
function parse(buffer, filename) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The workbook contains no worksheet.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const report = detect(matrix, filename);
  const index = headerIndex(matrix, report.importType);
  const map = headers(matrix[index]);
  const rows = matrix.slice(index + 1).map((row, offset) => build(report, map, row, index + offset + 2)).filter(Boolean).map(row => ({ ...row, rowFingerprint: fingerprint(row) }));
  if (!rows.length) throw new Error('No valid data rows were found.');
  return { ...report, rows };
}
module.exports = { parse, phone };
