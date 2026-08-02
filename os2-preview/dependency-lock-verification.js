'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const root = __dirname;
const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.60.0';
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const expectedLockfileVersion = 3;
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const maxPackageBytes = 1024 * 1024;
const maxLockBytes = 16 * 1024 * 1024;
const maxPackageEntries = 5000;
const prohibitedLifecycleScripts = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack'];
const expectedDirectDependencies = Object.freeze({
  bcryptjs: '^2.4.3',
  express: '^4.19.2',
  multer: '^1.4.5-lts.1',
  mysql2: '^3.11.0',
  nodemailer: '^6.9.16',
  xlsx: '^0.18.5'
});

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'dependency-lock-verification', error: message, packageLockPresent: fs.existsSync(lockPath), productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exactObject(left, right) {
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function secureRead(file, maxBytes, expectedOwner, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { fail(`${label}_MISSING`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`${label}_NOT_REGULAR_FILE`);
  if (pathStat.nlink !== 1) fail(`${label}_HARD_LINK_PROHIBITED`);
  if (pathStat.size <= 0 || pathStat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_PATH_NOT_CANONICAL`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW_UNAVAILABLE');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) fail(`${label}_DESCRIPTOR_NOT_REGULAR`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (descriptorStat.nlink !== 1) fail(`${label}_DESCRIPTOR_HARD_LINK_PROHIBITED`);
    if (descriptorStat.size !== pathStat.size || descriptorStat.mtimeMs !== pathStat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    if (descriptorStat.mode !== pathStat.mode || descriptorStat.uid !== pathStat.uid) fail(`${label}_SECURITY_METADATA_CHANGED_DURING_OPEN`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) fail(`${label}_READ_SIZE_MISMATCH`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${label}_INVALID_UTF8`); }
    if (text.charCodeAt(0) === 0xfeff) fail(`${label}_BOM_PROHIBITED`);
    if (text.includes('\u0000')) fail(`${label}_NUL_PROHIBITED`);
    if (text.includes('\r')) fail(`${label}_CRLF_PROHIBITED`);
    if (!text.endsWith('\n')) fail(`${label}_FINAL_NEWLINE_REQUIRED`);
    return { text, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), uid: descriptorStat.uid };
  } finally { fs.closeSync(descriptor); }
}
function parseJson(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { fail(`${label}_INVALID_JSON`); }
  if (!plainObject(value)) fail(`${label}_ROOT_OBJECT_REQUIRED`);
  return value;
}
function validateDependencySpec(name, spec) {
  if (typeof spec !== 'string' || !/^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) fail(`DIRECT_DEPENDENCY_SPEC_INVALID:${name}`);
}
function packageCandidatePaths(packageKey, dependencyName) {
  const parts = packageKey ? packageKey.split('/') : [];
  const candidates = [];
  while (true) {
    const base = parts.join('/');
    candidates.push(`${base ? `${base}/` : ''}node_modules/${dependencyName}`);
    const nodeModulesIndex = parts.lastIndexOf('node_modules');
    if (nodeModulesIndex < 0) break;
    parts.splice(Math.max(0, nodeModulesIndex - 1));
  }
  candidates.push(`node_modules/${dependencyName}`);
  return [...new Set(candidates)];
}
function validatePackageKey(key) {
  if (key === '') return;
  if (key.includes('\\') || key.startsWith('/') || key.endsWith('/') || key.includes('//')) fail(`LOCK_PACKAGE_PATH_INVALID:${key}`);
  if (path.posix.normalize(key) !== key || key.split('/').includes('..') || !key.startsWith('node_modules/')) fail(`LOCK_PACKAGE_PATH_UNSAFE:${key}`);
}

