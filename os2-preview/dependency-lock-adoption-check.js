'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    if (left === -1 || right === -1 || left >= right) failures.push(`${label} order invalid at ${markers[index]}`);
  }
}
function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });
  if (result.error && result.error.code === 'ETIMEDOUT') failures.push(`${file} syntax check timed out`);
  else if (result.error) failures.push(`${file} syntax check could not start: ${result.error.message}`);
  else if (result.signal) failures.push(`${file} syntax check ended by ${result.signal}`);
  else if (result.status !== 0) failures.push(`${file} syntax check failed: ${String(result.stderr || '').trim()}`);
}

for (const file of ['dependency-lock-provenance-verification.js', 'dependency-lock-adoption-materializer.js']) syntaxCheck(file);
const provenance = read('dependency-lock-provenance-verification.js');
const materializer = read('dependency-lock-adoption-materializer.js');
const workflow = read('../.github/workflows/os2-dependency-lock-adoption.yml');
const runbook = read('DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md');
const preflight = read('preview-activation-preflight.js');
const sourceIntegrity = read('workspace-source-integrity.js');
const pkgText = read('package.json');
let pkg = null;
try { pkg = JSON.parse(pkgText); } catch { failures.push('package.json is invalid JSON'); }

requireMarkers(provenance, [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.60.0'", "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", "expectedRepository = 'SjlerAi/talk2me'",
  "expectedWorkflow = 'OS2 Dependency Lock Generation'", 'expectedNodeMajor = 20',
  'maxLockBytes = 16 * 1024 * 1024', 'maxProvenanceBytes = 64 * 1024', 'allowedClockSkewMs = 5 * 60 * 1000',
  "'automaticCommit'", "'packageLockSha256'", "'sourceInventorySha256'", "'sourceCommit'",
  'function timingSafeHexEqual(left, right)', 'crypto.timingSafeEqual',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW', 'IDENTITY_CHANGED_DURING_OPEN',
  'METADATA_CHANGED_DURING_OPEN', 'SECURITY_METADATA_CHANGED_DURING_OPEN', 'READ_SIZE_MISMATCH',
  "new TextDecoder('utf-8', { fatal: true })", 'BOM_PROHIBITED', 'NUL_PROHIBITED', 'CRLF_PROHIBITED',
  'FINAL_NEWLINE_REQUIRED', 'PROVENANCE_SECRET_FIELD_PROHIBITED', "requiredEnvironment('EXPECTED_SOURCE_COMMIT'",
  "requiredEnvironment('CURRENT_COMMIT'", "requiredEnvironment('PROVENANCE_MAX_AGE_HOURS'",
  'CURRENT_COMMIT_MUST_DIFFER_FROM_SOURCE_COMMIT', 'PROVENANCE_MAX_AGE_HOURS_INVALID',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED', 'PROVENANCE_KEYS_INVALID',
  'PROVENANCE_SOURCE_COMMIT_MISMATCH', 'PROVENANCE_GENERATED_AT_NOT_CANONICAL_UTC',
  'PROVENANCE_GENERATED_AT_IN_FUTURE', 'PROVENANCE_TOO_OLD', 'PROVENANCE_LOCK_DIGEST_MISMATCH',
  'PROVENANCE_SAFETY_FLAGS_INVALID', 'PACKAGE_LOCK_DIRECT_DEPENDENCIES_INVALID',
  "check: 'dependency-lock-provenance-verification'", 'meaningfulControls: 60',
  'exactProvenanceSchemaVerified: true', 'sourceCommitContinuityVerified: true',
  'provenanceFreshnessVerified: true', 'constantTimeDigestComparison: true', 'secretFieldsRejected: true',
  'automaticCommit: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'provenance verifier');
if (provenance.includes('...process.env')) failures.push('Provenance verifier must not copy the complete parent environment');
if (provenance.includes('fs.writeFileSync') || provenance.includes('fs.unlinkSync') || provenance.includes('fs.rmSync')) failures.push('Provenance verifier must remain read-only');

requireMarkers(materializer, [
  "expectedRepository = 'SjlerAi/talk2me'", "expectedWorkflow = 'OS2 Dependency Lock Generation'",
  'verifierTimeoutMs = 30000', 'dependency-lock-artifact-verification.js',
  'dependency-lock-provenance.json', 'ADOPTION_TARGET_ALREADY_EXISTS',
  'secureDirectory(root, null, false', 'secureDirectory(artifactRoot, rootIdentity.uid, true',
  'Object.freeze({', 'PATH: \'/usr/bin:/bin\'', 'ALLOW_PRODUCTION_MUTATION: \'false\'',
  'ENABLE_CUSTOMER_MERGE_EXECUTION: \'false\'', 'spawnSync(process.execPath, [artifactVerifierPath]',
  'maxBuffer: 4 * 1024 * 1024', 'timeout: verifierTimeoutMs', "killSignal: 'SIGKILL'", 'shell: false',
  'ARTIFACT_VERIFIER_TIMEOUT', 'ARTIFACT_VERIFIER_OUTPUT_INVALID', 'ARTIFACT_VERIFIER_EVIDENCE_INVALID',
  "secureRead(path.join(artifactRoot, 'package-lock.json')", "secureRead(path.join(artifactRoot, 'manifest.txt')",
  "secureRead(path.join(artifactRoot, 'dependency-lock-generation.json')", 'MANIFEST_SOURCE_IDENTITY_MISMATCH',
  'MANIFEST_RUN_IDENTITY_MISMATCH', 'MANIFEST_LOCK_DIGEST_MISMATCH', 'GENERATION_EVIDENCE_LOCK_DIGEST_MISMATCH',
  'GENERATION_TIMESTAMP_INVALID', 'automaticCommit: false', 'sourceCommit,', 'sourceInventorySha256:',
  'publishExclusive(lockTarget, lockRecord.bytes, 0o644', 'publishExclusive(provenanceTarget, provenanceBytes, 0o644',
  'fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW',
  'fs.linkSync(temporary, file)', 'removeIfMatching(provenanceTarget', 'removeIfMatching(lockTarget',
  "check: 'dependency-lock-adoption-materialization'", 'meaningfulControls: 60',
  'artifactVerifierPassed: true', 'exclusiveNoOverwritePublication: true', 'gitMutationExecuted: false',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'adoption materializer');
if (materializer.includes('...process.env')) failures.push('Materializer must not inherit the complete parent environment');
if (materializer.includes('execSync(') || materializer.includes('execFileSync(') || materializer.includes('shell: true')) failures.push('Materializer child execution is not bounded safely');
if (materializer.includes('git ')) failures.push('Materializer must not execute Git commands');
if (!materializer.includes('fs.linkSync(temporary, file)')) failures.push('Materializer must use no-overwrite publication');

requireMarkers(workflow, [
  'name: OS2 Dependency Lock Adoption', 'push:', 'workflow_dispatch:', 'contents: read',
  'cancel-in-progress: false', 'timeout-minutes: 20', 'fetch-depth: 2', 'persist-credentials: false',
  'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  "PROVENANCE_MAX_AGE_HOURS: '168'", "ALLOW_PRODUCTION_MUTATION: 'false'", "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  'set -euo pipefail', 'test "$GITHUB_REPOSITORY" = "SjlerAi/talk2me"',
  'test "$(git rev-list --count "$source_commit..$GITHUB_SHA")" = "1"',
  'test "$(git rev-parse "$GITHUB_SHA^")" = "$source_commit"',
  "'os2-preview/dependency-lock-provenance.json'", "'os2-preview/package-lock.json'",
  'node dependency-lock-provenance-verification.js', 'node dependency-lock-adoption-check.js',
  'node dependency-lock-verification.js', 'verify:workspace-source-integrity',
  'npm ci --ignore-scripts --no-audit --no-fund', 'npm run check',
  'npm audit --omit=dev --audit-level=high', 'rm -rf node_modules',
  'status --porcelain --untracked-files=all', "check: 'dependency-lock-adoption'",
  'exactTwoFileCommit: true', 'highSeverityAuditPassed: true', 'sha256sum *.json > SHA256SUMS',
  'sha256sum --check SHA256SUMS', 'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
  'if-no-files-found: error', 'retention-days: 30'
], 'adoption workflow');
requireOrder(workflow, [
  'Checkout adoption commit and parent', 'Set up Node.js 20', 'Confirm controlled adoption event and commit shape',
  'Prepare private adoption evidence directory', 'Verify committed dependency lock provenance',
  'Verify adoption governance and committed lock', 'Capture pre-install source identity',
  'Install and validate adopted dependency graph', 'Prove source continuity and clean workspace',
  'Build adoption evidence artifact', 'Upload adoption evidence'
], 'adoption workflow');
if (workflow.includes('contents: write')) failures.push('Adoption workflow must not have repository write permission');
if (workflow.includes('persist-credentials: true')) failures.push('Adoption workflow checkout credentials must not persist');
if (workflow.includes('continue-on-error: true')) failures.push('Adoption workflow must fail closed');
if (workflow.includes('npm install ')) failures.push('Adoption workflow must not use npm install');
if (workflow.includes('cancel-in-progress: true')) failures.push('Adoption workflow must not cancel an in-progress verification');

requireMarkers(runbook, [
  'Dependency Lock Adoption', 'production at `talk2me.uent.co.za` remains untouched',
  'dependency-lock-adoption-materializer.js', 'dependency-lock-provenance-verification.js',
  'exact 15-field schema', 'exclusive no-overwrite semantics', 'never runs Git commands or commits automatically',
  'exactly these two paths in one commit', 'immediate child of the recorded generation source commit',
  'OS2 Dependency Lock Adoption', '168 hours', 'GitHub Issue #83'
], 'adoption runbook');

requireMarkers(preflight, [
  "'dependency-lock-adoption-check.js'", 'dependencyLockAdoptionGovernanceVerified: true',
  'dependencyLockAdoptionMaterializationExecuted: false', 'dependencyLockProvenanceVerificationExecuted: false'
], 'preview activation preflight');
requireMarkers(sourceIntegrity, [
  "['../.github/workflows/os2-dependency-lock-adoption.yml', 1024 * 1024]",
  "['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-check.js', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024]",
  'dependencyLockProvenanceProtected', 'dependencyLockAdoptionWorkflowProtected: files.some'
], 'workspace source integrity');

if (pkg) {
  const exactScripts = {
    'materialize:dependency-lock-adoption': 'node dependency-lock-adoption-materializer.js',
    'verify:dependency-lock-provenance': 'node dependency-lock-provenance-verification.js',
    'check:dependency-lock-adoption': 'node dependency-lock-adoption-check.js'
  };
  for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts[name] !== command) failures.push(`Missing exact package command ${name}`);
  for (const marker of [
    'node --check dependency-lock-provenance-verification.js',
    'node --check dependency-lock-adoption-materializer.js',
    'node --check dependency-lock-adoption-check.js',
    'node dependency-lock-adoption-check.js'
  ]) if (!pkg.scripts.check.includes(marker)) failures.push(`Normal validation missing ${marker}`);
  if (pkg.scripts.check.includes('node dependency-lock-adoption-materializer.js &&')) failures.push('Materializer must not execute in normal validation');
  if (pkg.scripts.check.includes('node dependency-lock-provenance-verification.js &&')) failures.push('Environment-bound provenance verification must not execute in normal validation');
}

if (failures.length) {
  console.error('DEPENDENCY LOCK ADOPTION GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-adoption-governance',
  meaningfulControls: 60,
  provenanceVerifierSyntaxVerified: true,
  materializerSyntaxVerified: true,
  exactApplicationIdentityRequired: true,
  exactDatabaseIdentityRequired: true,
  exactBranchIdentityRequired: true,
  exactRepositoryIdentityRequired: true,
  exactWorkflowIdentityRequired: true,
  exactSourceCommitRequired: true,
  distinctCurrentCommitRequired: true,
  provenanceFreshnessBoundRequired: true,
  canonicalUtcGenerationTimeRequired: true,
  futureTimestampRejected: true,
  exactProvenanceSchemaRequired: true,
  provenanceSecretFieldsRejected: true,
  packageLockDigestBindingRequired: true,
  constantTimeDigestComparisonRequired: true,
  exactDirectDependenciesRequired: true,
  readOnlyProvenanceVerificationRequired: true,
  existingAdoptionTargetsProhibited: true,
  canonicalApplicationRootRequired: true,
  privateArtifactRootRequired: true,
  artifactOwnerConsistencyRequired: true,
  fullArtifactVerificationRequired: true,
  boundedArtifactVerificationRequired: true,
  artifactVerifierForcedKillRequired: true,
  artifactVerifierShellDisabled: true,
  artifactVerifierOutputBounded: true,
  sanitizedArtifactVerifierEnvironmentRequired: true,
  artifactLockReverificationRequired: true,
  artifactManifestReverificationRequired: true,
  generationEvidenceReverificationRequired: true,
  exactManifestSourceIdentityRequired: true,
  exactManifestRunIdentityRequired: true,
  sourceInventoryDigestRequired: true,
  generationTimestampRequired: true,
  exclusivePackageLockPublicationRequired: true,
  exclusiveProvenancePublicationRequired: true,
  overwriteProhibited: true,
  publishedDigestReverificationRequired: true,
  checksumBoundRollbackRequired: true,
  automaticCommitProhibited: true,
  gitMutationProhibited: true,
  adoptionWorkflowReadOnlyRequired: true,
  adoptionWorkflowSingleCommitRequired: true,
  immediateParentContinuityRequired: true,
  exactTwoFileChangeRequired: true,
  packageLockAndProvenanceRequired: true,
  existingNodeModulesProhibited: true,
  npmCiRequired: true,
  npmInstallSubstitutionProhibited: true,
  integratedValidationRequired: true,
  highSeverityAuditRequired: true,
  preinstallSourceIntegrityRequired: true,
  postinstallSourceIntegrityRequired: true,
  sourceInventoryContinuityRequired: true,
  cleanWorkspaceAfterValidationRequired: true,
  privateAdoptionEvidenceRequired: true,
  adoptionEvidenceChecksumsRequired: true,
  pinnedArtifactUploadRequired: true,
  activationGovernanceRegistrationRequired: true,
  protectedSourceRegistrationRequired: true,
  environmentChangingAdoptionExcludedFromNormalValidation: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
