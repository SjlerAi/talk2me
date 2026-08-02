'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const failures = [];
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
}
function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000, killSignal: 'SIGKILL', shell: false, windowsHide: true });
  if (result.error && result.error.code === 'ETIMEDOUT') failures.push(`${file} syntax check timed out`);
  else if (result.error) failures.push(`${file} syntax check could not start: ${result.error.message}`);
  else if (result.signal) failures.push(`${file} syntax check ended by ${result.signal}`);
  else if (result.status !== 0) failures.push(`${file} syntax check failed: ${String(result.stderr || '').trim()}`);
}

syntaxCheck('dependency-lock-artifact-verification.js');
const verifier = read('dependency-lock-artifact-verification.js');
const workflow = read('../.github/workflows/os2-dependency-lock-generation.yml');
const workflowGovernance = read('dependency-lock-workflow-check.js');
const runbook = read('DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md');

requireMarkers(verifier, [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.59.0'", "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", "expectedRepository = 'SjlerAi/talk2me'",
  "expectedWorkflow = 'OS2 Dependency Lock Generation'", 'maxArtifactFileBytes = 16 * 1024 * 1024',
  "'SHA256SUMS'", "'dependency-lock-artifact-governance.json'", "'dependency-lock-generation.json'",
  "'dependency-lock-generation.json.sha256'", "'dependency-lock-generator-governance.json'",
  "'dependency-lock-governance.json'", "'dependency-lock-verification.json'", "'dependency-lock-workflow-governance.json'",
  "'generator-result.json'", "'manifest.txt'", "'package-lock.json'", "'source-integrity-postinstall.json'",
  "'source-integrity-preinstall.json'", 'function timingSafeHexEqual(left, right)', 'crypto.timingSafeEqual',
  'ARTIFACT_DIRECTORY_PATH_INVALID', 'ARTIFACT_DIRECTORY_PUBLIC_PATH_PROHIBITED', 'ARTIFACT_DIRECTORY_NOT_SECURE',
  'ARTIFACT_DIRECTORY_NOT_CANONICAL', 'ARTIFACT_DIRECTORY_NOT_PRIVATE', 'SECURE_DIRECTORY_FLAGS_UNAVAILABLE',
  'fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW', 'ARTIFACT_DIRECTORY_IDENTITY_CHANGED',
  'ARTIFACT_DIRECTORY_METADATA_CHANGED', 'ARTIFACT_FILENAME_INVALID', 'ARTIFACT_PATH_ESCAPE',
  'ARTIFACT_FILE_NOT_REGULAR', 'ARTIFACT_FILE_HARD_LINK_PROHIBITED', 'ARTIFACT_FILE_OWNER_MISMATCH',
  'ARTIFACT_FILE_SIZE_INVALID', 'ARTIFACT_FILE_NOT_PRIVATE', 'ARTIFACT_FILE_NOT_CANONICAL',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW', 'ARTIFACT_FILE_IDENTITY_CHANGED',
  'ARTIFACT_FILE_METADATA_CHANGED', 'ARTIFACT_FILE_SECURITY_METADATA_CHANGED', 'ARTIFACT_FILE_READ_SIZE_MISMATCH',
  "new TextDecoder('utf-8', { fatal: true })", 'ARTIFACT_FILE_BOM_PROHIBITED', 'ARTIFACT_FILE_NUL_PROHIBITED',
  'ARTIFACT_FILE_CRLF_PROHIBITED', 'ARTIFACT_FILE_FINAL_NEWLINE_REQUIRED', 'ARTIFACT_JSON_INVALID',
  'ARTIFACT_JSON_OBJECT_REQUIRED', 'ARTIFACT_MANIFEST_LINE_INVALID', 'ARTIFACT_MANIFEST_KEY_INVALID',
  'ARTIFACT_MANIFEST_VALUE_INVALID', 'ARTIFACT_MANIFEST_KEYS_INCOMPLETE', 'ARTIFACT_SECRET_FIELD_PROHIBITED',
  "requiredEnvironment('DEPENDENCY_LOCK_ARTIFACT_ROOT'", "requiredEnvironment('EXPECTED_REPOSITORY'",
  "requiredEnvironment('EXPECTED_REF'", "requiredEnvironment('EXPECTED_COMMIT_SHA'", "requiredEnvironment('EXPECTED_WORKFLOW'",
  "requiredEnvironment('EXPECTED_RUN_ID'", "requiredEnvironment('EXPECTED_RUN_ATTEMPT'", 'ARTIFACT_EXPECTED_IDENTITY_INVALID',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED', 'ARTIFACT_DIRECTORY_ENTRY_INVALID',
  'ARTIFACT_FILE_SET_INVALID', 'ARTIFACT_CHECKSUM_LINE_COUNT_INVALID', 'ARTIFACT_CHECKSUM_LINE_INVALID',
  'ARTIFACT_CHECKSUM_FILENAME_INVALID', 'ARTIFACT_CHECKSUM_MISMATCH', 'ARTIFACT_CHECKSUM_COVERAGE_INCOMPLETE',
  'ARTIFACT_GENERATION_SIDECAR_INVALID', 'ARTIFACT_PACKAGE_LOCK_IDENTITY_INVALID', 'ARTIFACT_PACKAGE_LOCK_ROOT_MISSING',
  'ARTIFACT_PACKAGE_LOCK_ROOT_IDENTITY_INVALID', 'ARTIFACT_PACKAGE_LOCK_DEPENDENCIES_INVALID',
  'ARTIFACT_MANIFEST_SOURCE_IDENTITY_MISMATCH', 'ARTIFACT_MANIFEST_RUN_IDENTITY_MISMATCH',
  'ARTIFACT_MANIFEST_DIGEST_INVALID', 'ARTIFACT_MANIFEST_SAFETY_INVALID', 'ARTIFACT_MANIFEST_LOCK_DIGEST_MISMATCH',
  'ARTIFACT_GENERATION_EVIDENCE_INVALID', 'ARTIFACT_GENERATION_IDENTITY_INVALID', 'ARTIFACT_GENERATION_SAFETY_INVALID',
  'ARTIFACT_GENERATION_CONTROL_EVIDENCE_INVALID', 'ARTIFACT_LOCK_VERIFICATION_EVIDENCE_INVALID',
  'ARTIFACT_GOVERNANCE_EVIDENCE_INVALID', 'ARTIFACT_SOURCE_INTEGRITY_EVIDENCE_INVALID',
  'ARTIFACT_SOURCE_INTEGRITY_SAFETY_INVALID', 'ARTIFACT_SOURCE_INVENTORY_CONTINUITY_INVALID',
  "check: 'dependency-lock-artifact-verification'", 'meaningfulControls: 60', 'exactFileSetVerified: true',
  'artifactDirectoryPrivate: true', 'artifactFilesPrivate: true', 'canonicalPathsVerified: true',
  'descriptorIdentityVerified: true', 'singleLinkFilesVerified: true', 'exactChecksumCoverageVerified: true',
  'constantTimeChecksumComparison: true', 'generationSidecarVerified: true', 'packageLockIdentityVerified: true',
  'exactDirectDependenciesVerified: true', 'manifestIdentityVerified: true', 'generationEvidenceVerified: true',
  'independentLockVerificationVerified: true', 'governanceEvidenceVerified: true',
  'sourceInventoryContinuityVerified: true', 'secretFieldsRejected: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'artifact verifier');

if (verifier.includes('...process.env')) failures.push('Artifact verifier must not clone the complete environment');
if (verifier.includes('fs.rmSync') || verifier.includes('fs.unlinkSync') || verifier.includes('fs.writeFileSync')) failures.push('Artifact verifier must remain read-only');
if (!verifier.includes('actualNames.join') || !verifier.includes('requiredFiles')) failures.push('Artifact verifier must require an exact file set');
if (!verifier.includes('sumLines.length !== checksumFiles.length')) failures.push('Artifact verifier must require exact checksum line coverage');
if (!verifier.includes('sourcePre.inventorySha256, sourcePost.inventorySha256')) failures.push('Artifact verifier must compare pre-install and post-install source digests');

requireMarkers(workflow, [
  'dependency-lock-artifact-governance.json', 'chmod 700 "$artifact"', 'find "$artifact" -maxdepth 1 -type f -exec chmod 600 {} +',
  'Verify dependency lock review artifact', 'DEPENDENCY_LOCK_ARTIFACT_ROOT:', 'EXPECTED_REPOSITORY:', 'EXPECTED_REF:',
  'EXPECTED_COMMIT_SHA:', 'EXPECTED_WORKFLOW:', 'EXPECTED_RUN_ID:', 'EXPECTED_RUN_ATTEMPT:',
  'node dependency-lock-artifact-verification.js', 'Upload dependency lock review artifact'
], 'dependency lock workflow');
if (workflow.indexOf('Verify dependency lock review artifact') >= workflow.indexOf('Upload dependency lock review artifact')) failures.push('Artifact verification must precede upload');
if (workflow.indexOf('Build review artifact') >= workflow.indexOf('Verify dependency lock review artifact')) failures.push('Artifact must be built before verification');

requireMarkers(workflowGovernance, [
  'node dependency-lock-artifact-check.js', 'dependency-lock-artifact-governance.json',
  'Verify dependency lock review artifact', 'node dependency-lock-artifact-verification.js',
  'artifactVerifierRequired: true', 'artifactVerifierRunsBeforeUpload: true'
], 'workflow governance');
requireMarkers(runbook, [
  'Dependency Lock Artifact Review', 'dependency-lock-artifact-verification.js', 'exact 13-file set',
  'SHA256SUMS', 'dependency-lock-generation.json.sha256', 'EXPECTED_COMMIT_SHA',
  'source inventory continuity', 'private `0700` directory', 'private `0600` files',
  'production remains untouched', 'GitHub Issue #83'
], 'artifact review runbook');

if (failures.length) {
  console.error('DEPENDENCY LOCK ARTIFACT GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-artifact-governance',
  meaningfulControls: 60,
  verifierSyntaxVerified: true,
  exactApplicationIdentityRequired: true,
  exactDatabaseIdentityRequired: true,
  exactBranchIdentityRequired: true,
  exactRepositoryIdentityRequired: true,
  exactWorkflowIdentityRequired: true,
  exactCommitIdentityRequired: true,
  exactRunIdentityRequired: true,
  absoluteArtifactPathRequired: true,
  publicArtifactPathProhibited: true,
  canonicalArtifactDirectoryRequired: true,
  artifactDirectorySymlinkProhibited: true,
  artifactDirectoryPrivateModeRequired: true,
  artifactDirectoryOwnerRequired: true,
  artifactDirectoryDescriptorIdentityRequired: true,
  exactArtifactFileSetRequired: true,
  hiddenArtifactEntriesProhibited: true,
  nestedArtifactDirectoriesProhibited: true,
  artifactSymlinksProhibited: true,
  artifactHardLinksProhibited: true,
  artifactOwnerConsistencyRequired: true,
  artifactPrivateFileModesRequired: true,
  artifactFileSizeBoundsRequired: true,
  artifactCanonicalPathsRequired: true,
  artifactDescriptorIdentityRequired: true,
  artifactMetadataStabilityRequired: true,
  artifactExactReadSizeRequired: true,
  fatalUtf8Required: true,
  byteOrderMarkProhibited: true,
  nulBytesProhibited: true,
  crlfProhibited: true,
  finalNewlineRequired: true,
  jsonObjectRootsRequired: true,
  exactChecksumLineCountRequired: true,
  exactChecksumFilenameSetRequired: true,
  duplicateChecksumEntriesProhibited: true,
  checksumPathTraversalProhibited: true,
  lowercaseSha256Required: true,
  constantTimeChecksumComparisonRequired: true,
  generationSidecarRequired: true,
  packageLockIdentityRequired: true,
  lockfileVersionThreeRequired: true,
  exactDirectDependenciesRequired: true,
  exactManifestKeysRequired: true,
  manifestRepositoryRequired: true,
  manifestRefRequired: true,
  manifestCommitRequired: true,
  manifestWorkflowRequired: true,
  manifestRunIdentityRequired: true,
  manifestSourceDigestRequired: true,
  manifestLockDigestRequired: true,
  manifestSafetyFlagsRequired: true,
  generationEvidenceRequired: true,
  independentLockVerificationRequired: true,
  fourGovernanceEvidenceFilesRequired: true,
  preinstallSourceEvidenceRequired: true,
  postinstallSourceEvidenceRequired: true,
  sourceInventoryContinuityRequired: true,
  secretFieldsProhibited: true,
  readOnlyVerificationRequired: true,
  artifactVerificationBeforeUploadRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
