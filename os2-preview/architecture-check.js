'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const migrationRoot = path.join(root, 'migrations');
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

const runtimeFiles = new Set([
  'server.js',
  'email-worker.js',
  'email-worker-runner.js',
  'privacy-export-worker.js'
]);
for (const entry of fs.readdirSync(root, { withFileTypes:true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  if (entry.name.endsWith('-routes.js')) runtimeFiles.add(entry.name);
}
for (const directory of ['core']) {
  const absolute = path.join(root, directory);
  for (const entry of fs.readdirSync(absolute, { withFileTypes:true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) runtimeFiles.add(`${directory}/${entry.name}`);
  }
}

for (const relative of [...runtimeFiles].sort()) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (/\bCREATE\s+TABLE\b/i.test(content)) failures.push(`Runtime CREATE TABLE found in ${relative}`);
  if (/res\.(?:json|send)\([^\n]*(?:error\.stack|error\.sqlMessage)/.test(content)) {
    failures.push(`Raw internal error exposure found in ${relative}`);
  }
}

if (!fs.existsSync(migrationRoot) || !fs.statSync(migrationRoot).isDirectory()) {
  failures.push('Migration directory is missing');
}
const migrationFiles = fs.existsSync(migrationRoot)
  ? fs.readdirSync(migrationRoot).filter(name => /^\d{8}_\d{3}_[A-Za-z0-9_-]+\.sql$/.test(name)).sort()
  : [];
if (!migrationFiles.length) failures.push('No versioned migrations found');
const migrationSource = migrationFiles
  .map(name => fs.readFileSync(path.join(migrationRoot, name), 'utf8'))
  .join('\n');
for (const table of [
  'os2_master_customers','os2_customer_accounts','os2_mobile_lines','os2_fixed_accounts',
  'os2_fixed_services','os2_customer_restrictions','os2_authorised_representatives',
  'os2_customer_documents','os2_work_items','os2_sticky_notes','os2_approval_requests','os2_audit_log'
]) {
  const definition = new RegExp(`\\bCREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+\\\`${table}\\\`|\\bCREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\b`, 'i');
  if (!definition.test(migrationSource)) failures.push(`Versioned migrations do not define ${table}`);
}

if (failures.length) {
  console.error('Integrated architecture validation failed:');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok:true,
  check:'integrated-architecture',
  runtimeFilesChecked:runtimeFiles.size,
  migrationFilesChecked:migrationFiles.length,
  runtimeSchemaCreationProhibited:true,
  completeMigrationInventoryRequired:true,
  productionMutationEnabled:false,
  mergeExecutionEnabled:false
}, null, 2));
