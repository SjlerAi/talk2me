'use strict';

const fs = require('fs');
const path = require('path');

const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const root = __dirname;

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    check: 'workspace-topology-verification',
    error: message,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
  process.exit(1);
}

function validateDirectory(directory, label, expectedOwner) {
  let pathStat;
  try {
    pathStat = fs.lstatSync(directory);
  } catch {
    fail(`${label} is missing: ${directory}`);
  }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) fail(`${label} must be a real non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) fail(`${label} must not be group or world writable: ${directory}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) fail(`${label} owner differs from the preview application root: ${directory}`);

  let canonical;
  try {
    canonical = fs.realpathSync.native(directory);
  } catch {
    fail(`${label} cannot be resolved canonically: ${directory}`);
  }
  if (canonical !== directory) fail(`${label} path is not canonical: ${directory}`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') {
    fail('O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification');
  }

  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    fail(`Unable to securely open ${label.toLowerCase()}: ${directory}: ${error.message}`);
  }
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) fail(`${label} descriptor is not a directory: ${directory}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label} changed during secure open: ${directory}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) fail(`${label} descriptor is group or world writable: ${directory}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) fail(`${label} descriptor owner differs from the preview application root: ${directory}`);
    return { uid: descriptorStat.uid, dev: descriptorStat.dev, ino: descriptorStat.ino };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateProtectedFile(file, label, expectedOwner, required) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    if (!required) return false;
    fail(`${label} is missing: ${file}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${file}`);
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail(`${label} owner differs from the preview application root: ${file}`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label} must not be group or world writable: ${file}`);
  if (stat.nlink !== 1) fail(`${label} must not have additional hard links: ${file}`);
  return true;
}

const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
if (!configuredRoot) fail('PREVIEW_APP_ROOT is required');
if (!path.isAbsolute(configuredRoot)) fail('PREVIEW_APP_ROOT must be absolute');
if (path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT must be normalized');
if (configuredRoot !== root) fail(`PREVIEW_APP_ROOT must match the executing application root: ${root}`);
if (String(process.env.DB_NAME || '').trim() !== expectedDatabase) fail(`Workspace verification requires DB_NAME=${expectedDatabase}`);
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
if (branch !== expectedBranch) fail(`Workspace verification requires the controlled branch: ${expectedBranch}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('Workspace verification refuses ALLOW_PRODUCTION_MUTATION=true');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('Workspace verification refuses ENABLE_CUSTOMER_MERGE_EXECUTION=true');

const rootIdentity = validateDirectory(root, 'Preview application root');
const migrationsDirectory = path.join(root, 'migrations');
const migrationsIdentity = validateDirectory(migrationsDirectory, 'Migrations directory', rootIdentity.uid);
validateProtectedFile(path.join(root, 'package.json'), 'package.json', rootIdentity.uid, true);
const packageLockPresent = validateProtectedFile(path.join(root, 'package-lock.json'), 'package-lock.json', rootIdentity.uid, false);

const migrationNames = fs.readdirSync(migrationsDirectory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
if (migrationNames.length < 25) fail(`Expected at least 25 migration files, found ${migrationNames.length}`);
if (!migrationNames.includes('20260801_025_merge_authorisation_restore_pin.sql')) fail('Migration 025 is missing from the protected workspace');
for (const name of migrationNames) {
  if (path.basename(name) !== name) fail(`Invalid migration basename: ${name}`);
  validateProtectedFile(path.join(migrationsDirectory, name), `Migration ${name}`, rootIdentity.uid, true);
}

const rootAfter = fs.lstatSync(root);
const migrationsAfter = fs.lstatSync(migrationsDirectory);
if (rootAfter.dev !== rootIdentity.dev || rootAfter.ino !== rootIdentity.ino) fail('Preview application root changed during topology verification');
if (migrationsAfter.dev !== migrationsIdentity.dev || migrationsAfter.ino !== migrationsIdentity.ino) fail('Migrations directory changed during topology verification');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-topology-verification',
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  migrationCount: migrationNames.length,
  packageLockPresent,
  directoryNoFollowVerification: true,
  directoryDescriptorIdentityVerified: true,
  protectedFilesSymlinkFree: true,
  protectedFilesHardLinkFree: true,
  protectedPathsNotGroupWorldWritable: true,
  ownershipConsistent: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
