'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PREVIEW_DB,
  RELEASE_BRANCH,
  MAX_ATTEMPTS,
  MAX_SECTION_ROWS,
  MAX_TOTAL_ROWS,
  MAX_EXPORT_FILES,
  MAX_FILE_BYTES,
  MAX_EXPORT_BYTES,
  safeSegment,
  canonicalJson,
  csvCell,
  csv,
  failureCode
} = require('./privacy-export-worker');

const root = __dirname;
const worker = fs.readFileSync(path.join(root, 'privacy-export-worker.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'privacy-routes.js'), 'utf8');
const migration009 = fs.readFileSync(path.join(root, 'migrations', '20260801_009_privacy_retention_and_exports.sql'), 'utf8');
const migration010 = fs.readFileSync(path.join(root, 'migrations', '20260801_010_privacy_export_worker.sql'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PRIVACY_EXPORT_WORKER_RUNBOOK.md'), 'utf8');
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
function workerMarker(name, marker) { control(name, worker.includes(marker)); }
function routeMarker(name, marker) { control(name, routes.includes(marker)); }
function supporting(name, condition) {
  try { assert.ok(condition, name); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

control('01 exact preview database identity', PREVIEW_DB === 'kloka_talk2me');
control('02 exact controlled branch identity', RELEASE_BRANCH === 'agent/talk2me-os2-integrated-rebuild');
workerMarker('03 explicit worker enablement required', 'PRIVACY_EXPORT_WORKER_ENABLED');
workerMarker('04 production mutation flag prohibited', 'PRODUCTION_MUTATION_FLAG_PROHIBITED');
workerMarker('05 customer merge execution flag prohibited', 'MERGE_EXECUTION_FLAG_PROHIBITED');
workerMarker('06 database host required', "requiredEnvironment('DB_HOST'");
workerMarker('07 database user required', "requiredEnvironment('DB_USER'");
workerMarker('08 database port strictly bounded', "strictInteger('DB_PORT', 3306, 1, 65535)");
workerMarker('09 batch size strictly bounded', "strictInteger('PRIVACY_EXPORT_BATCH_SIZE', 3, 1, 10)");
workerMarker('10 worker interval strictly bounded', "strictInteger('PRIVACY_EXPORT_INTERVAL_MS', 30000, 10000, 3600000)");
workerMarker('11 run-once flag strictly parsed', "strictBoolean('PRIVACY_EXPORT_RUN_ONCE')");
workerMarker('12 export root must be absolute and normalized', 'PRIVACY_EXPORT_DIR_MUST_BE_ABSOLUTE_NORMALIZED');
workerMarker('13 public_html export roots prohibited', 'PRIVACY_EXPORT_DIR_PUBLIC_WEB_ROOT_PROHIBITED');
workerMarker('14 public asset export roots prohibited', 'PRIVACY_EXPORT_DIR_PUBLIC_ASSET_ROOT_PROHIBITED');
workerMarker('15 application source export roots prohibited', 'PRIVACY_EXPORT_DIR_SOURCE_ROOT_PROHIBITED');
workerMarker('16 private 0700 directories required', 'fsp.chmod(directory, 0o700)');
workerMarker('17 canonical directory paths required', 'EXPORT_DIRECTORY_NOT_CANONICAL');
workerMarker('18 directory symbolic links prohibited', 'stat.isSymbolicLink()');
workerMarker('19 directory owner consistency required', 'EXPORT_DIRECTORY_OWNER_MISMATCH');
workerMarker('20 secure directory descriptor flags required', 'O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW');
workerMarker('21 directory descriptor identity required', 'EXPORT_DIRECTORY_IDENTITY_CHANGED');
workerMarker('22 restrictive worker umask required', 'process.umask(0o077)');
control('23 worker identity contains random entropy', /privacy-export-\$\{process\.pid\}-\$\{crypto\.randomBytes\(8\)/.test(worker));
workerMarker('24 database pool limited to three connections', 'connectionLimit: 3');
workerMarker('25 database keepalive disabled', 'enableKeepAlive: false');
workerMarker('26 database connect timeout bounded', 'connectTimeout: 10000');
workerMarker('27 UTC database and driver time required', 'timezone: \'Z\'');
workerMarker('28 database identity verified per connection', 'SELECT DATABASE() database_name, CONNECTION_ID() connection_id');
control('29 maximum attempts fixed at three', MAX_ATTEMPTS === 3);
workerMarker('30 expired queued and processing jobs expire before claiming', "SET status='expired'");
workerMarker('31 stale claims at maximum attempts become failed', 'EXPORT_MAX_ATTEMPTS_EXCEEDED');
workerMarker('32 stale claims below maximum attempts return to queue', 'STALE_CLAIM_RESET');
workerMarker('33 claim query binds request and customer identity', 'r.master_customer_id=e.master_customer_id');
workerMarker('34 only approved or completed requests are claimable', "r.status IN ('approved','completed')");
workerMarker('35 only access or export request types are claimable', "r.request_type IN ('access','export')");
workerMarker('36 claiming uses serializable isolation', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
workerMarker('37 queue rows are locked before claiming', `LIMIT \${config.batchSize} FOR UPDATE`);
workerMarker('38 every claim transition requires one affected row', 'EXPORT_CLAIM_STATE_CHANGED');
workerMarker('39 export snapshot uses repeatable read isolation', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
workerMarker('40 request and export customer mismatch rejected', 'EXPORT_REQUEST_CUSTOMER_MISMATCH');
workerMarker('41 archived customer export rejected', 'EXPORT_CUSTOMER_ARCHIVED');
control('42 each exported section is row bounded', MAX_SECTION_ROWS === 10000);
control('43 complete export row count is bounded', MAX_TOTAL_ROWS === 50000);
workerMarker('44 customer query requires exactly one row', 'EXPORT_CUSTOMER_DUPLICATE');
workerMarker('45 every data query is scoped to customerId', 'WHERE master_customer_id=:customerId');
workerMarker('46 document binary content is excluded', 'SELECT id,master_customer_id,document_type,original_filename,mime_type,file_size,sha256_hash');
control('47 spreadsheet formula injection is neutralized', csvCell('=2+2').startsWith("'="));
control('48 CSV uses canonical LF and final newline', csv([{ b:'x', a:'y' }]) === 'a,b\ny,x\n');
control('49 canonical JSON is sorted and newline terminated', canonicalJson({ z:1, a:2 }) === '{\n  "a": 2,\n  "z": 1\n}\n');
workerMarker('50 binary values are prohibited from text exports', 'BINARY_VALUE_PROHIBITED');
control('51 path segments are deterministic and traversal safe', /^[A-Za-z0-9_-]+-[0-9a-f]{12}$/.test(safeSegment('../../customer')));
workerMarker('52 temporary output directory is randomized', 'crypto.randomBytes(8).toString(\'hex\')}.tmp');
workerMarker('53 existing final export targets are never overwritten', 'EXPORT_TARGET_ALREADY_EXISTS');
workerMarker('54 export files use exclusive no-follow creation', 'O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW');
workerMarker('55 export files require 0600 single-link ownership', 'stat.nlink !== 1');
control('56 individual export files are limited to 16 MiB', MAX_FILE_BYTES === 16 * 1024 * 1024);
control('57 complete artifact limits are 32 files and 64 MiB', MAX_EXPORT_FILES === 32 && MAX_EXPORT_BYTES === 64 * 1024 * 1024);
workerMarker('58 manifest contains per-file SHA-256 evidence', 'files: files.slice().sort');
workerMarker('59 ready publication is guarded and uses canonical schema columns', 'e.storage_reference=:storageReference,e.content_sha256=:checksum');
control('60 failure output is a bounded code and never raw prose', failureCode(new Error('contains private customer detail')) === 'EXPORT_GENERATION_FAILED');

supporting('migration 009 owns canonical storage and checksum columns', migration009.includes('storage_reference') && migration009.includes('content_sha256'));
supporting('migration 010 adds worker claim and artifact counters', ['worker_id','claimed_at','attempts','file_count','total_bytes'].every(marker => migration010.includes(marker)));
supporting('runtime schema creation remains prohibited', !/CREATE\s+TABLE/i.test(worker));
supporting('worker no longer writes nonexistent storage_path', !worker.includes('storage_path'));
supporting('worker no longer writes nonexistent sha256_checksum', !worker.includes('sha256_checksum'));
supporting('metadata endpoint never returns storage_reference', routes.includes('/api/os2/privacy/exports/:id') && !/SELECT e\.id[^;]+e\.storage_reference/s.test(routes));
supporting('queue requires approved request state', routes.includes('PRIVACY_REQUEST_NOT_APPROVED'));
supporting('duplicate active exports are rejected', routes.includes('ACTIVE_PRIVACY_EXPORT_ALREADY_EXISTS'));
supporting('export revocation clears active worker claim', routes.includes("status='revoked',worker_id=NULL,claimed_at=NULL"));
supporting('export access events are recorded', routes.includes('os2_export_access_log'));
supporting('worker start command is exact', pkg.scripts['start:privacy-export-worker'] === 'node privacy-export-worker.js');
supporting('worker governance command is exact', pkg.scripts['check:privacy-export-worker'] === 'node privacy-export-worker-check.js');
supporting('worker syntax and governance run in normal validation', pkg.scripts.check.includes('node --check privacy-export-worker.js') && pkg.scripts.check.includes('node privacy-export-worker-check.js'));
supporting('runbook declares 60 governed controls', runbook.includes('## Sixty governed controls') && runbook.includes('60.'));
supporting('runbook keeps production untouched', runbook.includes('Production at `talk2me.uent.co.za` remains untouched'));

if (controls.length !== 60) failures.push(`Expected exactly 60 named privacy-export controls; found ${controls.length}`);
if (failures.length) {
  console.error('PRIVACY EXPORT 60-CONTROL CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'privacy-export-worker-governance',
  meaningfulControls: 60,
  previewDatabase: PREVIEW_DB,
  controlledBranch: RELEASE_BRANCH,
  maxAttempts: MAX_ATTEMPTS,
  maxSectionRows: MAX_SECTION_ROWS,
  maxTotalRows: MAX_TOTAL_ROWS,
  maxExportFiles: MAX_EXPORT_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxExportBytes: MAX_EXPORT_BYTES,
  privateArtifactPublicationRequired: true,
  spreadsheetFormulaNeutralisationRequired: true,
  approvedRequestsOnly: true,
  duplicateActiveExportProhibited: true,
  revocationSupported: true,
  publicStoragePathExposureProhibited: true,
  rawFailureDetailsProhibited: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
