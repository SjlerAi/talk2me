'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'release-source-integrity-verification.js'), 'utf8');
const workspaceVerifier = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'RELEASE_CANDIDATE_RUNBOOK.md'), 'utf8');

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
  "'workspace-source-integrity.js'",
  "encoding: 'utf8'",
  'maxBuffer: 16 * 1024 * 1024',
  'result.error',
  'result.signal',
  'result.status !== 0',
  'JSON.parse',
  'inventorySha256',
  'Workspace source inventory digest does not match the approved release digest',
  'evidence.packageLockPresent !== true',
  'exactApprovedInventoryMatched: true',
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

requireMarkers(runbook, [
  'RELEASE_SOURCE_INVENTORY_SHA256',
  'node release-source-integrity-verification.js',
  'exact approved workspace source digest',
  'package-lock.json to be included in the protected inventory'
], 'Release candidate runbook');

if (preflight.includes("'release-source-integrity-verification.js'")) {
  throw new Error('Environment-bound release source verification must not execute during source-only activation preflight');
}

console.log(JSON.stringify({
  ok: true,
  check: 'release-source-integrity-governance',
  approvedDigestRequired: true,
  exactDigestComparisonRequired: true,
  workspaceVerifierReexecuted: true,
  packageLockInProtectedInventoryRequired: true,
  secureDescriptorEvidenceRequired: true,
  environmentBoundVerifierExcludedFromSourceOnlyPreflight: true,
  activationGovernanceRegistrationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
