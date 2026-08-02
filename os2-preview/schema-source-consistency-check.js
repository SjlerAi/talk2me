'use strict';

const fs = require('fs');
const path = require('path');

function read(file) { return fs.readFileSync(path.join(__dirname, file), 'utf8'); }
function need(source, text, label) { if (!source.includes(text)) throw new Error(`Missing ${label}`); }
function forbid(source, text, label) { if (source.includes(text)) throw new Error(`Forbidden ${label}`); }
function requireAll(source, markers, scope) { for (const marker of markers) need(source, marker, `${scope}: ${marker}`); }

const plan = read('customer-merge-plan-routes.js');
const freshness = read('customer-merge-freshness-routes.js');
const authorisation = read('customer-merge-execution-authorisation-routes.js');
const readiness = read('customer-merge-execution-readiness-routes.js');
const previewReadiness = read('readiness-check.js');
const deploymentCheck = read('deployment-check.js');
const uatGate = read('uat-gate-check.js');
const releaseCandidateGate = read('release-candidate-gate.js');
const releaseManifestCheck = read('release-manifest-check.js');
const releaseManifestVerification = read('release-manifest-verification.js');
const schemaVerification = read('schema-verification.js');
const restoreEvidenceVerification = read('merge-restore-evidence-verification.js');
const previewDataVerification = read('preview-data-verification.js');
const packageSource = read('package.json');
const migration001 = read('migrations/20260801_001_integrated_core.sql');
const migration011 = read('migrations/20260801_011_backup_recovery_and_operations.sql');
const migration021 = read('migrations/20260801_021_merge_plan_freshness.sql');
const migration025 = read('migrations/20260801_025_merge_authorisation_restore_pin.sql');

requireAll(migration001, ["status ENUM('active','expired','revoked','archived')"], 'representative lifecycle');
requireAll(plan, ["status='active'", 'expires_at IS NULL OR expires_at>NOW()'], 'merge plan representative filtering');
requireAll(freshness, ["status='active'", 'expires_at IS NULL OR expires_at>NOW()'], 'merge freshness representative filtering');
forbid(plan, 'os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1', 'nonexistent representative is_active column in merge plan');
forbid(freshness, 'os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1', 'nonexistent representative is_active column in freshness');

requireAll(migration021, ['current_snapshot_hash', 'revalidated_at'], 'merge freshness migration');
requireAll(authorisation, ['revalidated_at', 'restore_test_id', 'PINNED_RESTORE_TEST_REQUIRED'], 'merge authorisation');
forbid(authorisation, 'last_revalidated_at', 'nonexistent last_revalidated_at column');
requireAll(migration011, ["status ENUM('planned','running','passed','failed','cancelled')"], 'restore status vocabulary');
requireAll(migration025, [
  'ADD COLUMN restore_test_id BIGINT NULL',
  'idx_merge_execution_restore',
  'ORDER BY rt.completed_at DESC,rt.id DESC'
], 'restore pin migration');
forbid(migration025, 'MAX(rt.id)', 'non-chronological restore-test backfill');

requireAll(readiness, [
  'rt.id=a.restore_test_id',
  'restoreEvidencePinned',
  'restoreBelongsToBackup',
  "row.restore_status==='passed'",
  "row.restore_target_environment==='isolated_preview_restore'",
  "row.restore_actual_database_name==='kloka_talk2me'",
  'Number(row.restore_failed_checks||0)===0',
  'executionAvailable:false'
], 'merge execution readiness');

requireAll(schemaVerification, [
  "const EXPECTED_MIGRATION_COUNT = 25",
  "'restore_test_id'",
  'restore_test_id IS NULL',
  'INVALID_REPRESENTATIVE_PERMISSIONS',
  'EXPIRED_ACTIVE_REPRESENTATIVES'
], 'schema verification');

