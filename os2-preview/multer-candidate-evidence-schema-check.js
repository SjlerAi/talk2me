'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const failures = [];
function read(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${name}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
  }
}
function runJsonCheck(file, label) {
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 256 * 1024,
    shell: false,
    env: Object.freeze({ PATH: process.env.PATH || '', NODE_ENV: 'test' })
  });
  if (result.error) {
    failures.push(`${label} execution failed: ${result.error.message}`);
    return {};
  }
  if (result.status !== 0) {
    failures.push(`${label} failed: ${String(result.stderr || result.stdout).trim()}`);
    return {};
  }
  try { return JSON.parse(String(result.stdout || '{}')); }
  catch { failures.push(`${label} returned invalid JSON`); return {}; }
}

const schema = read('MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md');
const approval = read('MULTER_2_GENERATION_APPROVAL.md');
const plan = read('MULTER_2_CANDIDATE_MANIFEST_PLAN.md');
const verifier = read('multer-candidate-evidence-verification.js');
const verifierGovernance = read('multer-candidate-evidence-verification-check.js');
const pkg = JSON.parse(read('package.json'));

const exactKeys = [
  'schemaVersion','check','ok','repository','branch','sourceCommit','application','applicationVersion',
  'currentMulter','candidateMulter','approvalPhrase','approvingOwner','approvedAt','generatedAt',
  'sourcePackageSha256','candidatePackageSha256','candidateLockSha256','sourceInventorySha256',
  'onlyMulterDependencyChanged','sourceManifestUnchanged','committedLockUnchanged','lifecycleScriptsExecuted',
  'sourceTreeNodeModulesCreated','dependencyAdoptionAuthorized','previewActivationAuthorized',
  'productionMutationEnabled','rollbackRequired','rollbackCompleted'
];

requireMarkers(schema, [
  'Status: defined, generation not authorized, no evidence emitted',
  'Schema version: `1`',
  '`check` must equal `multer-2-candidate-evidence`',
  '`repository` must equal `SjlerAi/talk2me`',
  '`branch` must equal `agent/talk2me-os2-integrated-rebuild`',
  '`sourceCommit` must be exactly 40 lowercase hexadecimal characters',
  '`application` must equal `talk2me-os2-preview`',
  '`applicationVersion` must equal `0.60.0`',
  '`currentMulter` must equal `^1.4.5-lts.1`',
  '`candidateMulter` must equal `2.2.0`',
  '`approvalPhrase` must equal `APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION`',
  'canonical UTC timestamps with millisecond precision and trailing `Z`',
  'must not be more than 24 hours after approval',
  'All four SHA-256 fields must be exactly 64 lowercase hexadecimal characters',
  'constant-time comparison',
  'When rollback is required, rollback completion must be true',
  'No additional key is permitted',
  'must not contain credentials, environment dumps, absolute private paths'
], 'candidate evidence schema');

for (const key of exactKeys) {
  if (!schema.includes(`\`${key}\``)) failures.push(`Candidate evidence schema missing key ${key}`);
}
if (new Set(exactKeys).size !== 28) failures.push('Candidate evidence key inventory must contain exactly 28 unique keys');

requireMarkers(approval, [
  'Status: not approved',
  'Owner generation approval granted: no',
  'Candidate manifest creation authorized: no',
  'Dependency-lock generation authorized: no',
  'Dependency-lock adoption authorized: no',
  'Preview activation authorized: no',
  'Production mutation authorized: no'
], 'generation approval');

requireMarkers(plan, [
  'Status: planned, not authorized, not applied',
  'source `package.json` SHA-256',
  'candidate `package.json` SHA-256',
  'generated candidate lock SHA-256',
  'production mutation disabled and adoption separately gated'
], 'candidate manifest plan');

requireMarkers(verifier, [
  "check: 'multer-candidate-evidence-verification'",
  'exactKeyCount: EXPECTED_KEYS.length',
  'approvalBound: true',
  'approvalWindowHours: 24',
  'digestsVerified: 4',
  'onlyMulterDependencyChanged: true',
  'adoptionAuthorized: false',
  'previewActivationAuthorized: false',
  'productionMutationEnabled: false'
], 'candidate evidence verifier');
requireMarkers(verifierGovernance, [
  "check: 'multer-candidate-evidence-verification-governance'",
  'exactEvidenceKeys: 28',
  'explicitLocalInputs: 6',
  'digestComparisons: 4',
  'shellExecutionAvailable: false',
  'externalNetworkAvailable: false',
  'databaseAvailable: false',
  'filesystemMutationAvailable: false'
], 'candidate evidence verifier governance');

const verifierEvidence = runJsonCheck('multer-candidate-evidence-verification-check.js', 'Multer candidate evidence verifier governance');
if (verifierEvidence.ok !== true || verifierEvidence.check !== 'multer-candidate-evidence-verification-governance') failures.push('Candidate evidence verifier governance identity invalid');
if (verifierEvidence.exactEvidenceKeys !== 28 || verifierEvidence.explicitLocalInputs !== 6 || verifierEvidence.digestComparisons !== 4) failures.push('Candidate evidence verifier governance counts invalid');
if (verifierEvidence.approvalBindingRequired !== true || verifierEvidence.approvalFreshnessHours !== 24 || verifierEvidence.rollbackCompletionRequired !== true) failures.push('Candidate evidence verifier approval or rollback governance invalid');
for (const key of ['shellExecutionAvailable','externalNetworkAvailable','databaseAvailable','filesystemMutationAvailable','dependencyAdoptionAuthorized','previewActivationAuthorized','productionMutationEnabled']) if (verifierEvidence[key] !== false) failures.push(`Candidate evidence verifier capability must remain false: ${key}`);

if (pkg.dependencies.multer !== '^1.4.5-lts.1') failures.push('Active Multer dependency changed before candidate evidence authorization');
if (Object.prototype.hasOwnProperty.call(pkg, 'devDependencies')) failures.push('Unexpected devDependencies in active package manifest');

if (failures.length) {
  console.error('MULTER CANDIDATE EVIDENCE SCHEMA CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'multer-candidate-evidence-schema-governance',
  schemaVersion: 1,
  exactKeyCount: exactKeys.length,
  exactCandidateVersion: '2.2.0',
  exactApprovalPhraseRequired: true,
  approvedSourceCommitRequired: true,
  canonicalUtcTimestampsRequired: true,
  approvalFreshnessHours: 24,
  fourSha256BindingsRequired: true,
  constantTimeDigestComparisonRequired: true,
  rollbackEvidenceRequired: true,
  verifierGovernanceRequired: true,
  verifierLocalInputs: 6,
  verifierFilesystemMutationAvailable: false,
  secretFieldsProhibited: true,
  ownerGenerationApprovalGranted: false,
  dependencyLockGenerationAuthorized: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
