'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
function read(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${relativePath}`);
    return '';
  }
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

const preflight = read('preview-activation-preflight.js');
const lockVerifier = read('dependency-lock-verification.js');
const lockGovernance = read('dependency-lock-governance-check.js');
const generator = read('dependency-lock-generator.js');
const generatorGovernance = read('dependency-lock-generator-check.js');
const workflowGovernance = read('dependency-lock-workflow-check.js');
const sourceIntegrity = read('workspace-source-integrity.js');
const sourceGovernance = read('workspace-source-integrity-check.js');
const lockWorkflow = read('../.github/workflows/os2-dependency-lock-generation.yml');
const ciWorkflow = read('../.github/workflows/os2-preview-ci.yml');
const activationRunbook = read('PREVIEW_ACTIVATION_RUNBOOK.md');
const generationRunbook = read('DEPENDENCY_LOCK_GENERATION_RUNBOOK.md');
const workflowRunbook = read('DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md');
const pkg = JSON.parse(read('package.json'));

requireMarkers(preflight, [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'childTimeoutMs = 30000',
  "'dependency-lock-verification.js'",
  "'dependency-lock-governance-check.js'",
  "'dependency-lock-generator-check.js'",
  "'dependency-lock-workflow-check.js'",
  "'workspace-source-integrity.js'",
  'dependencyLockVerified: true',
  'dependencyLockGovernanceVerified: true',
  'dependencyLockGeneratorGovernanceVerified: true',
  'dependencyLockWorkflowGovernanceVerified: true',
  'dependencyLockGenerationWorkflowExecuted: false',
  'dependencyLockGenerationExecuted: false',
  'dependencyInstallationExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'preview activation preflight');
requireOrder(preflight, [
  "'workspace-topology-verification.js'",
  "'dependency-lock-verification.js'",
  "'dependency-lock-governance-check.js'",
  "'dependency-lock-generator-check.js'",
  "'dependency-lock-workflow-check.js'",
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'"
], 'preview activation preflight');
if (preflight.includes('...process.env')) failures.push('Preflight must not inherit the full parent environment');
if (!preflight.includes("killSignal: 'SIGKILL'")) failures.push('Preflight must force SIGKILL on timeout');
if (!preflight.includes('shell: false')) failures.push('Preflight child shell execution must be disabled');
if (!preflight.includes('Object.freeze(childEnv)')) failures.push('Preflight child environment must be frozen');

requireMarkers(lockVerifier, [
  "check: 'dependency-lock-verification'",
  'meaningfulControls: 60',
  'packageLockPresent: true',
  'lockfileVersionThreeRequired: true',
  'registryHttpsOnlyRequired: true',
  'sha512IntegrityRequired: true',
  'dependencyEdgesResolved: true'
], 'dependency lock verifier');
requireMarkers(lockGovernance, [
  "check: 'dependency-lock-governance'",
  'meaningfulControls: 60',
  'npmCiRequired: true',
  'npmInstallSubstitutionProhibited: true',
  'dependencyAuditRequired: true',
  'dependencyInstallationExecuted: false'
], 'dependency lock governance');
requireMarkers(generator, [
  "expectedNodeMajor = 20",
  'expectedNpmMajor = 10',
  "expectedRegistry = 'https://registry.npmjs.org/'",
  'process.env.ALLOW_DEPENDENCY_LOCK_GENERATION',
  'publishExclusive(lockPath, candidate.bytes, 0o644',
  'packageLockVerifiedAfterPublication: true',
  'fullParentEnvironmentInherited: false'
], 'dependency lock generator');
requireMarkers(generatorGovernance, [
  "check: 'dependency-lock-generator-governance'",
  'meaningfulControls: 60',
  'exclusiveNoOverwritePublicationRequired: true',
  'environmentChangingGeneratorExcludedFromNormalValidation: true'
], 'dependency lock generator governance');
requireMarkers(workflowGovernance, [
  "check: 'dependency-lock-workflow-governance'",
  'meaningfulControls: 60',
  'manualDispatchOnly: true',
  'repositoryReadOnlyPermissionRequired: true',
  'automaticCommitProhibited: true',
  'artifactRetentionDays: 7'
], 'dependency lock workflow governance');

requireMarkers(lockWorkflow, [
  'name: OS2 Dependency Lock Generation',
  'workflow_dispatch:',
  'contents: read',
  'cancel-in-progress: false',
  'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'test "$LOCK_CONFIRMATION" = "GENERATE_OS2_LOCK"',
  'node dependency-lock-generator.js',
  'node dependency-lock-workflow-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'npm audit --omit=dev --audit-level=high',
  'test "$status" = "?? os2-preview/package-lock.json"',
  'retention-days: 7'
], 'dependency lock workflow');
if (/\bpush:\s*$/m.test(lockWorkflow)) failures.push('Lock workflow must remain manual-only');
if (/\bpull_request:\s*$/m.test(lockWorkflow)) failures.push('Lock workflow must not run for pull requests');
if (lockWorkflow.includes('contents: write')) failures.push('Lock workflow must not have repository write permission');
if (lockWorkflow.includes('persist-credentials: true')) failures.push('Lock workflow checkout credentials must not persist');
if (lockWorkflow.includes('continue-on-error: true')) failures.push('Lock workflow must fail closed');
if (lockWorkflow.includes('npm install ')) failures.push('Lock workflow must not use npm install');

requireMarkers(sourceIntegrity, [
  "['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024]",
  "['dependency-lock-workflow-check.js', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md', 2 * 1024 * 1024]",
  'dependencyLockWorkflowGovernanceProtected: files.some',
  'dependencyLockWorkflowRunbookProtected: files.some',
  'dependencyLockWorkflowProtected: files.some'
], 'workspace source integrity');
requireMarkers(sourceGovernance, [
  'dependencyLockWorkflowGovernanceProtected: verifier.includes',
  'dependencyLockWorkflowRunbookProtected: verifier.includes',
  'dependencyLockWorkflowProtected: verifier.includes',
  'dependencyLockWorkflowGovernancePreflightRegistrationRequired: true',
  'manualLockWorkflowExecutionExcludedFromNormalValidation: true'
], 'workspace source governance');

requireMarkers(ciWorkflow, [
  'name: OS2 Preview CI',
  'contents: read',
  'node dependency-lock-verification.js',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'npm audit --omit=dev --audit-level=high'
], 'preview CI workflow');
requireMarkers(activationRunbook, [
  'Dependency lock generation',
  'dependency-lock-generator-check.js',
  'package-lock.json',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'activation runbook');
requireMarkers(generationRunbook, [
  'Controlled Dependency Lock Generation',
  'ALLOW_DEPENDENCY_LOCK_GENERATION=true',
  'Node.js 20',
  'npm 10',
  'private evidence pair'
], 'generation runbook');
requireMarkers(workflowRunbook, [
  'OS2 Dependency Lock Generation Workflow',
  'GENERATE_OS2_LOCK',
  'workflow_dispatch',
  'does not commit',
  'seven days',
  'GitHub Issue #83'
], 'workflow runbook');

if (pkg.scripts['verify:preview-activation-preflight'] !== 'node preview-activation-preflight.js') failures.push('Exact preview activation command missing');
if (pkg.scripts['check:preview-activation-governance'] !== 'node preview-activation-governance-check.js') failures.push('Exact activation governance command missing');
if (!pkg.scripts.check.includes('node --check preview-activation-preflight.js')) failures.push('Preflight syntax check missing');
if (!pkg.scripts.check.includes('node --check preview-activation-governance-check.js')) failures.push('Activation governance syntax check missing');
if (!pkg.scripts.check.includes('node preview-activation-governance-check.js')) failures.push('Activation governance execution missing');
if (pkg.scripts.check.includes('node dependency-lock-generator.js')) failures.push('Environment-changing lock generation must not run in normal validation');

if (failures.length) {
  console.error('PREVIEW ACTIVATION GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-governance',
  application: pkg.name,
  version: pkg.version,
  orderedSourceChecks: 23,
  activationChildExecutionBounded: true,
  activationChildTimeoutMs: 30000,
  activationChildForcedKillSignalRequired: true,
  activationChildShellExecutionDisabled: true,
  completeParentEnvironmentInheritanceProhibited: true,
  childEnvironmentAllowlistRequired: true,
  childEnvironmentFrozenRequired: true,
  previewRootForced: true,
  previewDatabaseForced: true,
  releaseBranchForced: true,
  productionMutationDisabledInChildren: true,
  mergeExecutionDisabledInChildren: true,
  dependencyLockVerificationRequired: true,
  dependencyLockGovernanceRequired: true,
  dependencyLockGeneratorGovernanceRequired: true,
  dependencyLockWorkflowGovernanceRequired: true,
  dependencyLockWorkflowManualOnly: true,
  dependencyLockWorkflowRepositoryWriteProhibited: true,
  dependencyLockWorkflowAutomaticCommitProhibited: true,
  dependencyLockWorkflowArtifactRetentionDays: 7,
  dependencyLockGenerationWorkflowExecuted: false,
  dependencyLockGenerationExecuted: false,
  dependencyInstallationExecuted: false,
  workspaceSourceIntegrityRequired: true,
  recoveryReadinessRequired: true,
  recoveryReleaseGateRequired: true,
  releaseSourceIntegrityGovernanceRequired: true,
  releaseManifestGovernanceRequired: true,
  databaseBackedVerificationExecuted: false,
  backupRuntimeExecuted: false,
  backupVerificationExecuted: false,
  restoreTestExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
