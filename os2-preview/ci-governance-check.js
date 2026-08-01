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

const workflowMarkers = [
  'permissions:',
  'contents: read',
  'timeout-minutes:',
  'Detect dependency lock',
  'package-lock.json is absent',
  'Verify deterministic workspace source integrity',
  'npm run verify:workspace-source-integrity',
  'PREVIEW_APP_ROOT: ${{ github.workspace }}/os2-preview',
  'DB_NAME: kloka_talk2me',
  'RELEASE_BRANCH: agent/talk2me-os2-integrated-rebuild',
  "ALLOW_PRODUCTION_MUTATION: 'false'",
  "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false',
  "if: steps.dependency-lock.outputs.present == 'true'",
  'npm run check',
  'npm audit --omit=dev --audit-level=high',
  'Record dependency audit blocker',
  'DEPENDENCY_LOCK_PRESENT:',
  'Generate build evidence with source-integrity binding',
  'npm run evidence:build',
  'actions/upload-artifact@v4',
  'os2-preview/**',
  'public/os2/**'
];
for (const marker of workflowMarkers) {
  if (!workflow.includes(marker)) throw new Error(`Missing CI workflow control: ${marker}`);
}

if (!pkg.scripts?.['evidence:build']) throw new Error('Missing evidence:build package script');
if (pkg.scripts?.['verify:workspace-source-integrity'] !== 'node workspace-source-integrity.js') throw new Error('Missing exact verify:workspace-source-integrity package script');
if (pkg.scripts?.['check:workspace-source-integrity'] !== 'node workspace-source-integrity-check.js') throw new Error('Missing exact check:workspace-source-integrity package script');
if (!pkg.scripts?.['check:ci-governance']) throw new Error('Missing check:ci-governance package script');
if (!pkg.scripts.check.includes('ci-governance-check.js')) throw new Error('CI governance check not included in main validation suite');

const evidenceMarkers = [
  "const { spawnSync } = require('child_process')",
  'runWorkspaceSourceIntegrity()',
  "'workspace-source-integrity.js'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'workspaceSourceIntegrityVerified: true',
  'workspaceSourceInventorySha256',
  'workspaceSourceProtectedFileCount',
  'workspaceSourceMigrationCount',
  'workspace-source-integrity.json',
  'workspace-source-integrity.sha256',
  'sha256',
  'migrationCount',
  'routeFileCount',
  'checkFileCount',
  'GITHUB_SHA',
  'DEPENDENCY_LOCK_PRESENT',
  'dependencyLockPresent',
  'dependencyAuditEligible',
  'releaseCandidateEligible'
];
for (const marker of evidenceMarkers) {
  if (!evidence.includes(marker)) throw new Error(`Missing build evidence marker: ${marker}`);
}

for (const marker of [
  "check: 'workspace-source-integrity'",
  'inventorySha256',
  'secureDescriptorReads: true',
  'canonicalPathBinding: true',
  'hardLinkRejection: true',
  'ownershipConsistency: true',
  'boundedReads: true'
]) {
  if (!sourceIntegrity.includes(marker)) throw new Error(`Missing workspace source integrity marker: ${marker}`);
}
for (const marker of [
  "check: 'workspace-source-integrity-governance'",
  'packageVerifierCommandRegistered: true',
  'normalValidationRegistered: true',
  'environmentBoundVerifierExcludedFromNormalExecution: true'
]) {
  if (!sourceIntegrityGovernance.includes(marker)) throw new Error(`Missing workspace source integrity governance marker: ${marker}`);
}

const runbookMarkers = [
  'npm install --ignore-scripts --no-audit --no-fund --package-lock=false',
  'dependencyLockPresent: false',
  'dependencyAuditEligible: false',
  'releaseCandidateEligible: false',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'release-candidate gate must continue to fail',
  'pinned restore-evidence verification',
  'Production at `talk2me.uent.co.za` remains outside this workflow'
];
for (const marker of runbookMarkers) {
  if (!runbook.includes(marker)) throw new Error(`Missing CI runbook control: ${marker}`);
}

if (workflow.indexOf('npm run verify:workspace-source-integrity') > workflow.indexOf('npm install --ignore-scripts')) throw new Error('Workspace source integrity must run before dependency installation');
if (workflow.indexOf('npm run check') > workflow.indexOf('npm run evidence:build')) throw new Error('Build evidence must be generated after integrated validation');
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
  buildEvidenceBoundToWorkspaceSourceInventory: true,
  workspaceSourceIntegrityArtifactRetained: true,
  dependencyLockPolicy: 'source-validation-continues-audit-blocked-until-committed-lock',
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
