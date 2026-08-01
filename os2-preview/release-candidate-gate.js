'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const failures = [];
const warnings = [];

function exists(file) { return fs.existsSync(path.join(root, file)); }
function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'); }

const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const migrations = fs.readdirSync(path.join(root,'migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const requiredRunbooks = [
  'PREVIEW_DEPLOYMENT_RUNBOOK.md','PREVIEW_UAT_RUNBOOK.md','SECURITY_OPERATIONS_RUNBOOK.md',
  'PRIVACY_OPERATIONS_RUNBOOK.md','BACKUP_AND_RECOVERY_RUNBOOK.md','CI_AND_BUILD_EVIDENCE_RUNBOOK.md'
];
const requiredChecks = [
  'architecture-check.js','deployment-check.js','uat-gate-check.js','security-check.js','privacy-check.js',
  'operations-check.js','ci-governance-check.js','schema-verification.js'
];

if (!/^0\.\d+\.0$/.test(pkg.version)) fail(`Unexpected preview version format: ${pkg.version}`);
if (migrations.length < 11) fail(`Expected at least 11 migrations, found ${migrations.length}`);
for (const file of requiredRunbooks) if (!exists(file)) fail(`Missing runbook: ${file}`);
for (const file of requiredChecks) if (!exists(file)) fail(`Missing validation: ${file}`);

if (!exists('package-lock.json')) fail('package-lock.json is required before release-candidate freeze');
if (!process.env.GITHUB_SHA && !process.env.RELEASE_COMMIT_SHA) warn('No release commit SHA supplied');
if (!process.env.RELEASE_APPROVED_BY) warn('No release approver recorded');
if (!process.env.RELEASE_CHANGE_REFERENCE) warn('No release change reference recorded');

const forbiddenRuntimeCreate = fs.readdirSync(root)
  .filter(name => name.endsWith('-routes.js') || name === 'server.js')
  .filter(name => /CREATE\s+TABLE/i.test(fs.readFileSync(path.join(root,name),'utf8')));
if (forbiddenRuntimeCreate.length) fail(`Runtime CREATE TABLE found in: ${forbiddenRuntimeCreate.join(', ')}`);

const manifest = {
  ok: failures.length === 0,
  application: pkg.name,
  version: pkg.version,
  commitSha: process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || null,
  approvedBy: process.env.RELEASE_APPROVED_BY || null,
  changeReference: process.env.RELEASE_CHANGE_REFERENCE || null,
  generatedAt: new Date().toISOString(),
  migrationCount: migrations.length,
  migrationChecksums: migrations.map(file => ({ file, sha256: sha256(path.join('migrations',file)) })),
  requiredRunbooks,
  requiredChecks,
  failures,
  warnings
};

const output = process.env.RELEASE_MANIFEST_PATH;
if (output) {
  if (!path.isAbsolute(output)) fail('RELEASE_MANIFEST_PATH must be absolute');
  else fs.writeFileSync(output, JSON.stringify(manifest,null,2), { mode:0o600 });
}

console.log(JSON.stringify(manifest,null,2));
if (failures.length) process.exit(1);
