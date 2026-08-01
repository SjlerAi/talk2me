'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    check: 'release-source-integrity-verification',
    error: message,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
  process.exit(1);
}

const expectedInventorySha256 = String(process.env.RELEASE_SOURCE_INVENTORY_SHA256 || '').trim().toLowerCase();
const database = String(process.env.DB_NAME || '').trim();
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (!/^[0-9a-f]{64}$/.test(expectedInventorySha256)) fail('RELEASE_SOURCE_INVENTORY_SHA256 must be a 64-character hexadecimal SHA-256');
if (database !== expectedDatabase) fail(`DB_NAME must be ${expectedDatabase}`);
if (branch !== expectedBranch) fail(`RELEASE_BRANCH or GITHUB_REF_NAME must be ${expectedBranch}`);
if (!configuredRoot || configuredRoot !== root || !path.isAbsolute(configuredRoot) || path.normalize(configuredRoot) !== configuredRoot) fail(`PREVIEW_APP_ROOT must exactly match ${root}`);
if (nodeMajor !== expectedNodeMajor) fail(`Node.js ${expectedNodeMajor}.x is required; found ${process.versions.node}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('ALLOW_PRODUCTION_MUTATION=true is prohibited');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('ENABLE_CUSTOMER_MERGE_EXECUTION=true is prohibited');

const result = spawnSync(process.execPath, [path.join(root, 'workspace-source-integrity.js')], {
  cwd: root,
  env: {
    ...process.env,
    PREVIEW_APP_ROOT: root,
    DB_NAME: expectedDatabase,
    RELEASE_BRANCH: expectedBranch,
    ALLOW_PRODUCTION_MUTATION: 'false',
    ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
  },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true
});

if (result.error) fail(`Workspace source integrity verifier could not start: ${result.error.message}`);
if (result.signal) fail(`Workspace source integrity verifier was interrupted by signal ${result.signal}`);
if (result.status !== 0) fail(`Workspace source integrity verifier failed with status ${result.status}: ${String(result.stderr || '').trim()}`);

let evidence;
try { evidence = JSON.parse(String(result.stdout || '').trim()); }
catch { fail('Workspace source integrity verifier did not return valid JSON'); }

if (evidence.ok !== true || evidence.check !== 'workspace-source-integrity') fail('Workspace source integrity evidence identity is invalid');
if (evidence.database !== expectedDatabase || evidence.branch !== expectedBranch) fail('Workspace source integrity evidence preview identity is invalid');
if (evidence.productionMutationEnabled !== false || evidence.mergeExecutionEnabled !== false) fail('Workspace source integrity evidence safety flags are invalid');
if (!/^[0-9a-f]{64}$/i.test(String(evidence.inventorySha256 || ''))) fail('Workspace source integrity evidence is missing a valid inventory digest');
if (String(evidence.inventorySha256).toLowerCase() !== expectedInventorySha256) fail('Workspace source inventory digest does not match the approved release digest');
if (!Array.isArray(evidence.files) || evidence.files.length < 25) fail('Workspace source integrity evidence file inventory is incomplete');
if (evidence.packageLockPresent !== true) fail('Release source integrity requires the committed package-lock.json to be included');

console.log(JSON.stringify({
  ok: true,
  check: 'release-source-integrity-verification',
  application: evidence.application,
  version: evidence.version,
  applicationRoot: evidence.applicationRoot,
  database: expectedDatabase,
  branch: expectedBranch,
  inventorySha256: expectedInventorySha256,
  protectedFileCount: evidence.protectedFileCount,
  migrationCount: evidence.migrationCount,
  packageLockPresent: true,
  exactApprovedInventoryMatched: true,
  secureDescriptorReadsVerified: evidence.secureDescriptorReads === true,
  canonicalPathBindingVerified: evidence.canonicalPathBinding === true,
  hardLinkRejectionVerified: evidence.hardLinkRejection === true,
  ownershipConsistencyVerified: evidence.ownershipConsistency === true,
  boundedReadsVerified: evidence.boundedReads === true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
