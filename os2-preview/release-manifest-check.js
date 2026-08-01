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
  "flag:'wx'",
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
if(!gate.includes('fs.writeFileSync(checksumOutput')) throw new Error('Release manifest checksum sidecar is required');
if(!gate.includes("mode:0o600, flag:'wx'")) throw new Error('Release evidence files must be private and non-overwriting');

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
  'Required release evidence file is missing',
  'regular non-symlink file',
  'permissions must be 0600',
  'timingSafeEqual',
  'checksum verification failed',
  'commitIdentityVerified',
  'dependencyLockPresent',
  'dependencyLockSha256',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'mergeExecutionEnabled !== false',
  'migrationChecksums.length < 25',
  'release-manifest-verification'
];
for(const marker of verifierMarkers) if(!verifier.includes(marker)) throw new Error(`Missing release verifier marker: ${marker}`);

const runbookMarkers=[
  '20260801_025_merge_authorisation_restore_pin.sql',
  'npm run verify:merge-restore-evidence',
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
  'Migration 025, preview schema verification, pinned restore-evidence verification, deployment, restart and formal UAT have not yet been executed.'
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
  dependencyLockChecksumRequired:true,
  exactCommitIdentityRequired:true,
  releaseBranchLocked:true,
  failedManifestWriteProhibited:true,
  manifestChecksumSidecarRequired:true,
  releaseEvidenceOverwriteProhibited:true,
  postFreezeManifestVerificationRequired:true,
  previewDataMarkers:previewDataMarkers.length,
  verifierMarkers:verifierMarkers.length,
  runbookMarkers:runbookMarkers.length
},null,2));
