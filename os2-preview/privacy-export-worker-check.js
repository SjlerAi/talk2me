'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const required = [
  'privacy-export-worker.js',
  'migrations/20260801_010_privacy_export_worker.sql',
  'PRIVACY_EXPORT_WORKER_RUNBOOK.md'
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing privacy export worker file: ${file}`);

const worker = fs.readFileSync(path.join(root,'privacy-export-worker.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/20260801_010_privacy_export_worker.sql'),'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

for (const marker of [
  'REFUSING_NON_PREVIEW_DATABASE','PRIVACY_EXPORT_WORKER_ENABLED','SELECT id FROM os2_data_exports',
  'FOR UPDATE','status=\'processing\'','sha256','PRIVACY_REQUEST_NOT_APPROVED','0o600','attempts>=3'
]) if (!worker.includes(marker)) throw new Error(`Privacy export worker control missing: ${marker}`);
for (const marker of ['worker_id','claimed_at','attempts','file_count','total_bytes','os2_export_access_log']) {
  if (!migration.includes(marker)) throw new Error(`Privacy export migration marker missing: ${marker}`);
}
if (pkg.scripts['start:privacy-export-worker'] !== 'node privacy-export-worker.js') throw new Error('Privacy export worker start command missing');
if (/CREATE\s+TABLE/i.test(worker)) throw new Error('Runtime CREATE TABLE detected in privacy export worker');

console.log(JSON.stringify({ ok:true,module:'privacy-export-worker',previewDatabase:'kloka_talk2me' },null,2));
