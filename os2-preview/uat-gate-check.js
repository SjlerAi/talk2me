'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];

function source(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing UAT dependency ${file}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}
function expect(condition, message) { if (!condition) failures.push(message); }
function requireMarkers(file, markers) {
  const content = source(file);
  for (const marker of markers) expect(content.includes(marker), `${file} missing ${marker}`);
}

const uatMarkers = [
  "expectedBaseUrl = 'https://talk2me.kloka.co.za'", "expectedHost = 'talk2me.kloka.co.za'",
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'expectedNodeMajor = 20',
  'requestTimeoutMs = 15000', 'maxResponseBytes = 2 * 1024 * 1024', 'maxResults = 40', 'crypto.randomUUID()',
  'UAT_EXPECTED_COMMIT_SHA', 'RELEASE_SOURCE_INVENTORY_SHA256', 'UAT_EXPECTED_COMMIT_SHA_REQUIRED', 'APPROVED_SOURCE_DIGEST_REQUIRED',
  'REFUSING_NON_CANONICAL_PREVIEW_URL', 'REFUSING_NON_PREVIEW_URL', 'PREVIEW_DATABASE_REQUIRED', 'CONTROLLED_BRANCH_REQUIRED',
  'NODE_20_REQUIRED', 'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'UAT_IDENTITY', 'UAT_PASSWORD_INVALID', 'safePath(value)', 'UAT_REQUEST_PATH_INVALID', 'UAT_REQUEST_ORIGIN_MISMATCH',
  'UAT_RESPONSE_DECLARED_TOO_LARGE', 'UAT_RESPONSE_TOO_LARGE', 'UAT_RESPONSE_NUL_PROHIBITED',
  "if (!['GET', 'POST'].includes(method))", "redirect: 'manual'", "cache: 'no-store'", "credentials: 'omit'",
  'AbortSignal.timeout(requestTimeoutMs)', 'UAT_REDIRECT_PROHIBITED', 'UAT_RESPONSE_ORIGIN_MISMATCH',
  'UAT_JSON_CONTENT_TYPE_REQUIRED', 'UAT_RESPONSE_INVALID_JSON',
  'SESSION_COOKIE_HTTPONLY_REQUIRED', 'SESSION_COOKIE_SECURE_REQUIRED', 'SESSION_COOKIE_SAMESITE_REQUIRED',
  'SESSION_COOKIE_DOMAIN_ATTRIBUTE_PROHIBITED', "^os2_session=[A-Za-z0-9._~-]{16,4096}$",
  '/health', '/api/auth/me', '/api/auth/login', '/api/dashboard', '/api/os2/customers/search',
  '/api/os2/work-items', '/api/os2/notifications', '/api/os2/calendar', '/api/auth/logout',
  'Invalid login rejected', 'Invalid login does not issue session', 'Authenticated response does not rotate session unexpectedly',
  'Mutation tests intentionally disabled', 'Create UAT work item', 'Transition UAT work item', 'Logout clears session cookie',
  'Logged-out session rejected', 'responseBytesBounded: true', 'redirectsProhibited: true',
  'crossOriginResponsesProhibited: true', 'jsonContentTypeRequired: true', 'invalidLoginChecked: true',
  'secureSessionCookieVerified: true', 'logoutSessionInvalidationVerified: true', 'sourceIdentityRecorded: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
];
requireMarkers('preview-uat-runner.js', uatMarkers);

const uatSource = source('preview-uat-runner.js');
expect(!uatSource.includes("process.env.UAT_ALLOW_MUTATIONS === 'true'"), 'UAT mutation flag must be normalized case-insensitively');
expect(!uatSource.includes("redirect: 'follow'"), 'UAT redirects must never be followed');
expect(!uatSource.includes('rejectUnauthorized: false'), 'TLS certificate validation may not be disabled');
expect(!uatSource.includes('NODE_TLS_REJECT_UNAUTHORIZED'), 'TLS validation override is prohibited');
expect(uatSource.indexOf('ensurePreviewIdentity();') < uatSource.indexOf("request('/health')"), 'Preview identity must be verified before the first request');
expect(uatSource.indexOf('Invalid login rejected') < uatSource.indexOf('Preview login'), 'Invalid-login handling must be tested before valid login');
expect(uatSource.indexOf('Preview login') < uatSource.indexOf('Authenticated session status'), 'Login must precede authenticated checks');
expect(uatSource.indexOf('Logout accepted') < uatSource.indexOf('Logged-out session rejected'), 'Logout must precede session invalidation verification');
expect(uatSource.indexOf("const dashboard = await request('/api/dashboard'") < uatSource.indexOf("const search = await request('/api/os2/customers/search"), 'Dashboard must precede customer search');
expect(uatSource.indexOf("const work = await request('/api/os2/work-items'") < uatSource.indexOf("const notifications = await request('/api/os2/notifications'"), 'Work queue must precede notification checks');

