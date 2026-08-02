'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'multer-candidate-evidence-verification.js');
const expectedKeys = [
  'schemaVersion','check','ok','repository','branch','sourceCommit','application','applicationVersion',
  'currentMulter','candidateMulter','approvalPhrase','approvingOwner','approvedAt','generatedAt',
  'sourcePackageSha256','candidatePackageSha256','candidateLockSha256','sourceInventorySha256',
  'onlyMulterDependencyChanged','sourceManifestUnchanged','committedLockUnchanged','lifecycleScriptsExecuted',
  'sourceTreeNodeModulesCreated','dependencyAdoptionAuthorized','previewActivationAuthorized',
  'productionMutationEnabled','rollbackRequired','rollbackCompleted'
];

function canonical(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function write(file, bytes) { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function baseline(root) {
  const sourcePackage = {
    name: 'talk2me-os2-preview', version: '0.60.0', private: true, main: 'server.js',
    scripts: { start: 'node server.js' },
    dependencies: { bcryptjs: '^2.4.3', express: '^4.19.2', multer: '^1.4.5-lts.1', mysql2: '^3.11.0', nodemailer: '^6.9.16', xlsx: '^0.18.5' }
  };
  const candidatePackage = clone(sourcePackage);
  candidatePackage.dependencies.multer = '2.2.0';
  const candidateLock = { name: 'talk2me-os2-preview', version: '0.60.0', lockfileVersion: 3, packages: { '': { dependencies: candidatePackage.dependencies } } };
  const inventory = Buffer.from('protected-source-inventory-v1\n', 'utf8');
  const sourceBytes = canonical(sourcePackage);
  const candidateBytes = canonical(candidatePackage);
  const lockBytes = canonical(candidateLock);
  const approvedAt = '2026-08-02T12:00:00.000Z';
  const generatedAt = '2026-08-02T13:00:00.000Z';
  const sourceCommit = 'a'.repeat(40);
  const approval = {
    phrase: 'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION', owner: 'SjlerAi', approvedAt,
    sourceCommit, branch: 'agent/talk2me-os2-integrated-rebuild', application: 'talk2me-os2-preview',
    applicationVersion: '0.60.0', candidateMulter: '2.2.0'
  };
  const evidence = {
    schemaVersion: 1, check: 'multer-2-candidate-evidence', ok: true, repository: 'SjlerAi/talk2me',
    branch: 'agent/talk2me-os2-integrated-rebuild', sourceCommit, application: 'talk2me-os2-preview',
    applicationVersion: '0.60.0', currentMulter: '^1.4.5-lts.1', candidateMulter: '2.2.0',
    approvalPhrase: approval.phrase, approvingOwner: approval.owner, approvedAt, generatedAt,
    sourcePackageSha256: sha256(sourceBytes), candidatePackageSha256: sha256(candidateBytes),
    candidateLockSha256: sha256(lockBytes), sourceInventorySha256: sha256(inventory),
    onlyMulterDependencyChanged: true, sourceManifestUnchanged: true, committedLockUnchanged: true,
    lifecycleScriptsExecuted: false, sourceTreeNodeModulesCreated: false, dependencyAdoptionAuthorized: false,
    previewActivationAuthorized: false, productionMutationEnabled: false, rollbackRequired: false, rollbackCompleted: false
  };
  const files = {
    evidence: path.join(root, 'evidence.json'), approval: path.join(root, 'approval.json'),
    source: path.join(root, 'source-package.json'), candidate: path.join(root, 'candidate-package.json'),
    lock: path.join(root, 'candidate-lock.json'), inventory: path.join(root, 'source-inventory.txt')
  };
  return { evidence, approval, sourcePackage, candidatePackage, candidateLock, inventory, files };
}

function materialize(state) {
  write(state.files.evidence, canonical(state.evidence));
  write(state.files.approval, canonical(state.approval));
  write(state.files.source, canonical(state.sourcePackage));
  write(state.files.candidate, canonical(state.candidatePackage));
  write(state.files.lock, canonical(state.candidateLock));
  write(state.files.inventory, state.inventory);
}

function run(state) {
  const env = {
    PATH: process.env.PATH || '', NODE_ENV: 'test',
    MULTER_CANDIDATE_EVIDENCE_PATH: state.files.evidence,
    MULTER_GENERATION_APPROVAL_PATH: state.files.approval,
    MULTER_SOURCE_PACKAGE_PATH: state.files.source,
    MULTER_CANDIDATE_PACKAGE_PATH: state.files.candidate,
    MULTER_CANDIDATE_LOCK_PATH: state.files.lock,
    MULTER_SOURCE_INVENTORY_PATH: state.files.inventory
  };
  return spawnSync(process.execPath, [verifier], { cwd: __dirname, env, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024, shell: false });
}

function executeCase(name, mutate, expectedCode, shouldPass = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-evidence-regression-'));
  try {
    const state = baseline(root);
    mutate(state);
    materialize(state);
    const result = run(state);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (shouldPass) {
      if (result.status !== 0 || !output.includes('multer-candidate-evidence-verification')) throw new Error(`${name} expected success: ${output}`);
    } else if (result.status === 0 || !output.includes(expectedCode)) {
      throw new Error(`${name} expected ${expectedCode}: ${output}`);
    }
    return true;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases = {};
cases.validBaselineAccepted = executeCase('valid baseline', () => {}, '', true);
cases.extraKeyRejected = executeCase('extra key', s => { s.evidence.extra = true; }, 'EVIDENCE_KEYS_INVALID');
cases.reorderedKeysRejected = executeCase('reordered keys', s => { const reordered = {}; [...expectedKeys].reverse().forEach(k => { reordered[k] = s.evidence[k]; }); s.evidence = reordered; }, 'EVIDENCE_KEYS_INVALID');
cases.staleApprovalRejected = executeCase('stale approval', s => { s.evidence.generatedAt = '2026-08-03T12:00:00.001Z'; }, 'APPROVAL_WINDOW_INVALID');
cases.commitMismatchRejected = executeCase('commit mismatch', s => { s.approval.sourceCommit = 'b'.repeat(40); }, 'APPROVAL_BINDING_INVALID');
cases.ownerMismatchRejected = executeCase('owner mismatch', s => { s.approval.owner = 'OtherOwner'; }, 'APPROVAL_BINDING_INVALID');
cases.extraManifestChangeRejected = executeCase('extra manifest change', s => { s.candidatePackage.private = false; s.evidence.candidatePackageSha256 = sha256(canonical(s.candidatePackage)); }, 'CANDIDATE_PACKAGE_DIFF_INVALID');
cases.badSourceDigestRejected = executeCase('bad source digest', s => { s.evidence.sourcePackageSha256 = '0'.repeat(64); }, 'SOURCE_PACKAGE_DIGEST_MISMATCH');
cases.badLockDigestRejected = executeCase('bad lock digest', s => { s.evidence.candidateLockSha256 = '0'.repeat(64); }, 'CANDIDATE_LOCK_DIGEST_MISMATCH');
cases.rollbackIncompleteRejected = executeCase('rollback incomplete', s => { s.evidence.rollbackRequired = true; }, 'ROLLBACK_INCOMPLETE');
cases.adoptionFlagRejected = executeCase('adoption flag', s => { s.evidence.dependencyAdoptionAuthorized = true; }, 'DEPENDENCYADOPTIONAUTHORIZED_PROHIBITED');
cases.previewFlagRejected = executeCase('preview flag', s => { s.evidence.previewActivationAuthorized = true; }, 'PREVIEWACTIVATIONAUTHORIZED_PROHIBITED');
cases.productionFlagRejected = executeCase('production flag', s => { s.evidence.productionMutationEnabled = true; }, 'PRODUCTIONMUTATIONENABLED_PROHIBITED');
cases.lifecycleFlagRejected = executeCase('lifecycle flag', s => { s.evidence.lifecycleScriptsExecuted = true; }, 'LIFECYCLESCRIPTSEXECUTED_PROHIBITED');

console.log(JSON.stringify({
  ok: true,
  check: 'multer-candidate-evidence-negative-regression',
  caseCount: Object.keys(cases).length,
  cases,
  isolatedTemporaryFilesOnly: true,
  externalNetworkUsed: false,
  databaseConfigured: false,
  sourceTreeMutationEnabled: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