requireAll(restoreEvidenceVerification, [
  "const PREVIEW_DATABASE = 'kloka_talk2me'",
  'database !== PREVIEW_DATABASE',
  'LEFT JOIN os2_backup_runs b ON b.id=a.backup_run_id',
  'LEFT JOIN os2_restore_tests rt ON rt.id=a.restore_test_id',
  'Number(row.restore_backup_run_id) !== Number(row.backup_run_id)',
  "row.backup_status !== 'verified'",
  "row.restore_status !== 'passed'",
  "row.target_environment !== 'isolated_preview_restore'",
  'row.expected_database_name !== PREVIEW_DATABASE || row.actual_database_name !== PREVIEW_DATABASE',
  'row.restore_completed_at > row.authorised_at',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'restore evidence verification');

requireAll(previewDataVerification, [
  "expectedDatabase = 'kloka_talk2me'",
  "{ file: 'schema-verification.js'",
  "{ file: 'merge-restore-evidence-verification.js'",
  "encoding: 'utf8'",
  'maxBuffer: maxVerifierOutputBytes',
  'timeout: verifierTimeoutMs',
  "killSignal: 'SIGKILL'",
  'shell: false',
  'result.error',
  'result.signal',
  'result.status !== 0',
  'JSON.parse',
  'schemaVerifiedBeforeRestoreEvidence: true',
  'verifierEnvironmentSanitized: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'preview data verifier');
if (previewDataVerification.indexOf("schema-verification.js") > previewDataVerification.indexOf("merge-restore-evidence-verification.js")) {
  throw new Error('Preview data verification order must remain schema then restore evidence');
}

requireAll(packageSource, [
  '"version": "0.60.0"',
  '"verify:merge-restore-evidence": "node merge-restore-evidence-verification.js"',
  '"verify:preview-data": "node preview-data-verification.js"',
  '"verify:release-manifest": "node release-manifest-verification.js"',
  'node --check merge-restore-evidence-verification.js',
  'node --check preview-data-verification.js',
  'node --check release-manifest-verification.js'
], 'package registration');

requireAll(releaseManifestVerification, [
  "const expectedPreviewVersion = '0.60.0'",
  'manifest.version !== expectedPreviewVersion',
  'crypto.timingSafeEqual',
  "manifest.branch !== 'agent/talk2me-os2-integrated-rebuild'",
  'manifest.previewDataVerificationRequired !== true',
  "manifest.previewDataVerificationOrder[0] !== 'schema-verification.js'",
  "manifest.previewDataVerificationOrder[1] !== 'merge-restore-evidence-verification.js'",
  'manifest.mergeExecutionEnabled !== false',
  "manifest.restorePinMigration !== '20260801_025_merge_authorisation_restore_pin.sql'"
], 'release manifest verification');

for (const [source, label] of [
  [previewReadiness, 'preview readiness'],
  [deploymentCheck, 'deployment gate'],
  [uatGate, 'UAT gate'],
  [releaseCandidateGate, 'release candidate gate']
]) {
  requireAll(source, [
    '20260801_025_merge_authorisation_restore_pin.sql',
    'preview-data-verification.js'
  ], label);
}
requireAll(previewReadiness, ["process.env.DB_NAME !== 'kloka_talk2me'", "scripts['verify:preview-data']"], 'preview readiness');
requireAll(deploymentCheck, ["'verify:preview-data'", 'executionEnabled: false'], 'deployment gate');
requireAll(uatGate, ["pkg.scripts['verify:preview-data']", 'executionAvailable:false'], 'UAT gate');
requireAll(releaseCandidateGate, [
  "'verify:preview-data'",
  "previewDataVerificationOrder: ['schema-verification.js','merge-restore-evidence-verification.js']",
  'rt.id=a.restore_test_id',
  'restoreBelongsToBackup',
  'executionAvailable:false',
  'mergeExecutionEnabled: false',
  'package-lock.json is required before release-candidate freeze'
], 'release candidate gate');
requireAll(releaseManifestCheck, [
  'previewDataVerificationRequired:true',
  "previewDataVerificationOrder:['schema-verification.js','merge-restore-evidence-verification.js']",
  'mergeExecutionEnabled:false',
  "pkg.scripts.check.includes('release-manifest-check.js')"
], 'release manifest governance');
forbid(releaseManifestCheck, "pkg.scripts.check.includes('release-candidate-gate.js') === false", 'inverted release-candidate normal-chain assertion');

console.log(JSON.stringify({
  ok: true,
  check: 'schema-source-consistency',
  version: '0.60.0',
  exactMigrationInventory: 25,
  previewDataVerificationRequired: true,
  previewDataVerificationOrder: ['schema-verification.js', 'merge-restore-evidence-verification.js'],
  boundedVerifierOutputRequired: true,
  mergeExecutionEnabled: false
}, null, 2));
