'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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
  "['workspace-source-integrity.js', 2 * 1024 * 1024]",
  "['workspace-source-integrity-check.js', 2 * 1024 * 1024]",
  "['workspace-topology-governance-check.js', 2 * 1024 * 1024]",
  "['preview-activation-governance-check.js', 2 * 1024 * 1024]",
  "['release-source-integrity-verification.js', 2 * 1024 * 1024]",
  "['release-source-integrity-check.js', 2 * 1024 * 1024]",
  "['release-manifest-check.js', 2 * 1024 * 1024]",
  "['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]",
  'Unexpected migrations directory entry:',
  'canonicalInventory',
  'inventorySha256',
  'selfProtected: files.some',
  'governanceProtected: files.some',
  'activationGovernanceProtected: files.some',
  'releaseGovernanceProtected: files.some',
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

if (pkg.scripts['verify:workspace-source-integrity'] !== 'node workspace-source-integrity.js') throw new Error('Missing verify:workspace-source-integrity command');
if (pkg.scripts['check:workspace-source-integrity'] !== 'node workspace-source-integrity-check.js') throw new Error('Missing check:workspace-source-integrity command');
if (!pkg.scripts.check.includes('node --check workspace-source-integrity.js')) throw new Error('Workspace source integrity syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node --check workspace-source-integrity-check.js')) throw new Error('Workspace source integrity governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node workspace-source-integrity-check.js')) throw new Error('Workspace source integrity governance missing from normal validation');
if (pkg.scripts.check.includes('node workspace-source-integrity.js &&')) throw new Error('Environment-bound source inventory must not execute in normal validation');

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
  selfProtectionRequired: true,
  sourceGovernanceProtectionRequired: true,
  topologyGovernanceProtectionRequired: true,
  activationGovernanceProtectionRequired: true,
  releaseSourceGovernanceProtectionRequired: true,
  releaseManifestGovernanceProtectionRequired: true,
  releaseRunbookProtectionRequired: true,
  ciEvidenceRunbookProtectionRequired: true,
  activationPreflightRegistrationRequired: true,
  packageCommandRegistered: true,
  normalSyntaxValidationRegistered: true,
  normalGovernanceValidationRegistered: true,
  environmentBoundVerifierExcludedFromNormalExecution: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
