'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
const gate=fs.readFileSync(path.join(root,'release-candidate-gate.js'),'utf8');
const verifier=fs.readFileSync(path.join(root,'release-manifest-verification.js'),'utf8');
const previewData=fs.readFileSync(path.join(root,'preview-data-verification.js'),'utf8');
const runbook=fs.readFileSync(path.join(root,'RELEASE_CANDIDATE_RUNBOOK.md'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=[
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
  "fs.openSync(file, 'wx', 0o600)",
  'fs.fsyncSync(descriptor)',
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(manifestTemp, manifestPath)',
  'syncDirectory(directory)',
  'fs.lstatSync(directory)',
  'stat.isSymbolicLink() || !stat.isDirectory()',
  '(stat.mode & 0o077) !== 0',
  'fs.realpathSync(directory) !== path.resolve(directory)',
  'Release manifest directory must be a regular non-symlink directory:',
  'Release manifest directory permissions must not allow group or world access:',
  'Release manifest directory must resolve to its exact path:',
  'Release evidence publication failed:',
  'RELEASE_APPROVED_BY is required',
  'RELEASE_CHANGE_REFERENCE is required',
  'RELEASE_MANIFEST_PATH is required',
  'RELEASE_MANIFEST_PATH must be absolute',
  'Release manifest directory does not exist',
  'Release manifest already exists:',
  'Release manifest checksum already exists:',
  "const checksumOutput = output ? `${output}.sha256` : ''",
  'sha256Text',
  'dependencyLockPresent',
  'dependencyLockSha256',
  'migrationChecksums',
  'Runtime CREATE TABLE',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'preview-data-verification.js',
  'verify:preview-data',
  'previewDataVerificationRequired: true',
  "previewDataVerificationOrder: ['schema-verification.js','merge-restore-evidence-verification.js']",
  'Preview data verification database guard is missing',
  'Preview data verification order is invalid',
  'Preview data verification must inherit verifier output',
  'Preview data verification merge execution lock is missing',
  'merge-restore-pin-check.js',
  'merge-restore-evidence-verification.js',
  'customer-merge-execution-readiness-check.js',
  'schema-source-consistency-check.js',
  'verify:merge-restore-evidence',
  'check:merge-restore-pin',
  'rt.id=a.restore_test_id',
  'restoreMatchesBackup',
  'executionAvailable:false',
  'restorePinMigration',
  'mergeExecutionEnabled: false'
];
for(const marker of required) if(!gate.includes(marker)) throw new Error(`Missing release gate marker: ${marker}`);
if(gate.includes("warn('No release")) throw new Error('Release identity metadata must be blocking, not warning-only');
if(!gate.includes('else if (failures.length === 0)')) throw new Error('Release manifest must not be written while blockers exist');
if(!gate.includes('publishEvidencePair(output, manifestText, checksumText)')) throw new Error('Release manifest and checksum must use paired publication');
if(!gate.includes('if (manifestPublished) removeIfPresent(manifestPath)')) throw new Error('Partial manifest publication cleanup is required');
if(!gate.includes('if (checksumPublished) removeIfPresent(checksumPath)')) throw new Error('Partial checksum publication cleanup is required');

const previewDataMarkers=[
  "expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
];
for(const marker of previewDataMarkers) if(!previewData.includes(marker)) throw new Error(`Missing preview data verifier marker: ${marker}`);
if(previewData.indexOf("'schema-verification.js'") > previewData.indexOf("'merge-restore-evidence-verification.js'")) {
  throw new Error('Preview data verification order must remain schema then restore evidence');
}

const verifierMarkers=[
  'RELEASE_MANIFEST_PATH is required',
  'RELEASE_MANIFEST_PATH must be absolute',
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
  'Required release evidence file is missing',
  'regular non-symlink file',
  'permissions must be 0600',
  'Release evidence file cannot be resolved canonically:',
  'Release evidence file path is not canonical:',
  'timingSafeEqual',
  'checksum verification failed',
  "manifest.application !== 'talk2me-os2-preview'",
  'manifest.version !== expectedPreviewVersion',
  'Release manifest package.json checksum is invalid',
  'Checked-out package.json is missing',
  'Checked-out package.json must be a regular non-symlink file',
  'package.json checksum does not match the checked-out package.json',
  'Checked-out package.json is not valid JSON',
  'Release manifest application does not match the checked-out package.json',
  'Release manifest version does not match the checked-out package.json',
  'Checked-out package.json does not match the controlled preview identity',
  'packageManifestMatchesWorkspace: true',
  'commitIdentityVerified',
  'Release manifest approver evidence is missing',
  'Release manifest change reference is missing',
  'Release manifest generation timestamp is invalid',
  'Release manifest generation timestamp is unreasonably in the future',
  'dependencyLockPresent',
  'dependencyLockSha256',
  'Checked-out package-lock.json is missing',
  'Checked-out package-lock.json must be a regular non-symlink file',
  'dependency-lock checksum does not match the checked-out package-lock.json',
  'actualDependencyLockChecksum',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'previewDataVerificationRequired !== true',
  'Release manifest preview data verification order is invalid',
  "'verify:preview-data'",
  "'preview-data-verification.js'",
  'mergeExecutionEnabled !== false',
  'migrationChecksums.length !== manifest.migrationCount',
  'Release manifest contains a duplicate migration entry:',
  'Release manifest migration evidence omits migration 025',
  'Release manifest migration inventory does not match the checked-out migration count',
  'Release manifest migration order does not match the checked-out source:',
  'Release manifest migration checksum does not match the checked-out source:',
  'actualMigrationFiles',
  'dependencyLockMatchesWorkspace: true',
  'migrationInventoryMatchesWorkspace: true',
  'evidenceDirectoryCanonical: true',
  'evidenceDirectoryPrivate: true',
  'release-manifest-verification'
];
for(const marker of verifierMarkers) if(!verifier.includes(marker)) throw new Error(`Missing release verifier marker: ${marker}`);

const runbookMarkers=[
  '20260801_025_merge_authorisation_restore_pin.sql',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'schema-verification.js` first',
  'merge-restore-evidence-verification.js` second',
  'Running only `npm run verify:schema` or only `npm run verify:merge-restore-evidence` is not sufficient release evidence.',
  'Stop the release-candidate process if either verifier fails, is interrupted, or cannot start.',
  'npm run check:merge-restore-pin',
  'npm run check:customer-merge-execution-readiness',
  'node release-manifest-verification.js',
  'exact passed restore test for the same verified backup',
  'restore completed before Owner authorisation',
  'A newer restore test must not be substituted',
  'mergeExecutionEnabled: false',
  'does not enable customer-merge execution',
  'talk2me.kloka.co.za',
  'kloka_talk2me',
  'talk2me.uent.co.za',
  'Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
];
for(const marker of runbookMarkers) if(!runbook.includes(marker)) throw new Error(`Missing release runbook marker: ${marker}`);

if(!pkg.scripts['verify:preview-data']) throw new Error('Missing verify:preview-data script');
if(!pkg.scripts.check.includes('node --check preview-data-verification.js')) throw new Error('Preview data verifier syntax check missing from normal validation');
if(!pkg.scripts['check:release-candidate']) throw new Error('Missing check:release-candidate script');
if(!pkg.scripts['check:release-manifest']) throw new Error('Missing check:release-manifest script');
if(pkg.scripts.check.includes('release-candidate-gate.js')) throw new Error('Release candidate gate must not run in normal CI before lockfile freeze');
if(!pkg.scripts.check.includes('release-manifest-check.js')) throw new Error('Release manifest governance must run in the normal validation chain');
console.log(JSON.stringify({
  ok:true,
  module:'release-candidate-governance',
  version:pkg.version,
  restorePinMigration:'20260801_025_merge_authorisation_restore_pin.sql',
  mergeExecutionEnabled:false,
  previewDataVerificationRequired:true,
  previewDataVerificationOrder:['schema-verification.js','merge-restore-evidence-verification.js'],
  releaseMetadataBlocking:true,
  releaseApplicationIdentityRequired:true,
  packageManifestChecksumRequired:true,
  packageManifestWorkspaceBindingRequired:true,
  releaseApproverEvidenceRequired:true,
  releaseChangeReferenceRequired:true,
  releaseTimestampValidationRequired:true,
  migrationInventoryConsistencyRequired:true,
  duplicateMigrationEvidenceProhibited:true,
  dependencyLockChecksumRequired:true,
  dependencyLockWorkspaceBindingRequired:true,
  migrationInventoryWorkspaceBindingRequired:true,
  postFreezeCommitIdentityBindingRequired:true,
  postFreezeBranchIdentityBindingRequired:true,
  exactCommitIdentityRequired:true,
  releaseBranchLocked:true,
  failedManifestWriteProhibited:true,
  manifestChecksumSidecarRequired:true,
  releaseEvidenceOverwriteProhibited:true,
  releaseEvidencePublicationRaceSafe:true,
  releaseEvidencePartialCleanupRequired:true,
  releaseEvidenceDirectoryPrivate:true,
  releaseEvidenceDirectorySymlinkProhibited:true,
  releaseEvidenceDirectoryDurabilitySync:true,
  releaseEvidenceVerifierDirectoryProtection:true,
  releaseEvidenceVerifierCanonicalPaths:true,
  postFreezeManifestVerificationRequired:true,
  releaseRunbookPreviewDataProtected:true,
  previewDataMarkers:previewDataMarkers.length,
  verifierMarkers:verifierMarkers.length,
  runbookMarkers:runbookMarkers.length
},null,2));
