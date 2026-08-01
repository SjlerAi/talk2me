'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const requiredFiles = [
  'server.js','integrated-routes.js','document-routes.js','operational-routes.js',
  'core/permissions.js','core/transaction.js','core/audit.js','core/ownership.js',
  'core/work-items.js','core/restrictions.js','core/approvals.js',
  'core/representatives.js','core/services.js',
  'migrations/20260801_001_integrated_core.sql'
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required file: ${file}`);
}

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const mount of ['createIntegratedRouter','createDocumentRouter','createOperationalRouter']) {
  const count = (server.match(new RegExp(`app\\.use\\(${mount}\\(`, 'g')) || []).length;
  if (count !== 1) failures.push(`${mount} must be mounted exactly once; found ${count}`);
}

const javascriptFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (entry.name === 'node_modules') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && entry.name.endsWith('.js')) javascriptFiles.push(target);
  }
}
walk(root);

for (const file of javascriptFiles) {
  const content = fs.readFileSync(file, 'utf8');
  if (/\bCREATE\s+TABLE\b/i.test(content)) failures.push(`Runtime CREATE TABLE found in ${path.relative(root, file)}`);
  if (/res\.(?:json|send)\([^\n]*(?:error\.stack|error\.sqlMessage)/.test(content)) {
    failures.push(`Raw internal error exposure found in ${path.relative(root, file)}`);
  }
}

const migration = fs.readFileSync(path.join(root, 'migrations/20260801_001_integrated_core.sql'), 'utf8');
for (const table of [
  'os2_master_customers','os2_customer_accounts','os2_mobile_lines','os2_fixed_accounts',
  'os2_fixed_services','os2_customer_restrictions','os2_authorised_representatives',
  'os2_customer_documents','os2_work_items','os2_sticky_notes','os2_approval_requests','os2_audit_log'
]) {
  if (!migration.includes(table)) failures.push(`Migration does not define ${table}`);
}

if (failures.length) {
  console.error('Integrated architecture validation failed:');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Integrated architecture validation passed (${javascriptFiles.length} JavaScript files checked).`);
