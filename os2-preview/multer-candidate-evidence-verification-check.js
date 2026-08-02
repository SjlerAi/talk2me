'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'multer-candidate-evidence-verification.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, 'MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md'), 'utf8');
const failures = [];
function requireMarkers(text, markers, label) {
  for (const marker of markers) if (!text.includes(marker)) failures.push(`${label} missing ${marker}`);
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

for (const prohibited of [
  "require('http')", "require('https')", "require('net')", "require('tls')", "require('mysql2')",
  'child_process', 'spawn(', 'spawnSync(', 'exec(', 'execSync(', 'fetch(', 'axios', 'process.chdir(',
  'fs.writeFile', 'fs.unlink', 'fs.rename', 'fs.rm', 'fs.mkdir'
]) if (source.includes(prohibited)) failures.push(`Verifier contains prohibited capability: ${prohibited}`);

if ((source.match(/equalDigest\(/g) || []).length !== 5) failures.push('Verifier must define one equalDigest function and invoke it four times');
if ((source.match(/readRegular\(required\(/g) || []).length !== 6) failures.push('Verifier must read exactly six explicit local inputs');

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
  shellExecutionAvailable: false,
  externalNetworkAvailable: false,
  databaseAvailable: false,
  filesystemMutationAvailable: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
