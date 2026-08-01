'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'preview-uat-runner.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema-verification.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

expect(runner.includes("expectedHost = 'talk2me.kloka.co.za'"), 'UAT runner must pin the preview hostname');
expect(runner.includes('REFUSING_NON_PREVIEW_URL'), 'UAT runner must refuse non-preview URLs');
expect(runner.includes("UAT_ALLOW_MUTATIONS === 'true'"), 'Mutation tests must require explicit opt-in');
expect(runner.includes('/api/auth/login'), 'UAT must verify login');
expect(runner.includes('/api/dashboard'), 'UAT must verify dashboard');
expect(runner.includes('/api/os2/customers/search'), 'UAT must verify Master Customer search');
expect(runner.includes('/api/os2/work-items'), 'UAT must verify work items');
expect(runner.includes('/api/os2/notifications'), 'UAT must verify notifications');
expect(runner.includes('/api/auth/logout'), 'UAT must verify logout');
expect(schema.includes("dbName !== 'kloka_talk2me'"), 'Schema verification must pin the preview database');
expect(schema.includes('information_schema.TABLES'), 'Schema verification must inspect required tables');
expect(schema.includes('information_schema.COLUMNS'), 'Schema verification must inspect required columns');
expect(schema.includes('duplicate active mobile numbers'), 'Schema verification must detect duplicate active mobiles');
expect(pkg.scripts['verify:schema'] === 'node schema-verification.js', 'Package must expose verify:schema');
expect(pkg.scripts['uat:preview'] === 'node preview-uat-runner.js', 'Package must expose uat:preview');

if (failures.length) {
  console.error('UAT GATE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log('UAT gate check passed');
