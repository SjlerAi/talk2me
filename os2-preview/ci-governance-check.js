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

const pinnedActions = {
  checkout: 'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955',
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
};

const workflowMarkers = [
  'push:', 'workflow_dispatch:', 'branches:', 'agent/talk2me-os2-integrated-rebuild',
  'permissions:', 'contents: read', 'timeout-minutes:',
  pinnedActions.checkout, pinnedActions.setupNode, pinnedActions.uploadArtifact,
  'persist-credentials: false', 'fetch-depth: 1', '# v4.3.0', '# v4.4.0', '# v4.6.2',
  'Confirm controlled workflow event and ref', 'case "$GITHUB_EVENT_NAME" in', 'push|workflow_dispatch',
  'test "$GITHUB_REPOSITORY" = "SjlerAi/talk2me"',
  'test "$GITHUB_REF" = "refs/heads/agent/talk2me-os2-integrated-rebuild"',
  'test "$GITHUB_REF_NAME" = "agent/talk2me-os2-integrated-rebuild"', 'test -n "$GITHUB_SHA"',
  'Detect dependency lock', 'package-lock.json is absent',
  'Verify and retain pre-install workspace source integrity', 'id: preinstall-source', '$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json',
  'npm run --silent verify:workspace-source-integrity', 'inventory_sha256=', 'package_lock_present=',
  'Confirm dependency-lock detection matches source evidence', 'steps.preinstall-source.outputs.package_lock_present',
  'PREVIEW_APP_ROOT: ${{ github.workspace }}/os2-preview', 'DB_NAME: kloka_talk2me',
  'RELEASE_BRANCH: agent/talk2me-os2-integrated-rebuild', "ALLOW_PRODUCTION_MUTATION: 'false'", "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false', "if: steps.dependency-lock.outputs.present == 'true'",
  'npm run check', 'npm audit --omit=dev --audit-level=high', 'Record dependency audit blocker', 'DEPENDENCY_LOCK_PRESENT:',
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256:', 'steps.preinstall-source.outputs.inventory_sha256',
  'GITHUB_REF: ${{ github.ref }}', 'GITHUB_REPOSITORY: ${{ github.repository }}', 'GITHUB_WORKFLOW: ${{ github.workflow }}',
  'GITHUB_WORKFLOW_REF: ${{ github.workflow_ref }}', 'GITHUB_RUN_ATTEMPT: ${{ github.run_attempt }}', 'GITHUB_ACTOR: ${{ github.actor }}',
  'Generate build evidence with pre-install source continuity', 'npm run evidence:build',
  'os2-preview-build-evidence-${{ github.run_number }}-attempt-${{ github.run_attempt }}', 'os2-preview/**', 'public/os2/**'
];
requireMarkers(workflow, workflowMarkers, 'CI workflow');

if (/^\s*pull_request\s*:/m.test(workflow)) throw new Error('Release-evidence workflow must not run on pull_request merge refs');
if (/^\s*pull_request_target\s*:/m.test(workflow)) throw new Error('Unsafe pull_request_target trigger is prohibited');
if (!/^\s{2}push\s*:/m.test(workflow) || !/^\s{2}workflow_dispatch\s*:/m.test(workflow)) throw new Error('Controlled push and workflow_dispatch triggers are required');
if (!/push:[\s\S]*branches:[\s\S]*agent\/talk2me-os2-integrated-rebuild/.test(workflow)) throw new Error('Push trigger must be restricted to the controlled rebuild branch');

