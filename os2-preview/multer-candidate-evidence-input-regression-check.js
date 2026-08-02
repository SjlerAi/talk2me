'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'multer-candidate-evidence-verification.js');
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
function envFor(state) {
  return {
    PATH: process.env.PATH || '', NODE_ENV: 'test',
    MULTER_CANDIDATE_EVIDENCE_PATH: state.files.evidence,
    MULTER_GENERATION_APPROVAL_PATH: state.files.approval,
    MULTER_SOURCE_PACKAGE_PATH: state.files.source,
    MULTER_CANDIDATE_PACKAGE_PATH: state.files.candidate,
    MULTER_CANDIDATE_LOCK_PATH: state.files.lock,
    MULTER_SOURCE_INVENTORY_PATH: state.files.inventory
  };
}
function run(state, mutateEnv) {
  const env = envFor(state);
  if (mutateEnv) mutateEnv(env, state);
  return spawnSync(process.execPath, [verifier], { cwd: __dirname, env, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024, shell: false });
}
function executeCase(name, afterMaterialize, expectedCode, shouldPass = false, mutateEnv) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-evidence-input-'));
  try {
    const state = baseline(root);
    materialize(state);
    if (afterMaterialize) afterMaterialize(state, root);
    const result = run(state, mutateEnv);
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
cases.validCanonicalInputsAccepted = executeCase('valid canonical inputs', null, '', true);
cases.relativePathRejected = executeCase('relative path', null, 'EVIDENCE_PATH_INVALID', false, env => { env.MULTER_CANDIDATE_EVIDENCE_PATH = 'evidence.json'; });
cases.nonNormalizedPathRejected = executeCase('non-normalized path', null, 'EVIDENCE_PATH_INVALID', false, (env, state) => { env.MULTER_CANDIDATE_EVIDENCE_PATH = `${path.dirname(state.files.evidence)}${path.sep}.${path.sep}${path.basename(state.files.evidence)}`; });
cases.symlinkRejected = executeCase('symlink', (state, root) => { const link = path.join(root, 'evidence-link.json'); fs.symlinkSync(state.files.evidence, link); state.files.evidence = link; }, 'EVIDENCE_NOT_REGULAR_FILE');
cases.hardLinkRejected = executeCase('hard link', (state, root) => { const link = path.join(root, 'evidence-hardlink.json'); fs.linkSync(state.files.evidence, link); state.files.evidence = link; }, 'EVIDENCE_NOT_REGULAR_FILE');
cases.missingFileRejected = executeCase('missing file', state => { fs.unlinkSync(state.files.evidence); }, 'EVIDENCE_READ_FAILED');
cases.directoryRejected = executeCase('directory path', null, 'EVIDENCE_NOT_REGULAR_FILE', false, (env, state) => { env.MULTER_CANDIDATE_EVIDENCE_PATH = path.dirname(state.files.evidence); });
cases.overlongEnvironmentPathRejected = executeCase('overlong environment path', null, 'INVALID_MULTER_CANDIDATE_EVIDENCE_PATH', false, env => { env.MULTER_CANDIDATE_EVIDENCE_PATH = `/${'a'.repeat(4097)}`; });
cases.controlCharacterEnvironmentPathRejected = executeCase('control character environment path', null, 'INVALID_MULTER_CANDIDATE_EVIDENCE_PATH', false, (env, state) => { env.MULTER_CANDIDATE_EVIDENCE_PATH = `${state.files.evidence}\n`; });
cases.emptyFileRejected = executeCase('empty file', state => { fs.truncateSync(state.files.evidence, 0); }, 'EVIDENCE_SIZE_INVALID');
cases.oversizedJsonRejected = executeCase('oversized json', state => { fs.writeFileSync(state.files.evidence, Buffer.alloc(128 * 1024 + 1, 0x20)); }, 'EVIDENCE_SIZE_INVALID');
cases.oversizedLockRejected = executeCase('oversized lock', state => { fs.writeFileSync(state.files.lock, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20)); }, 'CANDIDATE_LOCK_SIZE_INVALID');
cases.crlfJsonRejected = executeCase('crlf json', state => { const text = fs.readFileSync(state.files.evidence, 'utf8').replace(/\n/g, '\r\n'); fs.writeFileSync(state.files.evidence, text); }, 'EVIDENCE_CANONICAL_JSON_REQUIRED');
cases.missingFinalNewlineRejected = executeCase('missing final newline', state => { const bytes = fs.readFileSync(state.files.evidence); fs.writeFileSync(state.files.evidence, bytes.subarray(0, bytes.length - 1)); }, 'EVIDENCE_CANONICAL_JSON_REQUIRED');
cases.invalidUtf8Rejected = executeCase('invalid utf8', state => { fs.writeFileSync(state.files.evidence, Buffer.from([0xff, 0xfe, 0xfd, 0x0a])); }, 'EVIDENCE_CANONICAL_JSON_REQUIRED');
cases.arrayJsonRejected = executeCase('array json', state => { fs.writeFileSync(state.files.evidence, canonical([])); }, 'EVIDENCE_OBJECT_REQUIRED');
cases.nullJsonRejected = executeCase('null json', state => { fs.writeFileSync(state.files.evidence, canonical(null)); }, 'EVIDENCE_OBJECT_REQUIRED');

console.log(JSON.stringify({
  ok: true,
  check: 'multer-candidate-evidence-input-regression',
  caseCount: Object.keys(cases).length,
  cases,
  canonicalJsonRequired: true,
  absoluteNormalizedPathsRequired: true,
  singleLinkRegularFilesRequired: true,
  boundedInputsRequired: true,
  descriptorBoundReadsRequired: true,
  missingAndDirectoryInputsRejected: true,
  boundedEnvironmentPathsRequired: true,
  controlCharactersProhibited: true,
  isolatedTemporaryFilesOnly: true,
  externalNetworkUsed: false,
  databaseConfigured: false,
  sourceTreeMutationEnabled: false,
  dependencyAdoptionAuthorized: false,
  previewActivationAuthorized: false,
  productionMutationEnabled: false
}, null, 2));
