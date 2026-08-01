'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'release-manifest-verification.js'), 'utf8');
const governance = fs.readFileSync(path.join(root, 'release-manifest-check.js'), 'utf8');
const activationRunbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
  }
}

const secureReadMarkers = [
  'function readSecureRegularFile(file, options = {})',
  'fs.lstatSync(file)',
  'pathStat.isSymbolicLink()',
  'fs.realpathSync.native(file)',
  'fs.constants.O_NOFOLLOW',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'fs.fstatSync(descriptor)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.size > maxBytes',
  'fs.readFileSync(descriptor)',
  'fs.closeSync(descriptor)',
  "expectedMode: 0o600",
  'maxBytes: 4096',
  'evidenceReadsUseNoFollow: true',
  'evidenceDescriptorIdentityVerified: true',
  'protectedFileSizeLimitsEnforced: true'
];
requireMarkers(verifier, secureReadMarkers, 'Release verifier');

const protectedTargets = [
  "readSecureRegularFile(manifestPath",
  "readSecureRegularFile(checksumPath",
  "readSecureRegularFile(packageJsonPath",
  "readSecureRegularFile(packageLockPath",
  "readSecureRegularFile(path.join(migrationsDirectory, file)"
];
requireMarkers(verifier, protectedTargets, 'Protected read coverage');
requireMarkers(governance, [
  'releaseEvidenceVerifierNoFollowReads: true',
  'releaseEvidenceVerifierDescriptorIdentityRequired: true',
  'releaseEvidenceVerifierSizeLimitsRequired: true',
  'workspaceProtectedReadsUseNoFollow: true'
], 'Release governance');
requireMarkers(activationRunbook, [
  'open protected files with `O_NOFOLLOW`',
  'compare the validated path device/inode identity with the opened descriptor',
  'read through the validated descriptor rather than reopening by path',
  'enforce bounded file sizes before reading'
], 'Activation runbook');

console.log(JSON.stringify({
  ok: true,
  check: 'release-evidence-security',
  version: pkg.version,
  noFollowRequired: true,
  descriptorIdentityRequired: true,
  descriptorBasedReadRequired: true,
  boundedReadsRequired: true,
  protectedTargets: protectedTargets.length,
  independentlyExecutable: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
