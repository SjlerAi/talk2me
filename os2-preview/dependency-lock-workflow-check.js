'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const workflowPath = path.join(root, '..', '.github', 'workflows', 'os2-dependency-lock-generation.yml');
const generatorPath = path.join(root, 'dependency-lock-generator.js');
const verifierPath = path.join(root, 'dependency-lock-verification.js');
const generatorGovernancePath = path.join(root, 'dependency-lock-generator-check.js');
const artifactVerifierPath = path.join(root, 'dependency-lock-artifact-verification.js');
const artifactGovernancePath = path.join(root, 'dependency-lock-artifact-check.js');
const runbookPath = path.join(root, 'DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md');
const artifactRunbookPath = path.join(root, 'DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md');
const failures = [];

function read(file, label) {
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${label}`);
    return '';
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) failures.push(`${label} must be a regular non-symlink file`);
  return fs.readFileSync(file, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
}
function requireOrder(source, markers, label) {
  for (let index = 1; index < markers.length; index += 1) {
    const left = source.indexOf(markers[index - 1]);
    const right = source.indexOf(markers[index]);
    if (left === -1 || right === -1 || left >= right) failures.push(`${label} order invalid at ${markers[index]}`);
  }
}

const workflow = read(workflowPath, 'dependency lock workflow');
const generator = read(generatorPath, 'dependency lock generator');
const verifier = read(verifierPath, 'dependency lock verifier');
const generatorGovernance = read(generatorGovernancePath, 'dependency lock generator governance');
const artifactVerifier = read(artifactVerifierPath, 'dependency lock artifact verifier');
const artifactGovernance = read(artifactGovernancePath, 'dependency lock artifact governance');
const runbook = read(runbookPath, 'dependency lock workflow runbook');
const artifactRunbook = read(artifactRunbookPath, 'dependency lock artifact review runbook');

requireMarkers(workflow, [
  'name: OS2 Dependency Lock Generation', 'workflow_dispatch:', 'confirmation:', 'Type GENERATE_OS2_LOCK',
  'permissions:', 'contents: read', 'cancel-in-progress: false', 'timeout-minutes: 20',
  'working-directory: os2-preview', 'DB_NAME: kloka_talk2me',
  'RELEASE_BRANCH: agent/talk2me-os2-integrated-rebuild', "ALLOW_DEPENDENCY_LOCK_GENERATION: 'true'",
  "ALLOW_PRODUCTION_MUTATION: 'false'", "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  'LOCK_ARTIFACT_ROOT: ${{ runner.temp }}/os2-dependency-lock-artifact',
  'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955', 'persist-credentials: false', 'fetch-depth: 1',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', "node-version: '20'",
  'set -euo pipefail', 'test "$GITHUB_EVENT_NAME" = "workflow_dispatch"',
  'test "$LOCK_CONFIRMATION" = "GENERATE_OS2_LOCK"', 'test "$GITHUB_REPOSITORY" = "SjlerAi/talk2me"',
  'test "$GITHUB_REF" = "refs/heads/agent/talk2me-os2-integrated-rebuild"',
  'test "$GITHUB_REF_NAME" = "agent/talk2me-os2-integrated-rebuild"', "grep -Eq '^[0-9a-f]{40}$'",
  'test ! -e package-lock.json', 'test ! -e node_modules', 'chmod 700 "$LOCK_TEMP_ROOT" "$LOCK_EVIDENCE_ROOT"',
  'case "$LOCK_TEMP_ROOT" in "$GITHUB_WORKSPACE"/*) exit 1',
  'case "$LOCK_EVIDENCE_ROOT" in "$GITHUB_WORKSPACE"/*) exit 1',
  'readlink -f "$(command -v node)"', 'readlink -f "$(command -v npm)"',
  'test "$node_major" = "20"', 'test "$npm_major" = "10"', 'node dependency-lock-generator.js',
  'test -s package-lock.json', 'test ! -e node_modules', 'dependency-lock-generation.json.sha256',
  'sha256sum --check dependency-lock-generation.json.sha256', "evidence.check !== 'dependency-lock-generation'",
  "evidence.application !== 'talk2me-os2-preview'", "evidence.database !== 'kloka_talk2me'",
  'evidence.packageLockSha256 !== digest', 'evidence.packageLockVerifiedAfterPublication !== true',
  'evidence.lifecycleScriptsExecuted !== false', 'evidence.fullParentEnvironmentInherited !== false',
  'evidence.productionMutationEnabled !== false', 'node dependency-lock-verification.js',
  'node dependency-lock-governance-check.js', 'node dependency-lock-generator-check.js',
  'node dependency-lock-workflow-check.js', 'node dependency-lock-artifact-check.js',
  'dependency-lock-artifact-governance.json', 'verify:workspace-source-integrity',
  'evidence.packageLockPresent !== true', 'npm ci --ignore-scripts --no-audit --no-fund',
  'npm run check', 'npm audit --omit=dev --audit-level=high',
  'evidence.inventorySha256 !== process.env.EXPECTED_INVENTORY_SHA256', 'rm -rf node_modules',
  'git -C "$GITHUB_WORKSPACE" status --porcelain --untracked-files=all',
  'test "$status" = "?? os2-preview/package-lock.json"', 'mkdir -p "$artifact"', 'chmod 700 "$artifact"',
  'install -m 600 package-lock.json "$artifact/package-lock.json"',
  'install -m 600 "$LOCK_EVIDENCE_ROOT"/*.json "$artifact/"',
  'install -m 600 "$LOCK_EVIDENCE_ROOT"/*.sha256 "$artifact/"',
  'source_inventory_sha256=', 'package_lock_sha256=', 'production_mutation_enabled=false',
  'merge_execution_enabled=false', 'chmod 600 "$artifact/manifest.txt"',
  'sha256sum package-lock.json *.json manifest.txt > SHA256SUMS', 'chmod 600 "$artifact/SHA256SUMS"',
  'find "$artifact" -maxdepth 1 -type f -exec chmod 600 {} +',
  'test "$(stat -c \'%a\' "$artifact")" = "700"',
  '(cd "$artifact" && sha256sum --check SHA256SUMS)',
  'Verify dependency lock review artifact', 'DEPENDENCY_LOCK_ARTIFACT_ROOT:',
  'EXPECTED_REPOSITORY: ${{ github.repository }}', 'EXPECTED_REF: ${{ github.ref }}',
  'EXPECTED_COMMIT_SHA: ${{ github.sha }}', 'EXPECTED_WORKFLOW: ${{ github.workflow }}',
  'EXPECTED_RUN_ID: ${{ github.run_id }}', 'EXPECTED_RUN_ATTEMPT: ${{ github.run_attempt }}',
  'node dependency-lock-artifact-verification.js',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'path: ${{ env.LOCK_ARTIFACT_ROOT }}', 'if-no-files-found: error', 'retention-days: 7'
], 'dependency lock workflow');

requireOrder(workflow, [
  'Checkout controlled branch', 'Set up Node.js 20', 'Confirm manual event and immutable source identity',
  'Prepare private generation directories', 'Resolve controlled Node and npm binaries',
  'Run controlled dependency lock generator', 'Verify private generation evidence',
  'Run lock and workflow governance', 'Capture pre-install protected source identity',
  'Install and validate generated lock', 'Prove source continuity after installation',
  'Build review artifact', 'Verify dependency lock review artifact', 'Upload dependency lock review artifact'
], 'dependency lock workflow');

if (/\bpush:\s*$/m.test(workflow)) failures.push('Dependency lock workflow must not run on push');
if (/\bpull_request:\s*$/m.test(workflow)) failures.push('Dependency lock workflow must not run on pull_request');
if (workflow.includes('contents: write')) failures.push('Dependency lock workflow must not receive contents write permission');
if (workflow.includes('persist-credentials: true')) failures.push('Checkout credentials must not persist');
if (workflow.includes('npm install ')) failures.push('Workflow must not use uncontrolled npm install');
if (workflow.includes('shell: pwsh') || workflow.includes('shell: cmd')) failures.push('Workflow must use the controlled bash execution path');
if (workflow.includes('continue-on-error: true')) failures.push('Workflow must fail closed');
if (workflow.includes('cancel-in-progress: true')) failures.push('Lock generation must not be cancelled by a later run');
if (workflow.includes('retention-days: 30')) failures.push('Lock review artifact retention must remain short');
if (!workflow.includes('git -C "$GITHUB_WORKSPACE" status --porcelain --untracked-files=all')) failures.push('Workflow must prove only package-lock.json changed from repository root');
if (!workflow.includes('(cd "$artifact" && sha256sum --check SHA256SUMS)')) failures.push('Artifact checksums must be verified from the artifact directory');
if (!workflow.includes('dependency-lock-workflow-check.js')) failures.push('Workflow must self-govern before artifact publication');
if (!workflow.includes('dependency-lock-artifact-check.js')) failures.push('Workflow must govern the artifact verifier before artifact publication');
if (workflow.indexOf('node dependency-lock-artifact-verification.js') >= workflow.indexOf('Upload dependency lock review artifact')) failures.push('Artifact verifier must run before upload');

requireMarkers(generator, [
  "expectedNodeMajor = 20", 'expectedNpmMajor = 10', "expectedRegistry = 'https://registry.npmjs.org/'",
  'process.env.ALLOW_DEPENDENCY_LOCK_GENERATION', 'publishExclusive(lockPath, candidate.bytes, 0o644',
  'packageLockVerifiedAfterPublication: true', 'fullParentEnvironmentInherited: false',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'dependency lock generator');
requireMarkers(verifier, [
  "check: 'dependency-lock-verification'", 'meaningfulControls: 60', 'packageLockPresent: true',
  'lockfileVersionThreeRequired: true', 'dependencyEdgesResolved: true'
], 'dependency lock verifier');
requireMarkers(generatorGovernance, [
  "check: 'dependency-lock-generator-governance'", 'meaningfulControls: 60',
  'exclusiveNoOverwritePublicationRequired: true', 'environmentChangingGeneratorExcludedFromNormalValidation: true'
], 'dependency lock generator governance');
requireMarkers(artifactVerifier, [
  "check: 'dependency-lock-artifact-verification'", 'meaningfulControls: 60',
  'exactFileSetVerified: true', 'exactChecksumCoverageVerified: true',
  'sourceInventoryContinuityVerified: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'dependency lock artifact verifier');
requireMarkers(artifactGovernance, [
  "check: 'dependency-lock-artifact-governance'", 'meaningfulControls: 60',
  'readOnlyVerificationRequired: true', 'artifactVerificationBeforeUploadRequired: true'
], 'dependency lock artifact governance');
requireMarkers(runbook, [
  'OS2 Dependency Lock Generation Workflow', 'GENERATE_OS2_LOCK', 'workflow_dispatch',
  'read-only repository permission', 'does not commit', 'seven days', 'package-lock.json',
  'SHA256SUMS', 'GitHub Issue #83', 'production remains untouched'
], 'dependency lock workflow runbook');
requireMarkers(artifactRunbook, [
  'Dependency Lock Artifact Review', 'exact 13-file set', 'dependency-lock-artifact-verification.js',
  'private `0700` directory', 'private `0600` files', 'source inventory continuity',
  'GitHub Issue #83', 'production remains untouched'
], 'dependency lock artifact runbook');

if (failures.length) {
  console.error('DEPENDENCY LOCK WORKFLOW GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-workflow-governance',
  meaningfulControls: 60,
  manualDispatchOnly: true,
  exactConfirmationRequired: true,
  repositoryReadOnlyPermissionRequired: true,
  concurrencyCancellationDisabled: true,
  workflowTimeoutMinutes: 20,
  exactControlledRepositoryRequired: true,
  exactControlledBranchRequired: true,
  exactCommitShaRequired: true,
  checkoutActionPinned: true,
  checkoutCredentialsPersisted: false,
  shallowCheckoutRequired: true,
  setupNodeActionPinned: true,
  node20Required: true,
  npm10Required: true,
  existingLockProhibited: true,
  existingNodeModulesProhibited: true,
  productionMutationDisabled: true,
  mergeExecutionDisabled: true,
  privateRunnerTempRequired: true,
  privateRunnerEvidenceRequired: true,
  sourceTreeTempProhibited: true,
  sourceTreeEvidenceProhibited: true,
  canonicalNodeBinaryRequired: true,
  canonicalNpmBinaryRequired: true,
  controlledGeneratorRequired: true,
  generationEvidenceRequired: true,
  generationEvidenceChecksumRequired: true,
  generationEvidenceIdentityRequired: true,
  generatedLockDigestBindingRequired: true,
  independentPostPublicationVerificationRequired: true,
  lifecycleScriptsExecuted: false,
  nodeModulesGeneratedDuringGeneration: false,
  fullParentEnvironmentInherited: false,
  registryPinEvidenceRequired: true,
  lockVerifierRequired: true,
  lockGovernanceRequired: true,
  generatorGovernanceRequired: true,
  workflowSelfGovernanceRequired: true,
  artifactGovernanceRequired: true,
  preinstallSourceIntegrityRequired: true,
  committedLockPresenceEvidenceRequired: true,
  npmCiRequired: true,
  npmInstallSubstitutionProhibited: true,
  integratedValidationRequired: true,
  highSeverityAuditRequired: true,
  postinstallSourceIntegrityRequired: true,
  sourceInventoryContinuityRequired: true,
  nodeModulesCleanupRequired: true,
  repositoryRootStatusRequired: true,
  packageLockOnlyWorkspaceChangeRequired: true,
  artifactManifestRequired: true,
  repositoryIdentityInManifestRequired: true,
  commitIdentityInManifestRequired: true,
  sourceDigestInManifestRequired: true,
  lockDigestInManifestRequired: true,
  artifactPrivateDirectoryRequired: true,
  artifactPrivateFilesRequired: true,
  artifactChecksumsRequired: true,
  artifactChecksumDirectoryBindingRequired: true,
  artifactChecksumVerificationRequired: true,
  artifactVerifierRequired: true,
  artifactVerifierRunsBeforeUpload: true,
  uploadArtifactActionPinned: true,
  missingArtifactFilesAreFatal: true,
  artifactRetentionDays: 7,
  automaticCommitProhibited: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
