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
const artifactVerifier = read('dependency-lock-artifact-verification.js');
const artifactGovernance = read('dependency-lock-artifact-check.js');
const provenanceVerifier = read('dependency-lock-provenance-verification.js');
const adoptionMaterializer = read('dependency-lock-adoption-materializer.js');
const adoptionGovernance = read('dependency-lock-adoption-check.js');
const sourceIntegrity = read('workspace-source-integrity.js');
const sourceGovernance = read('workspace-source-integrity-check.js');
const lockWorkflow = read('../.github/workflows/os2-dependency-lock-generation.yml');
const adoptionWorkflow = read('../.github/workflows/os2-dependency-lock-adoption.yml');
const ciWorkflow = read('../.github/workflows/os2-preview-ci.yml');
const activationRunbook = read('PREVIEW_ACTIVATION_RUNBOOK.md');
const generationRunbook = read('DEPENDENCY_LOCK_GENERATION_RUNBOOK.md');
const workflowRunbook = read('DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md');
const artifactRunbook = read('DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md');
const adoptionRunbook = read('DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md');
const pkg = JSON.parse(read('package.json'));

requireMarkers(preflight, [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20', 'childTimeoutMs = 30000', "'dependency-lock-verification.js'",
  "'dependency-lock-governance-check.js'", "'dependency-lock-generator-check.js'",
  "'dependency-lock-workflow-check.js'", "'dependency-lock-artifact-check.js'",
  "'dependency-lock-adoption-check.js'", "'workspace-source-integrity.js'",
  'dependencyLockVerified: true', 'dependencyLockGovernanceVerified: true',
  'dependencyLockGeneratorGovernanceVerified: true', 'dependencyLockWorkflowGovernanceVerified: true',
  'dependencyLockArtifactGovernanceVerified: true', 'dependencyLockAdoptionGovernanceVerified: true',
  'dependencyLockProvenanceVerificationExecuted: false', 'dependencyLockAdoptionMaterializationExecuted: false',
  'dependencyLockArtifactVerificationExecuted: false', 'dependencyLockGenerationWorkflowExecuted: false',
  'dependencyLockGenerationExecuted: false', 'dependencyInstallationExecuted: false',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'preview activation preflight');
requireOrder(preflight, [
  "'workspace-topology-verification.js'", "'dependency-lock-verification.js'",
  "'dependency-lock-governance-check.js'", "'dependency-lock-generator-check.js'",
  "'dependency-lock-workflow-check.js'", "'dependency-lock-artifact-check.js'",
  "'dependency-lock-adoption-check.js'", "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'", "'runtime-release-identity-check.js'",
  "'readiness-check.js'", "'deployment-check.js'", "'uat-gate-check.js'", "'release-manifest-check.js'"
], 'preview activation preflight');
if (preflight.includes('...process.env')) failures.push('Preflight must not inherit the full parent environment');
if (!preflight.includes("killSignal: 'SIGKILL'")) failures.push('Preflight must force SIGKILL on timeout');
if (!preflight.includes('shell: false')) failures.push('Preflight child shell execution must be disabled');
if (!preflight.includes('Object.freeze(childEnv)')) failures.push('Preflight child environment must be frozen');

requireMarkers(lockVerifier, [
  "check: 'dependency-lock-verification'", 'meaningfulControls: 60', 'packageLockPresent: true',
  'lockfileVersionThreeRequired: true', 'registryHttpsOnlyRequired: true', 'sha512IntegrityRequired: true',
  'dependencyEdgesResolved: true'
], 'dependency lock verifier');
requireMarkers(lockGovernance, [
  "check: 'dependency-lock-governance'", 'meaningfulControls: 60', 'npmCiRequired: true',
  'npmInstallSubstitutionProhibited: true', 'dependencyAuditRequired: true', 'dependencyInstallationExecuted: false'
], 'dependency lock governance');
requireMarkers(generator, [
  'expectedNodeMajor = 20', 'expectedNpmMajor = 10', "expectedRegistry = 'https://registry.npmjs.org/'",
  'process.env.ALLOW_DEPENDENCY_LOCK_GENERATION', 'publishExclusive(lockPath, candidate.bytes, 0o644',
  'packageLockVerifiedAfterPublication: true', 'fullParentEnvironmentInherited: false'
], 'dependency lock generator');
requireMarkers(generatorGovernance, [
  "check: 'dependency-lock-generator-governance'", 'meaningfulControls: 60',
  'exclusiveNoOverwritePublicationRequired: true', 'environmentChangingGeneratorExcludedFromNormalValidation: true'
], 'dependency lock generator governance');
requireMarkers(workflowGovernance, [
  "check: 'dependency-lock-workflow-governance'", 'meaningfulControls: 60', 'manualDispatchOnly: true',
  'repositoryReadOnlyPermissionRequired: true', 'artifactVerifierRequired: true',
  'artifactVerifierRunsBeforeUpload: true', 'automaticCommitProhibited: true', 'artifactRetentionDays: 7'
], 'dependency lock workflow governance');
requireMarkers(artifactVerifier, [
  "check: 'dependency-lock-artifact-verification'", 'meaningfulControls: 60',
  'exactFileSetVerified: true', 'exactChecksumCoverageVerified: true',
  'sourceInventoryContinuityVerified: true', 'secretFieldsRejected: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'dependency lock artifact verifier');
requireMarkers(artifactGovernance, [
  "check: 'dependency-lock-artifact-governance'", 'meaningfulControls: 60',
  'readOnlyVerificationRequired: true', 'artifactVerificationBeforeUploadRequired: true',
  'environmentBoundArtifactVerifierExcludedFromNormalExecution: true'
], 'dependency lock artifact governance');
requireMarkers(provenanceVerifier, [
  "check: 'dependency-lock-provenance-verification'", 'meaningfulControls: 60',
  'exactProvenanceSchemaVerified: true', 'sourceCommitContinuityVerified: true',
  'provenanceFreshnessVerified: true', 'packageLockDigestVerified: true',
  'secretFieldsRejected: true', 'automaticCommit: false',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'dependency lock provenance verifier');
requireMarkers(adoptionMaterializer, [
  "check: 'dependency-lock-adoption-materialization'", 'meaningfulControls: 60',
  'artifactVerifierPassed: true', 'exclusiveNoOverwritePublication: true',
  'packageLockPublished: true', 'provenancePublished: true',
  'automaticCommit: false', 'gitMutationExecuted: false'
], 'dependency lock adoption materializer');
requireMarkers(adoptionGovernance, [
  "check: 'dependency-lock-adoption-governance'", 'meaningfulControls: 60',
  'adoptionWorkflowReadOnlyRequired: true', 'adoptionWorkflowSingleCommitRequired: true',
  'immediateParentContinuityRequired: true', 'exactTwoFileChangeRequired: true',
  'environmentChangingAdoptionExcludedFromNormalValidation: true'
], 'dependency lock adoption governance');

requireMarkers(lockWorkflow, [
  'name: OS2 Dependency Lock Generation', 'workflow_dispatch:', 'contents: read', 'cancel-in-progress: false',
  'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
  'test "$LOCK_CONFIRMATION" = "GENERATE_OS2_LOCK"', 'node dependency-lock-generator.js',
  'node dependency-lock-workflow-check.js', 'node dependency-lock-artifact-check.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high',
  'test "$status" = "?? os2-preview/package-lock.json"', 'chmod 700 "$artifact"',
  'find "$artifact" -maxdepth 1 -type f -exec chmod 600 {} +',
  'node dependency-lock-artifact-verification.js', 'retention-days: 7'
], 'dependency lock workflow');
if (/\bpush:\s*$/m.test(lockWorkflow)) failures.push('Lock workflow must remain manual-only');
if (/\bpull_request:\s*$/m.test(lockWorkflow)) failures.push('Lock workflow must not run for pull requests');
if (lockWorkflow.includes('contents: write')) failures.push('Lock workflow must not have repository write permission');
if (lockWorkflow.includes('persist-credentials: true')) failures.push('Lock workflow checkout credentials must not persist');
if (lockWorkflow.includes('continue-on-error: true')) failures.push('Lock workflow must fail closed');
if (lockWorkflow.includes('npm install ')) failures.push('Lock workflow must not use npm install');
if (lockWorkflow.indexOf('Verify dependency lock review artifact') >= lockWorkflow.indexOf('Upload dependency lock review artifact')) failures.push('Artifact verification must precede upload');

requireMarkers(adoptionWorkflow, [
  'name: OS2 Dependency Lock Adoption', 'push:', 'workflow_dispatch:', 'contents: read',
  'cancel-in-progress: false', 'fetch-depth: 2', 'persist-credentials: false',
  "PROVENANCE_MAX_AGE_HOURS: '168'", 'test "$(git rev-list --count "$source_commit..$GITHUB_SHA")" = "1"',
  'test "$(git rev-parse "$GITHUB_SHA^")" = "$source_commit"',
  "'os2-preview/dependency-lock-provenance.json'", "'os2-preview/package-lock.json'",
  'node dependency-lock-provenance-verification.js', 'node dependency-lock-adoption-check.js',
  'node dependency-lock-verification.js', 'npm ci --ignore-scripts --no-audit --no-fund',
  'npm run check', 'npm audit --omit=dev --audit-level=high', 'rm -rf node_modules',
  'test -z "$(git -C "$GITHUB_WORKSPACE" status --porcelain --untracked-files=all)"',
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f', 'retention-days: 30'
], 'dependency lock adoption workflow');
if (adoptionWorkflow.includes('contents: write')) failures.push('Adoption workflow must not have repository write permission');
if (adoptionWorkflow.includes('persist-credentials: true')) failures.push('Adoption workflow checkout credentials must not persist');
if (adoptionWorkflow.includes('continue-on-error: true')) failures.push('Adoption workflow must fail closed');
if (adoptionWorkflow.includes('npm install ')) failures.push('Adoption workflow must not use npm install');
if (adoptionWorkflow.includes('cancel-in-progress: true')) failures.push('Adoption workflow must not cancel an in-progress verification');

requireMarkers(sourceIntegrity, [
  "['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024]",
  "['../.github/workflows/os2-dependency-lock-adoption.yml', 1024 * 1024]",
  "['dependency-lock-workflow-check.js', 2 * 1024 * 1024]",
  "['dependency-lock-artifact-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-artifact-check.js', 2 * 1024 * 1024]",
  "['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-check.js', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024]",
  'dependencyLockProvenanceProtected: files.some',
  'dependencyLockAdoptionWorkflowProtected: files.some'
], 'workspace source integrity');
requireMarkers(sourceGovernance, [
  'dependencyLockProvenanceVerifierProtected: verifier.includes',
  'dependencyLockAdoptionMaterializerProtected: verifier.includes',
  'dependencyLockAdoptionGovernanceProtected: verifier.includes',
  'dependencyLockConditionalProvenanceProtectionRequired: verifier.includes',
  'dependencyLockAdoptionRunbookProtected: verifier.includes',
  'dependencyLockAdoptionWorkflowProtected: verifier.includes',
  'dependencyLockAdoptionGovernancePreflightRegistrationRequired: true',
  'environmentChangingAdoptionMaterializerExcludedFromNormalExecution: true'
], 'workspace source governance');

requireMarkers(ciWorkflow, [
  'name: OS2 Preview CI', 'contents: read', 'node dependency-lock-verification.js',
  '.github/workflows/os2-dependency-lock-adoption.yml',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high'
], 'preview CI workflow');
requireMarkers(activationRunbook, [
  'Dependency lock generation', 'Dependency lock artifact verification', 'Dependency lock adoption',
  'dependency-lock-generator-check.js', 'dependency-lock-artifact-check.js', 'dependency-lock-adoption-check.js',
  'DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 'DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md',
  'package-lock.json', 'dependency-lock-provenance.json',
  'npm ci --ignore-scripts --no-audit --no-fund', 'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'activation runbook');
requireMarkers(generationRunbook, [
  'Controlled Dependency Lock Generation', 'ALLOW_DEPENDENCY_LOCK_GENERATION=true',
  'Node.js 20', 'npm 10', 'private evidence pair'
], 'generation runbook');
requireMarkers(workflowRunbook, [
  'OS2 Dependency Lock Generation Workflow', 'GENERATE_OS2_LOCK', 'workflow_dispatch',
  'does not commit', 'seven days', 'GitHub Issue #83'
], 'workflow runbook');
requireMarkers(artifactRunbook, [
  'Dependency Lock Artifact Review', 'exact 13-file set', 'dependency-lock-artifact-verification.js',
  'private `0700` directory', 'private `0600` files', 'source inventory continuity',
  'GitHub Issue #83', 'production remains untouched'
], 'artifact runbook');
requireMarkers(adoptionRunbook, [
  'Dependency Lock Adoption', 'dependency-lock-adoption-materializer.js',
  'dependency-lock-provenance-verification.js', 'exact 15-field schema',
  'exactly these two paths in one commit', 'immediate child of the recorded generation source commit',
  'OS2 Dependency Lock Adoption', '168 hours', 'GitHub Issue #83'
], 'adoption runbook');

const exactScripts = {
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'check:preview-activation-governance': 'node preview-activation-governance-check.js',
  'verify:dependency-lock-artifact': 'node dependency-lock-artifact-verification.js',
  'check:dependency-lock-artifact': 'node dependency-lock-artifact-check.js',
  'materialize:dependency-lock-adoption': 'node dependency-lock-adoption-materializer.js',
  'verify:dependency-lock-provenance': 'node dependency-lock-provenance-verification.js',
  'check:dependency-lock-adoption': 'node dependency-lock-adoption-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts[name] !== command) failures.push(`Exact ${name} command missing`);
for (const marker of [
  'node --check preview-activation-preflight.js', 'node --check preview-activation-governance-check.js',
  'node --check dependency-lock-artifact-verification.js', 'node --check dependency-lock-artifact-check.js',
  'node --check dependency-lock-provenance-verification.js', 'node --check dependency-lock-adoption-materializer.js',
  'node --check dependency-lock-adoption-check.js', 'node dependency-lock-artifact-check.js',
  'node dependency-lock-adoption-check.js', 'node preview-activation-governance-check.js'
]) if (!pkg.scripts.check.includes(marker)) failures.push(`Normal validation missing ${marker}`);
if (pkg.scripts.check.includes('node dependency-lock-generator.js &&')) failures.push('Environment-changing lock generation must not run in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-artifact-verification.js &&')) failures.push('Environment-bound artifact verification must not run in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-adoption-materializer.js &&')) failures.push('Environment-changing adoption materialization must not run in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-provenance-verification.js &&')) failures.push('Environment-bound provenance verification must not run in normal validation');

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
  orderedSourceChecks: 25,
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
  dependencyLockArtifactGovernanceRequired: true,
  dependencyLockAdoptionGovernanceRequired: true,
  dependencyLockProvenanceVerificationExecuted: false,
  dependencyLockAdoptionMaterializationExecuted: false,
  dependencyLockArtifactVerificationExecuted: false,
  dependencyLockWorkflowManualOnly: true,
  dependencyLockWorkflowRepositoryWriteProhibited: true,
  dependencyLockWorkflowAutomaticCommitProhibited: true,
  dependencyLockWorkflowArtifactRetentionDays: 7,
  dependencyLockAdoptionWorkflowReadOnly: true,
  dependencyLockAdoptionSingleCommitRequired: true,
  dependencyLockAdoptionExactTwoFileChangeRequired: true,
  dependencyLockGenerationWorkflowExecuted: false,
  dependencyLockGenerationExecuted: false,
  dependencyInstallationExecuted: false,
  workspaceSourceIntegrityRequired: true,
  dependencyLockAdoptionSourcesProtected: true,
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
