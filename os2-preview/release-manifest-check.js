'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
const gate=fs.readFileSync(path.join(root,'release-candidate-gate.js'),'utf8');
const runbook=fs.readFileSync(path.join(root,'RELEASE_CANDIDATE_RUNBOOK.md'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=[
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_COMMIT_SHA or GITHUB_SHA is required',
  'Release commit SHA must be a full 40-character hexadecimal SHA',
  'RELEASE_APPROVED_BY is required',
  'RELEASE_CHANGE_REFERENCE is required',
  'RELEASE_MANIFEST_PATH is required',
  'RELEASE_MANIFEST_PATH must be absolute',
  'Release manifest directory does not exist',
  'dependencyLockPresent',
  'dependencyLockSha256',
  'migrationChecksums',
  'Runtime CREATE TABLE',
  '20260801_025_merge_authorisation_restore_pin.sql',
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

const runbookMarkers=[
  '20260801_025_merge_authorisation_restore_pin.sql',
  'npm run verify:merge-restore-evidence',
  'npm run check:merge-restore-pin',
  'npm run check:customer-merge-execution-readiness',
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
  releaseMetadataBlocking:true,
  dependencyLockChecksumRequired:true,
  runbookMarkers:runbookMarkers.length
},null,2));
