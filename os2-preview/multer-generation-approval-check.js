'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const approvalPath = path.join(root, 'MULTER_2_GENERATION_APPROVAL.md');
const packagePath = path.join(root, 'package.json');
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedPreviewVersion = '0.60.0';
const currentMulter = '^1.4.5-lts.1';
const candidateMulter = '2.2.0';
const approvalPhrase = 'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION';

function fail(message) {
  console.error(`MULTER GENERATION APPROVAL CHECK FAILED: ${message}`);
  process.exit(1);
}

for (const file of [approvalPath, packagePath]) {
  if (!fs.existsSync(file)) fail(`missing ${path.basename(file)}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path.basename(file)} must be a regular file`);
}

const approval = fs.readFileSync(approvalPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const requiredMarkers = [
  'Status: not approved',
  `Controlled branch: \`${expectedBranch}\``,
  `Preview version: ${expectedPreviewVersion}`,
  `Exact candidate dependency: \`multer@${candidateMulter}\``,
  `\`${approvalPhrase}\``,
  'Owner generation approval granted: no',
  'Candidate manifest creation authorized: no',
  'Dependency-lock generation authorized: no',
  'Dependency-lock adoption authorized: no',
  'Preview activation authorized: no',
  'Production mutation authorized: no',
  'the exact 40-character source commit SHA',
  'an approval timestamp in canonical UTC',
  'the approving owner identity',
  'dependency adoption remains separately gated'
];

for (const marker of requiredMarkers) {
  if (!approval.includes(marker)) fail(`approval record missing ${marker}`);
}

if (pkg.version !== expectedPreviewVersion) fail('preview version mismatch');
if (!pkg.dependencies || pkg.dependencies.multer !== currentMulter) fail('active Multer dependency changed before approval');
if (pkg.dependencies.multer === candidateMulter) fail('candidate Multer dependency activated before approval');
if (/Status:\s*approved/i.test(approval)) fail('approval record unexpectedly approved');

console.log(JSON.stringify({
  ok: true,
  check: 'multer-generation-approval',
  controlledBranch: expectedBranch,
  previewVersion: expectedPreviewVersion,
  currentMulter,
  selectedCandidate: candidateMulter,
  exactApprovalPhraseRequired: true,
  ownerGenerationApprovalGranted: false,
  candidateManifestCreationAuthorized: false,
  dependencyLockGenerationAuthorized: false,
  dependencyLockAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
