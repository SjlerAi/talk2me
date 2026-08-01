'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const verifierTimeoutMs = 60000;
const maxVerifierOutputBytes = 4 * 1024 * 1024;
const actualDatabase = String(process.env.DB_NAME || '').trim();
const actualBranch = String(process.env.RELEASE_BRANCH || '').trim();
const actualRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const checks = [
  { file: 'schema-verification.js', check: 'schema-verification' },
  { file: 'merge-restore-evidence-verification.js', check: 'merge-restore-evidence-verification' }
];

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    check: 'preview-data-verification',
    error: message,
    database: actualDatabase || null,
    branch: actualBranch || null,
    applicationRoot: actualRoot || null,
    completed: details.completed || [],
    failedVerifier: details.failedVerifier || null,
    exitStatus: details.exitStatus ?? null,
    signal: details.signal || null,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
  process.exit(1);
}

if (actualDatabase !== expectedDatabase) fail('PREVIEW_DATABASE_REQUIRED');
if (actualBranch !== expectedBranch) fail('CONTROLLED_BRANCH_REQUIRED');
if (!actualRoot || !path.isAbsolute(actualRoot) || path.normalize(actualRoot) !== actualRoot || actualRoot !== root) fail('PREVIEW_APP_ROOT_INVALID');
if (!Number.isInteger(nodeMajor) || nodeMajor !== expectedNodeMajor) fail('NODE_20_REQUIRED');
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');

function buildChildEnvironment() {
  const inheritedKeys = ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS'];
  const env = {};
  for (const key of inheritedKeys) if (typeof process.env[key] === 'string' && process.env[key]) env[key] = process.env[key];
  env.PREVIEW_APP_ROOT = root;
  env.DB_NAME = expectedDatabase;
  env.DB_HOST = String(process.env.DB_HOST || '').trim();
  env.DB_PORT = String(process.env.DB_PORT || '3306').trim();
  env.DB_USER = String(process.env.DB_USER || '').trim();
  env.DB_PASSWORD = process.env.DB_PASSWORD || '';
  env.RELEASE_BRANCH = expectedBranch;
  env.NODE_ENV = 'production';
  env.ALLOW_PRODUCTION_MUTATION = 'false';
  env.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false';
  return Object.freeze(env);
}

const childEnvironment = buildChildEnvironment();
if (!childEnvironment.DB_HOST) fail('DB_HOST_REQUIRED');
if (!childEnvironment.DB_USER) fail('DB_USER_REQUIRED');
const dbPort = Number(childEnvironment.DB_PORT);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) fail('DB_PORT_INVALID');
if (Object.keys(childEnvironment).length > 22) fail('CHILD_ENVIRONMENT_KEY_LIMIT_EXCEEDED');

const completed = [];
const evidence = [];
for (const verifier of checks) {
  const result = spawnSync(process.execPath, [path.join(root, verifier.file)], {
    cwd: root,
    env: childEnvironment,
    encoding: 'utf8',
    maxBuffer: maxVerifierOutputBytes,
    timeout: verifierTimeoutMs,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });

  if (result.error && result.error.code === 'ETIMEDOUT') fail('VERIFIER_TIMEOUT', { completed, failedVerifier: verifier.file });
  if (result.error) fail(`VERIFIER_START_FAILED:${result.error.message}`, { completed, failedVerifier: verifier.file });
  if (result.signal) fail('VERIFIER_SIGNALLED', { completed, failedVerifier: verifier.file, signal: result.signal });
  if (result.status !== 0) fail(`VERIFIER_FAILED:${String(result.stderr || '').trim()}`, { completed, failedVerifier: verifier.file, exitStatus: result.status });

  let parsed;
  try { parsed = JSON.parse(String(result.stdout || '').trim()); } catch { fail('VERIFIER_OUTPUT_INVALID_JSON', { completed, failedVerifier: verifier.file }); }
  if (!parsed || parsed.ok !== true) fail('VERIFIER_OUTPUT_NOT_SUCCESSFUL', { completed, failedVerifier: verifier.file });
  if (parsed.database !== expectedDatabase) fail('VERIFIER_DATABASE_MISMATCH', { completed, failedVerifier: verifier.file });
  if (verifier.check === 'schema-verification') {
    if (!Number.isInteger(parsed.requiredTables) || parsed.requiredTables < 50) fail('SCHEMA_TABLE_EVIDENCE_INCOMPLETE', { completed, failedVerifier: verifier.file });
    if (!Number.isInteger(parsed.verifiedColumnGroups) || parsed.verifiedColumnGroups < 25) fail('SCHEMA_COLUMN_EVIDENCE_INCOMPLETE', { completed, failedVerifier: verifier.file });
    if (!Number.isInteger(parsed.appliedMigrations) || parsed.appliedMigrations < 25) fail('SCHEMA_MIGRATION_EVIDENCE_INCOMPLETE', { completed, failedVerifier: verifier.file });
    for (const key of ['duplicateAccounts','multiplePrimaryAccounts','duplicateMobiles','duplicateAccessGrants','archivedWithActiveOwnership','invalidDuplicatePairs','invalidMergePlans','invalidAuthorisations','invalidRepresentativePermissions','activeExpiredRepresentatives','unsafeApprovals','invalidatedApprovalsStillOpen']) {
      if (parsed[key] !== 0) fail(`SCHEMA_ZERO_DEFECT_EVIDENCE_MISSING:${key}`, { completed, failedVerifier: verifier.file });
    }
  }
  if (verifier.check === 'merge-restore-evidence-verification') {
    if (parsed.check !== verifier.check) fail('RESTORE_VERIFIER_IDENTITY_MISMATCH', { completed, failedVerifier: verifier.file });
    if (parsed.invalidAuthorisations !== 0) fail('INVALID_RESTORE_AUTHORISATIONS_DETECTED', { completed, failedVerifier: verifier.file });
  }
  evidence.push({ verifier: verifier.file, check: parsed.check || verifier.check, ok: true });
  completed.push(verifier.file);
}

if (completed.length !== checks.length) fail('VERIFIER_COMPLETION_COUNT_MISMATCH', { completed });
if (completed[0] !== 'schema-verification.js' || completed[1] !== 'merge-restore-evidence-verification.js') fail('VERIFIER_ORDER_MISMATCH', { completed });

console.log(JSON.stringify({
  ok: true,
  check: 'preview-data-verification',
  database: expectedDatabase,
  branch: expectedBranch,
  applicationRoot: root,
  nodeVersion: process.versions.node,
  completed,
  evidence,
  verifierCount: completed.length,
  schemaVerifiedBeforeRestoreEvidence: true,
  verifierEnvironmentSanitized: true,
  verifierEnvironmentFrozen: Object.isFrozen(childEnvironment),
  verifierEnvironmentKeyCount: Object.keys(childEnvironment).length,
  fullParentEnvironmentInherited: false,
  nodeOptionsInherited: false,
  nodePathInherited: false,
  bashEnvInherited: false,
  gitDirectoryOverrideInherited: false,
  npmUserConfigOverrideInherited: false,
  verifierTimeoutMs,
  verifierOutputBytesBounded: true,
  verifierShellDisabled: true,
  verifierForcedKillSignal: 'SIGKILL',
  verifierWindowHidden: true,
  schemaEvidenceParsed: true,
  schemaZeroDefectEvidenceVerified: true,
  restoreEvidenceParsed: true,
  restoreAuthorisationDefects: 0,
  databaseBackedVerificationExecuted: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
