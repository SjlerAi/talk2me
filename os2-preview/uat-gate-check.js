'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'preview-uat-runner.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema-verification.js'), 'utf8');
const previewData = fs.readFileSync(path.join(root, 'preview-data-verification.js'), 'utf8');
const readiness = fs.readFileSync(path.join(root, 'customer-merge-execution-readiness-routes.js'), 'utf8');
const restoreEvidence = fs.readFileSync(path.join(root, 'merge-restore-evidence-verification.js'), 'utf8');
const restorePinCheck = fs.readFileSync(path.join(root, 'merge-restore-pin-check.js'), 'utf8');
const migration025 = fs.readFileSync(path.join(root, 'migrations/20260801_025_merge_authorisation_restore_pin.sql'), 'utf8');
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
expect(schema.includes('migrations.length < 25'), 'Schema verification must require migration 025');
expect(schema.includes('restore_test_id IS NULL'), 'Schema verification must reject unpinned merge authorisations');
expect(previewData.includes("expectedDatabase = 'kloka_talk2me'"), 'Preview data verification must pin the preview database');
expect(previewData.indexOf('schema-verification.js') < previewData.indexOf('merge-restore-evidence-verification.js'), 'Preview data verification must run schema before restore evidence');
expect(previewData.includes("stdio: 'inherit'"), 'Preview data verification must preserve verifier output');
expect(previewData.includes('result.error'), 'Preview data verification must fail on spawn errors');
expect(previewData.includes('result.signal || result.status !== 0'), 'Preview data verification must fail on signals or non-zero exits');
expect(previewData.includes('mergeExecutionEnabled: false'), 'Preview data verification must keep merge execution disabled');
expect(migration025.includes('ADD COLUMN restore_test_id BIGINT NULL'), 'Migration 025 must add the pinned restore reference');
expect(restoreEvidence.includes("database !== 'kloka_talk2me'"), 'Restore evidence verification must refuse non-preview databases');
expect(restoreEvidence.includes('rt.id = a.restore_test_id'), 'Restore evidence verification must join the exact pinned restore test');
expect(restoreEvidence.includes('rt.backup_run_id <> a.backup_run_id'), 'Restore evidence verification must validate restore-to-backup ownership');
expect(restoreEvidence.includes('rt.completed_at > a.authorised_at'), 'Restore evidence verification must enforce evidence chronology');
expect(restorePinCheck.includes('routePinned'), 'Restore-pin regression guard must require runtime pinning');
expect(readiness.includes('executionAvailable:false'), 'Merge execution must remain disabled during UAT');
expect(pkg.scripts['verify:schema'] === 'node schema-verification.js', 'Package must expose verify:schema');
expect(pkg.scripts['verify:merge-restore-evidence'] === 'node merge-restore-evidence-verification.js', 'Package must expose restore evidence verification');
expect(pkg.scripts['verify:preview-data'] === 'node preview-data-verification.js', 'Package must expose preview data verification');
expect(pkg.scripts['check:merge-restore-pin'] === 'node merge-restore-pin-check.js', 'Package must expose restore-pin regression validation');
expect(pkg.scripts['uat:preview'] === 'node preview-uat-runner.js', 'Package must expose uat:preview');

if (failures.length) {
  console.error('UAT GATE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log('UAT gate check passed');
