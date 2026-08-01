'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const gate = fs.readFileSync(path.join(root, 'release-candidate-gate.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'release-manifest-verification.js'), 'utf8');
const previewData = fs.readFileSync(path.join(root, 'preview-data-verification.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'RELEASE_CANDIDATE_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`Missing ${label} marker: ${marker}`);
  }
}

const gateMarkers = [
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_COMMIT_SHA or GITHUB_SHA is required',
  'Release commit SHA must be a full 40-character hexadecimal SHA',
  'RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated',
  'RELEASE_BRANCH or GITHUB_REF_NAME is required',
  'Unexpected release branch:',
  'agent/talk2me-os2-integrated-rebuild',
  'commitIdentityVerified',
  "pkg.name !== 'talk2me-os2-preview'",
  "const packageJsonChecksum = sha256('package.json')",
  'packageJsonSha256: packageJsonChecksum',
  "const bootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql'",
  'migrationLedgerBootstrapFile: bootstrapFile',
  'migrationLedgerBootstrapSha256: bootstrapChecksum',
  'migrationLedgerBootstrapGovernanceRequired: true',
  'runtimeLedgerCreationDisabled: true',
  "'migration-ledger-bootstrap-governance-check.js'",
  "'check:migration-ledger-bootstrap'",
  "fs.openSync(file, 'wx', 0o600)",
  'fs.fsyncSync(descriptor)',
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(manifestTemp, manifestPath)',
  'syncDirectory(directory)',
  'fs.lstatSync(directory)',
  'stat.isSymbolicLink() || !stat.isDirectory()',
  '(stat.mode & 0o077) !== 0',
  'fs.realpathSync(directory) !== path.resolve(directory)',
  'Release evidence publication failed:',
  'RELEASE_APPROVED_BY is required',
  'RELEASE_CHANGE_REFERENCE is required',
  'RELEASE_MANIFEST_PATH is required',
  'RELEASE_MANIFEST_PATH must be absolute',
  'Release manifest already exists:',
  'Release manifest checksum already exists:',
  'dependencyLockPresent',
  'dependencyLockSha256',
  'migrationChecksums',
  'Runtime CREATE TABLE',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'previewDataVerificationRequired: true',
  "previewDataVerificationOrder: ['schema-verification.js','merge-restore-evidence-verification.js']",
  'mergeExecutionEnabled: false'
];
requireMarkers(gate, gateMarkers, 'release gate');
if (gate.includes("warn('No release")) throw new Error('Release identity metadata must be blocking, not warning-only');
requireMarkers(gate, [
  'else if (failures.length === 0)',
  'publishEvidencePair(output, manifestText, checksumText)',
  'if (manifestPublished) removeIfPresent(manifestPath)',
  'if (checksumPublished) removeIfPresent(checksumPath)'
], 'release publication');

const previewDataMarkers = [
  "expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
];
requireMarkers(previewData, previewDataMarkers, 'preview data verifier');
if (previewData.indexOf("'schema-verification.js'") > previewData.indexOf("'merge-restore-evidence-verification.js'")) throw new Error('Preview data verification order must remain schema then restore evidence');

const verifierMarkers = [
  'RELEASE_MANIFEST_PATH is required',
  'RELEASE_MANIFEST_PATH must be absolute',
  'RELEASE_MANIFEST_PATH must be normalized',
  'RELEASE_COMMIT_SHA or GITHUB_SHA is required for post-freeze verification',
  'Post-freeze verified commit SHA must be a full 40-character hexadecimal SHA',
  'RELEASE_BRANCH or GITHUB_REF_NAME is required for post-freeze verification',
  'Unexpected post-freeze release branch:',
  'Release manifest commit SHA does not match the post-freeze verified commit SHA',
  'Release manifest branch does not match the post-freeze verified branch',
  'commitShaMatchesVerifiedCheckout: true',
  'branchMatchesVerifiedCheckout: true',
  'Release evidence directory is missing:',
  'Release evidence directory must be a real non-symlink directory:',
  'Release evidence directory must not permit group or world access:',
  'Release evidence directory cannot be resolved canonically:',
  'Release evidence directory path is not canonical:',
  'function readSecureRegularFile(file, options = {})',
  'fs.constants.O_NOFOLLOW',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'fs.fstatSync(descriptor)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'changed between path validation and secure open',
  'exceeds the maximum permitted size',
  'fs.readFileSync(descriptor)',
  'fs.closeSync(descriptor)',
  "expectedMode: 0o600",
  'maxBytes: 4 * 1024 * 1024',
  'maxBytes: 4096',
  'O_NOFOLLOW is required for secure release evidence verification',
  'Unable to securely open',
  'timingSafeEqual',
  'checksum verification failed',
  "manifest.application !== 'talk2me-os2-preview'",
  'manifest.version !== expectedPreviewVersion',
  'Release manifest package.json checksum is invalid',
  'manifest.migrationLedgerBootstrapFile !== expectedBootstrapFile',
  'Release manifest migration-ledger bootstrap checksum is invalid',
  'Release manifest does not require migration-ledger bootstrap governance',
  'Release manifest does not confirm runtime ledger creation is disabled',
  "label: 'Checked-out package.json'",
  "label: 'Checked-out package-lock.json'",
  "label: 'Checked-out migration ledger bootstrap'",
  "label: 'Checked-out migration'",
  'migration-ledger bootstrap checksum does not match the checked-out source',
  'migrationLedgerBootstrapMatchesWorkspace: true',
  'runtimeLedgerCreationDisabled: true',
  'package.json checksum does not match the checked-out package.json',
  'Checked-out package.json is not valid JSON',
  'dependency-lock checksum does not match the checked-out package-lock.json',
  'Release manifest migration checksum does not match the checked-out source:',
  'dependencyLockMatchesWorkspace: true',
  'migrationInventoryMatchesWorkspace: true',
  'evidenceDirectoryCanonical: true',
  'evidenceDirectoryPrivate: true',
  'evidenceReadsUseNoFollow: true',
  'evidenceDescriptorIdentityVerified: true',
  'protectedFileSizeLimitsEnforced: true',
  'release-manifest-verification'
];
requireMarkers(verifier, verifierMarkers, 'release verifier');

