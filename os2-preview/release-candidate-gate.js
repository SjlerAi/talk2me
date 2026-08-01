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

const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const migrations = fs.readdirSync(path.join(root,'migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const requiredRunbooks = [
  'PREVIEW_DEPLOYMENT_RUNBOOK.md','PREVIEW_UAT_RUNBOOK.md','SECURITY_OPERATIONS_RUNBOOK.md',
  'PRIVACY_OPERATIONS_RUNBOOK.md','BACKUP_AND_RECOVERY_RUNBOOK.md','CI_AND_BUILD_EVIDENCE_RUNBOOK.md'
];
const requiredChecks = [
  'architecture-check.js','deployment-check.js','uat-gate-check.js','security-check.js','privacy-check.js',
  'operations-check.js','ci-governance-check.js','schema-verification.js',
  'merge-restore-pin-check.js','merge-restore-evidence-verification.js',
  'customer-merge-execution-readiness-check.js','schema-source-consistency-check.js'
];
const requiredScripts = [
  'verify:schema','verify:merge-restore-evidence','check:merge-restore-pin','check:customer-merge-execution-readiness',
  'check:schema-source-consistency','check:readiness','check:deployment','check:uat-gate'
];
const restorePinMigration = '20260801_025_merge_authorisation_restore_pin.sql';
const explicitReleaseCommitSha = String(process.env.RELEASE_COMMIT_SHA || '').trim();
const githubCommitSha = String(process.env.GITHUB_SHA || '').trim();
const releaseCommitSha = explicitReleaseCommitSha || githubCommitSha;
const releaseApprovedBy = String(process.env.RELEASE_APPROVED_BY || '').trim();
const releaseChangeReference = String(process.env.RELEASE_CHANGE_REFERENCE || '').trim();
const releaseBranch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const output = String(process.env.RELEASE_MANIFEST_PATH || '').trim();

if (!/^0\.\d+\.0$/.test(pkg.version)) fail(`Unexpected preview version format: ${pkg.version}`);
if (migrations.length < 25) fail(`Expected at least 25 migrations, found ${migrations.length}`);
if (!migrations.includes(restorePinMigration)) fail(`Missing required migration: ${restorePinMigration}`);
for (const file of requiredRunbooks) if (!exists(file)) fail(`Missing runbook: ${file}`);
for (const file of requiredChecks) if (!exists(file)) fail(`Missing validation: ${file}`);
for (const script of requiredScripts) if (!pkg.scripts || !pkg.scripts[script]) fail(`Missing package command: ${script}`);

if (!exists('package-lock.json')) fail('package-lock.json is required before release-candidate freeze');
if (!releaseCommitSha) fail('RELEASE_COMMIT_SHA or GITHUB_SHA is required');
else if (!/^[0-9a-f]{40}$/i.test(releaseCommitSha)) fail('Release commit SHA must be a full 40-character hexadecimal SHA');
if (explicitReleaseCommitSha && githubCommitSha && explicitReleaseCommitSha.toLowerCase() !== githubCommitSha.toLowerCase()) {
  fail('RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated');
}
if (!releaseBranch) fail('RELEASE_BRANCH or GITHUB_REF_NAME is required');
else if (releaseBranch !== 'agent/talk2me-os2-integrated-rebuild') fail(`Unexpected release branch: ${releaseBranch}`);
if (!releaseApprovedBy) fail('RELEASE_APPROVED_BY is required');
if (!releaseChangeReference) fail('RELEASE_CHANGE_REFERENCE is required');
if (!output) fail('RELEASE_MANIFEST_PATH is required');
else if (!path.isAbsolute(output)) fail('RELEASE_MANIFEST_PATH must be absolute');

const readinessSource = exists('customer-merge-execution-readiness-routes.js')
  ? fs.readFileSync(path.join(root,'customer-merge-execution-readiness-routes.js'),'utf8')
  : '';
if (!readinessSource.includes('executionAvailable:false')) fail('Merge execution lock evidence is missing');
if (!readinessSource.includes('rt.id=a.restore_test_id')) fail('Exact pinned restore readiness join is missing');
if (!readinessSource.includes('restoreMatchesBackup')) fail('Restore-to-backup readiness evidence is missing');

const forbiddenRuntimeCreate = fs.readdirSync(root)
  .filter(name => name.endsWith('-routes.js') || name === 'server.js')
  .filter(name => /CREATE\s+TABLE/i.test(fs.readFileSync(path.join(root,name),'utf8')));
if (forbiddenRuntimeCreate.length) fail(`Runtime CREATE TABLE found in: ${forbiddenRuntimeCreate.join(', ')}`);

const dependencyLockChecksum = exists('package-lock.json') ? sha256('package-lock.json') : null;
const manifest = {
  ok: failures.length === 0,
  application: pkg.name,
  version: pkg.version,
  commitSha: releaseCommitSha || null,
  branch: releaseBranch || null,
  commitIdentityVerified: Boolean(
    releaseCommitSha &&
    /^[0-9a-f]{40}$/i.test(releaseCommitSha) &&
    (!explicitReleaseCommitSha || !githubCommitSha || explicitReleaseCommitSha.toLowerCase() === githubCommitSha.toLowerCase())
  ),
  approvedBy: releaseApprovedBy || null,
  changeReference: releaseChangeReference || null,
  generatedAt: new Date().toISOString(),
  dependencyLockPresent: Boolean(dependencyLockChecksum),
  dependencyLockSha256: dependencyLockChecksum,
  migrationCount: migrations.length,
  restorePinMigration,
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
  } else if (failures.length === 0) {
    fs.writeFileSync(output, JSON.stringify(manifest,null,2) + '\n', { mode:0o600, flag:'wx' });
  }
}

manifest.ok = failures.length === 0;
console.log(JSON.stringify(manifest,null,2));
if (failures.length) process.exit(1);
