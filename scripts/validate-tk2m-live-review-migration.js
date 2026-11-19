'use strict';
/* CI contract for the live-only Data Review schema repair. No DB connection. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'scripts/install-tk2m-live-review-decisions.js'),'utf8');
const stage=fs.readFileSync(path.join(root,'scripts/install-tk2m-review-schema.js'),'utf8');
assert.match(src,/env\.CRM_LIVE_MODE!=='true'/);
assert.match(src,/env\.CRM_STAGE_MODE!=='false'/);
assert.match(src,/env\.DB_NAME!=='talk_crm_stage'/);
assert.match(src,/env\.DB_USER!=='talk_crmstg'/);
assert.match(src,/env\.APP_URL!=='https:\/\/crm\.tk2m\.co\.za'/);
assert.match(src,/--apply/);
assert.match(src,/--backup=/);
assert.match(src,/st\.size<100000/);
assert.match(src,/age>20\*60\*1000/);
assert.match(src,/CREATE TABLE IF NOT EXISTS tk2m_review_decisions/);
assert.match(src,/CREATE TABLE IF NOT EXISTS tk2m_review_history/);
assert.doesNotMatch(src,/CREATE TABLE IF NOT EXISTS tk2m_review_source_deltas/);
const ddl=src.split('const tables=')[1]?.split('async function validateTable')[0]||'';
for(const name of ['tk2m_review_decisions','tk2m_review_history']){
 assert.match(ddl,new RegExp('CREATE TABLE IF NOT EXISTS '+name));
 assert.ok(stage.includes('CREATE TABLE IF NOT EXISTS '+name),'staging schema reference missing '+name);
}
assert.ok(!/\b(?:DROP TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE clients|ALTER TABLE)\b/i.test(ddl));
assert.match(src,/const check=process\.argv\.includes\('--check'\),apply=process\.argv\.includes\('--apply'\)/);
assert.match(src,/if\(check===apply\)throw Error/);
assert.match(src,/if\(existing\.has\(name\)\)await validateTable/);
assert.match(src,/source_snapshot_not_modified=true/);
console.log('TK2M_LIVE_REVIEW_SCHEMA_GUARDS_AND_IDEMPOTENCE_CONTRACT_PASS');