const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
if (configuredRoot !== root) fail(`PREVIEW_APP_ROOT_MUST_MATCH:${root}`);
if (String(process.env.DB_NAME || '').trim() !== expectedDatabase) fail(`DB_NAME_MUST_BE:${expectedDatabase}`);
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
if (branch !== expectedBranch) fail(`RELEASE_BRANCH_MUST_BE:${expectedBranch}`);
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor !== expectedNodeMajor) fail(`NODE_MAJOR_MUST_BE:${expectedNodeMajor}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');

const rootStat = fs.lstatSync(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('APPLICATION_ROOT_NOT_SECURE_DIRECTORY');
if (fs.realpathSync.native(root) !== root) fail('APPLICATION_ROOT_NOT_CANONICAL');
if (process.platform !== 'win32' && (rootStat.mode & 0o022) !== 0) fail('APPLICATION_ROOT_WRITABLE_BY_GROUP_OR_WORLD');
const packageEvidence = secureRead(packagePath, maxPackageBytes, rootStat.uid, 'PACKAGE_JSON');
const lockEvidence = secureRead(lockPath, maxLockBytes, rootStat.uid, 'PACKAGE_LOCK');
const pkg = parseJson(packageEvidence.text, 'PACKAGE_JSON');
const lock = parseJson(lockEvidence.text, 'PACKAGE_LOCK');

if (pkg.name !== expectedApplication) fail('PACKAGE_NAME_MISMATCH');
if (pkg.version !== expectedVersion) fail('PACKAGE_VERSION_MISMATCH');
if (pkg.private !== true) fail('PACKAGE_PRIVATE_REQUIRED');
if (pkg.main !== 'server.js') fail('PACKAGE_MAIN_MISMATCH');
if (!plainObject(pkg.scripts) || Object.keys(pkg.scripts).length < 1) fail('PACKAGE_SCRIPTS_REQUIRED');
for (const [name, command] of Object.entries(pkg.scripts)) {
  if (typeof command !== 'string' || !command.trim() || command !== command.trim() || /[\u0000-\u001f\u007f]/.test(command)) fail(`PACKAGE_SCRIPT_INVALID:${name}`);
}
for (const name of prohibitedLifecycleScripts) if (Object.prototype.hasOwnProperty.call(pkg.scripts, name)) fail(`LIFECYCLE_SCRIPT_PROHIBITED:${name}`);
if (!exactObject(pkg.dependencies, expectedDirectDependencies)) fail('DIRECT_DEPENDENCY_SET_MISMATCH');
for (const [name, spec] of Object.entries(pkg.dependencies)) validateDependencySpec(name, spec);
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) fail('DEV_DEPENDENCIES_PROHIBITED');
if (pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).length) fail('ROOT_OPTIONAL_DEPENDENCIES_PROHIBITED');
if (pkg.bundleDependencies || pkg.bundledDependencies) fail('BUNDLED_DEPENDENCIES_PROHIBITED');
if (pkg.workspaces) fail('WORKSPACES_PROHIBITED');

if (lock.name !== expectedApplication || lock.version !== expectedVersion) fail('LOCK_ROOT_IDENTITY_MISMATCH');
if (lock.lockfileVersion !== expectedLockfileVersion) fail('LOCKFILE_VERSION_MUST_BE_3');
if (lock.requires !== true) fail('LOCK_REQUIRES_TRUE_REQUIRED');
if (!plainObject(lock.packages)) fail('LOCK_PACKAGES_OBJECT_REQUIRED');
const packageKeys = Object.keys(lock.packages);
if (packageKeys.length < Object.keys(expectedDirectDependencies).length + 1 || packageKeys.length > maxPackageEntries) fail('LOCK_PACKAGE_COUNT_INVALID');
if (!Object.prototype.hasOwnProperty.call(lock.packages, '')) fail('LOCK_ROOT_PACKAGE_MISSING');
if (new Set(packageKeys).size !== packageKeys.length) fail('LOCK_PACKAGE_PATH_DUPLICATE');
const rootPackage = lock.packages[''];
if (!plainObject(rootPackage)) fail('LOCK_ROOT_PACKAGE_INVALID');
if (rootPackage.name !== expectedApplication || rootPackage.version !== expectedVersion) fail('LOCK_ROOT_PACKAGE_IDENTITY_MISMATCH');
if (!exactObject(rootPackage.dependencies, expectedDirectDependencies)) fail('LOCK_ROOT_DEPENDENCIES_MISMATCH');
if (rootPackage.devDependencies && Object.keys(rootPackage.devDependencies).length) fail('LOCK_ROOT_DEV_DEPENDENCIES_PROHIBITED');
if (rootPackage.optionalDependencies && Object.keys(rootPackage.optionalDependencies).length) fail('LOCK_ROOT_OPTIONAL_DEPENDENCIES_PROHIBITED');

let installScriptPackageCount = 0;
let devPackageCount = 0;
let verifiedDependencyEdges = 0;
const resolvedUrls = new Set();
for (const key of packageKeys) {
  validatePackageKey(key);
  const record = lock.packages[key];
  if (!plainObject(record)) fail(`LOCK_PACKAGE_RECORD_INVALID:${key}`);
  if (key === '') continue;
  if (record.link === true || record.inBundle === true || record.extraneous === true) fail(`LOCK_PACKAGE_LINK_OR_BUNDLE_PROHIBITED:${key}`);
  if (record.dev === true) { devPackageCount += 1; fail(`LOCK_DEV_PACKAGE_PROHIBITED:${key}`); }
  if (record.hasInstallScript === true) { installScriptPackageCount += 1; fail(`LOCK_INSTALL_SCRIPT_PROHIBITED:${key}`); }
  if (typeof record.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(record.version)) fail(`LOCK_PACKAGE_VERSION_INVALID:${key}`);
  if (typeof record.resolved !== 'string' || !record.resolved.startsWith('https://registry.npmjs.org/') || /[\u0000-\u001f\u007f]/.test(record.resolved)) fail(`LOCK_RESOLVED_URL_INVALID:${key}`);
  if (record.resolved.includes('#') || record.resolved.includes('?') || resolvedUrls.has(`${key}\0${record.resolved}`)) fail(`LOCK_RESOLVED_URL_UNSAFE:${key}`);
  resolvedUrls.add(`${key}\0${record.resolved}`);
  if (typeof record.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity)) fail(`LOCK_INTEGRITY_INVALID:${key}`);
  if (record.engines && (!plainObject(record.engines) || Object.values(record.engines).some(value => typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)))) fail(`LOCK_ENGINES_INVALID:${key}`);
  for (const field of ['dependencies', 'optionalDependencies']) {
    if (!record[field]) continue;
    if (!plainObject(record[field])) fail(`LOCK_${field.toUpperCase()}_INVALID:${key}`);
    for (const dependencyName of Object.keys(record[field])) {
      if (!packageCandidatePaths(key, dependencyName).some(candidate => Object.prototype.hasOwnProperty.call(lock.packages, candidate))) fail(`LOCK_DEPENDENCY_EDGE_UNRESOLVED:${key}:${dependencyName}`);
      verifiedDependencyEdges += 1;
    }
  }
}
for (const name of Object.keys(expectedDirectDependencies)) {
  const key = `node_modules/${name}`;
  if (!plainObject(lock.packages[key])) fail(`DIRECT_DEPENDENCY_LOCK_ENTRY_MISSING:${name}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-verification',
  meaningfulControls: 60,
  application: expectedApplication,
  version: expectedVersion,
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  nodeVersion: process.versions.node,
  packageLockPresent: true,
  packageJsonBytes: packageEvidence.bytes,
  packageLockBytes: lockEvidence.bytes,
  packageJsonSha256: packageEvidence.sha256,
  packageLockSha256: lockEvidence.sha256,
  lockfileVersion: lock.lockfileVersion,
  packageEntryCount: packageKeys.length,
  directDependencyCount: Object.keys(expectedDirectDependencies).length,
  verifiedDependencyEdges,
  installScriptPackageCount,
  devPackageCount,
  exactPreviewRootRequired: true,
  exactPreviewDatabaseRequired: true,
  exactControlledBranchRequired: true,
  node20Required: true,
  productionMutationDisabled: true,
  mergeExecutionDisabled: true,
  canonicalApplicationRootRequired: true,
  privateApplicationRootRequired: true,
  packageJsonRegularFileRequired: true,
  packageLockRegularFileRequired: true,
  symbolicLinksProhibited: true,
  additionalHardLinksProhibited: true,
  sourceOwnerConsistencyRequired: true,
  groupWorldWriteProhibited: true,
  sourceSizeBoundsRequired: true,
  noFollowDescriptorReadsRequired: true,
  pathDescriptorIdentityRequired: true,
  descriptorMetadataStabilityRequired: true,
  exactReadByteCountRequired: true,
  fatalUtf8DecodingRequired: true,
  byteOrderMarkProhibited: true,
  nulBytesProhibited: true,
  crlfProhibited: true,
  finalNewlineRequired: true,
  jsonObjectRootsRequired: true,
  exactPackageIdentityRequired: true,
  privatePackageRequired: true,
  exactMainEntrypointRequired: true,
  packageScriptsValidated: true,
  lifecycleScriptsProhibited: true,
  exactDirectDependencySetRequired: true,
  directDependencySpecsValidated: true,
  rootDevDependenciesProhibited: true,
  rootOptionalDependenciesProhibited: true,
  bundledDependenciesProhibited: true,
  workspacesProhibited: true,
  exactLockIdentityRequired: true,
  lockfileVersionThreeRequired: true,
  lockRequiresTrueRequired: true,
  packageCountBounded: true,
  lockRootPackageRequired: true,
  duplicatePackagePathsProhibited: true,
  normalizedPackagePathsRequired: true,
  nodeModulesContainmentRequired: true,
  linkedPackagesProhibited: true,
  bundledPackagesProhibited: true,
  extraneousPackagesProhibited: true,
  devPackagesProhibited: true,
  installScriptsProhibited: true,
  semanticPackageVersionsRequired: true,
  registryHttpsOnlyRequired: true,
  resolvedUrlFragmentsQueriesProhibited: true,
  sha512IntegrityRequired: true,
  engineMetadataValidated: true,
  dependencyEdgesResolved: true,
  directDependencyEntriesRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
