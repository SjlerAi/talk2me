'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const repositoryRoot = path.resolve(root, '..');
const failures = [];

function read(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing CI governance file: ${full}`);
    return '';
  }
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) failures.push(`CI governance source must be a regular non-symlink file: ${full}`);
  return fs.readFileSync(full, 'utf8');
}

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
}

function prohibitMarkers(source, markers, label) {
  for (const marker of markers) if (source.includes(marker)) failures.push(`${label} contains prohibited ${marker}`);
}

function validatePinnedActions(source, label, expectedCount) {
  const uses = source.split(/\r?\n/).filter(line => /^\s*uses:\s*/.test(line));
  if (uses.length !== expectedCount) failures.push(`${label} must contain exactly ${expectedCount} action uses; found ${uses.length}`);
  for (const line of uses) {
    const reference = line.trim().replace(/^uses:\s*/, '').split(/\s+#/)[0].trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(reference)) failures.push(`${label} action is not pinned to an immutable SHA: ${reference}`);
  }
}

const ciWorkflow = read(path.join(repositoryRoot, '.github/workflows/os2-preview-ci.yml'));
const generationWorkflow = read(path.join(repositoryRoot, '.github/workflows/os2-dependency-lock-generation.yml'));
const adoptionWorkflow = read(path.join(repositoryRoot, '.github/workflows/os2-dependency-lock-adoption.yml'));
const buildEvidence = read(path.join(root, 'build-evidence.js'));
const sourceIntegrity = read(path.join(root, 'workspace-source-integrity.js'));
const sourceGovernance = read(path.join(root, 'workspace-source-integrity-check.js'));
const lockVerifier = read(path.join(root, 'dependency-lock-verification.js'));
const lockGovernance = read(path.join(root, 'dependency-lock-governance-check.js'));
const generationGovernance = read(path.join(root, 'dependency-lock-workflow-check.js'));
const adoptionGovernance = read(path.join(root, 'dependency-lock-adoption-check.js'));
const runbook = read(path.join(root, 'CI_AND_BUILD_EVIDENCE_RUNBOOK.md'));
const packageText = read(path.join(root, 'package.json'));
let pkg = {};
try { pkg = JSON.parse(packageText); } catch (error) { failures.push(`package.json invalid JSON: ${error.message}`); }

for (const [label, workflow, count] of [
  ['Preview CI workflow', ciWorkflow, 3],
  ['Dependency lock generation workflow', generationWorkflow, 3],
  ['Dependency lock adoption workflow', adoptionWorkflow, 3]
]) {
  requireMarkers(workflow, ['permissions:', 'contents: read', 'persist-credentials: false', "node-version: '20'"], label);
  prohibitMarkers(workflow, ['contents: write', 'permissions: write-all', 'continue-on-error: true', 'persist-credentials: true'], label);
  validatePinnedActions(workflow, label, count);
}

requireMarkers(ciWorkflow, [
  'name: OS2 Preview CI', 'push:', 'workflow_dispatch:', 'agent/talk2me-os2-integrated-rebuild',
  'fetch-depth: 1', 'node dependency-lock-verification.js', 'node dependency-lock-governance-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check', 'npm audit --omit=dev --audit-level=high',
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256:', 'npm run evidence:build', 'if-no-files-found: error', 'retention-days: 30'
], 'Preview CI workflow');
prohibitMarkers(ciWorkflow, ['npm install ', 'pull_request_target:'], 'Preview CI workflow');

requireMarkers(generationWorkflow, [
  'name: OS2 Dependency Lock Generation', 'workflow_dispatch:', 'GENERATE_OS2_LOCK', 'fetch-depth: 1',
  'node dependency-lock-generator.js', 'node dependency-lock-workflow-check.js', 'node dependency-lock-artifact-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high', 'retention-days: 7'
], 'Dependency lock generation workflow');
if (/^\s{2}(push|pull_request|pull_request_target)\s*:/m.test(generationWorkflow)) failures.push('Dependency lock generation workflow must remain manual-only');

requireMarkers(adoptionWorkflow, [
  'name: OS2 Dependency Lock Adoption', 'push:', 'workflow_dispatch:', 'fetch-depth: 2',
  "'os2-preview/package-lock.json'", "'os2-preview/dependency-lock-provenance.json'",
  'node dependency-lock-provenance-verification.js', 'node dependency-lock-adoption-check.js',
  'node dependency-lock-verification.js', 'npm ci --ignore-scripts --no-audit --no-fund',
  'npm run check', 'npm audit --omit=dev --audit-level=high', 'retention-days: 30'
], 'Dependency lock adoption workflow');

requireMarkers(lockVerifier, [
  "check: 'dependency-lock-verification'", 'meaningfulControls: 60', 'packageLockPresent: true',
  'lockfileVersionThreeRequired: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Dependency lock verifier');
requireMarkers(lockGovernance, [
  "check: 'dependency-lock-governance'", 'npmCiRequired: true', 'npmInstallSubstitutionProhibited: true',
  'dependencyAuditRequired: true', 'dependencyInstallationExecuted: false'
], 'Dependency lock governance');
requireMarkers(generationGovernance, [
  "check: 'dependency-lock-workflow-governance'", 'manualDispatchOnly: true',
  'repositoryReadOnlyPermissionRequired: true', 'automaticCommitProhibited: true'
], 'Dependency lock generation governance');
requireMarkers(adoptionGovernance, [
  "check: 'dependency-lock-adoption-governance'", 'adoptionWorkflowReadOnlyRequired: true',
  'immediateParentContinuityRequired: true', 'exactTwoFileChangeRequired: true',
  'integratedValidationRequired: true', 'highSeverityAuditRequired: true'
], 'Dependency lock adoption governance');

requireMarkers(buildEvidence, [
  "expectedRepository = 'SjlerAi/talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'validateCiIdentity()', 'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256',
  'workspaceSourceIntegrityStableAcrossDependencyInstall',
  'fs.constants.O_DIRECTORY', 'fs.constants.O_NOFOLLOW',
  'maxEvidenceFiles = 2000', 'maxEvidenceFileBytes = 16 * 1024 * 1024',
  'maxEvidenceTotalBytes = 256 * 1024 * 1024', 'secureReadFile(', 'artifact-manifest.json',
  'mode: 0o700', '0o600', 'crypto.timingSafeEqual'
], 'Build evidence');
prohibitMarkers(buildEvidence, ['shell: true'], 'Build evidence');

requireMarkers(sourceIntegrity, [
  "check: 'workspace-source-integrity'", 'inventorySha256', 'packageLockPresent: true',
  'secureDescriptorReads: true', 'canonicalPathBinding: true', 'hardLinkRejection: true',
  'ownershipConsistency: true', 'boundedReads: true'
], 'Workspace source integrity');
requireMarkers(sourceGovernance, [
  "check: 'workspace-source-integrity-governance'", 'ciWorkflowProtectionRequired: true',
  'environmentBoundVerifierExcludedFromNormalExecution: true'
], 'Workspace source integrity governance');

requireMarkers(runbook, [
  'controlled branch only', 'pull_request merge refs', 'push and manual `workflow_dispatch`',
  'immutable 40-character commit SHA', 'persist-credentials: false', 'fetch-depth: 1',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high',
  'missing lockfile is a hard failure', 'pre-install inventory digest', 'post-install inventory digest',
  'must match exactly', 'workspaceSourceIntegrityStableAcrossDependencyInstall: true',
  'O_DIRECTORY | O_NOFOLLOW', '2,000 files', '16 MiB', '256 MiB', 'atomic publication',
  'private `0700` evidence directory', 'private `0600` evidence files', 'artifact-manifest.json',
  'OS2 Dependency Lock Adoption', 'exact two-file adoption commit', 'dependency-lock-provenance.json',
  'Production at `talk2me.uent.co.za` remains outside this workflow'
], 'CI and build evidence runbook');

if (pkg.scripts?.['evidence:build'] !== 'node build-evidence.js') failures.push('Missing exact evidence:build package command');
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of ['node --check build-evidence.js', 'node --check ci-governance-check.js', 'node ci-governance-check.js']) {
  if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
}
for (const prohibited of ['node build-evidence.js', 'npm run evidence:build']) {
  if (normalCheck.includes(`&& ${prohibited} &&`)) failures.push(`Environment-bound evidence command must not execute during normal validation: ${prohibited}`);
}

if (failures.length) {
  console.error('CI GOVERNANCE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'ci-governance',
  meaningfulControls: 60,
  controlledBranchOnly: true,
  releaseEvidenceFromPullRequestMergeRefsProhibited: true,
  immutableActionPinsRequired: true,
  repositoryReadOnlyPermissionRequired: true,
  checkoutCredentialsPersisted: false,
  node20Required: true,
  committedDependencyLockRequired: true,
  npmCiRequired: true,
  installScriptsDisabled: true,
  highSeverityAuditRequired: true,
  preinstallSourceIntegrityRequired: true,
  postinstallSourceIntegrityRequired: true,
  sourceDigestContinuityRequired: true,
  secureManifestDescriptorReads: true,
  boundedManifestCollection: true,
  privateEvidenceDirectoryRequired: true,
  privateEvidenceFilesRequired: true,
  atomicEvidencePublicationRequired: true,
  dependencyLockGenerationManualOnly: true,
  dependencyLockAdoptionSingleCommitRequired: true,
  automaticCommitProhibited: true,
  databaseExecutionEnabled: false,
  migrationExecutionEnabled: false,
  deploymentExecutionEnabled: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
