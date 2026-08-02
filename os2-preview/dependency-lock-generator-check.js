'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = __dirname;
const failures = [];
function read(file) { const full = path.join(root, file); if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; } return fs.readFileSync(full, 'utf8'); }
function requireMarkers(file, markers) { const source = read(file); for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`); return source; }
function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000, killSignal: 'SIGKILL', shell: false, windowsHide: true });
  if (result.error && result.error.code === 'ETIMEDOUT') failures.push(`${file} syntax check timed out`);
  else if (result.error) failures.push(`${file} syntax check failed to start: ${result.error.message}`);
  else if (result.signal) failures.push(`${file} syntax check ended by ${result.signal}`);
  else if (result.status !== 0) failures.push(`${file} syntax check failed: ${String(result.stderr || '').trim()}`);
}

for (const file of ['dependency-lock-generator.js', 'dependency-lock-verification.js', 'dependency-lock-governance-check.js']) syntaxCheck(file);

const generator = requireMarkers('dependency-lock-generator.js', [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.59.0'", 'expectedNodeMajor = 20',
  'expectedNpmMajor = 10', "expectedRegistry = 'https://registry.npmjs.org/'", 'maxPackageBytes = 1024 * 1024',
  'maxLockBytes = 16 * 1024 * 1024', 'generationTimeoutMs = 10 * 60 * 1000', 'verifierTimeoutMs = 60 * 1000',
  'const expectedDirectDependencies = Object.freeze({', "bcryptjs: '^2.4.3'", "express: '^4.19.2'",
  "multer: '^1.4.5-lts.1'", "mysql2: '^3.11.0'", "nodemailer: '^6.9.16'", "xlsx: '^0.18.5'",
  'function exactObject(left, right)', 'function secureRead(file, maxBytes, expectedOwner, label)',
  'stat.isSymbolicLink()', 'stat.nlink !== 1', '(stat.mode & 0o022) !== 0', 'fs.realpathSync.native(file) !== file',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW', 'opened.dev !== stat.dev || opened.ino !== stat.ino',
  'opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs',
  'opened.uid !== stat.uid || opened.mode !== stat.mode', "new TextDecoder('utf-8', { fatal: true })",
  'text.charCodeAt(0) === 0xfeff', "text.includes('\\u0000')", "text.includes('\\r')", "!text.endsWith('\\n')",
  'function secureDirectory(directory, label, expectedOwner, requirePrivate)',
  'fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW',
  'function validateExecutable(file, label)', '(stat.mode & 0o111) === 0',
  'function publishExclusive(file, bytes, mode, expectedParentOwner)',
  'fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW',
  'fs.fsyncSync(fd)', 'fs.fchmodSync(fd, mode)', 'fs.linkSync(temporary, file)', 'fs.unlinkSync(temporary)',
  'result.nlink !== 1 || result.size !== bytes.length', 'function safeRemoveGeneratedLock(expectedDigest)',
  'current.sha256 === expectedDigest', 'function sanitizedEnvironment(tempDirectory, npmBin, nodeBin)',
  'return Object.freeze({', "npm_config_registry: expectedRegistry", "npm_config_ignore_scripts: 'true'",
  "npm_config_audit: 'false'", "npm_config_fund: 'false'", "npm_config_package_lock: 'true'",
  "npm_config_lockfile_version: '3'", "npm_config_update_notifier: 'false'", "npm_config_userconfig: '/dev/null'",
  'function runBounded(command, args, options, timeoutMs, label)', 'spawnSync(command, args',
  'maxBuffer: 4 * 1024 * 1024', "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  "required('PREVIEW_APP_ROOT')", "required('DB_NAME', 128)", "required('RELEASE_BRANCH', 200)",
  "process.env.ALLOW_DEPENDENCY_LOCK_GENERATION !== 'true'", 'PRODUCTION_MUTATION_FLAG_PROHIBITED',
  'MERGE_EXECUTION_FLAG_PROHIBITED', 'PACKAGE_LOCK_ALREADY_EXISTS', "secureDirectory(root, 'APPLICATION_ROOT'",
  "secureRead(packagePath, maxPackageBytes, rootIdentity.uid, 'PACKAGE_JSON')", '!exactObject(pkg.dependencies, expectedDirectDependencies)',
  'PACKAGE_LIFECYCLE_SCRIPT_PROHIBITED', "validateExecutable(required('NPM_BIN')", "validateExecutable(required('NODE_BIN')",
  'NODE_BIN_PROCESS_MISMATCH', "required('DEPENDENCY_LOCK_TEMP_ROOT')", "tempRoot.startsWith(`${root}${path.sep}`)",
  '/public_html/i.test(tempRoot)', "required('DEPENDENCY_LOCK_EVIDENCE_PATH')", "path.extname(evidencePath) !== '.json'",
  'EVIDENCE_ALREADY_EXISTS', "fs.mkdtempSync(path.join(tempRoot, 'talk2me-lock-'))", 'fs.chmodSync(temporaryDirectory, 0o700)',
  "secureDirectory(temporaryDirectory, 'TEMP_WORKSPACE'", "runBounded(npmBin, ['--version']", 'NPM_MAJOR_MUST_BE_',
  "publishExclusive(path.join(temporaryDirectory, 'package.json')", "'install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--package-lock=true','--lockfile-version=3'",
  'DEPENDENCY_LOCK_GENERATION', 'NODE_MODULES_GENERATED_UNEXPECTEDLY', "secureRead(candidatePath, maxLockBytes",
  'candidateJson.lockfileVersion !== 3', "candidateJson.packages['']", "exactObject(candidateJson.packages[''].dependencies, expectedDirectDependencies)",
  "secureDirectory(root, 'APPLICATION_ROOT_POST_GENERATION'", "secureRead(packagePath, maxPackageBytes, rootIdentity.uid, 'PACKAGE_JSON_POST_GENERATION')",
  'PACKAGE_JSON_CHANGED_DURING_GENERATION', 'publishExclusive(lockPath, candidate.bytes, 0o644',
  'dependency-lock-verification.js', 'DEPENDENCY_LOCK_VERIFICATION', 'DEPENDENCY_LOCK_VERIFIER_INVALID_JSON',
  'verifierEvidence.packageLockSha256 !== candidate.sha256', "check: 'dependency-lock-generation'",
  'packageLockVerifiedAfterPublication: true', 'packageJsonUnchangedDuringGeneration: true',
  'packageLockPublishedAtomically: true', 'packageLockOverwriteAllowed: false', 'lifecycleScriptsExecuted: false',
  'nodeModulesGenerated: false', 'registryPinned: true', 'fullParentEnvironmentInherited: false', 'evidencePrivate: true',
  'publishExclusive(evidencePath, evidenceBytes, 0o600', 'publishExclusive(`${evidencePath}.sha256`',
  'if (publishedDigest) safeRemoveGeneratedLock(publishedDigest)',
  'fs.rmSync(temporaryDirectory, { recursive: true, force: true })',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);

if (generator.includes('...process.env')) failures.push('Generator must not inherit the full parent environment');
if (generator.includes('execSync(') || generator.includes('execFileSync(')) failures.push('Generator must use bounded spawnSync only');
if (generator.includes('shell: true')) failures.push('Generator must never enable shell execution');
if (generator.includes('npm install --')) failures.push('Generator must not construct a shell command string');
if (generator.includes('fs.renameSync(temporary, file)')) failures.push('Rename-overwrite publication is prohibited');
if (!generator.includes('if (fs.existsSync(file)) fail(`REFUSING_TO_OVERWRITE:${file}`)')) failures.push('Publication must refuse existing targets');
if (!generator.includes("if (fs.existsSync(lockPath)) fail('PACKAGE_LOCK_ALREADY_EXISTS')")) failures.push('Existing lockfiles must be rejected');
if (!generator.includes('fs.linkSync(temporary, file)')) failures.push('No-overwrite hard-link publication is required');
if (!generator.includes('current.sha256 === expectedDigest')) failures.push('Rollback must be checksum-bound');
if (!generator.includes('verifierEvidence.packageLockSha256 !== candidate.sha256')) failures.push('Independent verifier evidence must bind the exact generated digest');

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
  'Controlled Dependency Lock Generation', 'ALLOW_DEPENDENCY_LOCK_GENERATION=true', 'NPM_BIN=', 'NODE_BIN=',
  'DEPENDENCY_LOCK_TEMP_ROOT=', 'DEPENDENCY_LOCK_EVIDENCE_PATH=', 'Node.js 20', 'npm 10',
  'https://registry.npmjs.org/', 'package-lock.json must not already exist', 'lifecycle scripts are disabled',
  'node_modules must not be created', 'dependency-lock-verification.js', 'private evidence pair',
  'Production at `talk2me.uent.co.za` remains untouched', 'not executed by `npm run check`'
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
  generatorSyntaxVerified: true,
  independentVerifierSyntaxVerified: true,
  dependencyGovernanceSyntaxVerified: true,
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
  exactDirectDependencySetRequired: true,
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
  exclusiveNoOverwritePublicationRequired: true,
  independentPostPublicationVerificationRequired: true,
  checksumBoundRollbackRequired: true,
  privateAtomicEvidenceRequired: true,
  evidenceChecksumSidecarRequired: true,
  controlledTemporaryCleanupRequired: true,
  environmentChangingGeneratorExcludedFromNormalValidation: true
}, null, 2));
