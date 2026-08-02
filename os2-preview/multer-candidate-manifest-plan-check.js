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
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
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
  if (result.error) failures.push(`${label} execution failed: ${result.error.message}`);
  else if (result.status !== 0) failures.push(`${label} failed: ${String(result.stderr || result.stdout).trim()}`);
  else {
    try { return JSON.parse(String(result.stdout || '{}')); }
    catch { failures.push(`${label} returned invalid JSON`); }
  }
  return {};
}

const pkg = JSON.parse(read('package.json'));
const plan = read('MULTER_2_CANDIDATE_MANIFEST_PLAN.md');
const approval = read('MULTER_2_GENERATION_APPROVAL.md');
const schema = read('MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md');

const expectedCurrent = '^1.4.5-lts.1';
const expectedCandidate = '2.2.0';
const expectedOtherDependencies = Object.freeze({
  bcryptjs: '^2.4.3',
  express: '^4.19.2',
  mysql2: '^3.11.0',
  nodemailer: '^6.9.16',
  xlsx: '^0.18.5'
});

if (pkg.name !== 'talk2me-os2-preview' || pkg.version !== '0.60.0' || pkg.private !== true || pkg.main !== 'server.js') failures.push('Active package identity changed');
if (!pkg.dependencies || pkg.dependencies.multer !== expectedCurrent) failures.push('Active Multer dependency changed before approval');
for (const [name, value] of Object.entries(expectedOtherDependencies)) if (pkg.dependencies[name] !== value) failures.push(`Non-Multer dependency changed: ${name}`);
if (Object.keys(pkg.dependencies || {}).length !== 6) failures.push('Direct dependency set changed');
if (pkg.devDependencies || pkg.optionalDependencies || pkg.bundledDependencies || pkg.bundleDependencies || pkg.workspaces) failures.push('Prohibited dependency section present');
for (const name of ['preinstall','install','postinstall','prepare','prepublish','prepublishOnly','prepack','postpack']) if (pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, name)) failures.push(`Lifecycle script present: ${name}`);

requireMarkers(plan, [
  'Status: planned, not authorized, not applied',
  'from `"multer": "^1.4.5-lts.1"`',
  'to `"multer": "2.2.0"`',
  'No semver range, tag, alias, URL, file path, workspace reference or pre-release version is permitted.',
  'the existing scripts object without additions, removals or value changes',
  'every non-Multer direct dependency name and value',
  'private temporary workspace outside the repository source tree',
  'must not overwrite committed `package.json` or `package-lock.json`',
  'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION',
  'approved 40-character source commit SHA',
  'source `package.json` SHA-256',
  'candidate `package.json` SHA-256',
  'generated candidate lock SHA-256',
  'production mutation disabled and adoption separately gated',
  'if more than the exact Multer dependency value changes'
], 'Candidate manifest plan');

requireMarkers(approval, [
  'Status: not approved',
  'Candidate manifest creation authorized: no',
  'Dependency-lock generation authorized: no',
  'Dependency-lock adoption authorized: no'
], 'Generation approval');

requireMarkers(schema, [
  'Status: defined, generation not authorized, no evidence emitted',
  'Schema version: `1`',
  'No additional key is permitted.',
  'constant-time comparison',
  'When rollback is required, rollback completion must be true'
], 'Candidate evidence schema');

const schemaEvidence = runJsonCheck('multer-candidate-evidence-schema-check.js', 'Multer candidate evidence schema');
if (schemaEvidence.ok !== true || schemaEvidence.check !== 'multer-candidate-evidence-schema-governance') failures.push('Candidate evidence schema evidence invalid');
if (schemaEvidence.schemaVersion !== 1 || schemaEvidence.exactKeyCount !== 28) failures.push('Candidate evidence schema identity invalid');
if (schemaEvidence.exactCandidateVersion !== '2.2.0') failures.push('Candidate evidence target invalid');
if (schemaEvidence.fourSha256BindingsRequired !== true || schemaEvidence.constantTimeDigestComparisonRequired !== true) failures.push('Candidate digest governance incomplete');
if (schemaEvidence.rollbackEvidenceRequired !== true || schemaEvidence.secretFieldsProhibited !== true) failures.push('Candidate rollback or secret governance incomplete');
if (schemaEvidence.ownerGenerationApprovalGranted !== false || schemaEvidence.dependencyLockGenerationAuthorized !== false) failures.push('Candidate generation unexpectedly authorized');
if (schemaEvidence.dependencyAdoptionAuthorized !== false || schemaEvidence.previewActivationAuthorized !== false || schemaEvidence.productionMutationEnabled !== false) failures.push('Candidate downstream gate unexpectedly authorized');

if (failures.length) {
  console.error('MULTER CANDIDATE MANIFEST PLAN CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'multer-candidate-manifest-plan',
  currentDependency: expectedCurrent,
  selectedCandidate: expectedCandidate,
  exactSingleDependencyChangeRequired: true,
  scriptsContinuityRequired: true,
  nonMulterDependencyContinuityRequired: true,
  lifecycleScriptsProhibited: true,
  privateCandidateWorkspaceRequired: true,
  candidateEvidenceSchemaRequired: true,
  candidateEvidenceSchemaVersion: 1,
  candidateEvidenceExactKeyCount: 28,
  fourSha256BindingsRequired: true,
  constantTimeDigestComparisonRequired: true,
  rollbackEvidenceRequired: true,
  secretFieldsProhibited: true,
  committedManifestMutationAuthorized: false,
  committedLockMutationAuthorized: false,
  dependencyInstallationAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
