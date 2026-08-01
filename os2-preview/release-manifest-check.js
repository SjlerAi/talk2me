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
const uatRunbook = fs.readFileSync(path.join(root, 'PREVIEW_UAT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
}

requireMarkers(gate, [
  'verifierTimeoutMs = 30000',
  "killSignal: 'SIGKILL'",
  'shell: false',
  "result.error.code === 'ETIMEDOUT'",
  'validateReleaseText(approvedBy',
  'validateReleaseText(changeReference',
  'must not contain control characters',
  'must be owned by the executing user',
  "validatePrivateDirectory(path.dirname(bootstrapEvidencePath), 'Bootstrap evidence directory')",
  'Release manifest path must differ from bootstrap evidence path',
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated',
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'sourceIntegrityEvidence = runVerifier',
  'migrationLedgerBootstrapEvidenceSha256: bootstrapEvidenceSha256',
  'generatedAt: new Date().toISOString()',
  'migrationCompletionRequiresConfirmedLockRelease: true',
  'migrationConnectionClosedBeforeSuccess: true',
  "fs.openSync(file, 'wx', 0o600)",
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(manifestTemp, manifestPath)',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release candidate gate');

requireMarkers(verifier, [
  "check: 'release-manifest-verification'",
  'validateReleaseText(manifest.approvedBy',
  'validateReleaseText(manifest.changeReference',
  "Date.parse(String(manifest.generatedAt || ''))",
  'unreasonably in the future',
  'older than the permitted 30-day verification window',
  'must be owned by the executing user',
  "validatePrivateDirectory(directory, 'Release evidence directory')",
  "validatePrivateDirectory(path.dirname(bootstrapEvidencePath), 'Bootstrap evidence directory')",
  'Bootstrap evidence path must differ from release manifest path',
  'verifierTimeoutMs = 30000',
  "killSignal: 'SIGKILL'",
  'shell: false',
  "result.error.code === 'ETIMEDOUT'",
  'verifyFrozenSource(root, manifest.approvedSourceInventorySha256)',
  'crypto.timingSafeEqual',
  'Bootstrap evidence file changed after release freeze',
  'generatedAtValidated: true',
  'releaseMetadataValidated: true',
  'evidenceDirectoryOwnerVerified: true',
  'bootstrapEvidenceDirectoryOwnerVerified: true',
  'protectedFileOwnershipVerified: true',
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
  'package-lock.json to be included in the protected inventory',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json',
  'RELEASE_COMMIT_SHA=<exact-40-character-git-sha>',
  'RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild',
  'RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json',
  'advisory-lock release and connection closure'
], 'Release candidate runbook');

const activationOrder = [
  'workspace-topology-verification.js','workspace-source-integrity.js','workspace-source-integrity-check.js',
  'workspace-topology-governance-check.js','migration-ledger-bootstrap-governance-check.js',
  'migration-ledger-bootstrap-runner-check.js','migration-ledger-bootstrap-evidence-check.js',
  'migration-runner-security-check.js','runtime-release-identity-check.js','readiness-check.js',
  'deployment-check.js','uat-gate-check.js','release-evidence-security-check.js',
  'release-source-integrity-check.js','release-manifest-check.js'
];
let previous = -1;
for (const marker of activationOrder) {
  const position = activationRunbook.indexOf(marker);
  if (position === -1) throw new Error(`Preview activation runbook missing ${marker}`);
  if (position <= previous) throw new Error(`Preview activation runbook order invalid at ${marker}`);
  previous = position;
}
requireMarkers(activationRunbook, [
  'RELEASE_SOURCE_INVENTORY_SHA256','npm run verify:release-source-integrity','30 seconds','shell execution disabled',
  'Re-run approved source-integrity verification immediately before formal UAT',
  'Re-run approved source-integrity verification immediately before release freeze',
  'Any source change after CI approval invalidates the candidate',
  'databaseBackedVerificationExecuted: false','migrationsExecuted: false','previewRestartExecuted: false',
  'productionMutationEnabled: false','mergeExecutionEnabled: false'
], 'Preview activation runbook');
requireMarkers(uatRunbook, [
  'RELEASE_SOURCE_INVENTORY_SHA256','npm run verify:release-source-integrity','exactApprovedInventoryMatched: true',
  'packageLockPresent: true','Re-run approved source-integrity verification immediately before UAT starts',
  'Any source change after the retained CI evidence was produced invalidates that UAT attempt'
], 'Preview UAT runbook');

const exactScripts = {
  'check:release-candidate': 'node release-candidate-gate.js',
  'verify:release-manifest': 'node release-manifest-verification.js',
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'check:release-manifest': 'node release-manifest-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts?.[name] !== command) throw new Error(`Missing exact ${name} command`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of ['node --check release-manifest-verification.js','node --check release-source-integrity-verification.js','node --check release-source-integrity-check.js','node release-source-integrity-check.js','node release-manifest-check.js']) {
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
  releaseMetadataLengthAndControlCharacterValidationRequired: true,
  releaseManifestTimestampValidationRequired: true,
  releaseManifestMaximumAgeRequired: true,
  releaseEvidenceDirectoryOwnershipRequired: true,
  bootstrapEvidenceDirectoryOwnershipRequired: true,
  protectedEvidenceFileOwnershipRequired: true,
  releaseAndBootstrapEvidencePathsMustDiffer: true,
  releaseSourceIntegrityBeforeUatRequired: true,
  releaseSourceIntegrityBeforeFreezeRequired: true,
  releaseSourceIntegrityPostFreezeRequired: true,
  sourceChangeInvalidatesCandidate: true,
  bootstrapExecutionEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  releaseEvidencePublicationRaceSafe: true,
  activationRunbookFullGovernanceOrderProtected: true,
  uatRunbookSourceRevalidationProtected: true,
  runtimeLedgerCreationDisabled: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
