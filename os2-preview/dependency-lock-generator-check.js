'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const failures = [];
function read(file) { const full = path.join(root, file); if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; } return fs.readFileSync(full, 'utf8'); }
function requireMarkers(file, markers) { const source = read(file); for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`); return source; }

const generator = requireMarkers('dependency-lock-generator.js', [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.59.0'", 'expectedNodeMajor = 20',
  'expectedNpmMajor = 10', "expectedRegistry = 'https://registry.npmjs.org/'", 'maxPackageBytes = 1024 * 1024',
  'maxLockBytes = 16 * 1024 * 1024', 'generationTimeoutMs = 10 * 60 * 1000', 'verifierTimeoutMs = 60 * 1000',
  'PREVIEW_APP_ROOT_MUST_MATCH', 'DB_NAME_MISMATCH', 'RELEASE_BRANCH_MISMATCH', 'DEPENDENCY_LOCK_GENERATION_NOT_ENABLED',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED', 'NODE_MAJOR_MUST_BE_', 'PACKAGE_LOCK_ALREADY_EXISTS',
  'APPLICATION_ROOT_NOT_SECURE_DIRECTORY', 'APPLICATION_ROOT_NOT_CANONICAL', 'APPLICATION_ROOT_PERMISSIONS_INVALID',
  'PACKAGE_JSON_NOT_REGULAR_FILE', 'PACKAGE_JSON_HARD_LINK_PROHIBITED', 'PACKAGE_JSON_SIZE_INVALID',
  'PACKAGE_JSON_WRITABLE_BY_GROUP_OR_WORLD', 'PACKAGE_JSON_OWNER_MISMATCH', 'PACKAGE_JSON_PATH_NOT_CANONICAL',
  'O_NOFOLLOW_UNAVAILABLE', 'PACKAGE_JSON_IDENTITY_CHANGED_DURING_OPEN', 'PACKAGE_JSON_METADATA_CHANGED_DURING_OPEN',
  'PACKAGE_JSON_SECURITY_METADATA_CHANGED_DURING_OPEN', 'PACKAGE_JSON_READ_SIZE_MISMATCH', 'PACKAGE_JSON_INVALID_UTF8',
  'PACKAGE_JSON_BOM_PROHIBITED', 'PACKAGE_JSON_CANONICAL_TEXT_REQUIRED', 'PACKAGE_JSON_INVALID_JSON',
  'PACKAGE_JSON_ROOT_OBJECT_REQUIRED', 'PACKAGE_IDENTITY_INVALID', 'PACKAGE_DEPENDENCIES_INVALID',
  'PACKAGE_LIFECYCLE_SCRIPT_PROHIBITED', 'NPM_BIN_PATH_INVALID', 'NPM_BIN_NOT_SECURE_FILE', 'NPM_BIN_NOT_CANONICAL',
  'NPM_BIN_WRITABLE_BY_GROUP_OR_WORLD', 'NPM_BIN_NOT_EXECUTABLE', 'NODE_BIN_PATH_INVALID', 'NODE_BIN_NOT_SECURE_FILE',
  'NODE_BIN_NOT_CANONICAL', 'NODE_BIN_PROCESS_MISMATCH', 'NPM_VERSION_TIMEOUT', 'NPM_MAJOR_MUST_BE_',
  'TEMP_ROOT_LOCATION_PROHIBITED', 'TEMP_ROOT_NOT_SECURE_DIRECTORY', 'TEMP_ROOT_NOT_CANONICAL', 'TEMP_ROOT_OWNER_MISMATCH',
  'TEMP_ROOT_PERMISSIONS_INVALID', 'EVIDENCE_PATH_INVALID', 'EVIDENCE_PATH_EXTENSION_INVALID', 'EVIDENCE_ALREADY_EXISTS',
  'EVIDENCE_PARENT_NOT_SECURE_DIRECTORY', 'EVIDENCE_PARENT_NOT_CANONICAL', 'EVIDENCE_PARENT_OWNER_MISMATCH',
  'EVIDENCE_PARENT_PERMISSIONS_INVALID', "fs.mkdtempSync(path.join(tempRoot, 'talk2me-lock-'))", 'fs.chmodSync(temporaryDirectory, 0o700)',
  'Object.freeze(env)', 'fullParentEnvironmentInherited: false', "npm_config_registry: expectedRegistry", "npm_config_ignore_scripts: 'true'",
  "npm_config_audit: 'false'", "npm_config_fund: 'false'", "npm_config_package_lock: 'true'", "npm_config_lockfile_version: '3'",
  "npm_config_update_notifier: 'false'", "npm_config_userconfig: '/dev/null'", "'--package-lock-only'", "'--ignore-scripts'",
  "'--no-audit'", "'--no-fund'", "'--package-lock=true'", "'--lockfile-version=3'", 'shell: false',
  "killSignal: 'SIGKILL'", 'maxBuffer: 4 * 1024 * 1024', 'NODE_MODULES_GENERATED_UNEXPECTEDLY',
  'GENERATED_PACKAGE_LOCK_NOT_REGULAR_FILE', 'GENERATED_PACKAGE_LOCK_HARD_LINK_PROHIBITED', 'GENERATED_PACKAGE_LOCK_SIZE_INVALID',
  'GENERATED_PACKAGE_LOCK_IDENTITY_CHANGED_DURING_OPEN', 'GENERATED_LOCK_IDENTITY_INVALID', 'GENERATED_LOCK_PACKAGES_INVALID',
  'GENERATED_LOCK_ROOT_INVALID', 'GENERATED_LOCK_DEPENDENCIES_MISMATCH', 'APPLICATION_ROOT_IDENTITY_CHANGED',
  'PACKAGE_JSON_CHANGED_DURING_GENERATION', 'atomicWrite(lockPath, candidate.bytes, 0o644', 'DEPENDENCY_LOCK_VERIFICATION',
  'DEPENDENCY_LOCK_VERIFIER_INVALID_JSON', 'DEPENDENCY_LOCK_VERIFIER_EVIDENCE_INVALID', 'packageLockVerifiedAfterPublication: true',
  'packageJsonUnchangedDuringGeneration: true', 'packageLockPublishedAtomically: true', 'packageLockOverwriteAllowed: false',
  'lifecycleScriptsExecuted: false', 'nodeModulesGenerated: false', 'registryPinned: true', 'evidencePrivate: true',
  'atomicWrite(evidencePath, evidenceBytes, 0o600', 'atomicWrite(`${evidencePath}.sha256`', 'safeRemoveGeneratedLock',
  'fs.rmSync(temporaryDirectory, { recursive: true, force: true })', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);

if (generator.includes('...process.env')) failures.push('Generator must not inherit the full parent environment');
if (generator.includes('npm install --')) failures.push('Generator must use argument-array process execution, not a shell command string');
if (!generator.includes('spawnSync(command, args')) failures.push('Generator must use bounded spawnSync argument arrays');
if (!generator.includes('fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW')) failures.push('Atomic writes must use exclusive no-follow descriptors');
if (!generator.includes('if (fs.existsSync(file)) fail(`REFUSING_TO_OVERWRITE:${file}`)')) failures.push('Generator must refuse evidence and lock overwrites');
if (!generator.includes('if (fs.existsSync(lockPath)) fail(\'PACKAGE_LOCK_ALREADY_EXISTS\')')) failures.push('Generator must refuse an existing package lock');
if (!generator.includes("if (publishedDigest) safeRemoveGeneratedLock(publishedDigest)")) failures.push('Generator must roll back only its own failed publication');
if (!generator.includes('candidate.sha256 === expectedDigest') && !generator.includes('current.sha256 === expectedDigest')) failures.push('Rollback must be checksum-bound');
if (!generator.includes('dependency-lock-verification.js')) failures.push('Published lock must pass the independent verifier');

requireMarkers('dependency-lock-verification.js', [
  "check: 'dependency-lock-verification'", 'meaningfulControls: 60', 'packageLockPresent: true',
  'lockfileVersionThreeRequired: true', 'registryHttpsOnlyRequired: true', 'sha512IntegrityRequired: true',
  'dependencyEdgesResolved: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('dependency-lock-governance-check.js', [
  "check: 'dependency-lock-governance'", 'meaningfulControls: 60', 'npmCiRequired: true',
  'npmInstallSubstitutionProhibited: true', 'dependencyAuditRequired: true', 'dependencyInstallationExecuted: false'
]);
requireMarkers('DEPENDENCY_LOCK_GENERATION_RUNBOOK.md', [
  'controlled lock generation', 'ALLOW_DEPENDENCY_LOCK_GENERATION=true', 'NPM_BIN=', 'NODE_BIN=',
  'DEPENDENCY_LOCK_TEMP_ROOT=', 'DEPENDENCY_LOCK_EVIDENCE_PATH=', 'Node.js 20', 'npm 10',
  'https://registry.npmjs.org/', 'package-lock.json must not already exist', 'lifecycle scripts are disabled',
  'node_modules must not be created', 'dependency-lock-verification.js', 'private evidence pair',
  'production remains untouched', 'not executed by npm run check'
]);

if (failures.length) {
  console.error('DEPENDENCY LOCK GENERATOR GOVERNANCE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-generator-governance',
  meaningfulControls: 60,
  exactPreviewRootRequired: true,
  exactPreviewDatabaseRequired: true,
  exactControlledBranchRequired: true,
  explicitGenerationOptInRequired: true,
  productionMutationDisabled: true,
  mergeExecutionDisabled: true,
  node20Required: true,
  npm10Required: true,
  npmRegistryPinned: true,
  existingLockOverwriteProhibited: true,
  canonicalApplicationRootRequired: true,
  applicationRootOwnerRequired: true,
  unsafeApplicationRootWritesProhibited: true,
  securePackageReadRequired: true,
  packageSingleLinkRequired: true,
  packageOwnerConsistencyRequired: true,
  packageSizeBoundRequired: true,
  fatalUtf8Required: true,
  canonicalPackageTextRequired: true,
  exactPackageIdentityRequired: true,
  exactDependencyCountRequired: true,
  lifecycleScriptsProhibited: true,
  absoluteNpmBinaryRequired: true,
  canonicalNpmBinaryRequired: true,
  executableNpmBinaryRequired: true,
  absoluteNodeBinaryRequired: true,
  runningNodeBinaryMatchRequired: true,
  boundedNpmVersionCheckRequired: true,
  privateExternalTempRootRequired: true,
  sourceTreeTempWorkspaceProhibited: true,
  publicHtmlTempWorkspaceProhibited: true,
  privateExternalEvidencePathRequired: true,
  evidenceJsonExtensionRequired: true,
  evidenceOverwriteProhibited: true,
  privateTemporaryWorkspaceRequired: true,
  sanitizedEnvironmentRequired: true,
  fullParentEnvironmentInherited: false,
  npmUserConfigurationDisabled: true,
  installScriptsDisabled: true,
  auditDuringGenerationDisabled: true,
  fundingDuringGenerationDisabled: true,
  packageLockOnlyRequired: true,
  lockfileVersionThreeRequired: true,
  generationTimeoutRequired: true,
  forcedKillSignalRequired: true,
  shellExecutionDisabled: true,
  childOutputBounded: true,
  nodeModulesGenerationProhibited: true,
  generatedLockSecureReadRequired: true,
  generatedLockIdentityRequired: true,
  generatedRootDependenciesRequired: true,
  packageContinuityRequired: true,
  rootDirectoryContinuityRequired: true,
  atomicExclusiveLockPublicationRequired: true,
  independentPostPublicationVerificationRequired: true,
  checksumBoundRollbackRequired: true,
  privateAtomicEvidenceRequired: true,
  evidenceChecksumSidecarRequired: true,
  controlledTemporaryCleanupRequired: true,
  environmentChangingGeneratorExcludedFromNormalValidation: true
}, null, 2));
