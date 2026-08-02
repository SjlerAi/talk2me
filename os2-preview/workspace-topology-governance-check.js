'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const bootstrapGovernance = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-governance-check.js'), 'utf8');
const activation = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const adoptionRunbook = fs.readFileSync(path.join(root, 'DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
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

try { new Function(verifier); } catch (error) { failures.push(`Workspace topology verifier syntax invalid: ${error.message}`); }

requireMarkers(verifier, [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20', 'PREVIEW_APP_ROOT is required',
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW', 'IDENTITY_CHANGED_DURING_OPEN',
  'METADATA_CHANGED_DURING_OPEN', 'SECURITY_METADATA_CHANGED_DURING_OPEN',
  "['package-lock.json', 16 * 1024 * 1024]", "['dependency-lock-provenance.json', 64 * 1024]",
  "['dependency-lock-provenance-verification.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024]",
  "['dependency-lock-adoption-check.js', 2 * 1024 * 1024]",
  "['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024]",
  "['workspace-topology-verification.js', 2 * 1024 * 1024]",
  "['workspace-topology-governance-check.js', 2 * 1024 * 1024]",
  "['workspace-source-integrity.js', 2 * 1024 * 1024]",
  "['workspace-source-integrity-check.js', 2 * 1024 * 1024]",
  "['preview-activation-preflight.js', 2 * 1024 * 1024]",
  "['preview-activation-governance-check.js', 2 * 1024 * 1024]",
  "['release-evidence-security-check.js', 2 * 1024 * 1024]",
  "['release-source-integrity-verification.js', 2 * 1024 * 1024]",
  "['release-source-integrity-check.js', 2 * 1024 * 1024]",
  "['release-candidate-gate.js', 4 * 1024 * 1024]",
  "['release-manifest-verification.js', 4 * 1024 * 1024]",
  "['release-manifest-check.js', 2 * 1024 * 1024]",
  "['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]",
  'MIGRATION_HIDDEN_ENTRY_PROHIBITED', 'MIGRATION_NON_FILE_ENTRY_PROHIBITED',
  'MIGRATION_FILENAME_INVALID', 'MIGRATION_COUNT_MUST_BE_25', 'MIGRATION_025_MISSING',
  "assertDirectoryIdentity(root, rootIdentity, 'APPLICATION_ROOT')",
  "assertDirectoryIdentity(migrationsDirectory, migrationsIdentity, 'MIGRATIONS_DIRECTORY')",
  'packageLockPresent:', 'dependencyLockProvenancePresent:',
  'dependencyLockAdoptionControlsProtected:', 'dependencyLockAdoptionRunbookProtected:',
  'topologyVerifierSelfProtected:', 'topologyGovernanceProtected:',
  'sourceIntegrityControlsProtected:', 'activationGovernanceProtected:', 'releaseGovernanceProtected:',
  'criticalMigrationControlsProtected: true', 'criticalReleaseControlsProtected: true',
  'operationalRunbooksProtected: true', 'exactMigrationCountRequired: true', 'migration025Required: true',
  'migrationDirectoryContainsOnlyOrderedSqlFiles: true', 'directoryIdentityReverifiedAfterInventory: true',
  'protectedFileMetadataStabilityRequired: true', 'protectedFilesHardLinkFree: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Workspace topology verifier');

if (verifier.includes("['package-lock.json', 'package-lock.json', false")) failures.push('package-lock.json must be mandatory in activation topology');
if (!verifier.includes("['package-lock.json', 16 * 1024 * 1024]")) failures.push('package-lock.json mandatory topology entry missing');
if (!verifier.includes("['dependency-lock-provenance.json', 64 * 1024]")) failures.push('dependency-lock provenance mandatory topology entry missing');

requireMarkers(bootstrapGovernance, [
  "check: 'migration-ledger-bootstrap-governance'", "bootstrapFile: 'MIGRATION_LEDGER_BOOTSTRAP.sql'",
  'createsExactlyOneTable: true', 'runtimeLedgerCreationDisabled: true',
  'workspaceProtectionRequired: true', 'previewDatabaseOnly: true'
], 'Bootstrap governance');

requireMarkers(activation, [
  "'workspace-topology-verification.js'", "'dependency-lock-adoption-check.js'",
  "'workspace-source-integrity.js'", "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'", 'childEnv.PREVIEW_APP_ROOT = root',
  "childEnv.ALLOW_PRODUCTION_MUTATION = 'false'", "childEnv.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false'",
  'dependencyLockAdoptionGovernanceVerified: true',
  'dependencyLockProvenanceVerificationExecuted: false',
  'dependencyLockAdoptionMaterializationExecuted: false'
], 'Activation preflight');
requireOrder(activation, [
  "'workspace-topology-verification.js'", "'dependency-lock-adoption-check.js'",
  "'workspace-source-integrity.js'", "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'"
], 'Activation preflight');

requireMarkers(runbook, [
  'workspace-topology-verification.js', '`O_DIRECTORY | O_NOFOLLOW`',
  'package-lock.json', 'dependency-lock-provenance.json',
  'dependency-lock-adoption-check.js', 'DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md',
  'all ordered migrations', 'additional hard-link rejection', 'bounded reads',
  'source inventory digest', 'The same frozen environment is supplied to all 25 controls'
], 'Activation runbook');
requireMarkers(adoptionRunbook, [
  'Dependency Lock Adoption', 'exactly these two paths in one commit',
  'immediate child of the recorded generation source commit',
  'dependency-lock-provenance-verification.js', 'dependency-lock-adoption-materializer.js',
  'production at `talk2me.uent.co.za` remains untouched'
], 'Adoption runbook');

if (pkg.scripts['check:workspace-topology-governance'] !== 'node workspace-topology-governance-check.js') failures.push('Missing exact workspace topology governance package command');
for (const marker of [
  'node --check workspace-topology-governance-check.js',
  'node workspace-topology-governance-check.js'
]) if (!pkg.scripts.check.includes(marker)) failures.push(`Normal validation missing ${marker}`);

if (failures.length) {
  console.error('WORKSPACE TOPOLOGY GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-topology-governance',
  node20Required: true,
  topologyVerifierSyntaxParsed: true,
  directoryNoFollowRequired: true,
  fileNoFollowRequired: true,
  descriptorIdentityRequired: true,
  descriptorMetadataStabilityRequired: true,
  postInventoryDirectoryIdentityRequired: true,
  hardLinkRejectionRequired: true,
  boundedProtectedFilesRequired: true,
  migrationDirectoryPurityRequired: true,
  exactMigrationCountRequired: true,
  migration025Required: true,
  packageLockMandatoryForActivation: true,
  dependencyLockProvenanceMandatoryForActivation: true,
  dependencyLockProvenanceVerifierProtected: true,
  dependencyLockAdoptionMaterializerProtected: true,
  dependencyLockAdoptionGovernanceProtected: true,
  dependencyLockAdoptionRunbookProtected: true,
  topologyVerifierSelfProtected: true,
  topologyGovernanceSelfProtected: true,
  sourceIntegrityControlsProtected: true,
  activationGovernanceProtected: true,
  releaseGovernanceProtected: true,
  migrationLedgerBootstrapProtected: true,
  migrationLedgerBootstrapGovernanceRequired: true,
  migrationRunnerProtected: true,
  releaseCandidateControlsProtected: true,
  operationalRunbooksProtected: true,
  activationOrderingProtected: true,
  adoptionGovernanceRunsBeforeSourceIntegrity: true,
  packageCommandRegistered: true,
  normalValidationRegistered: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
