'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    check: 'runtime-release-identity',
    error: message
  }, null, 2));
  process.exit(1);
}

const root = __dirname;
const packagePath = path.join(root, 'package.json');
let packageStat;
try {
  packageStat = fs.lstatSync(packagePath);
} catch {
  fail('package.json is missing');
}
if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
  fail('package.json must be a regular non-symlink file');
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
} catch {
  fail('package.json is not valid JSON');
}

const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.59.0';
const expectedNodeMajor = 20;
const actualNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (pkg.name !== expectedApplication) {
  fail(`Unexpected application identity: ${pkg.name || 'missing'}`);
}
if (pkg.version !== expectedVersion) {
  fail(`Unexpected preview version: ${pkg.version || 'missing'}`);
}
if (!Number.isInteger(actualNodeMajor) || actualNodeMajor !== expectedNodeMajor) {
  fail(`Node.js ${expectedNodeMajor}.x is required; found ${process.versions.node}`);
}
if (process.env.DB_NAME && process.env.DB_NAME !== 'kloka_talk2me') {
  fail(`Runtime identity check refuses non-preview database: ${process.env.DB_NAME}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'runtime-release-identity',
  application: pkg.name,
  version: pkg.version,
  nodeVersion: process.versions.node,
  expectedNodeMajor,
  database: process.env.DB_NAME || null,
  previewDatabaseRequiredWhenConfigured: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
