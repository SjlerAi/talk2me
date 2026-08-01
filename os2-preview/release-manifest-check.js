'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
const gate=fs.readFileSync(path.join(root,'release-candidate-gate.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=[
  'package-lock.json is required before release-candidate freeze',
  'RELEASE_APPROVED_BY',
  'RELEASE_CHANGE_REFERENCE',
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
if(!pkg.scripts['check:release-candidate']) throw new Error('Missing check:release-candidate script');
if(!pkg.scripts['check:release-manifest']) throw new Error('Missing check:release-manifest script');
if(pkg.scripts.check.includes('release-candidate-gate.js')) throw new Error('Release candidate gate must not run in normal CI before lockfile freeze');
if(!pkg.scripts.check.includes('release-manifest-check.js')) throw new Error('Release manifest governance must run in the normal validation chain');
console.log(JSON.stringify({
  ok:true,
  module:'release-candidate-governance',
  version:pkg.version,
  restorePinMigration:'20260801_025_merge_authorisation_restore_pin.sql',
  mergeExecutionEnabled:false
},null,2));