const actionUseLines = workflow.split(/\r?\n/).filter(line => /^\s*uses:\s*/.test(line));
if (actionUseLines.length !== 3) throw new Error(`CI workflow must contain exactly three action uses; found ${actionUseLines.length}`);
for (const line of actionUseLines) {
  const reference = line.trim().replace(/^uses:\s*/, '').split(/\s+#/)[0].trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(reference)) throw new Error(`CI action reference is not pinned to a full immutable SHA: ${reference}`);
}
for (const pinned of Object.values(pinnedActions)) if (!actionUseLines.some(line => line.includes(pinned))) throw new Error(`Required pinned CI action is missing: ${pinned}`);
if (/uses:\s*[^\s#]+@v\d+/i.test(workflow)) throw new Error('Mutable major-version GitHub Action references are prohibited');
if (/uses:\s*[^\s#]+@(main|master|latest)\b/i.test(workflow)) throw new Error('Mutable branch or latest GitHub Action references are prohibited');

if (!pkg.scripts?.['evidence:build']) throw new Error('Missing evidence:build package script');
if (pkg.scripts?.['verify:workspace-source-integrity'] !== 'node workspace-source-integrity.js') throw new Error('Missing exact verify:workspace-source-integrity package script');
if (pkg.scripts?.['check:workspace-source-integrity'] !== 'node workspace-source-integrity-check.js') throw new Error('Missing exact check:workspace-source-integrity package script');
if (!pkg.scripts?.['check:ci-governance']) throw new Error('Missing check:ci-governance package script');
if (!pkg.scripts.check.includes('ci-governance-check.js')) throw new Error('CI governance check not included in main validation suite');

requireMarkers(evidence, [
  'validateCiIdentity()', "expectedRepository = 'SjlerAi/talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'Unexpected GitHub repository identity', 'GITHUB_SHA must be a full 40-character hexadecimal commit SHA',
  'Unexpected GitHub branch identity', 'Unexpected GitHub ref identity', 'GITHUB_WORKFLOW_REF does not identify the controlled preview workflow and branch',
  'githubActionsIdentityVerified', 'exactRepositoryVerified', 'exactCommitShaVerified', 'exactBranchAndRefVerified', 'exactWorkflowRefVerified',
  'EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256', 'workspaceSourceIntegrityStableAcrossDependencyInstall',
  'secureManifestDescriptorReads: true', 'boundedManifestCollection: true', 'artifact-manifest.json'
], 'Build evidence');

requireMarkers(sourceIntegrity, [
  "check: 'workspace-source-integrity'", 'inventorySha256', 'secureDescriptorReads: true', 'canonicalPathBinding: true',
  'hardLinkRejection: true', 'ownershipConsistency: true', 'boundedReads: true', 'ciEvidenceControlsProtected: files.some',
  "['../.github/workflows/os2-preview-ci.yml', 1024 * 1024]"
], 'Workspace source integrity');
requireMarkers(sourceIntegrityGovernance, [
  "check: 'workspace-source-integrity-governance'", 'packageVerifierCommandRegistered: true',
  'normalValidationRegistered: true', 'environmentBoundVerifierExcludedFromNormalExecution: true',
  'ciBuildEvidenceProtectionRequired: true', 'ciGovernanceProtectionRequired: true', 'ciWorkflowProtectionRequired: true'
], 'Workspace source integrity governance');

requireMarkers(runbook, [
  'controlled branch only', 'pull_request merge refs are prohibited', 'push and manual `workflow_dispatch`',
  'immutable 40-character commit SHA', 'actions/checkout', 'actions/setup-node', 'actions/upload-artifact',
  'Mutable action tags, branches, and `latest` references are prohibited', 'persist-credentials: false', 'fetch-depth: 1',
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false', 'pre-install inventory digest', 'post-install inventory digest',
  'must match exactly', 'dependency-lock detection must agree', 'workspaceSourceIntegrityStableAcrossDependencyInstall: true',
  'secure descriptor-based reads', '`O_NOFOLLOW`', '`O_DIRECTORY`', '2,000 files', '16 MiB', '256 MiB',
  'atomic publication', 'private `0700` evidence directory', 'private `0600` evidence files', 'artifact-manifest.json',
  'dependencyLockPresent: false', 'dependencyAuditEligible: false', 'releaseCandidateEligible: false',
  'Production at `talk2me.uent.co.za` remains outside this workflow'
], 'CI runbook');

const eventGuardPosition = workflow.indexOf('Confirm controlled workflow event and ref');
const dependencyPosition = workflow.indexOf('Detect dependency lock');
const preinstallPosition = workflow.indexOf('npm run --silent verify:workspace-source-integrity');
const installPosition = workflow.indexOf('npm install --ignore-scripts');
const checkPosition = workflow.indexOf('npm run check');
const evidencePosition = workflow.indexOf('npm run evidence:build');
if (eventGuardPosition === -1 || dependencyPosition === -1 || eventGuardPosition >= dependencyPosition) throw new Error('Controlled event/ref verification must run before dependency inspection');
if (preinstallPosition === -1 || installPosition === -1 || preinstallPosition >= installPosition) throw new Error('Workspace source integrity must run before dependency installation');
if (checkPosition === -1 || evidencePosition === -1 || checkPosition >= evidencePosition) throw new Error('Build evidence must be generated after integrated validation');
if (/cache:\s*npm/.test(workflow)) throw new Error('npm cache must not assume a lockfile before dependency freeze');
if (/npm install(?![^\n]*--package-lock=false)/.test(workflow)) throw new Error('CI install must not generate an uncommitted dependency lock');
if (/permissions:\s*write-all/.test(workflow)) throw new Error('write-all workflow permission is prohibited');
if (/continue-on-error:\s*true/.test(workflow)) throw new Error('Validation failures may not be ignored');

console.log(JSON.stringify({
  ok: true,
  module: 'ci-governance',
  workflow: '.github/workflows/os2-preview-ci.yml',
  controlledBranchOnly: true,
  allowedEvents: ['push', 'workflow_dispatch'],
  pullRequestMergeRefsProhibited: true,
  pullRequestTargetProhibited: true,
  eventAndRefGuardRunsBeforeDependencyInspection: true,
  checkoutCredentialsPersisted: false,
  checkoutFetchDepth: 1,
  immutableActionReferencesRequired: true,
  checkoutActionPinnedSha: pinnedActions.checkout.split('@')[1],
  setupNodeActionPinnedSha: pinnedActions.setupNode.split('@')[1],
  uploadArtifactActionPinnedSha: pinnedActions.uploadArtifact.split('@')[1],
  exactActionUseCountRequired: true,
  workflowIdentityEnvironmentExplicit: true,
  artifactNameBoundToRunAttempt: true,
  workspaceSourceIntegrityRunsBeforeDependencyInstall: true,
  sourceIntegrityStableAcrossDependencyInstallRequired: true,
  buildEvidenceBoundToWorkspaceSourceInventory: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
