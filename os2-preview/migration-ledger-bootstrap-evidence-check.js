'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-evidence-verification.js'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-runner.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label} missing marker: ${marker}`);
  }
}

requireMarkers(verifier, [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql'",
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH is required',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'timingSafeEqual',
  'bootstrapSha256',
  'verifiedBackupSha256',
  'verifiedBackupReference',
  'preexistingLedgerTableCount !== 0',
  'createdLedgerTableCount !== 1',
  'ledgerSchemaVerified !== true',
  'ledgerRowCount !== 0',
  'advisoryLockOwnerVerified !== true',
  'advisoryLockReleased !== true',
  'productionMutationEnabled !== false',
  'mergeExecutionEnabled !== false',
  'bootstrapMatchesWorkspace: true',
  'advisoryLockLifecycleVerified: true'
], 'Bootstrap evidence verifier');

requireMarkers(runner, [
  'VERIFIED_BACKUP_REFERENCE',
  'VERIFIED_BACKUP_SHA256',
  'BOOTSTRAP_OPERATOR',
  'BOOTSTRAP_CHANGE_REFERENCE',
  'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE',
  'ledgerSchemaVerified: true',
  'ledgerEmpty: true',
  'advisoryLockOwnerVerified: true'
], 'Bootstrap runner');

requireMarkers(runbook, [
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'migration-ledger-bootstrap-evidence-verification.js',
  'bootstrap evidence checksum',
  'ledger table was absent before execution',
  'advisory lock lifecycle'
], 'Deployment runbook');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-ledger-bootstrap-evidence-governance',
  secureEvidenceReadRequired: true,
  evidenceChecksumRequired: true,
  bootstrapWorkspaceBindingRequired: true,
  verifiedBackupEvidenceRequired: true,
  operatorAndChangeReferenceRequired: true,
  ledgerAbsenceBeforeExecutionRequired: true,
  exactLedgerCreationRequired: true,
  schemaAndEmptyLedgerVerificationRequired: true,
  advisoryLockLifecycleRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
