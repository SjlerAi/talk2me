'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'release-source-integrity-verification.js'), 'utf8');
const workspaceVerifier = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const releaseGate = fs.readFileSync(path.join(root, 'release-candidate-gate.js'), 'utf8');
const manifestVerifier = fs.readFileSync(path.join(root, 'release-manifest-verification.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'RELEASE_CANDIDATE_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
  }
}

requireMarkers(verifier, [
  "check: 'release-source-integrity-verification'",
  'RELEASE_SOURCE_INVENTORY_SHA256',
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'verifierTimeoutMs = 30000',
  "'workspace-source-integrity.js'",
  "encoding: 'utf8'",
  'maxBuffer: 16 * 1024 * 1024',
  'timeout: verifierTimeoutMs',
  "killSignal: 'SIGKILL'",
  'shell: false',
  "result.error.code === 'ETIMEDOUT'",
  'result.signal',
  'result.status !== 0',
  'JSON.parse',
  'evidence.applicationRoot !== root',
  'evidence.protectedFileCount !== evidence.files.length',
  'evidence.migrationCount < 25',
  'evidence.packageLockPresent !== true',
  'evidence.secureDescriptorReads !== true',
  'Workspace source inventory digest does not match the approved release digest',
  'exactApprovedInventoryMatched: true',
  'verifierShellDisabled: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Release source integrity verifier');

requireMarkers(workspaceVerifier, [
  "check: 'workspace-source-integrity'",
  'inventorySha256',
  'secureDescriptorReads: true',
  'canonicalPathBinding: true',
  'hardLinkRejection: true',
  'ownershipConsistency: true',
  'boundedReads: true'
], 'Workspace source integrity verifier');

requireMarkers(preflight, [
  "'release-source-integrity-check.js'",
  'releaseSourceIntegrityGovernanceVerified: true'
], 'Preview activation preflight');

const gateVerifierCall = "runVerifier('release-source-integrity-verification.js',{ RELEASE_SOURCE_INVENTORY_SHA256: approvedSourceInventorySha256 },'Release source integrity verifier')";
requireMarkers(releaseGate, [
  'RELEASE_SOURCE_INVENTORY_SHA256',
  gateVerifierCall,
  'approvedSourceInventorySha256',
  'releaseSourceIntegrityVerified: Boolean(sourceIntegrityEvidence'
], 'Release candidate gate');

const manifestVerifierCall = 'verifyFrozenSource(root, manifest.approvedSourceInventorySha256)';
requireMarkers(manifestVerifier, [
  'manifest.approvedSourceInventorySha256',
  manifestVerifierCall,
  'evidence.exactApprovedInventoryMatched !== true',
  "String(evidence.inventorySha256 || '').toLowerCase() !== inventorySha256.toLowerCase()"
], 'Release manifest verifier');

requireMarkers(runbook, [
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'node release-source-integrity-verification.js',
  'CI source inventory and approved digest',
  'package-lock.json to be included in the protected inventory',
  '30-second execution limit',
  'shell execution disabled'
], 'Release candidate runbook');

if (pkg.scripts?.['verify:release-source-integrity'] !== 'node release-source-integrity-verification.js') {
  throw new Error('Missing exact verify:release-source-integrity package command');
}
if (pkg.scripts?.['check:release-source-integrity'] !== 'node release-source-integrity-check.js') {
  throw new Error('Missing exact check:release-source-integrity package command');
}
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check release-source-integrity-verification.js',
  'node --check release-source-integrity-check.js',
  'node release-source-integrity-check.js'
]) {
  if (!normalCheck.includes(marker)) throw new Error(`Normal validation missing ${marker}`);
}
if (normalCheck.includes('node release-source-integrity-verification.js')) {
  throw new Error('Environment-bound release source verifier must not execute in normal validation');
}
if (preflight.includes("'release-source-integrity-verification.js'")) {
  throw new Error('Environment-bound release source verification must not execute during source-only activation preflight');
}

const gateVerifyPosition = releaseGate.indexOf(gateVerifierCall);
const gatePublishPosition = releaseGate.indexOf('publishEvidencePair(output');
if (gateVerifyPosition === -1 || gatePublishPosition === -1 || gateVerifyPosition >= gatePublishPosition) {
  throw new Error('Release source integrity must be verified before release evidence publication');
}

const manifestVerifyPosition = manifestVerifier.indexOf(manifestVerifierCall);
const packageVerifyPosition = manifestVerifier.indexOf("readSecureRegularFile(path.join(root, 'package.json')");
if (manifestVerifyPosition === -1 || packageVerifyPosition === -1 || manifestVerifyPosition >= packageVerifyPosition) {
  throw new Error('Post-freeze source integrity must be verified before individual package checks');
}

console.log(JSON.stringify({
  ok: true,
  check: 'release-source-integrity-governance',
  approvedDigestRequired: true,
  exactDigestComparisonRequired: true,
  workspaceVerifierReexecuted: true,
  boundedExecutionRequired: true,
  forcedKillSignalRequired: true,
  shellExecutionDisabled: true,
  verifierOutputBounded: true,
  applicationRootEvidenceRequired: true,
  protectedFileCountConsistencyRequired: true,
  migrationInventoryMinimumRequired: true,
  packageLockInProtectedInventoryRequired: true,
  secureDescriptorEvidenceRequired: true,
  verificationBeforeReleasePublicationRequired: true,
  postFreezeVerificationBeforeIndividualFilesRequired: true,
  environmentBoundVerifierExcludedFromSourceOnlyPreflight: true,
  packageCommandsRegistered: true,
  normalSyntaxValidationRegistered: true,
  normalGovernanceValidationRegistered: true,
  environmentBoundVerifierExcludedFromNormalExecution: true,
  activationGovernanceRegistrationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
