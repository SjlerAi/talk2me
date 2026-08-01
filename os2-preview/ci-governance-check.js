'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'os2-preview-ci.yml');
const packagePath = path.join(__dirname, 'package.json');
const evidencePath = path.join(__dirname, 'build-evidence.js');
const sourceIntegrityPath = path.join(__dirname, 'workspace-source-integrity.js');
const sourceIntegrityGovernancePath = path.join(__dirname, 'workspace-source-integrity-check.js');
const runbookPath = path.join(__dirname, 'CI_AND_BUILD_EVIDENCE_RUNBOOK.md');

for (const file of [workflowPath, packagePath, evidencePath, sourceIntegrityPath, sourceIntegrityGovernancePath, runbookPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing CI governance file: ${file}`);
}

const workflow = fs.readFileSync(workflowPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const evidence = fs.readFileSync(evidencePath, 'utf8');
const sourceIntegrity = fs.readFileSync(sourceIntegrityPath, 'utf8');
const sourceIntegrityGovernance = fs.readFileSync(sourceIntegrityGovernancePath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
}

const workflowMarkers = [
  'permissions:', 'contents: read', 'timeout-minutes:', 'Detect dependency lock', 'package-lock.json is absent',
  'Verify and retain pre-install workspace source integrity', 'id: preinstall-source', '$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json',
  'npm run --silent verify:workspace-source-integrity', 'inventory_sha256=', 'package_lock_present=',
  'Confirm dependency-lock detection matches source evidence', 'steps.preinstall-source.outputs.package_lock_present',
  'PREVIEW_APP_ROOT: ${{ github.workspace }}/os2-preview', 'DB_NAME: kloka_talk2me',
  'RELEASE_BRANCH: agent/talk2me-os2-integrated-rebuild', "ALLOW_PRODUCTION_MUTATION: 'false'", "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false', "if: steps.dependency-lock.outputs.present == 'true'",
  'npm run check', 'npm audit --omit=dev --audit-level=high', 'Record dependency audit blocker', 'DEPENDENCY_LOCK_PRESENT:',
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256:', 'steps.preinstall-source.outputs.inventory_sha256',
  'Generate build evidence with pre-install source continuity', 'npm run evidence:build', 'actions/upload-artifact@v4', 'os2-preview/**', 'public/os2/**'
];
requireMarkers(workflow, workflowMarkers, 'CI workflow');

if (!pkg.scripts?.['evidence:build']) throw new Error('Missing evidence:build package script');
if (pkg.scripts?.['verify:workspace-source-integrity'] !== 'node workspace-source-integrity.js') throw new Error('Missing exact verify:workspace-source-integrity package script');
if (pkg.scripts?.['check:workspace-source-integrity'] !== 'node workspace-source-integrity-check.js') throw new Error('Missing exact check:workspace-source-integrity package script');
if (!pkg.scripts?.['check:ci-governance']) throw new Error('Missing check:ci-governance package script');
if (!pkg.scripts.check.includes('ci-governance-check.js')) throw new Error('CI governance check not included in main validation suite');

const evidenceMarkers = [
  "const { spawnSync } = require('child_process')", 'runWorkspaceSourceIntegrity()', "'workspace-source-integrity.js'",
  "expectedRepository = 'SjlerAi/talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'validateCiIdentity()',
  'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_REF', 'GITHUB_WORKFLOW', 'GITHUB_WORKFLOW_REF',
  'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTOR',
  'GITHUB_SHA must be a full 40-character hexadecimal commit SHA', 'refs/heads/${expectedBranch}',
  '.github/workflows/os2-preview-ci.yml@refs/heads/${expectedBranch}',
  'GITHUB_RUN_ID must be a positive integer', 'GITHUB_RUN_NUMBER must be a positive integer', 'GITHUB_RUN_ATTEMPT must be a positive integer',
  'verifierTimeoutMs = 30000', 'timeout: verifierTimeoutMs', "killSignal: 'SIGKILL'", 'shell: false', "result.error.code === 'ETIMEDOUT'",
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256', 'GITHUB_ACTIONS', 'equalHex(expectedPreinstallDigest, postinstallDigest)',
  'Protected source inventory changed between pre-install verification and build-evidence generation', 'parseBooleanEnvironment',
  'DEPENDENCY_LOCK_PRESENT does not match the filesystem', 'Workspace source-integrity lock evidence does not match the filesystem',
  'secureReadFile', 'O_DIRECTORY and O_NOFOLLOW are required for build evidence traversal',
  'maxEvidenceFiles = 2000', 'maxEvidenceFileBytes = 16 * 1024 * 1024', 'maxEvidenceTotalBytes = 256 * 1024 * 1024',
  'assertSafeExistingEvidencePath', 'assertPrivateDirectory', 'atomicWrite', 'fs.constants.O_EXCL', 'fs.fsyncSync',
  'Evidence output permissions must be 0600', 'Evidence directory must not permit group or world access', 'verifySidecar',
  'artifact-manifest.json', 'artifact-manifest.sha256', 'privateDirectoryVerified: true', 'atomicPublicationVerified: true',
  'checksumPairsVerified: true', 'evidenceDirectoryPrivate: true', 'evidenceFilesAtomic: true', 'evidenceChecksumPairsVerified: true',
  'githubActionsIdentityVerified', 'exactRepositoryVerified', 'exactCommitShaVerified', 'exactBranchAndRefVerified', 'exactWorkflowRefVerified',
  'workflowRunAttempt', 'workflowActor', 'sourceInventorySha256: postinstallDigest',
  'workspaceSourceIntegrityVerified: true', 'preinstallWorkspaceSourceInventorySha256', 'postinstallWorkspaceSourceInventorySha256',
  'workspaceSourceIntegrityStableAcrossDependencyInstall', 'dependencyLockStateVerifiedAgainstFilesystem: true',
  'dependencyLockStateVerifiedAgainstSourceIntegrity: true', 'workspaceSourceProtectedFileCount', 'workspaceSourceMigrationCount',
  'workspace-source-integrity.json', 'workspace-source-integrity.sha256', 'build-evidence.json', 'build-evidence.sha256',
  'migrationCount', 'routeFileCount', 'checkFileCount', 'dependencyAuditEligible', 'releaseCandidateEligible'
];
requireMarkers(evidence, evidenceMarkers, 'Build evidence');

requireMarkers(sourceIntegrity, [
  "check: 'workspace-source-integrity'", 'inventorySha256', 'secureDescriptorReads: true', 'canonicalPathBinding: true',
  'hardLinkRejection: true', 'ownershipConsistency: true', 'boundedReads: true', 'ciWorkflowProtected: true'
], 'Workspace source integrity');
requireMarkers(sourceIntegrityGovernance, [
  "check: 'workspace-source-integrity-governance'", 'packageVerifierCommandRegistered: true',
  'normalValidationRegistered: true', 'environmentBoundVerifierExcludedFromNormalExecution: true', 'ciWorkflowProtectionRequired: true'
], 'Workspace source integrity governance');

const runbookMarkers = [
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false', 'pre-install inventory digest', 'post-install inventory digest',
  'must match exactly', 'dependency-lock detection must agree', 'workspaceSourceIntegrityStableAcrossDependencyInstall: true',
  'exact GitHub repository, commit, branch, ref, workflow reference, run ID, run number, run attempt, and actor',
  'githubActionsIdentityVerified: true', 'full 40-character commit SHA', 'controlled `refs/heads/agent/talk2me-os2-integrated-rebuild` ref',
  'secure descriptor-based reads', '`O_NOFOLLOW`', '`O_DIRECTORY`', '2,000 files', '16 MiB', '256 MiB',
  'directory identity is rechecked', 'atomic publication', 'private `0700` evidence directory', 'private `0600` evidence files',
  'artifact-manifest.json', 'checksum pairs are reverified before upload', 'dependencyLockPresent: false',
  'dependencyAuditEligible: false', 'releaseCandidateEligible: false', 'npm ci --ignore-scripts --no-audit --no-fund',
  'release-candidate gate must continue to fail', 'pinned restore-evidence verification',
  'Production at `talk2me.uent.co.za` remains outside this workflow'
];
requireMarkers(runbook, runbookMarkers, 'CI runbook');

const preinstallPosition = workflow.indexOf('npm run --silent verify:workspace-source-integrity');
const installPosition = workflow.indexOf('npm install --ignore-scripts');
const checkPosition = workflow.indexOf('npm run check');
const evidencePosition = workflow.indexOf('npm run evidence:build');
if (preinstallPosition === -1 || installPosition === -1 || preinstallPosition >= installPosition) throw new Error('Workspace source integrity must run before dependency installation');
if (checkPosition === -1 || evidencePosition === -1 || checkPosition >= evidencePosition) throw new Error('Build evidence must be generated after integrated validation');
if (workflow.indexOf('Confirm dependency-lock detection matches source evidence') >= installPosition) throw new Error('Dependency-lock consistency must be confirmed before dependency installation');
if (workflow.indexOf('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256:') >= evidencePosition) throw new Error('Expected pre-install digest must be provided to build-evidence generation');
if (/cache:\s*npm/.test(workflow)) throw new Error('npm cache must not assume a lockfile before dependency freeze');
if (/npm install(?![^\n]*--package-lock=false)/.test(workflow)) throw new Error('CI install must not generate an uncommitted dependency lock');
if (/pull_request_target\s*:/.test(workflow)) throw new Error('Unsafe pull_request_target trigger is prohibited');
if (/permissions:\s*write-all/.test(workflow)) throw new Error('write-all workflow permission is prohibited');
if (/continue-on-error:\s*true/.test(workflow)) throw new Error('Validation failures may not be ignored');

console.log(JSON.stringify({
  ok: true,
  module: 'ci-governance',
  workflow: '.github/workflows/os2-preview-ci.yml',
  validationMarkers: workflowMarkers.length,
  evidenceMarkers: evidenceMarkers.length,
  runbookMarkers: runbookMarkers.length,
  workspaceSourceIntegrityRunsBeforeDependencyInstall: true,
  preinstallSourceDigestRetainedAsWorkflowOutput: true,
  postinstallSourceDigestComparedWithPreinstallDigest: true,
  sourceIntegrityStableAcrossDependencyInstallRequired: true,
  exactGitHubRepositoryIdentityRequired: true,
  exactGitHubCommitIdentityRequired: true,
  exactGitHubBranchAndRefIdentityRequired: true,
  exactGitHubWorkflowRefRequired: true,
  positiveWorkflowRunIdentityRequired: true,
  workflowActorIdentityRequired: true,
  artifactManifestBoundToCiIdentity: true,
  dependencyLockDetectionConsistencyRequired: true,
  buildEvidenceLockStateConsistencyRequired: true,
  buildEvidenceVerifierExecutionBounded: true,
  buildEvidenceDirectoryDescriptorsRequired: true,
  buildEvidenceFileDescriptorReadsRequired: true,
  buildEvidenceDirectoryIdentityRecheckRequired: true,
  buildEvidenceOwnerConsistencyRequired: true,
  buildEvidenceFileCountBounded: true,
  buildEvidencePerFileBytesBounded: true,
  buildEvidenceTotalBytesBounded: true,
  existingEvidencePathSafetyRequired: true,
  buildEvidencePrivateDirectoryRequired: true,
  buildEvidenceAtomicPublicationRequired: true,
  buildEvidencePrivateFilesRequired: true,
  buildEvidenceChecksumReverificationRequired: true,
  artifactManifestRequired: true,
  buildEvidenceBoundToWorkspaceSourceInventory: true,
  workspaceSourceIntegrityArtifactRetained: true,
  dependencyLockPolicy: 'source-validation-continues-audit-blocked-until-committed-lock',
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
