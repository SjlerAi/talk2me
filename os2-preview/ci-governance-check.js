'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const repositoryRoot = path.resolve(root, '..');
const files = Object.freeze({
  ciWorkflow: path.join(repositoryRoot, '.github', 'workflows', 'os2-preview-ci.yml'),
  generationWorkflow: path.join(repositoryRoot, '.github', 'workflows', 'os2-dependency-lock-generation.yml'),
  adoptionWorkflow: path.join(repositoryRoot, '.github', 'workflows', 'os2-dependency-lock-adoption.yml'),
  package: path.join(root, 'package.json'),
  buildEvidence: path.join(root, 'build-evidence.js'),
  lockVerifier: path.join(root, 'dependency-lock-verification.js'),
  lockGovernance: path.join(root, 'dependency-lock-governance-check.js'),
  generationGovernance: path.join(root, 'dependency-lock-workflow-check.js'),
  adoptionGovernance: path.join(root, 'dependency-lock-adoption-check.js'),
  sourceIntegrity: path.join(root, 'workspace-source-integrity.js'),
  sourceGovernance: path.join(root, 'workspace-source-integrity-check.js'),
  runbook: path.join(root, 'CI_AND_BUILD_EVIDENCE_RUNBOOK.md')
});
const failures = [];
function read(name) {
  const file = files[name];
  if (!fs.existsSync(file)) { failures.push(`Missing CI governance file: ${file}`); return ''; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) failures.push(`CI governance source must be a regular non-symlink file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
}
function requireOrder(source, markers, label) {
  for (let index = 1; index < markers.length; index += 1) {
    const left = source.indexOf(markers[index - 1]);
    const right = source.indexOf(markers[index]);
    if (left < 0 || right < 0 || left >= right) failures.push(`${label} order invalid at ${markers[index]}`);
  }
}
function validatePinnedActions(source, label, expectedCount) {
  const lines = source.split(/\r?\n/).filter(line => /^\s*uses:\s*/.test(line));
  if (lines.length !== expectedCount) failures.push(`${label} must contain exactly ${expectedCount} action uses; found ${lines.length}`);
  for (const line of lines) {
    const reference = line.trim().replace(/^uses:\s*/, '').split(/\s+#/)[0].trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(reference)) failures.push(`${label} action is not pinned to a full immutable SHA: ${reference}`);
  }
  if (/uses:\s*[^\s#]+@(v\d+|main|master|latest)\b/i.test(source)) failures.push(`${label} contains a mutable action reference`);
}
function commonWorkflowSafety(source, label) {
  if (!source.includes('permissions:') || !source.includes('contents: read')) failures.push(`${label} must use read-only repository permission`);
  if (source.includes('contents: write') || source.includes('permissions: write-all')) failures.push(`${label} repository write permission is prohibited`);
  if (source.includes('persist-credentials: true')) failures.push(`${label} checkout credentials must not persist`);
  if (source.includes('continue-on-error: true')) failures.push(`${label} must fail closed`);
  if (source.includes('npm install ')) failures.push(`${label} must not use npm install`);
  if (source.includes('shell: true')) failures.push(`${label} must not enable shell execution in Node child controls`);
}

const ciWorkflow = read('ciWorkflow');
const generationWorkflow = read('generationWorkflow');
const adoptionWorkflow = read('adoptionWorkflow');
const pkgText = read('package');
const buildEvidence = read('buildEvidence');
const lockVerifier = read('lockVerifier');
const lockGovernance = read('lockGovernance');
const generationGovernance = read('generationGovernance');
const adoptionGovernance = read('adoptionGovernance');
const sourceIntegrity = read('sourceIntegrity');
const sourceGovernance = read('sourceGovernance');
const runbook = read('runbook');
let pkg = null;
try { pkg = JSON.parse(pkgText); } catch { failures.push('package.json is invalid JSON'); }

const pinned = Object.freeze({
  checkout: 'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955',
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
});

requireMarkers(ciWorkflow, [
  'name: OS2 Preview CI', 'push:', 'workflow_dispatch:', 'agent/talk2me-os2-integrated-rebuild',
  '.github/workflows/os2-preview-ci.yml', '.github/workflows/os2-dependency-lock-generation.yml',
  '.github/workflows/os2-dependency-lock-adoption.yml', 'contents: read', 'cancel-in-progress: true',
  'timeout-minutes: 15', pinned.checkout, pinned.setupNode, pinned.uploadArtifact,
  'persist-credentials: false', 'fetch-depth: 1', "node-version: '20'",
  'Confirm controlled workflow event and ref', 'push|workflow_dispatch',
  'test "$GITHUB_REPOSITORY" = "SjlerAi/talk2me"',
  'test "$GITHUB_REF" = "refs/heads/agent/talk2me-os2-integrated-rebuild"',
  'test "$GITHUB_REF_NAME" = "agent/talk2me-os2-integrated-rebuild"',
  'Verify committed dependency lock', 'node dependency-lock-verification.js',
  'Verify dependency lock governance', 'node dependency-lock-governance-check.js',
  'Verify and retain pre-install workspace source integrity', 'evidence.packageLockPresent !== true',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check',
  'npm audit --omit=dev --audit-level=high', "DEPENDENCY_LOCK_PRESENT: 'true'",
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256:', 'npm run evidence:build',
  'os2-preview-build-evidence-${{ github.run_number }}-attempt-${{ github.run_attempt }}',
  'if-no-files-found: error', 'retention-days: 30'
], 'Preview CI workflow');
requireOrder(ciWorkflow, [
  'Checkout repository', 'Set up Node.js', 'Confirm controlled workflow event and ref',
  'Verify committed dependency lock', 'Verify dependency lock governance',
  'Verify and retain pre-install workspace source integrity', 'Install dependencies from committed lock',
  'Run integrated validation suite', 'Run production dependency audit',
  'Generate build evidence with pre-install source continuity', 'Upload build evidence'
], 'Preview CI workflow');
if (/^\s*pull_request(_target)?\s*:/m.test(ciWorkflow)) failures.push('Preview CI release evidence must not run on pull request merge refs');
if (!/^\s{2}push\s*:/m.test(ciWorkflow) || !/^\s{2}workflow_dispatch\s*:/m.test(ciWorkflow)) failures.push('Preview CI must retain controlled push and workflow_dispatch triggers');
commonWorkflowSafety(ciWorkflow, 'Preview CI workflow');
validatePinnedActions(ciWorkflow, 'Preview CI workflow', 3);

requireMarkers(generationWorkflow, [
  'name: OS2 Dependency Lock Generation', 'workflow_dispatch:', 'Type GENERATE_OS2_LOCK',
  'contents: read', 'cancel-in-progress: false', 'timeout-minutes: 20', pinned.checkout, pinned.setupNode,
  pinned.uploadArtifact, 'persist-credentials: false', 'fetch-depth: 1', "node-version: '20'",
  'test "$LOCK_CONFIRMATION" = "GENERATE_OS2_LOCK"', 'node dependency-lock-generator.js',
  'node dependency-lock-workflow-check.js', 'node dependency-lock-artifact-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check',
  'npm audit --omit=dev --audit-level=high', 'node dependency-lock-artifact-verification.js',
  'test "$status" = "?? os2-preview/package-lock.json"', 'retention-days: 7'
], 'Dependency lock generation workflow');
if (/^\s{2}push\s*:/m.test(generationWorkflow) || /^\s{2}pull_request\s*:/m.test(generationWorkflow)) failures.push('Dependency lock generation workflow must remain manual-only');
commonWorkflowSafety(generationWorkflow, 'Dependency lock generation workflow');
validatePinnedActions(generationWorkflow, 'Dependency lock generation workflow', 3);

requireMarkers(adoptionWorkflow, [
  'name: OS2 Dependency Lock Adoption', 'push:', 'workflow_dispatch:',
  "- 'os2-preview/package-lock.json'", "- 'os2-preview/dependency-lock-provenance.json'",
  'contents: read', 'cancel-in-progress: false', 'timeout-minutes: 20', pinned.checkout, pinned.setupNode,
  pinned.uploadArtifact, 'persist-credentials: false', 'fetch-depth: 2', "node-version: '20'",
  "PROVENANCE_MAX_AGE_HOURS: '168'", "ALLOW_PRODUCTION_MUTATION: 'false'",
  "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'", 'test "$GITHUB_REPOSITORY" = "SjlerAi/talk2me"',
  'test "$(git rev-list --count "$source_commit..$GITHUB_SHA")" = "1"',
  'test "$(git rev-parse "$GITHUB_SHA^")" = "$source_commit"',
  "'os2-preview/dependency-lock-provenance.json'", "'os2-preview/package-lock.json'",
  'node dependency-lock-provenance-verification.js', 'node dependency-lock-adoption-check.js',
  'node dependency-lock-verification.js', 'npm run --silent verify:workspace-source-integrity',
  'evidence.dependencyLockProvenanceProtected !== true',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check',
  'npm audit --omit=dev --audit-level=high', 'rm -rf node_modules',
  'test -z "$(git -C "$GITHUB_WORKSPACE" status --porcelain --untracked-files=all)"',
  "check: 'dependency-lock-adoption'", 'exactTwoFileCommit: true',
  'highSeverityAuditPassed: true', 'sha256sum *.json > SHA256SUMS',
  'sha256sum --check SHA256SUMS', 'if-no-files-found: error', 'retention-days: 30'
], 'Dependency lock adoption workflow');
requireOrder(adoptionWorkflow, [
  'Checkout adoption commit and parent', 'Set up Node.js 20',
  'Confirm controlled adoption event and commit shape', 'Prepare private adoption evidence directory',
  'Verify committed dependency lock provenance', 'Verify adoption governance and committed lock',
  'Capture pre-install source identity', 'Install and validate adopted dependency graph',
  'Prove source continuity and clean workspace', 'Build adoption evidence artifact', 'Upload adoption evidence'
], 'Dependency lock adoption workflow');
commonWorkflowSafety(adoptionWorkflow, 'Dependency lock adoption workflow');
validatePinnedActions(adoptionWorkflow, 'Dependency lock adoption workflow', 3);
if (adoptionWorkflow.includes('cancel-in-progress: true')) failures.push('Adoption verification must not be cancelled by a later run');

requireMarkers(lockVerifier, [
  "check: 'dependency-lock-verification'", 'meaningfulControls: 60', 'packageLockPresent: true',
  'lockfileVersionThreeRequired: true', 'registryHttpsOnlyRequired: true', 'sha512IntegrityRequired: true',
  'dependencyEdgesResolved: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Dependency lock verifier');
requireMarkers(lockGovernance, [
  "check: 'dependency-lock-governance'", 'npmCiRequired: true',
  'npmInstallSubstitutionProhibited: true', 'dependencyAuditRequired: true',
  'dependencyInstallationExecuted: false'
], 'Dependency lock governance');
requireMarkers(generationGovernance, [
  "check: 'dependency-lock-workflow-governance'", 'meaningfulControls: 60',
  'manualDispatchOnly: true', 'repositoryReadOnlyPermissionRequired: true',
  'artifactVerifierRunsBeforeUpload: true', 'automaticCommitProhibited: true'
], 'Dependency lock generation workflow governance');
requireMarkers(adoptionGovernance, [
  "check: 'dependency-lock-adoption-governance'", 'meaningfulControls: 60',
  'adoptionWorkflowReadOnlyRequired: true', 'adoptionWorkflowSingleCommitRequired: true',
  'immediateParentContinuityRequired: true', 'exactTwoFileChangeRequired: true',
  'npmCiRequired: true', 'integratedValidationRequired: true', 'highSeverityAuditRequired: true',
  'sourceInventoryContinuityRequired: true', 'cleanWorkspaceAfterValidationRequired: true'
], 'Dependency lock adoption governance');

requireMarkers(buildEvidence, [
  'validateCiIdentity()', "expectedRepository = 'SjlerAi/talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'githubActionsIdentityVerified',
  'exactRepositoryVerified', 'exactCommitShaVerified', 'exactBranchAndRefVerified',
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256',
  'workspaceSourceIntegrityStableAcrossDependencyInstall', 'secureManifestDescriptorReads: true',
  'boundedManifestCollection: true', 'artifact-manifest.json'
], 'Build evidence');
requireMarkers(sourceIntegrity, [
  "check: 'workspace-source-integrity'", 'inventorySha256', 'packageLockPresent: true',
  "['../.github/workflows/os2-preview-ci.yml', 1024 * 1024]",
  "['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024]",
  "['../.github/workflows/os2-dependency-lock-adoption.yml', 1024 * 1024]",
  'dependencyLockWorkflowProtected: files.some', 'dependencyLockAdoptionWorkflowProtected: files.some',
  'dependencyLockProvenanceProtected: files.some', 'repositoryRootContainmentRequired: true',
  'secureDescriptorReads: true', 'canonicalPathBinding: true', 'hardLinkRejection: true',
  'ownershipConsistency: true', 'boundedReads: true'
], 'Workspace source integrity');
requireMarkers(sourceGovernance, [
  "check: 'workspace-source-integrity-governance'", 'dependencyLockWorkflowProtected: verifier.includes',
  'dependencyLockAdoptionWorkflowProtected: verifier.includes',
  'dependencyLockConditionalProvenanceProtectionRequired: verifier.includes',
  'ciWorkflowProtectionRequired: true', 'environmentBoundVerifierExcludedFromNormalExecution: true'
], 'Workspace source integrity governance');
requireMarkers(runbook, [
  'controlled branch only', 'pull_request merge refs', 'push and manual `workflow_dispatch`',
  'immutable 40-character commit SHA', 'actions/checkout', 'actions/setup-node', 'actions/upload-artifact',
  'Mutable action tags, branches, and `latest` references are prohibited', 'persist-credentials: false',
  'fetch-depth: 1', 'node dependency-lock-verification.js', 'node dependency-lock-governance-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high',
  'missing lockfile is a hard failure', 'pre-install inventory digest', 'post-install inventory digest',
  'must match exactly', 'workspaceSourceIntegrityStableAcrossDependencyInstall: true',
  'secure descriptor-based reads', '`O_NOFOLLOW`', '`O_DIRECTORY`', '2,000 files', '16 MiB',
  '256 MiB', 'atomic publication', 'private `0700` evidence directory', 'private `0600` evidence files',
  'artifact-manifest.json', 'OS2 Dependency Lock Adoption',
  '.github/workflows/os2-dependency-lock-adoption.yml', 'exact two-file adoption commit',
  'dependency-lock-provenance.json', 'Production at `talk2me.uent.co.za` remains outside this workflow'
], 'CI and build evidence runbook');

if (pkg) {
  if (pkg.scripts['evidence:build'] !== 'node build-evidence.js') failures.push('Missing exact evidence:build package command');
  if (pkg.scripts['check:ci-governance'] !== 'node ci-governance-check.js') failures.push('Missing exact check:ci-governance command');
  if (pkg.scripts['check:dependency-lock-adoption'] !== 'node dependency-lock-adoption-check.js') failures.push('Missing exact adoption-governance package command');
  if (!pkg.scripts.check.includes('node ci-governance-check.js')) failures.push('CI governance must execute in normal validation');
  if (!pkg.scripts.check.includes('node dependency-lock-adoption-check.js')) failures.push('Adoption governance must execute in normal validation');
}

if (failures.length) {
  console.error('CI GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'ci-governance',
  module: 'ci-governance',
  meaningfulControls: 60,
  workflow: '.github/workflows/os2-preview-ci.yml',
  controlledBranchOnly: true,
  allowedEvents: ['push', 'workflow_dispatch'],
  pullRequestMergeRefsProhibited: true,
  pullRequestTargetProhibited: true,
  repositoryReadOnlyPermissionRequired: true,
  dependencyLockVerificationRequired: true,
  dependencyLockGovernanceRequired: true,
  missingLockIsHardFailure: true,
  npmCiRequired: true,
  npmInstallProhibited: true,
  installScriptsDisabled: true,
  dependencyAuditRequired: true,
  checkoutCredentialsPersisted: false,
  checkoutFetchDepth: 1,
  immutableActionReferencesRequired: true,
  checkoutActionPinnedSha: pinned.checkout.split('@')[1],
  setupNodeActionPinnedSha: pinned.setupNode.split('@')[1],
  uploadArtifactActionPinnedSha: pinned.uploadArtifact.split('@')[1],
  exactActionUseCountRequired: true,
  workspaceSourceIntegrityRunsBeforeDependencyInstall: true,
  sourceIntegrityStableAcrossDependencyInstallRequired: true,
  buildEvidenceBoundToWorkspaceSourceInventory: true,
  generationWorkflowGovernanceRequired: true,
  generationWorkflowManualOnly: true,
  generationWorkflowRepositoryWriteProhibited: true,
  generationArtifactVerificationBeforeUploadRequired: true,
  generationArtifactRetentionDays: 7,
  adoptionWorkflowChangesTriggerCi: true,
  adoptionWorkflowGovernanceRequired: true,
  adoptionWorkflowReadOnly: true,
  adoptionWorkflowCheckoutFetchDepth: 2,
  adoptionWorkflowSingleCommitRequired: true,
  adoptionWorkflowImmediateParentRequired: true,
  adoptionWorkflowExactTwoFileChangeRequired: true,
  adoptionProvenanceVerificationRequired: true,
  adoptionProvenanceFreshnessHours: 168,
  adoptionPackageLockVerificationRequired: true,
  adoptionPreinstallSourceIntegrityRequired: true,
  adoptionNpmCiRequired: true,
  adoptionIntegratedValidationRequired: true,
  adoptionHighSeverityAuditRequired: true,
  adoptionPostinstallSourceIntegrityRequired: true,
  adoptionCleanWorkspaceRequired: true,
  adoptionEvidenceChecksumsRequired: true,
  adoptionEvidenceRetentionDays: 30,
  adoptionAutomaticCommitProhibited: true,
  adoptionWorkflowProtectedBySourceInventory: true,
  dependencyLockProvenanceProtectedWhenPresent: true,
  normalCiArtifactRetentionDays: 30,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
