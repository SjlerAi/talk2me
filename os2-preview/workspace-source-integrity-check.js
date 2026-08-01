'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
}

requireMarkers(verifier, [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'descriptorStat.size > maxBytes',
  'crypto.createHash(\'sha256\')',
  "['workspace-source-integrity.js', 1024 * 1024]",
  'Unexpected migrations directory entry:',
  'canonicalInventory',
  'inventorySha256',
  'secureDescriptorReads: true',
  'canonicalPathBinding: true',
  'hardLinkRejection: true',
  'ownershipConsistency: true',
  'boundedReads: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Workspace source integrity verifier');

requireMarkers(preflight, [
  "'workspace-topology-verification.js'",
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  'workspaceSourceIntegrityVerified: true',
  'workspaceSourceIntegrityGovernanceVerified: true'
], 'Preview activation preflight');

const expectedOrder = [
  "'workspace-topology-verification.js'",
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'"
];
for (let index = 1; index < expectedOrder.length; index += 1) {
  if (preflight.indexOf(expectedOrder[index - 1]) >= preflight.indexOf(expectedOrder[index])) throw new Error(`Workspace source integrity order invalid at ${expectedOrder[index]}`);
}

requireMarkers(runbook, [
  'workspace-source-integrity.js',
  'workspace-source-integrity-check.js',
  'deterministic SHA-256 inventory',
  'secure descriptor-based reads',
  'source inventory digest'
], 'Activation runbook');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-source-integrity-governance',
  deterministicInventoryRequired: true,
  secureDescriptorReadsRequired: true,
  canonicalPathBindingRequired: true,
  hardLinkRejectionRequired: true,
  ownershipConsistencyRequired: true,
  boundedReadsRequired: true,
  migrationDirectoryPurityRequired: true,
  activationPreflightRegistrationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
