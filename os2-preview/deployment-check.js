'use strict';

const fs = require('fs');
const path = require('path');

const mustContain = (file, tokens) => {
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const token of tokens) if (!content.includes(token)) throw new Error(`${file} missing ${token}`);
};
const mustExist = (file) => {
  if (!fs.existsSync(path.join(__dirname, file))) throw new Error(`Missing deployment dependency ${file}`);
};

mustContain('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  'ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'os2_schema_migrations'
]);

mustContain('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'",
  "expectedVersion = '0.59.0'",
  'expectedNodeMajor = 20',
  "expectedDatabase = 'kloka_talk2me'",
  'DB_NAME is required for runtime release identity verification',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

mustContain('workspace-topology-verification.js', [
  'PREVIEW_APP_ROOT is required',
  'PREVIEW_APP_ROOT must match the executing application root',
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'must not be group or world writable',
  'must not have additional hard links',
  'owner differs from the preview application root',
  'Migration 025 is missing from the protected workspace',
  'directoryNoFollowVerification: true',
  'directoryDescriptorIdentityVerified: true',
  'protectedFilesSymlinkFree: true',
  'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

mustContain('preview-activation-preflight.js', [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'PREVIEW_APP_ROOT',
  "'workspace-topology-verification.js'",
  'ALLOW_PRODUCTION_MUTATION=true',
  'ENABLE_CUSTOMER_MERGE_EXECUTION=true',
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'workspaceTopologyVerified: true',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

mustContain('preview-activation-governance-check.js', [
  'Preview activation preflight order is invalid',
  'workspaceTopologyVerificationRequired: true',
  'directoryNoFollowVerificationRequired: true',
  'protectedFileHardLinkRejectionRequired: true',
  'ownershipConsistencyRequired: true',
  'verify:preview-activation-preflight',
  'PREVIEW_ACTIVATION_RUNBOOK.md',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

mustContain('release-manifest-verification.js', [
  'function readSecureRegularFile(file, options = {})',
  'fs.constants.O_NOFOLLOW',
  'fs.fstatSync(descriptor)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.size > maxBytes',
  'fs.readFileSync(descriptor)',
  'evidenceReadsUseNoFollow: true',
  'evidenceDescriptorIdentityVerified: true',
  'protectedFileSizeLimitsEnforced: true'
]);

mustContain('release-evidence-security-check.js', [
  'Release verifier',
  'Protected read coverage',
  'Release governance',
  'Activation runbook',
  'noFollowRequired: true',
  'descriptorIdentityRequired: true',
  'descriptorBasedReadRequired: true',
  'boundedReadsRequired: true',
  'independentlyExecutable: true'
]);

mustContain('PREVIEW_ACTIVATION_RUNBOOK.md', [
  'PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview',
  'workspace-topology-verification.js',
  'directory descriptors with `O_DIRECTORY | O_NOFOLLOW`',
  'additional hard links',
  'npm run verify:preview-activation-preflight',
  'npm ci',
  'npm run check',
  'ALLOW_PREVIEW_MIGRATIONS=true',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'open protected files with `O_NOFOLLOW`',
  'compare the validated path device/inode identity with the opened descriptor',
  'read through the validated descriptor rather than reopening by path',
  'enforce bounded file sizes before reading',
  'Restart only the preview Node.js application',
  'Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
]);

mustContain('readiness-check.js', [
  "process.env.DB_NAME !== 'kloka_talk2me'",
  'Node.js 20.x is required',
  'EMAIL_WORKER_ENABLED',
  'migrations.length < 25',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'runtime-release-identity-check.js',
  'preview-activation-preflight.js',
  'preview-data-verification.js',
  'merge-restore-evidence-verification.js',
  'merge-restore-pin-check.js',
  "scripts['verify:runtime-release-identity']",
  "scripts['verify:preview-activation-preflight']",
  "scripts['verify:preview-data']"
]);

mustContain('preview-data-verification.js', [
  "const expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
]);

mustContain('merge-restore-evidence-verification.js', [
  "database !== 'kloka_talk2me'",
  'LEFT JOIN os2_backup_runs b ON b.id = a.backup_run_id',
  'LEFT JOIN os2_restore_tests rt ON rt.id = a.restore_test_id',
  'INVALID_PINNED_RESTORE_EVIDENCE'
]);

mustContain('merge-restore-pin-check.js', ['restore_test_id','ORDER BY rt.completed_at DESC,rt.id DESC']);

mustContain('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'talk2me.kloka.co.za',
  'kloka_talk2me',
  'talk2me.uent.co.za',
  'ALLOW_PREVIEW_MIGRATIONS=true npm run migrate:preview',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'schema-verification.js',
  'merge-restore-evidence-verification.js',
  'Running only `npm run verify:schema` is not sufficient',
  'mergeExecutionEnabled: false',
  'Restart only the preview Node.js application'
]);

[
  'migrations/20260801_025_merge_authorisation_restore_pin.sql',
  'runtime-release-identity-check.js',
  'workspace-topology-verification.js',
  'preview-activation-preflight.js',
  'preview-activation-governance-check.js',
  'release-manifest-verification.js',
  'release-evidence-security-check.js',
  'PREVIEW_ACTIVATION_RUNBOOK.md',
  'schema-verification.js',
  'preview-data-verification.js',
  'merge-restore-evidence-verification.js',
  'merge-restore-pin-check.js',
  'PREVIEW_DEPLOYMENT_RUNBOOK.md'
].forEach(mustExist);

const packageJson = require('./package.json');
for (const script of [
  'migrate:preview','verify:runtime-release-identity','verify:preview-activation-preflight','verify:schema',
  'verify:preview-data','verify:merge-restore-evidence','check:merge-restore-pin','check:readiness','check:deployment'
]) {
  if (!packageJson.scripts[script]) throw new Error(`package.json missing ${script}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'deployment-controls',
  application: 'talk2me-os2-preview',
  version: packageJson.version,
  nodeMajorRequired: 20,
  database: 'kloka_talk2me',
  minimumMigrationCount: 25,
  runtimeReleaseIdentityRequired: true,
  workspaceTopologyVerificationRequired: true,
  directoryNoFollowVerificationRequired: true,
  protectedFileHardLinkRejectionRequired: true,
  ownershipConsistencyRequired: true,
  previewActivationPreflightRequired: true,
  previewActivationGovernanceRequired: true,
  secureReleaseEvidenceVerificationRequired: true,
  noFollowEvidenceReadsRequired: true,
  descriptorIdentityRequired: true,
  boundedProtectedReadsRequired: true,
  previewDataVerificationRequired: true,
  deploymentRunbookProtected: true,
  activationRunbookProtected: true,
  restoreEvidenceRequired: true,
  productionMutationEnabled: false,
  executionEnabled: false
}, null, 2));
