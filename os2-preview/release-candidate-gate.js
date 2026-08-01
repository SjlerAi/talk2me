'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const failures = [];
const warnings = [];

function exists(file) { return fs.existsSync(path.join(root, file)); }
function fail(message) { failures.push(message); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'); }
function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function writePrivateTemp(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
function removeIfPresent(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function validatePrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Release manifest directory must be a regular non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error(`Release manifest directory permissions must not allow group or world access: ${directory}`);
  if (fs.realpathSync(directory) !== path.resolve(directory)) throw new Error(`Release manifest directory must resolve to its exact path: ${directory}`);
}
function publishEvidencePair(manifestPath, manifestText, checksumText) {
  const checksumPath = `${manifestPath}.sha256`;
  const directory = path.dirname(manifestPath);
  const nonce = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  const manifestTemp = `${manifestPath}.${nonce}.tmp`;
  const checksumTemp = `${checksumPath}.${nonce}.tmp`;
  let checksumPublished = false;
  let manifestPublished = false;
  try {
    writePrivateTemp(manifestTemp, manifestText);
    writePrivateTemp(checksumTemp, checksumText);
    fs.linkSync(checksumTemp, checksumPath);
    checksumPublished = true;
    fs.linkSync(manifestTemp, manifestPath);
    manifestPublished = true;
    syncDirectory(directory);
  } catch (error) {
    if (manifestPublished) removeIfPresent(manifestPath);
    if (checksumPublished) removeIfPresent(checksumPath);
    syncDirectory(directory);
    throw error;
  } finally {
    removeIfPresent(manifestTemp);
    removeIfPresent(checksumTemp);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const migrations = fs.readdirSync(path.join(root,'migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const requiredRunbooks = [
  'PREVIEW_DEPLOYMENT_RUNBOOK.md','PREVIEW_UAT_RUNBOOK.md','SECURITY_OPERATIONS_RUNBOOK.md',
  'PRIVACY_OPERATIONS_RUNBOOK.md','BACKUP_AND_RECOVERY_RUNBOOK.md','CI_AND_BUILD_EVIDENCE_RUNBOOK.md'
];
const requiredChecks = [
  'architecture-check.js','deployment-check.js','uat-gate-check.js','security-check.js','privacy-check.js',
  'operations-check.js','ci-governance-check.js','schema-verification.js','preview-data-verification.js',
  'runtime-release-identity-check.js','migration-ledger-bootstrap-governance-check.js','migration-runner-security-check.js',
  'merge-restore-pin-check.js','merge-restore-evidence-verification.js',
  'customer-merge-execution-readiness-check.js','schema-source-consistency-check.js'
];
const requiredScripts = [
  'verify:schema','verify:merge-restore-evidence','verify:preview-data','verify:runtime-release-identity',
  'check:migration-ledger-bootstrap','check:migration-runner-security','check:merge-restore-pin',
  'check:customer-merge-execution-readiness','check:schema-source-consistency',
  'check:readiness','check:deployment','check:uat-gate'
];
const restorePinMigration = '20260801_025_merge_authorisation_restore_pin.sql';
const bootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const explicitReleaseCommitSha = String(process.env.RELEASE_COMMIT_SHA || '').trim();
const githubCommitSha = String(process.env.GITHUB_SHA || '').trim();
const releaseCommitSha = explicitReleaseCommitSha || githubCommitSha;
const releaseApprovedBy = String(process.env.RELEASE_APPROVED_BY || '').trim();
const releaseChangeReference = String(process.env.RELEASE_CHANGE_REFERENCE || '').trim();
const releaseBranch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const output = String(process.env.RELEASE_MANIFEST_PATH || '').trim();
const checksumOutput = output ? `${output}.sha256` : '';

if (pkg.name !== 'talk2me-os2-preview') fail(`Unexpected preview package name: ${pkg.name}`);
if (!/^0\.\d+\.0$/.test(pkg.version)) fail(`Unexpected preview version format: ${pkg.version}`);
if (migrations.length < 25) fail(`Expected at least 25 migrations, found ${migrations.length}`);
if (!migrations.includes(restorePinMigration)) fail(`Missing required migration: ${restorePinMigration}`);
if (!exists(bootstrapFile)) fail(`Missing migration ledger bootstrap: ${bootstrapFile}`);
for (const file of requiredRunbooks) if (!exists(file)) fail(`Missing runbook: ${file}`);
for (const file of requiredChecks) if (!exists(file)) fail(`Missing validation: ${file}`);
for (const script of requiredScripts) if (!pkg.scripts || !pkg.scripts[script]) fail(`Missing package command: ${script}`);

if (!exists('package-lock.json')) fail('package-lock.json is required before release-candidate freeze');
if (!releaseCommitSha) fail('RELEASE_COMMIT_SHA or GITHUB_SHA is required');
else if (!/^[0-9a-f]{40}$/i.test(releaseCommitSha)) fail('Release commit SHA must be a full 40-character hexadecimal SHA');
if (explicitReleaseCommitSha && githubCommitSha && explicitReleaseCommitSha.toLowerCase() !== githubCommitSha.toLowerCase()) fail('RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated');
if (!releaseBranch) fail('RELEASE_BRANCH or GITHUB_REF_NAME is required');
else if (releaseBranch !== 'agent/talk2me-os2-integrated-rebuild') fail(`Unexpected release branch: ${releaseBranch}`);
if (!releaseApprovedBy) fail('RELEASE_APPROVED_BY is required');
if (!releaseChangeReference) fail('RELEASE_CHANGE_REFERENCE is required');
if (!output) fail('RELEASE_MANIFEST_PATH is required');
else if (!path.isAbsolute(output)) fail('RELEASE_MANIFEST_PATH must be absolute');

const bootstrapGovernanceSource = exists('migration-ledger-bootstrap-governance-check.js')
  ? fs.readFileSync(path.join(root,'migration-ledger-bootstrap-governance-check.js'),'utf8') : '';
if (!bootstrapGovernanceSource.includes('runtimeLedgerCreationDisabled: true')) fail('Bootstrap runtime-creation lock is missing');
if (!bootstrapGovernanceSource.includes('workspaceProtectionRequired: true')) fail('Bootstrap workspace protection is missing');
if (!bootstrapGovernanceSource.includes('previewDatabaseOnly: true')) fail('Bootstrap preview database guard is missing');

const runtimeIdentitySource = exists('runtime-release-identity-check.js')
  ? fs.readFileSync(path.join(root,'runtime-release-identity-check.js'),'utf8') : '';
if (!runtimeIdentitySource.includes("expectedApplication = 'talk2me-os2-preview'")) fail('Runtime release application identity guard is missing');
if (!runtimeIdentitySource.includes("expectedVersion = '0.59.0'")) fail('Runtime release version guard is missing');
if (!runtimeIdentitySource.includes('expectedNodeMajor = 20')) fail('Runtime release Node.js major guard is missing');
if (!runtimeIdentitySource.includes("process.env.DB_NAME !== 'kloka_talk2me'")) fail('Runtime release preview database guard is missing');
if (!runtimeIdentitySource.includes('productionMutationEnabled: false')) fail('Runtime production mutation lock is missing');
if (!runtimeIdentitySource.includes('mergeExecutionEnabled: false')) fail('Runtime merge execution lock is missing');

const previewDataSource = exists('preview-data-verification.js')
  ? fs.readFileSync(path.join(root,'preview-data-verification.js'),'utf8') : '';
if (!previewDataSource.includes("expectedDatabase = 'kloka_talk2me'")) fail('Preview data verification database guard is missing');
if (previewDataSource.indexOf("'schema-verification.js'") > previewDataSource.indexOf("'merge-restore-evidence-verification.js'")) fail('Preview data verification order is invalid');
if (!previewDataSource.includes("stdio: 'inherit'")) fail('Preview data verification must inherit verifier output');
if (!previewDataSource.includes('mergeExecutionEnabled: false')) fail('Preview data verification merge execution lock is missing');

const readinessSource = exists('customer-merge-execution-readiness-routes.js')
  ? fs.readFileSync(path.join(root,'customer-merge-execution-readiness-routes.js'),'utf8') : '';
if (!readinessSource.includes('executionAvailable:false')) fail('Merge execution lock evidence is missing');
if (!readinessSource.includes('rt.id=a.restore_test_id')) fail('Exact pinned restore readiness join is missing');
if (!readinessSource.includes('restoreMatchesBackup')) fail('Restore-to-backup readiness evidence is missing');

const forbiddenRuntimeCreate = fs.readdirSync(root)
  .filter(name => name.endsWith('-routes.js') || name === 'server.js')
  .filter(name => /CREATE\s+TABLE/i.test(fs.readFileSync(path.join(root,name),'utf8')));
if (forbiddenRuntimeCreate.length) fail(`Runtime CREATE TABLE found in: ${forbiddenRuntimeCreate.join(', ')}`);

const packageJsonChecksum = sha256('package.json');
const dependencyLockChecksum = exists('package-lock.json') ? sha256('package-lock.json') : null;
const bootstrapChecksum = exists(bootstrapFile) ? sha256(bootstrapFile) : null;
const manifest = {
  ok: failures.length === 0,
  application: pkg.name,
  version: pkg.version,
  packageJsonSha256: packageJsonChecksum,
  commitSha: releaseCommitSha || null,
  branch: releaseBranch || null,
  commitIdentityVerified: Boolean(releaseCommitSha && /^[0-9a-f]{40}$/i.test(releaseCommitSha) && (!explicitReleaseCommitSha || !githubCommitSha || explicitReleaseCommitSha.toLowerCase() === githubCommitSha.toLowerCase())),
  approvedBy: releaseApprovedBy || null,
  changeReference: releaseChangeReference || null,
  generatedAt: new Date().toISOString(),
  dependencyLockPresent: Boolean(dependencyLockChecksum),
  dependencyLockSha256: dependencyLockChecksum,
  migrationLedgerBootstrapFile: bootstrapFile,
  migrationLedgerBootstrapSha256: bootstrapChecksum,
  migrationLedgerBootstrapGovernanceRequired: true,
  runtimeLedgerCreationDisabled: true,
  migrationCount: migrations.length,
  restorePinMigration,
  previewDataVerificationRequired: true,
  previewDataVerificationOrder: ['schema-verification.js','merge-restore-evidence-verification.js'],
  runtimeReleaseIdentityVerificationRequired: true,
  mergeExecutionEnabled: false,
  migrationChecksums: migrations.map(file => ({ file, sha256: sha256(path.join('migrations',file)) })),
  requiredRunbooks,
  requiredChecks,
  requiredScripts,
  failures,
  warnings
};

if (output && path.isAbsolute(output)) {
  const outputDirectory = path.dirname(output);
  if (!fs.existsSync(outputDirectory)) {
    fail(`Release manifest directory does not exist: ${outputDirectory}`);
    manifest.ok = false;
  } else {
    try { validatePrivateDirectory(outputDirectory); }
    catch (error) { fail(error.message); manifest.ok = false; }
  }
  if (fs.existsSync(output)) {
    fail(`Release manifest already exists: ${output}`);
    manifest.ok = false;
  } else if (fs.existsSync(checksumOutput)) {
    fail(`Release manifest checksum already exists: ${checksumOutput}`);
    manifest.ok = false;
  } else if (failures.length === 0) {
    const manifestText = JSON.stringify(manifest,null,2) + '\n';
    const manifestChecksum = sha256Text(manifestText);
    const checksumText = `${manifestChecksum}  ${path.basename(output)}\n`;
    try { publishEvidencePair(output, manifestText, checksumText); }
    catch (error) { fail(`Release evidence publication failed: ${error.message}`); manifest.ok = false; }
  }
}

manifest.ok = failures.length === 0;
console.log(JSON.stringify(manifest,null,2));
if (failures.length) process.exit(1);
