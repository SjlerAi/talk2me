'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {localClock,archiveLibrary}=require('../src/services/tk2m-library-monthly-archive');
const source=fs.readFileSync('src/routes/uat-library.js','utf8');
const ui=fs.readFileSync('public/js/uat-library.js','utf8');
const view=fs.readFileSync('views/uat-library.ejs','utf8');
const cron=fs.readFileSync('scripts/run-tk2m-library-monthly-archive.js','utf8');
assert.equal(localClock(new Date('2026-12-06T22:00:01Z')).day,'07');
assert.equal(localClock(new Date('2026-12-06T22:00:01Z')).hour,'00');
assert.equal(localClock(new Date('2026-12-06T22:00:01Z')).minute,'00');
assert.equal(localClock(new Date('2026-12-06T22:00:01Z')).cutoff,'2026-12-07 00:00:00');
assert.equal(localClock(new Date('2026-12-06T21:59:59Z')).day,'06');
assert.match(source,/function canRestoreArchived/);
assert.match(source,/Number\(user.id\)===1/);
assert.match(source,/canRestoreArchived\(req.session.user\)/);
assert.match(source,/includeArchived && canRestoreArchived\(user\)/);
assert.match(source,/row.status!=='active'&&!canRestoreArchived\(req.session.user\)/);
assert.match(source,/Only Gerda can restore archived files/);
assert.match(source,/Only Gerda can republish archived documents/);
assert.match(source,/shareWithStaff:status==='active'/);
assert.match(source,/COALESCE\(v.created_at,d.created_at\) DESC/g);
assert.match(ui,/data-library-restore/);
assert.match(ui,/status=archived/);
assert.match(ui,/share_with_staff:true/);
assert.match(view,/data-library-archive-tab hidden/);
assert.match(view,/data-library-archive-list/);
assert.match(view,/midnight/);
assert.match(cron,/CRM_LIVE_MODE:'true'/);
assert.match(cron,/APP_URL:'https:\/\/crm.tk2m.co.za'/);
assert.match(cron,/Africa\/Johannesburg/);
assert.match(cron,/archiveLibrary\(db/);
const queries=[],history=[];
let firstRun=true,failOnUpdate=false;
const connection={
 async beginTransaction(){history.push('begin')},
 async commit(){history.push('commit')},
 async rollback(){history.push('rollback')},
 release(){history.push('release')},
 async execute(sql,params){
  queries.push({sql,params});
  if(sql.includes('INSERT IGNORE INTO library_monthly_archive_runs'))
   return [{affectedRows:firstRun?1:0}];
  if(sql.includes('INSERT INTO library_monthly_archive_items'))return [{affectedRows:44}];
  if(sql.includes("UPDATE library_documents")){
   if(failOnUpdate)throw Error('simulated MySQL interruption');
   return [{affectedRows:44}];
  }
  if(sql.includes("UPDATE library_monthly_archive_runs"))return [{affectedRows:1}];
  throw Error('Unexpected archive query: '+sql.slice(0,120));
 }
};
const db={
 async query(sql){queries.push({sql});return [[]]},
 async getConnection(){return connection}
};
async function validate(){
 const skipped=await archiveLibrary(db,{now:new Date('2026-12-06T21:59:59Z')});
 assert.equal(skipped.due,false);
 assert.equal(history.length,0);
 const atMidnight=await archiveLibrary(db,{now:new Date('2026-12-06T22:00:02Z')});
 assert.equal(atMidnight.month,'2026-12');
 assert.equal(atMidnight.archived,44);
 assert.deepEqual(history.slice(0,3),['begin','commit','release']);
 assert.ok(queries.some(q=>q.sql.includes('status=\'active\' AND d.updated_at<:cutoff')));
 assert.ok(queries.some(q=>q.sql.includes("SET status='archived'")));
 assert.ok(queries.some(q=>q.sql.includes('updated_at<:cutoff')));
 assert.ok(queries.some(q=>q.params?.cutoff==='2026-12-07 00:00:00'));
 firstRun=false;
 const duplicate=await archiveLibrary(db,{now:new Date('2026-12-06T22:00:22Z')});
 assert.equal(duplicate.alreadyRan,true);
 assert.equal(duplicate.archived,0);
 firstRun=true;failOnUpdate=true;
 await assert.rejects(()=>archiveLibrary(db,{now:new Date('2027-01-06T22:00:01Z')}),/simulated MySQL interruption/);
 assert.ok(history.includes('rollback'));
 failOnUpdate=false;
 const catchUp=await archiveLibrary(db,{now:new Date('2026-11-19T13:00:00Z'),catchUp:true});
 assert.equal(catchUp.month,'2026-11');
 assert.equal(catchUp.archived,44);
 const noCatch=await archiveLibrary(db,{now:new Date('2026-11-19T13:00:00Z')});
 assert.equal(noCatch.due,false);
 console.log('TK2M_LIBRARY_MIDNIGHT_7TH_ARCHIVE_GERDA_ONLY_AND_ROLLBACK_PASS');
}
validate().catch(e=>{console.error(e);process.exitCode=1});