requireMarkers('release-source-integrity-verification.js', [
  'RELEASE_SOURCE_INVENTORY_SHA256', "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'verifierTimeoutMs = 30000', "killSignal: 'SIGKILL'", 'shell: false', 'exactApprovedInventoryMatched: true',
  'evidence.packageLockPresent !== true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('release-source-integrity-check.js', [
  "check: 'release-source-integrity-governance'", 'packageCommandsRegistered: true', 'normalSyntaxValidationRegistered: true',
  'normalGovernanceValidationRegistered: true', 'environmentBoundVerifierExcludedFromNormalExecution: true'
]);
requireMarkers('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.60.0'", 'expectedNodeMajor = 20',
  "expectedDatabase = 'kloka_talk2me'", 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'bootstrapMatchesWorkspace: true', 'verifiedBackupEvidencePresent: true', 'ledgerAbsentBeforeBootstrap: true', 'advisoryLockLifecycleVerified: true'
]);
requireMarkers('migration-runner.js', [
  "required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')", 'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true',
  'ledgerStrictPrefixVerified: true', 'advisoryLockReleased: true', 'advisoryLockFreeAfterRelease: true',
  'databaseConnectionClosedBeforeSuccess: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('preview-data-verification.js', [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "'schema-verification.js'", "'merge-restore-evidence-verification.js'", 'schemaZeroDefectEvidenceVerified: true',
  'restoreEvidenceSemanticsVerified: true', 'databaseBackedVerificationExecuted: true', 'mergeExecutionEnabled: false'
]);
const previewData = source('preview-data-verification.js');
expect(previewData.indexOf('schema-verification.js') < previewData.indexOf('merge-restore-evidence-verification.js'), 'Preview data verification must run schema before restore evidence');
requireMarkers('migrations/20260801_025_merge_authorisation_restore_pin.sql', ['ADD COLUMN restore_test_id BIGINT NULL']);
requireMarkers('customer-merge-execution-readiness-routes.js', ['executionAvailable:false']);

requireMarkers('PREVIEW_UAT_RUNBOOK.md', [
  'UAT_EXPECTED_COMMIT_SHA', 'RELEASE_SOURCE_INVENTORY_SHA256', '15-second request timeout', '2 MiB response limit',
  'redirects are prohibited', 'cross-origin responses are prohibited', 'invalid-login attempt', '`HttpOnly`', '`Secure`', '`SameSite`',
  'logout must clear the session cookie', 'the old session must return `401`', 'UAT run UUID', 'mutation work-item ID',
  'DB_NAME=kloka_talk2me', 'schema-verification.js` first', 'merge-restore-evidence-verification.js` second',
  'Running only `npm run verify:schema` is not sufficient', 'mergeExecutionEnabled: false', 'exact commit SHA and preview version'
]);
requireMarkers('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH', 'npm run verify:migration-ledger-bootstrap-evidence',
  'database connection must close before final success', 'Mandatory preview data verification'
]);

const pkg = JSON.parse(source('package.json') || '{}');
const exactScripts = {
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'verify:runtime-release-identity': 'node runtime-release-identity-check.js',
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js', 'verify:schema': 'node schema-verification.js',
  'verify:merge-restore-evidence': 'node merge-restore-evidence-verification.js',
  'verify:preview-data': 'node preview-data-verification.js', 'uat:preview': 'node preview-uat-runner.js'
};
for (const [name, command] of Object.entries(exactScripts)) expect(pkg.scripts?.[name] === command, `Package must expose exact ${name}`);
const normalCheck = String(pkg.scripts?.check || '');
expect(normalCheck.includes('node --check preview-uat-runner.js'), 'Normal validation must syntax-check preview-uat-runner.js');
expect(normalCheck.includes('node --check uat-gate-check.js'), 'Normal validation must syntax-check uat-gate-check.js');
expect(normalCheck.includes('node uat-gate-check.js'), 'Normal validation must execute UAT governance');
expect(!normalCheck.includes('node preview-uat-runner.js'), 'Environment-bound UAT runner must not execute during normal validation');

if (failures.length) {
  console.error('UAT GATE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'uat-gate',
  meaningfulControls: 60,
  exactPreviewOriginRequired: true,
  exactPreviewDatabaseRequired: true,
  exactControlledBranchRequired: true,
  node20Required: true,
  exactCommitShaRequired: true,
  approvedSourceDigestRequired: true,
  requestPathsValidated: true,
  requestMethodsRestricted: true,
  requestTimeoutBounded: true,
  responseBytesBounded: true,
  redirectsProhibited: true,
  crossOriginResponsesProhibited: true,
  jsonContentTypeRequired: true,
  tlsValidationOverrideProhibited: true,
  invalidLoginRequired: true,
  invalidLoginSessionProhibited: true,
  secureCookieHttpOnlyRequired: true,
  secureCookieSecureRequired: true,
  secureCookieSameSiteRequired: true,
  broadCookieDomainProhibited: true,
  authenticatedIdentityRequired: true,
  authenticatedRoleRequired: true,
  unexpectedSessionRotationProhibited: true,
  dashboardVerificationRequired: true,
  customerSearchVerificationRequired: true,
  workQueueVerificationRequired: true,
  notificationVerificationRequired: true,
  calendarVerificationRequired: true,
  mutationsDisabledByDefault: true,
  mutationRecordTraceableByRunId: true,
  logoutCookieClearRequired: true,
  logoutSessionInvalidationRequired: true,
  sourceIdentityRecorded: true,
  approvedSourceInventoryRequired: true,
  releaseSourceIntegrityVerificationRequired: true,
  runtimeReleaseIdentityRequired: true,
  migrationLedgerBootstrapEvidenceRequired: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  previewDataVerificationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
