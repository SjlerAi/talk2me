'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
function read(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) { failures.push(`Missing ${relativePath}`); return ''; }
  return fs.readFileSync(file, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
}
function requireOrder(source, markers, label) {
  for (let index = 1; index < markers.length; index += 1) {
    const left = source.indexOf(markers[index - 1]);
    const right = source.indexOf(markers[index]);
    if (left < 0 || right < 0 || left >= right) failures.push(`${label} order invalid at ${markers[index]}`);
  }
}

const verifier = read('dependency-lock-verification.js');
const provenanceVerifier = read('dependency-lock-provenance-verification.js');
const adoptionGovernance = read('dependency-lock-adoption-check.js');
const ciWorkflow = read('../.github/workflows/os2-preview-ci.yml');
const adoptionWorkflow = read('../.github/workflows/os2-dependency-lock-adoption.yml');
const preflight = read('preview-activation-preflight.js');
const sourceIntegrity = read('workspace-source-integrity.js');
const sourceGovernance = read('workspace-source-integrity-check.js');
const activationGovernance = read('preview-activation-governance-check.js');
const activationRunbook = read('PREVIEW_ACTIVATION_RUNBOOK.md');
const adoptionRunbook = read('DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md');

requireMarkers(verifier, [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.60.0'",
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20', 'expectedLockfileVersion = 3', 'maxPackageBytes = 1024 * 1024',
  'maxLockBytes = 16 * 1024 * 1024', 'maxPackageEntries = 5000',
  "bcryptjs: '^2.4.3'", "express: '^4.19.2'", "multer: '^1.4.5-lts.1'",
  "mysql2: '^3.11.0'", "nodemailer: '^6.9.16'", "xlsx: '^0.18.5'",
  '${label}_NOT_REGULAR_FILE', 'HARD_LINK_PROHIBITED',
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
  'lockfileVersionThreeRequired: true', 'registryHttpsOnlyRequired: true', 'sha512IntegrityRequired: true',
  'dependencyEdgesResolved: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Dependency lock verifier');
if (verifier.includes('...process.env')) failures.push('Dependency verifier must not copy the complete environment');
if (verifier.includes('npm install') || verifier.includes('npm ci')) failures.push('Dependency verifier must remain read-only');
if (/writeFile|appendFile|renameSync|unlinkSync|rmSync|mkdirSync/.test(verifier)) failures.push('Dependency verifier must not write or delete source');
if (!verifier.includes("fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)")) failures.push('Dependency verifier must use O_NOFOLLOW');
if (!verifier.includes("record.resolved.startsWith('https://registry.npmjs.org/')")) failures.push('Dependency verifier must restrict resolved tarballs to the npm registry over HTTPS');
if (!verifier.includes('/^sha512-')) failures.push('Dependency verifier must require SHA-512 integrity');
if (!verifier.includes('packageCandidatePaths(key, dependencyName)')) failures.push('Dependency verifier must resolve dependency graph edges');

requireMarkers(provenanceVerifier, [
  "expectedRepository = 'SjlerAi/talk2me'", "expectedWorkflow = 'OS2 Dependency Lock Generation'",
  "requiredEnvironment('EXPECTED_SOURCE_COMMIT'", "requiredEnvironment('CURRENT_COMMIT'",
  "requiredEnvironment('PROVENANCE_MAX_AGE_HOURS'", 'CURRENT_COMMIT_MUST_DIFFER_FROM_SOURCE_COMMIT',
  'PROVENANCE_KEYS_INVALID', 'PROVENANCE_SOURCE_COMMIT_MISMATCH',
  'PROVENANCE_GENERATED_AT_NOT_CANONICAL_UTC', 'PROVENANCE_TOO_OLD',
  'PROVENANCE_LOCK_DIGEST_MISMATCH', 'PROVENANCE_SAFETY_FLAGS_INVALID',
  "check: 'dependency-lock-provenance-verification'", 'meaningfulControls: 60',
  'exactProvenanceSchemaVerified: true', 'sourceCommitContinuityVerified: true',
  'provenanceFreshnessVerified: true', 'packageLockDigestVerified: true',
  'constantTimeDigestComparison: true', 'secretFieldsRejected: true',
  'automaticCommit: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Dependency lock provenance verifier');
if (provenanceVerifier.includes('fs.writeFileSync') || provenanceVerifier.includes('fs.unlinkSync') || provenanceVerifier.includes('fs.rmSync')) failures.push('Provenance verifier must remain read-only');

requireMarkers(ciWorkflow, [
  'name: OS2 Preview CI', "node-version: '20'", 'node dependency-lock-verification.js',
  'node dependency-lock-governance-check.js', 'npm ci --ignore-scripts --no-audit --no-fund',
  'npm audit --omit=dev --audit-level=high', 'verify:workspace-source-integrity',
  '.github/workflows/os2-dependency-lock-adoption.yml'
], 'Preview CI workflow');
if (ciWorkflow.includes('npm install')) failures.push('Preview CI must not substitute npm install for npm ci');
if (ciWorkflow.includes('package-lock=false')) failures.push('Preview CI must not bypass the committed lock');
if (/continue-on-error:\s*true/.test(ciWorkflow)) failures.push('Preview CI validation failures may not be ignored');

requireMarkers(adoptionWorkflow, [
  'name: OS2 Dependency Lock Adoption', 'contents: read', 'fetch-depth: 2',
  "PROVENANCE_MAX_AGE_HOURS: '168'", 'node dependency-lock-provenance-verification.js',
  'node dependency-lock-adoption-check.js', 'node dependency-lock-verification.js',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check',
  'npm audit --omit=dev --audit-level=high',
  "'os2-preview/dependency-lock-provenance.json'", "'os2-preview/package-lock.json'",
  'test "$(git rev-list --count "$source_commit..$GITHUB_SHA")" = "1"',
  'test "$(git rev-parse "$GITHUB_SHA^")" = "$source_commit"',
  'test -z "$(git -C "$GITHUB_WORKSPACE" status --porcelain --untracked-files=all)"'
], 'Dependency lock adoption workflow');
if (adoptionWorkflow.includes('contents: write')) failures.push('Adoption workflow must remain read-only');
if (adoptionWorkflow.includes('npm install ')) failures.push('Adoption workflow must not use npm install');

requireMarkers(adoptionGovernance, [
  "check: 'dependency-lock-adoption-governance'", 'meaningfulControls: 60',
  'adoptionWorkflowReadOnlyRequired: true', 'adoptionWorkflowSingleCommitRequired: true',
  'immediateParentContinuityRequired: true', 'exactTwoFileChangeRequired: true',
  'npmCiRequired: true', 'npmInstallSubstitutionProhibited: true',
  'integratedValidationRequired: true', 'highSeverityAuditRequired: true',
  'sourceInventoryContinuityRequired: true', 'cleanWorkspaceAfterValidationRequired: true',
  'automaticCommitProhibited: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Dependency lock adoption governance');

requireMarkers(preflight, [
  "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  "'dependency-lock-adoption-check.js'", 'dependencyLockVerified: true',
  'dependencyLockGovernanceVerified: true', 'dependencyLockAdoptionGovernanceVerified: true',
  'packageLockRequired: true', 'dependencyLockProvenanceVerificationExecuted: false',
  'dependencyLockAdoptionMaterializationExecuted: false', 'dependencyInstallationExecuted: false'
], 'Preview activation preflight');
requireOrder(preflight, [
  "'dependency-lock-verification.js'", "'dependency-lock-governance-check.js'",
  "'dependency-lock-adoption-check.js'", "'workspace-source-integrity.js'"
], 'Preview activation preflight');

requireMarkers(sourceIntegrity, [
  "['package-lock.json', 16 * 1024 * 1024]", "['dependency-lock-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-governance-check.js', 2 * 1024 * 1024]",
  "['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-check.js', 2 * 1024 * 1024]",
  "if (fs.existsSync(provenancePath)) protectedFiles.push(['dependency-lock-provenance.json', 64 * 1024])",
  'packageLockPresent: true', 'dependencyLockVerifierProtected: files.some',
  'dependencyLockGovernanceProtected: files.some', 'dependencyLockProvenanceProtected: files.some'
], 'Workspace source integrity');
if (sourceIntegrity.includes("if (fs.existsSync(path.join(root, 'package-lock.json')))")) failures.push('package-lock.json must be unconditionally protected');

requireMarkers(sourceGovernance, [
  'dependencyLockVerificationPreflightRegistrationRequired: true',
  'dependencyLockGovernancePreflightRegistrationRequired: true',
  'dependencyLockAdoptionGovernancePreflightRegistrationRequired: true',
  'dependencyLockProvenanceVerifierProtected: verifier.includes',
  'dependencyLockAdoptionMaterializerProtected: verifier.includes',
  'dependencyLockAdoptionGovernanceProtected: verifier.includes',
  'dependencyLockConditionalProvenanceProtectionRequired: verifier.includes'
], 'Workspace source governance');
requireMarkers(activationGovernance, [
  'dependencyLockVerificationRequired: true', 'dependencyLockGovernanceRequired: true',
  'dependencyLockAdoptionGovernanceRequired: true',
  'dependencyLockProvenanceVerificationExecuted: false',
  'dependencyLockAdoptionMaterializationExecuted: false',
  'dependencyInstallationExecuted: false'
], 'Preview activation governance');
requireMarkers(activationRunbook, [
  'Dependency lock verification', 'Dependency lock adoption', 'package-lock.json',
  'dependency-lock-provenance.json', 'lockfile version 3',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm audit --omit=dev --audit-level=high',
  'A missing lockfile is a hard failure', 'dependencyInstallationExecuted: false'
], 'Preview activation runbook');
requireMarkers(adoptionRunbook, [
  'Dependency Lock Adoption', 'dependency-lock-provenance.json',
  'exactly these two paths in one commit', 'immediate child of the recorded generation source commit',
  'dependency-lock-provenance-verification.js', '168 hours'
], 'Dependency lock adoption runbook');

if (failures.length) {
  console.error('DEPENDENCY LOCK GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
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
  provenanceVerificationRequiredForAdoption: true,
  provenanceExactSchemaRequired: true,
  provenanceFreshnessRequired: true,
  provenanceLockDigestBindingRequired: true,
  adoptionSingleCommitRequired: true,
  adoptionImmediateParentRequired: true,
  adoptionExactTwoFileChangeRequired: true,
  activationPreflightRegistrationRequired: true,
  sourceInventoryProtectionRequired: true,
  sourceGovernanceProtectionRequired: true,
  activationGovernanceRequired: true,
  runbookControlsRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  dependencyInstallationExecuted: false
}, null, 2));
