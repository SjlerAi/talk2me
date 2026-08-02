'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
function requireMarkers(source, markers, label) { for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`); }

requireMarkers(verifier, [
  "const repositoryRoot = path.resolve(root, '..')", 'path.resolve(root, relativePath)',
  'Protected source escapes the repository root:', 'Repository root must be a real directory',
  'Repository and application roots must share an owner', 'repositoryRootContainmentRequired: true',
  'parentWorkflowPathsResolvedCanonically: true', 'repositoryApplicationOwnerConsistency: true',
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'expectedNodeMajor = 20',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW', 'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1', 'descriptorStat.size !== pathStat.size || descriptorStat.mtimeMs !== pathStat.mtimeMs',
  'bytes.length !== descriptorStat.size', 'crypto.createHash(\'sha256\')',
  "['../.github/workflows/os2-preview-ci.yml', 1024 * 1024]",
  "['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024]",
  "['../.github/workflows/os2-dependency-lock-adoption.yml', 1024 * 1024]",
  "['package-lock.json', 16 * 1024 * 1024]", "['dependency-lock-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-governance-check.js', 2 * 1024 * 1024]", "['dependency-lock-generator.js', 2 * 1024 * 1024]",
  "['dependency-lock-generator-check.js', 2 * 1024 * 1024]", "['dependency-lock-workflow-check.js', 2 * 1024 * 1024]",
  "['dependency-lock-artifact-verification.js', 2 * 1024 * 1024]", "['dependency-lock-artifact-check.js', 2 * 1024 * 1024]",
  "['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]", "['dependency-lock-adoption-check.js', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_GENERATION_RUNBOOK.md', 2 * 1024 * 1024]", "['DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 2 * 1024 * 1024]", "['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024]",
  "if (fs.existsSync(provenancePath)) protectedFiles.push(['dependency-lock-provenance.json', 64 * 1024])",
  "['workspace-source-integrity.js', 2 * 1024 * 1024]", "['workspace-source-integrity-check.js', 2 * 1024 * 1024]",
  "['workspace-topology-governance-check.js', 2 * 1024 * 1024]", "['preview-activation-governance-check.js', 2 * 1024 * 1024]",
  "['build-evidence.js', 2 * 1024 * 1024]", "['ci-governance-check.js', 2 * 1024 * 1024]",
  "['release-source-integrity-verification.js', 2 * 1024 * 1024]", "['release-source-integrity-check.js', 2 * 1024 * 1024]",
  "['release-manifest-check.js', 2 * 1024 * 1024]", "['backup-runner.js', 2 * 1024 * 1024]",
  "['backup-verification.js', 2 * 1024 * 1024]", "['restore-test-runner.js', 2 * 1024 * 1024]",
  "['restore-test-governance-check.js', 2 * 1024 * 1024]", "['restore-test-integration-check.js', 2 * 1024 * 1024]",
  "['recovery-readiness-check.js', 2 * 1024 * 1024]", "['recovery-release-gate.js', 2 * 1024 * 1024]",
  "['BACKUP_AND_RECOVERY_RUNBOOK.md', 2 * 1024 * 1024]", "['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]",
  'Unexpected migrations directory entry:', 'Protected source inventory contains duplicate paths', 'canonicalInventory', 'inventorySha256',
  'packageLockPresent: true', 'selfProtected: files.some', 'governanceProtected: files.some',
  'dependencyLockVerifierProtected: files.some', 'dependencyLockGovernanceProtected: files.some',
  'dependencyLockGeneratorProtected: files.some', 'dependencyLockGeneratorGovernanceProtected: files.some',
  'dependencyLockWorkflowGovernanceProtected: files.some', 'dependencyLockArtifactVerifierProtected: files.some',
  'dependencyLockArtifactGovernanceProtected: files.some', 'dependencyLockProvenanceVerifierProtected: files.some',
  'dependencyLockAdoptionMaterializerProtected: files.some', 'dependencyLockAdoptionGovernanceProtected: files.some',
  'dependencyLockProvenanceProtected: files.some', 'dependencyLockGenerationRunbookProtected: files.some',
  'dependencyLockWorkflowRunbookProtected: files.some', 'dependencyLockArtifactRunbookProtected: files.some',
  'dependencyLockAdoptionRunbookProtected: files.some', 'dependencyLockWorkflowProtected: files.some',
  'dependencyLockAdoptionWorkflowProtected: files.some', 'activationGovernanceProtected: files.some',
  'ciWorkflowProtected: files.some', 'ciEvidenceControlsProtected: files.some', 'releaseGovernanceProtected: files.some',
  'backupRunnerProtected: files.some', 'backupVerificationProtected: files.some', 'restoreRunnerProtected: files.some',
  'restoreGovernanceProtected: files.some', 'restoreIntegrationProtected: files.some', 'recoveryReadinessProtected: files.some',
  'recoveryReleaseGateProtected: files.some', 'recoveryRunbookProtected: files.some', 'conditionalProvenanceProtectionRequired: true',
  'duplicatePathsRejected: true', 'secureDescriptorReads: true', 'pathAndDescriptorMetadataBound: true',
  'exactReadByteCountRequired: true', 'canonicalPathBinding: true', 'hardLinkRejection: true',
  'ownershipConsistency: true', 'boundedReads: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Workspace source integrity verifier');

if (verifier.includes("const file = path.join(root, relativePath)")) throw new Error('Protected parent workflow paths must not use non-canonical path.join resolution');
if (verifier.includes("if (fs.existsSync(path.join(root, 'package-lock.json')))")) throw new Error('package-lock.json must be mandatory, not conditionally protected');

requireMarkers(preflight, [
  "'workspace-topology-verification.js'", "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  "'dependency-lock-generator-check.js'", "'dependency-lock-workflow-check.js'", "'dependency-lock-artifact-check.js'",
  "'dependency-lock-adoption-check.js'", "'workspace-source-integrity.js'", "'workspace-source-integrity-check.js'",
  "'restore-test-governance-check.js'", "'restore-test-integration-check.js'", "'recovery-readiness-check.js'",
  "'recovery-release-gate.js'", 'dependencyLockVerified: true', 'dependencyLockGovernanceVerified: true',
  'dependencyLockGeneratorGovernanceVerified: true', 'dependencyLockWorkflowGovernanceVerified: true',
  'dependencyLockArtifactGovernanceVerified: true', 'dependencyLockAdoptionGovernanceVerified: true',
  'packageLockRequired: true', 'workspaceSourceIntegrityVerified: true', 'workspaceSourceIntegrityGovernanceVerified: true',
  'restoreTestGovernanceVerified: true', 'restoreTestIntegrationVerified: true', 'recoveryReadinessVerified: true',
  'recoveryReleaseGateVerified: true', 'dependencyLockProvenanceVerificationExecuted: false',
  'dependencyLockAdoptionMaterializationExecuted: false', 'dependencyLockArtifactVerificationExecuted: false',
  'dependencyLockGenerationWorkflowExecuted: false', 'dependencyLockGenerationExecuted: false',
  'dependencyInstallationExecuted: false', 'backupRuntimeExecuted: false', 'backupVerificationExecuted: false',
  'restoreTestExecuted: false'
], 'Preview activation preflight');

const expectedOrder = [
  "'workspace-topology-verification.js'", "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  "'dependency-lock-generator-check.js'", "'dependency-lock-workflow-check.js'", "'dependency-lock-artifact-check.js'",
  "'dependency-lock-adoption-check.js'", "'workspace-source-integrity.js'", "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'", "'migration-ledger-bootstrap-governance-check.js'",
  "'migration-runner-security-check.js'", "'restore-test-governance-check.js'", "'restore-test-integration-check.js'",
  "'recovery-readiness-check.js'", "'recovery-release-gate.js'", "'runtime-release-identity-check.js'"
];
for (let index = 1; index < expectedOrder.length; index += 1) if (preflight.indexOf(expectedOrder[index - 1]) >= preflight.indexOf(expectedOrder[index])) throw new Error(`Workspace source integrity order invalid at ${expectedOrder[index]}`);

requireMarkers(runbook, [
  'Dependency lock generation', 'Dependency lock artifact verification', 'Dependency lock adoption', 'package-lock.json',
  'dependency-lock-generator-check.js', 'dependency-lock-workflow-check.js', 'dependency-lock-artifact-check.js',
  'dependency-lock-adoption-check.js', 'DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md',
  'DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 'DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md',
  'deterministic SHA-256 inventory', 'secure descriptor-based reads', 'source inventory digest',
  'CI workflow file itself is part of the protected source inventory',
  'dependency-lock workflow is also part of the protected source inventory'
], 'Activation runbook');

const exactScripts = {
  'verify:workspace-source-integrity': 'node workspace-source-integrity.js',
  'check:workspace-source-integrity': 'node workspace-source-integrity-check.js',
  'verify:dependency-lock-artifact': 'node dependency-lock-artifact-verification.js',
  'check:dependency-lock-artifact': 'node dependency-lock-artifact-check.js',
  'materialize:dependency-lock-adoption': 'node dependency-lock-adoption-materializer.js',
  'verify:dependency-lock-provenance': 'node dependency-lock-provenance-verification.js',
  'check:dependency-lock-adoption': 'node dependency-lock-adoption-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts[name] !== command) throw new Error(`Missing exact ${name} command`);
for (const marker of [
  'node --check workspace-source-integrity.js', 'node --check workspace-source-integrity-check.js',
  'node --check dependency-lock-artifact-verification.js', 'node --check dependency-lock-artifact-check.js',
  'node --check dependency-lock-provenance-verification.js', 'node --check dependency-lock-adoption-materializer.js',
  'node --check dependency-lock-adoption-check.js', 'node dependency-lock-artifact-check.js',
  'node dependency-lock-adoption-check.js', 'node workspace-source-integrity-check.js'
]) if (!pkg.scripts.check.includes(marker)) throw new Error(`Normal validation missing ${marker}`);
if (pkg.scripts.check.includes('node workspace-source-integrity.js &&')) throw new Error('Environment-bound source inventory must not execute in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-artifact-verification.js &&')) throw new Error('Environment-bound artifact verifier must not execute in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-adoption-materializer.js &&')) throw new Error('Environment-changing adoption materializer must not execute in normal validation');
if (pkg.scripts.check.includes('node dependency-lock-provenance-verification.js &&')) throw new Error('Environment-bound provenance verifier must not execute in normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-source-integrity-governance',
  deterministicInventoryRequired: true,
  repositoryRootContainmentRequired: true,
  parentWorkflowPathsResolvedCanonically: true,
  repositoryApplicationOwnerConsistencyRequired: true,
  packageLockRequired: true,
  packageLockUnconditionalProtectionRequired: true,
  dependencyLockVerifierProtected: verifier.includes("['dependency-lock-verification.js', 2 * 1024 * 1024]"),
  dependencyLockGovernanceProtected: verifier.includes("['dependency-lock-governance-check.js', 2 * 1024 * 1024]"),
  dependencyLockGeneratorProtected: verifier.includes("['dependency-lock-generator.js', 2 * 1024 * 1024]"),
  dependencyLockGeneratorGovernanceProtected: verifier.includes("['dependency-lock-generator-check.js', 2 * 1024 * 1024]"),
  dependencyLockWorkflowGovernanceProtected: verifier.includes("['dependency-lock-workflow-check.js', 2 * 1024 * 1024]"),
  dependencyLockArtifactVerifierProtected: verifier.includes("['dependency-lock-artifact-verification.js', 2 * 1024 * 1024]"),
  dependencyLockArtifactGovernanceProtected: verifier.includes("['dependency-lock-artifact-check.js', 2 * 1024 * 1024]"),
  dependencyLockProvenanceVerifierProtected: verifier.includes("['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]"),
  dependencyLockAdoptionMaterializerProtected: verifier.includes("['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]"),
  dependencyLockAdoptionGovernanceProtected: verifier.includes("['dependency-lock-adoption-check.js', 2 * 1024 * 1024]"),
  dependencyLockConditionalProvenanceProtectionRequired: verifier.includes("if (fs.existsSync(provenancePath)) protectedFiles.push(['dependency-lock-provenance.json', 64 * 1024])"),
  dependencyLockGenerationRunbookProtected: verifier.includes("['DEPENDENCY_LOCK_GENERATION_RUNBOOK.md', 2 * 1024 * 1024]"),
  dependencyLockWorkflowRunbookProtected: verifier.includes("['DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md', 2 * 1024 * 1024]"),
  dependencyLockArtifactRunbookProtected: verifier.includes("['DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 2 * 1024 * 1024]"),
  dependencyLockAdoptionRunbookProtected: verifier.includes("['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024]"),
  dependencyLockWorkflowProtected: verifier.includes("['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024]"),
  dependencyLockAdoptionWorkflowProtected: verifier.includes("['../.github/workflows/os2-dependency-lock-adoption.yml', 1024 * 1024]"),
  secureDescriptorReadsRequired: true,
  descriptorMetadataStabilityRequired: true,
  exactReadByteCountRequired: true,
  canonicalPathBindingRequired: true,
  hardLinkRejectionRequired: true,
  ownershipConsistencyRequired: true,
  boundedReadsRequired: true,
  duplicatePathRejectionRequired: true,
  migrationDirectoryPurityRequired: true,
  selfProtectionRequired: true,
  sourceGovernanceProtectionRequired: true,
  topologyGovernanceProtectionRequired: true,
  activationGovernanceProtectionRequired: true,
  ciWorkflowProtectionRequired: true,
  ciBuildEvidenceProtectionRequired: true,
  ciGovernanceProtectionRequired: true,
  releaseSourceGovernanceProtectionRequired: true,
  releaseManifestGovernanceProtectionRequired: true,
  backupRunnerProtectionRequired: true,
  backupVerificationProtectionRequired: true,
  restoreRunnerProtectionRequired: true,
  restoreGovernanceProtectionRequired: true,
  restoreIntegrationProtectionRequired: true,
  recoveryReadinessProtectionRequired: true,
  recoveryReleaseGateProtectionRequired: true,
  recoveryRunbookProtectionRequired: true,
  releaseRunbookProtectionRequired: true,
  ciEvidenceRunbookProtectionRequired: true,
  activationPreflightRegistrationRequired: true,
  dependencyLockVerificationPreflightRegistrationRequired: true,
  dependencyLockGovernancePreflightRegistrationRequired: true,
  dependencyLockGeneratorGovernancePreflightRegistrationRequired: true,
  dependencyLockWorkflowGovernancePreflightRegistrationRequired: true,
  dependencyLockArtifactGovernancePreflightRegistrationRequired: true,
  dependencyLockAdoptionGovernancePreflightRegistrationRequired: true,
  provenanceVerifierPackageCommandRequired: true,
  adoptionMaterializerPackageCommandRequired: true,
  adoptionGovernancePackageCommandRequired: true,
  adoptionControlSyntaxValidationRequired: true,
  adoptionGovernanceNormalExecutionRequired: true,
  environmentBoundProvenanceVerifierExcludedFromNormalExecution: true,
  environmentChangingAdoptionMaterializerExcludedFromNormalExecution: true,
  restoreGovernancePreflightRegistrationRequired: true,
  restoreIntegrationPreflightRegistrationRequired: true,
  recoveryReadinessPreflightRegistrationRequired: true,
  recoveryReleaseGatePreflightRegistrationRequired: true,
  environmentBoundVerifierExcludedFromNormalExecution: true,
  environmentChangingLockGeneratorExcludedFromNormalExecution: true,
  manualLockWorkflowExecutionExcludedFromNormalValidation: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
