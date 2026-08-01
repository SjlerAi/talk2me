'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const gate = fs.readFileSync(path.join(root, 'release-candidate-gate.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'release-manifest-verification.js'), 'utf8');
const sourceVerifier = fs.readFileSync(path.join(root, 'release-source-integrity-verification.js'), 'utf8');
const sourceGovernance = fs.readFileSync(path.join(root, 'release-source-integrity-check.js'), 'utf8');
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
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'verifyReleaseSourceIntegrity(approvedSourceInventorySha256)',
  'approvedSourceInventorySha256',
  'releaseSourceIntegrityVerified: Boolean(releaseSourceIntegrityEvidence)',
  "requireValue('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'verifyBootstrapEvidence(bootstrapEvidencePath)',
  'migrationLedgerBootstrapEvidenceSha256: bootstrapEvidenceSha256',
  'bootstrapEvidenceVerifiedBeforeReleaseFreeze: Boolean(bootstrapEvidenceSha256 && bootstrapEvidenceSidecarSha256)',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  "fs.openSync(file, 'wx', 0o600)",
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(manifestTemp, manifestPath)',
  'syncDirectory(directory)',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release candidate gate');

requireMarkers(verifier, [
  "check: 'release-manifest-verification'",
  'manifest.approvedSourceInventorySha256',
  'verifyReleaseSourceIntegrity(manifest.approvedSourceInventorySha256)',
  'releaseSourceIntegrityMatchesApprovedDigest: true',
  'function readSecureRegularFile(file, options = {})',
  'pathStat.nlink !== 1',
  'fs.constants.O_NOFOLLOW',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'crypto.timingSafeEqual',
  'manifest.migrationLedgerBootstrapEvidenceVerified !== true',
  "verifyChecksumPair(bootstrapEvidencePath, 'Migration ledger bootstrap evidence'",
  'Bootstrap evidence file changed after release freeze',
  'bootstrapExecutionEvidenceMatchesFrozenManifest: true',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release manifest verifier');

requireMarkers(sourceVerifier, [
  "check: 'release-source-integrity-verification'",
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'verifierTimeoutMs = 30000',
  "killSignal: 'SIGKILL'",
  'shell: false',
  'evidence.packageLockPresent !== true',
  'Workspace source inventory digest does not match the approved release digest',
  'exactApprovedInventoryMatched: true'
], 'Release source integrity verifier');

requireMarkers(sourceGovernance, [
  "check: 'release-source-integrity-governance'",
  'packageCommandsRegistered: true',
  'normalSyntaxValidationRegistered: true',
  'normalGovernanceValidationRegistered: true',
  'environmentBoundVerifierExcludedFromNormalExecution: true',
  'verificationBeforeReleasePublicationRequired: true',
  'postFreezeVerificationBeforeIndividualFilesRequired: true'
], 'Release source integrity governance');

requireMarkers(releaseRunbook, [
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'node release-source-integrity-verification.js',
  'exact approved workspace source digest',
  'package-lock.json to be included in the protected inventory',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json',
  'RELEASE_COMMIT_SHA=<exact-40-character-git-sha>',
  'RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild',
  'RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json',
  'advisory-lock release and connection closure',
  'The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
], 'Release candidate runbook');

const activationOrder = [
  'workspace-topology-verification.js',
  'workspace-source-integrity.js',
  'workspace-source-integrity-check.js',
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
  'release-source-integrity-check.js',
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
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'npm run verify:release-source-integrity',
  '30 seconds',
  'shell execution disabled',
  'package-lock.json` in the protected inventory',
  'npm run bootstrap:migration-ledger',
  'npm run verify:migration-ledger-bootstrap-evidence',
  'evidence verification before MySQL',
  'Individual `applied <migration>` lines are not completion evidence.',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Preview activation runbook');

const exactScripts = {
  'check:release-candidate': 'node release-candidate-gate.js',
  'verify:release-manifest': 'node release-manifest-verification.js',
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'check:release-manifest': 'node release-manifest-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) {
  if (pkg.scripts?.[name] !== command) throw new Error(`Missing exact ${name} command`);
}
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check release-manifest-verification.js',
  'node --check release-source-integrity-verification.js',
  'node --check release-source-integrity-check.js',
  'node release-source-integrity-check.js',
  'node release-manifest-check.js'
]) {
  if (!normalCheck.includes(marker)) throw new Error(`Normal validation missing ${marker}`);
}
if (normalCheck.includes('node release-candidate-gate.js')) throw new Error('Release candidate gate must not execute in normal validation before release evidence exists');
if (normalCheck.includes('node release-source-integrity-verification.js')) throw new Error('Environment-bound source verifier must not execute in normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'release-candidate-governance',
  version: pkg.version,
  exactCommitIdentityRequired: true,
  releaseBranchLocked: true,
  dependencyLockRequired: true,
  approvedSourceInventoryRequired: true,
  releaseSourceIntegrityVerificationRequired: true,
  releaseSourceIntegrityBoundedExecutionRequired: true,
  releaseSourceIntegrityBeforeFreezeRequired: true,
  releaseSourceIntegrityPostFreezeRequired: true,
  releaseSourceIntegrityCommandsRegistered: true,
  bootstrapExecutionEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  releaseEvidencePublicationRaceSafe: true,
  activationRunbookFullGovernanceOrderProtected: true,
  runtimeLedgerCreationDisabled: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
