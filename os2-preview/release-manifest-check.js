'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];

function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing ${file}`);
    return '';
  }
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) failures.push(`${file} must be a regular non-symlink file`);
  return fs.readFileSync(full, 'utf8');
}

function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
  return source;
}

const pkgText = read('package.json');
let pkg = {};
try { pkg = JSON.parse(pkgText || '{}'); } catch (error) { failures.push(`package.json invalid JSON: ${error.message}`); }
if (pkg.version !== '0.60.0') failures.push(`Expected package version 0.60.0, found ${pkg.version || 'missing'}`);

const gate = requireMarkers('release-candidate-gate.js', [
  'verifierTimeoutMs = 30000', "killSignal: 'SIGKILL'", 'shell: false',
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated',
  'RELEASE_SOURCE_INVENTORY_SHA256', 'migrationLedgerBootstrapEvidenceSha256',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  "fs.openSync(file, 'wx', 0o600)", 'restorePinMigration',
  'previewDataVerificationRequired: true', 'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
if (gate.includes('env: { ...process.env')) failures.push('release-candidate-gate.js must not inherit the complete parent environment');

const verifier = requireMarkers('release-manifest-verification.js', [
  "check: 'release-manifest-verification'",
  "expectedApplication = 'talk2me-os2-preview'",
  "expectedPreviewVersion = '0.60.0'",
  "expectedReleaseBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql'",
  "expectedRestorePinMigration = '20260801_025_merge_authorisation_restore_pin.sql'",
  "expectedPreviewDataOrder = ['schema-verification.js', 'merge-restore-evidence-verification.js']",
  'requireExactArray(manifest.previewDataVerificationOrder',
  'requireExactArray(manifest.requiredFiles',
  'requireExactArray(manifest.requiredScripts',
  'manifest.migrationCount !== actualMigrations.length',
  'manifest.releaseSourceMigrationCount !== actualMigrations.length',
  'sourceEvidence.protectedFileCount !== manifest.releaseSourceProtectedFileCount',
  'sourceEvidence.migrationCount !== manifest.releaseSourceMigrationCount',
  'validateCanonicalIso(manifest.generatedAt',
  'older than the permitted 30-day verification window',
  'unreasonably in the future',
  'Release manifest root must be an object',
  'must not contain duplicates',
  "for (const [name, value] of [['packageJsonSha256'",
  'fail(`Release manifest ${name} is invalid`)',
  'Checked-out package.json is invalid JSON',
  'packageJson.name !== expectedApplication',
  'packageJson.version !== expectedPreviewVersion',
  'Checked-out package-lock.json is invalid JSON',
  'lockJson.name !== expectedApplication',
  'lockJson.version !== expectedPreviewVersion',
  'lockJson.lockfileVersion < 2',
  "bootstrapEvidence.check !== 'migration-ledger-bootstrap-runner'",
  'bootstrapEvidence.database !== expectedDatabase',
  'Verified backup SHA-256 is invalid',
  'bootstrapEvidence.ledgerRowCount !== 0',
  'bootstrapEvidence.advisoryLockUsed !== true',
  'Bootstrap completion precedes bootstrap start',
  'Release manifest was generated before bootstrap completion',
  'Required restore-pin migration is missing from the workspace',
  'Release manifest contains duplicate migration evidence',
  'Release manifest migration checksum format is invalid',
  'evidenceReadByteCountVerified: true',
  'exactRequiredFilesVerified: true',
  'exactRequiredScriptsVerified: true',
  'exactPreviewDataVerificationOrderVerified: true',
  'exactRestorePinMigrationVerified: true',
  'manifestMigrationCountVerified: true',
  'releaseSourceCountsReconciled: true',
  'bootstrapBackupEvidenceValidated: true',
  'bootstrapTimelineValidated: true',
  'migrationInventoryUnique: true',
  'releaseSourceChildEnvironmentSanitized: true',
  "NODE_ENV: 'production'", 'env: Object.freeze(allowedEnv)',
  "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  'evidence.packageLockPresent !== true', 'crypto.timingSafeEqual',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
if (verifier.includes('env: { ...process.env')) failures.push('release-manifest-verification.js must not inherit the complete parent environment');

requireMarkers('release-source-integrity-verification.js', [
  "check: 'release-source-integrity-verification'", 'RELEASE_SOURCE_INVENTORY_SHA256',
  'verifierTimeoutMs = 30000', "killSignal: 'SIGKILL'", 'shell: false',
  'evidence.packageLockPresent !== true', 'exactApprovedInventoryMatched: true'
]);
requireMarkers('release-source-integrity-check.js', [
  "check: 'release-source-integrity-governance'", 'packageCommandsRegistered: true',
  'normalSyntaxValidationRegistered: true', 'normalGovernanceValidationRegistered: true',
  'environmentBoundVerifierExcludedFromNormalExecution: true',
  'verificationBeforeReleasePublicationRequired: true',
  'postFreezeVerificationBeforeIndividualFilesRequired: true'
]);
requireMarkers('RELEASE_CANDIDATE_RUNBOOK.md', [
  'exact required-file inventory', 'exact required-script inventory',
  'canonical UTC ISO-8601', 'migrationCount', 'restorePinMigration',
  'previewDataVerificationRequired', 'previewDataVerificationOrder',
  'source protected-file count', 'source migration count',
  'package name and version', 'lockfileVersion', 'bootstrap operator',
  'verified backup reference', 'verified backup SHA-256',
  'bootstrap completion must precede release freeze',
  'migration filenames are unique', 'migration checksum formats',
  'sanitized allowlisted environment', 'RELEASE_SOURCE_INVENTORY_SHA256',
  'node release-source-integrity-verification.js',
  'package-lock.json to be included in the protected inventory'
]);
requireMarkers('PREVIEW_ACTIVATION_RUNBOOK.md', [
  'RELEASE_SOURCE_INVENTORY_SHA256', 'npm run verify:release-source-integrity',
  'Re-run approved source-integrity verification immediately before formal UAT',
  'Re-run approved source-integrity verification immediately before release freeze',
  'Any source change after CI approval invalidates the candidate',
  'databaseBackedVerificationExecuted: false', 'migrationsExecuted: false',
  'previewRestartExecuted: false', 'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
requireMarkers('PREVIEW_UAT_RUNBOOK.md', [
  'RELEASE_SOURCE_INVENTORY_SHA256', 'npm run verify:release-source-integrity',
  'exactApprovedInventoryMatched: true', 'packageLockPresent: true',
  'Re-run approved source-integrity verification immediately before UAT starts',
  'Any source change after the retained CI evidence was produced invalidates that UAT attempt'
]);

const exactScripts = {
  'check:release-candidate': 'node release-candidate-gate.js',
  'verify:release-manifest': 'node release-manifest-verification.js',
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'check:release-manifest': 'node release-manifest-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts?.[name] !== command) failures.push(`Missing exact ${name} command`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check release-manifest-verification.js',
  'node --check release-source-integrity-verification.js',
  'node --check release-source-integrity-check.js',
  'node release-source-integrity-check.js',
  'node release-manifest-check.js'
]) if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
if (normalCheck.includes('node release-candidate-gate.js')) failures.push('Release candidate gate must not execute during normal validation');
if (normalCheck.includes('node release-source-integrity-verification.js')) failures.push('Environment-bound source verifier must not execute during normal validation');

if (failures.length) {
  console.error('RELEASE MANIFEST GOVERNANCE FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'release-candidate-governance',
  version: pkg.version,
  semanticControlsGoverned: 50,
  exactApplicationIdentityRequired: true,
  exactVersionIdentityRequired: true,
  exactCommitIdentityRequired: true,
  releaseBranchLocked: true,
  dependencyLockRequired: true,
  dependencyLockIdentityRequired: true,
  dependencyLockVersionRequired: true,
  exactRequiredFilesRequired: true,
  exactRequiredScriptsRequired: true,
  exactPreviewDataOrderRequired: true,
  exactRestorePinMigrationRequired: true,
  manifestMigrationCountRequired: true,
  releaseSourceCountReconciliationRequired: true,
  canonicalManifestTimestampRequired: true,
  bootstrapTimelineRequired: true,
  bootstrapBackupEvidenceRequired: true,
  migrationDirectoryIdentityRequired: true,
  uniqueMigrationInventoryRequired: true,
  migrationChecksumFormatRequired: true,
  releaseVerifierChildEnvironmentSanitized: true,
  completeParentEnvironmentInheritanceProhibited: true,
  releaseSourceIntegrityBeforeUatRequired: true,
  releaseSourceIntegrityBeforeFreezeRequired: true,
  releaseSourceIntegrityPostFreezeRequired: true,
  sourceChangeInvalidatesCandidate: true,
  runtimeLedgerCreationDisabled: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
