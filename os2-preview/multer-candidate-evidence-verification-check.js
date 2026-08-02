'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.join(__dirname, 'multer-candidate-evidence-verification.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, 'MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md'), 'utf8');
const negativeRegression = fs.readFileSync(path.join(__dirname, 'multer-candidate-evidence-negative-regression-check.js'), 'utf8');
const inputRegression = fs.readFileSync(path.join(__dirname, 'multer-candidate-evidence-input-regression-check.js'), 'utf8');
const failures = [];
function requireMarkers(text, markers, label) {
  for (const marker of markers) if (!text.includes(marker)) failures.push(`${label} missing ${marker}`);
}
function runJsonCheck(file, label) {
  const result = spawnSync(process.execPath, [file], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 60000,
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

requireMarkers(source, [
  "const EXPECTED_KEYS = Object.freeze([",
  "'rollbackRequired','rollbackCompleted'",
  'const HEX40 = /^[0-9a-f]{40}$/',
  'const HEX64 = /^[0-9a-f]{64}$/',
  'const UTC_MS =',
  'const MAX_JSON = 128 * 1024',
  'const MAX_FILE = 16 * 1024 * 1024',
  "MULTER_CANDIDATE_EVIDENCE_PATH",
  "MULTER_GENERATION_APPROVAL_PATH",
  "MULTER_SOURCE_PACKAGE_PATH",
  "MULTER_CANDIDATE_PACKAGE_PATH",
  "MULTER_CANDIDATE_LOCK_PATH",
  "MULTER_SOURCE_INVENTORY_PATH",
  "fs.constants.O_NOFOLLOW",
  "descriptor = fs.openSync(file, flags)",
  "const opened = fs.fstatSync(descriptor)",
  "const after = fs.fstatSync(descriptor)",
  "sameFile(before, opened)",
  "sameFile(opened, after)",
  "bytes.length !== opened.size",
  "fs.closeSync(descriptor)",
  "crypto.timingSafeEqual",
  "evidence.check !== 'multer-2-candidate-evidence'",
  "evidence.repository !== 'SjlerAi/talk2me'",
  "evidence.branch !== 'agent/talk2me-os2-integrated-rebuild'",
  "evidence.candidateMulter !== '2.2.0'",
  "generatedAt - approvedAt > 24 * 60 * 60 * 1000",
  "approval.sourceCommit !== evidence.sourceCommit",
  "sourceClone.dependencies.multer = '2.2.0'",
  "CANDIDATE_PACKAGE_DIFF_INVALID",
  "digestsVerified: 4",
  "descriptorBoundReads: true",
  "noFollowOpenRequired: true",
  "inodeContinuityVerified: true",
  "if (evidence.rollbackRequired && !evidence.rollbackCompleted)",
  "adoptionAuthorized: false",
  "previewActivationAuthorized: false",
  "productionMutationEnabled: false"
], 'candidate evidence verifier');

requireMarkers(schema, [
  'Schema version: `1`',
  'A future evidence JSON object must contain exactly these keys:',
  '28. `rollbackCompleted`',
  'must not be more than 24 hours after approval',
  'Digest comparison must use constant-time comparison',
  'No additional key is permitted.',
  'Unexpected files must be preserved for manual review.'
], 'candidate evidence schema');

requireMarkers(negativeRegression, [
  "check: 'multer-candidate-evidence-negative-regression'",
  'validBaselineAccepted',
  'extraKeyRejected',
  'reorderedKeysRejected',
  'staleApprovalRejected',
  'commitMismatchRejected',
  'ownerMismatchRejected',
  'extraManifestChangeRejected',
  'badSourceDigestRejected',
  'badLockDigestRejected',
  'rollbackIncompleteRejected',
  'adoptionFlagRejected',
  'previewFlagRejected',
  'productionFlagRejected',
  'lifecycleFlagRejected',
  'isolatedTemporaryFilesOnly: true',
  'externalNetworkUsed: false',
  'databaseConfigured: false',
  'sourceTreeMutationEnabled: false'
], 'candidate evidence negative regression');

requireMarkers(inputRegression, [
  "check: 'multer-candidate-evidence-input-regression'",
  'validCanonicalInputsAccepted',
  'relativePathRejected',
  'nonNormalizedPathRejected',
  'symlinkRejected',
  'hardLinkRejected',
  'missingFileRejected',
  'directoryRejected',
  'overlongEnvironmentPathRejected',
  'controlCharacterEnvironmentPathRejected',
  'emptyFileRejected',
  'oversizedJsonRejected',
  'oversizedLockRejected',
  'crlfJsonRejected',
  'missingFinalNewlineRejected',
  'invalidUtf8Rejected',
  'arrayJsonRejected',
  'nullJsonRejected',
  'canonicalJsonRequired: true',
  'absoluteNormalizedPathsRequired: true',
  'singleLinkRegularFilesRequired: true',
  'boundedInputsRequired: true',
  'descriptorBoundReadsRequired: true',
  'missingAndDirectoryInputsRejected: true',
  'boundedEnvironmentPathsRequired: true',
  'controlCharactersProhibited: true',
  'isolatedTemporaryFilesOnly: true',
  'externalNetworkUsed: false',
  'databaseConfigured: false',
  'sourceTreeMutationEnabled: false'
], 'candidate evidence input regression');

for (const prohibited of [
  "require('http')", "require('https')", "require('net')", "require('tls')", "require('mysql2')",
  'child_process', 'spawn(', 'spawnSync(', 'exec(', 'execSync(', 'fetch(', 'axios', 'process.chdir(',
  'fs.writeFile', 'fs.unlink', 'fs.rename', 'fs.rm', 'fs.mkdir'
]) if (source.includes(prohibited)) failures.push(`Verifier contains prohibited capability: ${prohibited}`);

if ((source.match(/equalDigest\(/g) || []).length !== 5) failures.push('Verifier must define one equalDigest function and invoke it four times');
if ((source.match(/readRegular\(required\(/g) || []).length !== 6) failures.push('Verifier must read exactly six explicit local inputs');
if ((source.match(/fs\.openSync\(/g) || []).length !== 1) failures.push('Verifier must use one controlled descriptor open path');
if ((source.match(/fs\.fstatSync\(/g) || []).length !== 2) failures.push('Verifier must verify descriptor state before and after reading');

const regressionEvidence = runJsonCheck('multer-candidate-evidence-negative-regression-check.js', 'Multer candidate evidence negative regression');
if (regressionEvidence.ok !== true || regressionEvidence.check !== 'multer-candidate-evidence-negative-regression') failures.push('Negative regression evidence identity invalid');
if (regressionEvidence.caseCount !== 14) failures.push('Negative regression must execute exactly 14 cases');
for (const [name, passed] of Object.entries(regressionEvidence.cases || {})) if (passed !== true) failures.push(`Negative regression case failed: ${name}`);
for (const key of ['externalNetworkUsed','databaseConfigured','sourceTreeMutationEnabled','dependencyAdoptionAuthorized','previewActivationAuthorized','productionMutationEnabled']) if (regressionEvidence[key] !== false) failures.push(`Negative regression safety flag must remain false: ${key}`);
if (regressionEvidence.isolatedTemporaryFilesOnly !== true) failures.push('Negative regression must use isolated temporary files only');

const inputEvidence = runJsonCheck('multer-candidate-evidence-input-regression-check.js', 'Multer candidate evidence input regression');
if (inputEvidence.ok !== true || inputEvidence.check !== 'multer-candidate-evidence-input-regression') failures.push('Input regression evidence identity invalid');
if (inputEvidence.caseCount !== 17) failures.push('Input regression must execute exactly 17 cases');
for (const [name, passed] of Object.entries(inputEvidence.cases || {})) if (passed !== true) failures.push(`Input regression case failed: ${name}`);
for (const key of ['canonicalJsonRequired','absoluteNormalizedPathsRequired','singleLinkRegularFilesRequired','boundedInputsRequired','descriptorBoundReadsRequired','missingAndDirectoryInputsRejected','boundedEnvironmentPathsRequired','controlCharactersProhibited','isolatedTemporaryFilesOnly']) if (inputEvidence[key] !== true) failures.push(`Input regression required flag must remain true: ${key}`);
for (const key of ['externalNetworkUsed','databaseConfigured','sourceTreeMutationEnabled','dependencyAdoptionAuthorized','previewActivationAuthorized','productionMutationEnabled']) if (inputEvidence[key] !== false) failures.push(`Input regression safety flag must remain false: ${key}`);

if (failures.length) {
  console.error('MULTER CANDIDATE EVIDENCE VERIFICATION GOVERNANCE FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'multer-candidate-evidence-verification-governance',
  exactEvidenceKeys: 28,
  explicitLocalInputs: 6,
  digestComparisons: 4,
  approvalBindingRequired: true,
  approvalFreshnessHours: 24,
  rollbackCompletionRequired: true,
  negativeRegressionRequired: true,
  negativeRegressionCases: 14,
  inputRegressionRequired: true,
  inputRegressionCases: 17,
  descriptorBoundReadsRequired: true,
  noFollowOpenRequired: true,
  inodeContinuityRequired: true,
  postReadSizeContinuityRequired: true,
  shellExecutionAvailable: false,
  externalNetworkAvailable: false,
  databaseAvailable: false,
  filesystemMutationAvailable: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