const runbookMarkers = [
  '20260801_025_merge_authorisation_restore_pin.sql',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'schema-verification.js` first',
  'merge-restore-evidence-verification.js` second',
  'Running only `npm run verify:schema` or only `npm run verify:merge-restore-evidence` is not sufficient release evidence.',
  'Stop the release-candidate process if either verifier fails, is interrupted, or cannot start.',
  'npm run check:merge-restore-pin',
  'npm run check:customer-merge-execution-readiness',
  'node release-manifest-verification.js',
  'mergeExecutionEnabled: false',
  'talk2me.kloka.co.za',
  'kloka_talk2me',
  'talk2me.uent.co.za',
  'Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
];
requireMarkers(runbook, runbookMarkers, 'release runbook');

if (!pkg.scripts['verify:preview-data']) throw new Error('Missing verify:preview-data script');
if (!pkg.scripts['check:migration-ledger-bootstrap']) throw new Error('Missing check:migration-ledger-bootstrap script');
if (!pkg.scripts.check.includes('node --check preview-data-verification.js')) throw new Error('Preview data verifier syntax check missing from normal validation');
if (!pkg.scripts['check:release-candidate']) throw new Error('Missing check:release-candidate script');
if (!pkg.scripts['check:release-manifest']) throw new Error('Missing check:release-manifest script');
if (pkg.scripts.check.includes('release-candidate-gate.js')) throw new Error('Release candidate gate must not run in normal CI before lockfile freeze');
if (!pkg.scripts.check.includes('release-manifest-check.js')) throw new Error('Release manifest governance must run in the normal validation chain');

console.log(JSON.stringify({
  ok: true,
  module: 'release-candidate-governance',
  version: pkg.version,
  restorePinMigration: '20260801_025_merge_authorisation_restore_pin.sql',
  migrationLedgerBootstrapGovernanceRequired: true,
  migrationLedgerBootstrapWorkspaceBindingRequired: true,
  runtimeLedgerCreationDisabled: true,
  mergeExecutionEnabled: false,
  previewDataVerificationRequired: true,
  previewDataVerificationOrder: ['schema-verification.js','merge-restore-evidence-verification.js'],
  releaseMetadataBlocking: true,
  packageManifestWorkspaceBindingRequired: true,
  dependencyLockWorkspaceBindingRequired: true,
  migrationInventoryWorkspaceBindingRequired: true,
  exactCommitIdentityRequired: true,
  releaseBranchLocked: true,
  releaseEvidencePublicationRaceSafe: true,
  releaseEvidenceDirectoryPrivate: true,
  releaseEvidenceDirectorySymlinkProhibited: true,
  releaseEvidenceDirectoryDurabilitySync: true,
  releaseEvidenceVerifierCanonicalPaths: true,
  releaseEvidenceVerifierNoFollowReads: true,
  releaseEvidenceVerifierDescriptorIdentityRequired: true,
  releaseEvidenceVerifierSizeLimitsRequired: true,
  workspaceProtectedReadsUseNoFollow: true,
  postFreezeManifestVerificationRequired: true,
  gateMarkers: gateMarkers.length,
  previewDataMarkers: previewDataMarkers.length,
  verifierMarkers: verifierMarkers.length,
  runbookMarkers: runbookMarkers.length
}, null, 2));
