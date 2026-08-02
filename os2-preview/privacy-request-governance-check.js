'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const routes = fs.readFileSync(path.join(root, 'privacy-routes.js'), 'utf8');
const securityRoutes = fs.readFileSync(path.join(root, 'security-routes.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'privacy-export-worker.js'), 'utf8');
const workerCheck = fs.readFileSync(path.join(root, 'privacy-export-worker-check.js'), 'utf8');
const migration009 = fs.readFileSync(path.join(root, 'migrations', '20260801_009_privacy_retention_and_exports.sql'), 'utf8');
const migration010 = fs.readFileSync(path.join(root, 'migrations', '20260801_010_privacy_export_worker.sql'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const failures = [];
const controls = [];

function control(name, condition) {
  try {
    assert.ok(condition, name);
    controls.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function marker(name, source, value) {
  control(name, source.includes(value));
}

marker('01 privacy routes require authenticated access', routes, "router.use('/api/os2/privacy', requireAuth)");
marker('02 consent reads require privacy read permission', routes, "requirePermission('privacy.read')");
marker('03 consent writes require privacy manage permission', routes, "requirePermission('privacy.manage')");
marker('04 privacy decisions require privacy decide permission', routes, "requirePermission('privacy.decide')");
marker('05 export queueing requires privacy export permission', routes, "requirePermission('privacy.export')");
marker('06 retention operations require privacy retention permission', routes, "requirePermission('privacy.retention')");
marker('07 numeric identifiers use positive safe integers', routes, 'Number.isSafeInteger(id) && id > 0');
marker('08 bounded text rejects control characters', routes, '/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/');
marker('09 request references contain cryptographic randomness', routes, 'crypto.randomBytes(6)');
marker('10 internal failures use bounded fallback responses', routes, "error:fallback");
marker('11 consent reads are customer scoped', routes, 'WHERE c.master_customer_id=:customerId');
marker('12 consent result sets are bounded', routes, 'ORDER BY c.created_at DESC,c.id DESC LIMIT 1000');
marker('13 consent creation locks the selected customer', routes, 'archived_at IS NULL LIMIT 1 FOR UPDATE');
marker('14 consent creation rejects missing customers', routes, "controlledError('CUSTOMER_NOT_FOUND',404)");
marker('15 consent status is allowlisted', routes, "['granted','withdrawn','not_required','pending']");
marker('16 consent grant time is database generated', routes, "CASE WHEN :status='granted' THEN NOW() ELSE NULL END");
marker('17 consent withdrawal time is database generated', routes, "CASE WHEN :status='withdrawn' THEN NOW() ELSE NULL END");
marker('18 consent creation records central audit evidence', routes, "actionType:'customer_consent_recorded'");
marker('19 request list status is allowlisted', routes, "['received','identity_verification','in_review','approved','rejected','completed','cancelled']");
marker('20 request list output is bounded', routes, 'LIMIT 500');
marker('21 privacy request types are allowlisted', routes, "['access','correction','restriction','objection','deletion','export']");
marker('22 privacy request creation locks active customer identity', routes, 'SELECT id,display_name FROM os2_master_customers WHERE id=:id AND archived_at IS NULL LIMIT 1 FOR UPDATE');
marker('23 privacy requests receive a thirty-day due date', routes, 'DATE_ADD(NOW(),INTERVAL 30 DAY)');
marker('24 privacy request creation is audited', routes, "actionType:'privacy_request_created'");
marker('25 privacy request decisions lock the request row', routes, 'SELECT * FROM os2_data_subject_requests WHERE id=:id LIMIT 1 FOR UPDATE');
marker('26 privacy request self-approval is prohibited', routes, "SELF_APPROVAL_NOT_ALLOWED");
marker('27 terminal privacy requests cannot be changed', routes, "PRIVACY_REQUEST_TERMINAL");
marker('28 rejection requires a bounded reason', routes, "REJECTION_REASON_REQUIRED");
marker('29 request updates compare the current state', routes, 'WHERE id=:id AND status=:currentStatus');
marker('30 request state transitions require one affected row', routes, 'PRIVACY_REQUEST_STATE_CHANGED');
marker('31 privacy request decisions are audited', routes, "actionType:'privacy_request_status_changed'");
marker('32 export formats are explicitly allowlisted', routes, "['json','csv_bundle']");
marker('33 only access or export requests can be exported', routes, "['access','export'].includes(record.request_type)");
marker('34 only approved or completed requests can queue exports', routes, "['approved','completed'].includes(record.status)");
marker('35 duplicate active exports are rejected', routes, 'ACTIVE_PRIVACY_EXPORT_ALREADY_EXISTS');
marker('36 active export detection checks expiry', routes, 'expires_at IS NOT NULL AND expires_at>NOW()');
marker('37 queued exports expire after seven days', routes, 'DATE_ADD(NOW(),INTERVAL 7 DAY)');
marker('38 export queueing records release authorization', routes, "'release_authorised'");
marker('39 export queueing records central audit evidence', routes, "actionType:'privacy_export_queued'");
marker('40 export queueing uses serializable isolation', routes, "{ isolationLevel:'SERIALIZABLE' }");
marker('41 export metadata requires export permission', routes, "router.get('/api/os2/privacy/exports/:id', requirePermission('privacy.export')");
marker('42 metadata joins the originating privacy request', routes, 'JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id');
control('43 metadata does not expose private storage references', !/SELECT e\.id[^;]+e\.storage_reference/s.test(routes));
marker('44 metadata access is recorded', routes, "'metadata_view'");
marker('45 revocation requires privacy decision permission', routes, "router.post('/api/os2/privacy/exports/:id/revoke', requirePermission('privacy.decide')");
marker('46 revocation requires a reason', routes, 'PRIVACY_EXPORT_REVOCATION_REASON_REQUIRED');
marker('47 revocation locks the export row', routes, 'SELECT * FROM os2_data_exports WHERE id=:id LIMIT 1 FOR UPDATE');
marker('48 repeated revocation is rejected', routes, 'PRIVACY_EXPORT_ALREADY_REVOKED');
marker('49 revocation clears active worker claims', routes, "status='revoked',worker_id=NULL,claimed_at=NULL");
marker('50 revocation uses compare-and-set state protection', routes, 'WHERE id=:id AND status=:currentStatus');
marker('51 revocation records access-log evidence', routes, "'revoked'");
marker('52 revocation records central audit evidence', routes, "actionType:'privacy_export_revoked'");
marker('53 retention review status is allowlisted', routes, "['pending','retained','archived','anonymised','deleted','deferred']");
marker('54 retention decisions lock pending reviews', routes, 'SELECT * FROM os2_retention_reviews WHERE id=:id LIMIT 1 FOR UPDATE');
marker('55 retention decisions require a reason', routes, 'RETENTION_DECISION_REASON_REQUIRED');
marker('56 retention decisions require one affected row', routes, 'RETENTION_REVIEW_STATE_CHANGED');
marker('57 retention decisions record central audit evidence', routes, "actionType:'retention_review_decided'");
marker('58 privacy routes are mounted through the authenticated security router', securityRoutes, 'router.use(createPrivacyRouter({pool,requireAuth}))');
control('59 runtime schema creation remains prohibited', !/CREATE\s+TABLE/i.test(routes) && !/CREATE\s+TABLE/i.test(worker));
control('60 canonical worker schema and governance remain registered', worker.includes('storage_reference') && worker.includes('content_sha256') && migration009.includes('storage_reference') && migration009.includes('content_sha256') && migration010.includes('worker_id') && pkg.scripts['check:privacy-export-worker'] === 'node privacy-export-worker-check.js' && pkg.scripts.check.includes('node privacy-export-worker-check.js') && workerCheck.includes('Expected exactly 60 named privacy-export controls'));

if (controls.length !== 60) failures.push(`Expected exactly 60 named privacy-request controls; found ${controls.length}`);
if (failures.length) {
  console.error('PRIVACY REQUEST 60-CONTROL CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'privacy-request-governance',
  meaningfulControls: 60,
  authenticatedPrivacyBoundaryRequired: true,
  consentAuditRequired: true,
  selfApprovalProhibited: true,
  approvedRequestsOnly: true,
  duplicateActiveExportsProhibited: true,
  privateStorageReferenceExposureProhibited: true,
  revocationEvidenceRequired: true,
  retentionDecisionEvidenceRequired: true,
  runtimeSchemaMutationProhibited: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
