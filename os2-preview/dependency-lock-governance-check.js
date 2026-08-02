'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const failures = [];
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
  return source;
}

const verifier = requireMarkers('dependency-lock-verification.js', [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.59.0'",
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20', 'expectedLockfileVersion = 3', 'maxPackageBytes = 1024 * 1024',
  'maxLockBytes = 16 * 1024 * 1024', 'maxPackageEntries = 5000',
  "bcryptjs: '^2.4.3'", "express: '^4.19.2'", "multer: '^1.4.5-lts.1'",
  "mysql2: '^3.11.0'", "nodemailer: '^6.9.16'", "xlsx: '^0.18.5'",
  'PACKAGE_JSON_NOT_REGULAR_FILE', 'PACKAGE_LOCK_NOT_REGULAR_FILE', 'HARD_LINK_PROHIBITED',
  'WRITABLE_BY_GROUP_OR_WORLD', 'OWNER_MISMATCH', 'PATH_NOT_CANONICAL', 'O_NOFOLLOW_UNAVAILABLE',
  'IDENTITY_CHANGED_DURING_OPEN', 'METADATA_CHANGED_DURING_OPEN', 'READ_SIZE_MISMATCH',
  "new TextDecoder('utf-8', { fatal: true })", 'BOM_PROHIBITED', 'NUL_PROHIBITED',
  'CRLF_PROHIBITED', 'FINAL_NEWLINE_REQUIRED', 'ROOT_OBJECT_REQUIRED',
  'PREVIEW_APP_ROOT_MUST_MATCH', 'DB_NAME_MUST_BE', 'RELEASE_BRANCH_MUST_BE', 'NODE_MAJOR_MUST_BE',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'APPLICATION_ROOT_NOT_CANONICAL', 'APPLICATION_ROOT_WRITABLE_BY_GROUP_OR_WORLD',
  'PACKAGE_NAME_MISMATCH', 'PACKAGE_VERSION_MISMATCH', 'PACKAGE_PRIVATE_REQUIRED', 'PACKAGE_MAIN_MISMATCH',
  'PACKAGE_SCRIPTS_REQUIRED', 'PACKAGE_SCRIPT_INVALID', 'LIFECYCLE_SCRIPT_PROHIBITED',
  'DIRECT_DEPENDENCY_SET_MISMATCH', 'DIRECT_DEPENDENCY_SPEC_INVALID', 'DEV_DEPENDENCIES_PROHIBITED',
  'ROOT_OPTIONAL_DEPENDENCIES_PROHIBITED', 'BUNDLED_DEPENDENCIES_PROHIBITED', 'WORKSPACES_PROHIBITED',
  'LOCK_ROOT_IDENTITY_MISMATCH', 'LOCKFILE_VERSION_MUST_BE_3', 'LOCK_REQUIRES_TRUE_REQUIRED',
  'LOCK_PACKAGES_OBJECT_REQUIRED', 'LOCK_PACKAGE_COUNT_INVALID', 'LOCK_ROOT_PACKAGE_MISSING',
  'LOCK_PACKAGE_PATH_DUPLICATE', 'LOCK_ROOT_PACKAGE_IDENTITY_MISMATCH', 'LOCK_ROOT_DEPENDENCIES_MISMATCH',
  'LOCK_PACKAGE_PATH_INVALID', 'LOCK_PACKAGE_PATH_UNSAFE', 'LOCK_PACKAGE_RECORD_INVALID',
  'LOCK_PACKAGE_LINK_OR_BUNDLE_PROHIBITED', 'LOCK_DEV_PACKAGE_PROHIBITED', 'LOCK_INSTALL_SCRIPT_PROHIBITED',
  'LOCK_PACKAGE_VERSION_INVALID', 'LOCK_RESOLVED_URL_INVALID', 'LOCK_RESOLVED_URL_UNSAFE',
  'LOCK_INTEGRITY_INVALID', 'LOCK_ENGINES_INVALID', 'LOCK_DEPENDENCY_EDGE_UNRESOLVED',
  'DIRECT_DEPENDENCY_LOCK_ENTRY_MISSING', "check: 'dependency-lock-verification'", 'meaningfulControls: 60',
  'packageLockPresent: true', 'packageJsonSha256', 'packageLockSha256', 'verifiedDependencyEdges',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);

if (verifier.includes('...process.env')) failures.push('Dependency verifier must not inherit or copy the complete environment');
if (verifier.includes('npm install') || verifier.includes('npm ci')) failures.push('Dependency verifier must be read-only');
if (/writeFile|appendFile|renameSync|unlinkSync|rmSync|mkdirSync/.test(verifier)) failures.push('Dependency verifier must not write or delete files');
if (!verifier.includes("fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)")) failures.push('Dependency verifier must use O_NOFOLLOW reads');
if (!verifier.includes("record.resolved.startsWith('https://registry.npmjs.org/')")) failures.push('Dependency verifier must restrict tarballs to the npm registry over HTTPS');
if (!verifier.includes("/^sha512-")) failures.push('Dependency verifier must require SHA-512 package integrity');
if (!verifier.includes("lock.lockfileVersion !== expectedLockfileVersion")) failures.push('Dependency verifier must enforce lockfile version 3');
if (!verifier.includes("!exactObject(rootPackage.dependencies, expectedDirectDependencies)")) failures.push('Dependency verifier must bind root lock dependencies to package.json');
if (!verifier.includes('packageCandidatePaths(key, dependencyName)')) failures.push('Dependency verifier must resolve dependency graph edges');

const workflow = requireMarkers('../.github/workflows/os2-preview-ci.yml', [
  'name: OS2 Preview CI', "node-version: '20'", 'dependency-lock-verification.js',
  'dependency-lock-governance-check.js', 'npm ci --ignore-scripts --no-audit --no-fund',
  'npm audit --omit=dev --audit-level=high', 'package-lock.json', 'verify:workspace-source-integrity'
]);
if (workflow.includes('npm install --ignore-scripts')) failures.push('CI must not substitute npm install for npm ci');
if (workflow.includes('package-lock=false')) failures.push('CI must not bypass the committed dependency lock');
if (workflow.includes('::warning::package-lock.json is absent')) failures.push('Missing lockfile must be a hard failure, not a warning');

const preflight = requireMarkers('preview-activation-preflight.js', [
  "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  'dependencyLockVerified: true', 'dependencyLockGovernanceVerified: true',
  'packageLockRequired: true', 'dependencyInstallationExecuted: false'
]);
if (preflight.indexOf("'dependency-lock-verification.js'") >= preflight.indexOf("'workspace-source-integrity.js'")) failures.push('Dependency lock verification must precede workspace source hashing');
if (preflight.indexOf("'dependency-lock-governance-check.js'") >= preflight.indexOf("'workspace-source-integrity.js'")) failures.push('Dependency lock governance must precede workspace source hashing');

const sourceIntegrity = requireMarkers('workspace-source-integrity.js', [
  "['package-lock.json', 16 * 1024 * 1024]", "['dependency-lock-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-governance-check.js', 2 * 1024 * 1024]", 'packageLockPresent: true',
  'dependencyLockVerifierProtected: files.some', 'dependencyLockGovernanceProtected: files.some'
]);
if (sourceIntegrity.includes("if (fs.existsSync(path.join(root, 'package-lock.json')))")) failures.push('Protected source inventory must require, not conditionally include, package-lock.json');

requireMarkers('workspace-source-integrity-check.js', [
  "['package-lock.json', 16 * 1024 * 1024]", "['dependency-lock-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-governance-check.js', 2 * 1024 * 1024]", 'dependencyLockVerifierProtected: files.some',
  'dependencyLockGovernanceProtected: files.some', 'dependencyLockVerificationPreflightRegistrationRequired: true',
  'dependencyLockGovernancePreflightRegistrationRequired: true'
]);
requireMarkers('preview-activation-governance-check.js', [
  "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  'dependencyLockVerificationRequired: true', 'dependencyLockGovernanceRequired: true',
  'packageLockRequired: true', 'dependencyInstallationExecuted: false'
]);
requireMarkers('PREVIEW_ACTIVATION_RUNBOOK.md', [
  'Dependency lock verification', 'package-lock.json', 'lockfileVersion` must be `3`',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high',
  'missing lockfile is a hard stop', 'dependencyInstallationExecuted: false'
]);

if (failures.length) {
  console.error('DEPENDENCY LOCK GOVERNANCE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-governance',
  meaningfulControls: 60,
  verifierReadOnly: true,
  exactPreviewIdentityRequired: true,
  node20Required: true,
  packageLockRequired: true,
  lockfileVersionThreeRequired: true,
  securePackageJsonReadRequired: true,
  securePackageLockReadRequired: true,
  canonicalPathsRequired: true,
  symbolicLinksProhibited: true,
  hardLinksProhibited: true,
  ownerConsistencyRequired: true,
  unsafeWriteModesProhibited: true,
  descriptorIdentityRequired: true,
  descriptorMetadataStabilityRequired: true,
  boundedSourceReadsRequired: true,
  fatalUtf8Required: true,
  canonicalLineEndingsRequired: true,
  validJsonObjectsRequired: true,
  exactApplicationIdentityRequired: true,
  privatePackageRequired: true,
  exactMainEntrypointRequired: true,
  packageScriptsValidated: true,
  lifecycleScriptsProhibited: true,
  exactDirectDependenciesRequired: true,
  semverDependencySpecsRequired: true,
  devDependenciesProhibited: true,
  optionalRootDependenciesProhibited: true,
  bundledDependenciesProhibited: true,
  workspacesProhibited: true,
  exactLockRootRequired: true,
  boundedPackageEntryCountRequired: true,
  normalizedPackagePathsRequired: true,
  nodeModulesContainmentRequired: true,
  linkedPackagesProhibited: true,
  bundledPackagesProhibited: true,
  extraneousPackagesProhibited: true,
  devPackagesProhibited: true,
  installScriptsProhibited: true,
  semanticPackageVersionsRequired: true,
  npmRegistryHttpsRequired: true,
  resolvedUrlFragmentsProhibited: true,
  sha512IntegrityRequired: true,
  engineMetadataValidated: true,
  dependencyGraphEdgesRequired: true,
  directDependencyEntriesRequired: true,
  ciLockVerificationRequired: true,
  ciGovernanceVerificationRequired: true,
  npmCiRequired: true,
  npmInstallSubstitutionProhibited: true,
  lockBypassProhibited: true,
  dependencyAuditRequired: true,
  activationPreflightRegistrationRequired: true,
  sourceInventoryProtectionRequired: true,
  sourceGovernanceProtectionRequired: true,
  activationGovernanceRequired: true,
  runbookControlsRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  dependencyInstallationExecuted: false
}, null, 2));
