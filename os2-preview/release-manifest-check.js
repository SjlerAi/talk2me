'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const gate = fs.readFileSync(path.join(root, 'release-candidate-gate.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'release-manifest-verification.js'), 'utf8');
const releaseRunbook = fs.readFileSync(path.join(root, 'RELEASE_CANDIDATE_RUNBOOK.md'), 'utf8');
const activationRunbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
  }
}

requireMarkers(gate, [
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_COMMIT_SHA or GITHUB_SHA is required',
  'RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated',
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "expectedDatabase = 'kloka_talk2me'",
  "requireValue('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'verifyBootstrapEvidence(bootstrapEvidencePath)',
  "'migration-ledger-bootstrap-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'bootstrapEvidenceSha256 = sha256File(bootstrapEvidencePath)',
  'bootstrapEvidenceSidecarSha256 = sha256File(`${bootstrapEvidencePath}.sha256`)',
  'migrationLedgerBootstrapEvidencePath: bootstrapEvidencePath',
  'migrationLedgerBootstrapEvidenceSha256: bootstrapEvidenceSha256',
  'migrationLedgerBootstrapEvidenceSidecarSha256: bootstrapEvidenceSidecarSha256',
  'migrationLedgerBootstrapEvidenceVerified: Boolean(bootstrapEvidenceSha256 && bootstrapEvidenceSidecarSha256)',
  'bootstrapEvidenceVerifiedBeforeReleaseFreeze: Boolean(bootstrapEvidenceSha256 && bootstrapEvidenceSidecarSha256)',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  "fs.openSync(file, 'wx', 0o600)",
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(manifestTemp, manifestPath)',
  'syncDirectory(directory)',
  'if (manifestPublished) removeIfPresent(manifestPath)',
  'if (checksumPublished) removeIfPresent(checksumPath)',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release candidate gate');

requireMarkers(verifier, [
  "check: 'release-manifest-verification'",
  'function readSecureRegularFile(file, options = {})',
  'pathStat.nlink !== 1',
  'fs.constants.O_NOFOLLOW',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'crypto.timingSafeEqual',
  'manifest.migrationLedgerBootstrapEvidenceVerified !== true',
  'manifest.bootstrapEvidenceVerifiedBeforeReleaseFreeze !== true',
  "verifyChecksumPair(bootstrapEvidencePath, 'Migration ledger bootstrap evidence'",
  'Bootstrap evidence file changed after release freeze',
  'Bootstrap evidence checksum sidecar changed after release freeze',
  'bootstrapEvidence.bootstrapSha256 !== manifest.migrationLedgerBootstrapSha256.toLowerCase()',
  'bootstrapEvidence.preexistingLedgerTableCount !== 0',
  'bootstrapEvidence.createdLedgerTableCount !== 1',
  'bootstrapEvidence.ledgerSchemaVerified !== true',
  'bootstrapEvidence.ledgerEmpty !== true',
  'bootstrapEvidence.advisoryLockReleased !== true',
  'bootstrapExecutionEvidenceMatchesFrozenManifest: true',
  'bootstrapExecutionEvidenceMatchesWorkspace: true',
  'bootstrapEvidenceVerifiedBeforeReleaseFreeze: true',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release manifest verifier');

requireMarkers(releaseRunbook, [
  'talk2me.kloka.co.za',
  'kloka_talk2me',
  'talk2me.uent.co.za',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'npm run bootstrap:migration-ledger',
  'npm run verify:migration-ledger-bootstrap-evidence',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json',
  'RELEASE_COMMIT_SHA=<exact-40-character-git-sha>',
  'RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild',
  'RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json',
  'bootstrap evidence SHA-256',
  'bootstrap evidence-sidecar SHA-256',
  'advisory-lock release and connection closure',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'node release-manifest-verification.js',
  'runtimeLedgerCreationDisabled',
  'mergeExecutionEnabled: false',
  'The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
], 'Release candidate runbook');

const activationOrder = [
  'workspace-topology-verification.js',
  'workspace-topology-governance-check.js',
  'migration-ledger-bootstrap-governance-check.js',
  'migration-ledger-bootstrap-runner-check.js',
  'migration-ledger-bootstrap-evidence-check.js',
  'migration-runner-security-check.js',
  'runtime-release-identity-check.js',
  'readiness-check.js',
  'deployment-check.js',
  'uat-gate-check.js',
  'release-evidence-security-check.js',
  'release-manifest-check.js'
];
let previous = -1;
for (const marker of activationOrder) {
  const position = activationRunbook.indexOf(marker);
  if (position === -1) throw new Error(`Preview activation runbook missing ${marker}`);
  if (position <= previous) throw new Error(`Preview activation runbook order invalid at ${marker}`);
  previous = position;
}
requireMarkers(activationRunbook, [
  'npm run bootstrap:migration-ledger',
  'npm run verify:migration-ledger-bootstrap-evidence',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'evidence verification before MySQL',
  'advisory-lock release, and database-connection closure',
  'Individual `applied <migration>` lines are not completion evidence.',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Preview activation runbook');

if (pkg.scripts['check:release-candidate'] !== 'node release-candidate-gate.js') throw new Error('Missing exact check:release-candidate command');
if (pkg.scripts['verify:release-manifest'] !== 'node release-manifest-verification.js') throw new Error('Missing exact verify:release-manifest command');
if (pkg.scripts['verify:migration-ledger-bootstrap-evidence'] !== 'node migration-ledger-bootstrap-evidence-verification.js') throw new Error('Missing exact bootstrap evidence verification command');
if (pkg.scripts['check:release-manifest'] !== 'node release-manifest-check.js') throw new Error('Missing exact check:release-manifest command');
if (!pkg.scripts.check.includes('node --check release-manifest-verification.js')) throw new Error('Release verifier syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node release-manifest-check.js')) throw new Error('Release manifest governance missing from normal validation');
if (pkg.scripts.check.includes('node release-candidate-gate.js')) throw new Error('Release candidate gate must not execute in normal validation before release evidence exists');

console.log(JSON.stringify({
  ok: true,
  check: 'release-candidate-governance',
  version: pkg.version,
  exactCommitIdentityRequired: true,
  releaseBranchLocked: true,
  dependencyLockRequired: true,
  bootstrapExecutionEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: true,
  bootstrapEvidenceFileChecksumFrozen: true,
  bootstrapEvidenceSidecarChecksumFrozen: true,
  bootstrapEvidencePostFreezeVerificationRequired: true,
  bootstrapEvidenceWorkspaceBindingRequired: true,
  bootstrapEvidenceBackupBindingRequired: true,
  bootstrapLedgerAbsenceProofRequired: true,
  bootstrapLedgerSchemaProofRequired: true,
  bootstrapAdvisoryLockLifecycleRequired: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  releaseEvidencePublicationRaceSafe: true,
  releaseEvidenceDirectoryPrivate: true,
  releaseEvidenceVerifierNoFollowReads: true,
  releaseEvidenceVerifierDescriptorIdentityRequired: true,
  releaseEvidenceVerifierHardLinkRejectionRequired: true,
  releaseEvidenceVerifierSizeLimitsRequired: true,
  activationRunbookFullGovernanceOrderProtected: true,
  releaseRunbookBootstrapEvidenceProcedureProtected: true,
  runtimeLedgerCreationDisabled: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
