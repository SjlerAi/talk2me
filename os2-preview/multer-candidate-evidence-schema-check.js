'use strict';

const fs = require('fs');
const path = require('path');

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

const schema = read('MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md');
const approval = read('MULTER_2_GENERATION_APPROVAL.md');
const plan = read('MULTER_2_CANDIDATE_MANIFEST_PLAN.md');
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
  secretFieldsProhibited: true,
  ownerGenerationApprovalGranted: false,
  dependencyLockGenerationAuthorized: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
