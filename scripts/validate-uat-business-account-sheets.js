'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const XLSX=require('xlsx');
const ejs=require('ejs');
const {
  parseQuarterlySheet,compareQuarterlyRows,ensureQuarterlySheetSchema,FILE_LIMIT,MAX_LINES
}=require('../src/services/quarterly-account-sheet');

function makeWorkbook(rows,header=['Number','Package','Upgrade Date','End Date','Usage','Current Cost']){
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...rows]),'Worksheet');
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx',cellDates:true});
}
const workbook=makeWorkbook([
  ['0828827058\u00a0','Red Business 55GB',new Date(Date.UTC(2026,9,1)),new Date(Date.UTC(2027,2,18)),'Yes',null],
  ['0662791744','3.7GB Data Top Up','2027-03-01','2027-08-18','Last Used Feb 2026','R 499.00'],
  ['0724347546','20GB Data Top Up','2026-04-01','2026-10-03','Yes',0]
]);
const parsed=parseQuarterlySheet(workbook,'Example (Pty) Ltd.xlsx');
assert.equal(parsed.sheetName,'Worksheet');
assert.equal(parsed.rows.length,3);
assert.equal(parsed.rows[0].phone,'27828827058');
assert.equal(parsed.rows[0].upgradeDate,'2026-10-01');
assert.equal(parsed.rows[0].endDate,'2027-03-18');
assert.equal(parsed.rows[0].currentCost,null);
assert.equal(parsed.rows[1].currentCost,499);
assert.equal(parsed.rows[1].usage,'Last Used Feb 2026');
assert.equal(parsed.rows[2].currentCost,0);
assert.equal(parsed.rows[0].sourceRow,2);
assert.ok(parsed.fileHash.length===64);
assert.deepEqual(parsed.headers,['Number','Package','Upgrade Date','End Date','Usage','Current Cost']);
assert.equal(parsed.rows[0].rawFields['Current Cost'],null);
assert.equal(FILE_LIMIT,4*1024*1024);
assert.equal(MAX_LINES,2000);
assert.throws(()=>parseQuarterlySheet(Buffer.alloc(50),'bad.xlsx'),/genuine/);
assert.throws(()=>parseQuarterlySheet(workbook,'bad.csv'),/\.xlsx/);
assert.throws(()=>parseQuarterlySheet(makeWorkbook([
  ['0828827058','A','','','',''],['0828827058','B','','','','']
]),'duplicate.xlsx'),/duplicate number/i);
assert.throws(()=>parseQuarterlySheet(makeWorkbook([
  ['bad','A','','','','']
]),'missing.xlsx'),/invalid or missing/);
assert.throws(()=>parseQuarterlySheet(makeWorkbook([
  ['0828827058','A','31-02-2026','','','']
]),'invaliddate.xlsx'),/invalid Upgrade Date/);
assert.throws(()=>parseQuarterlySheet(makeWorkbook([
  ['0828827058','A','','','','not a number']
]),'badcost.xlsx'),/Current Cost/);
assert.throws(()=>parseQuarterlySheet(makeWorkbook([
  ['0828827058','A','','','','']
],['Number','Name','Other','X','Y','Z']),'wrongheaders.xlsx'),/Number and Package/);

const previous=[
  {phone:'27828827058',packageName:'Red Business 55GB',upgradeDate:'2026-10-01',endDate:'2027-03-18',usage:'Yes',currentCost:null},
  {phone:'27860000000',packageName:'Old line',upgradeDate:null,endDate:null,usage:null,currentCost:120}
];
assert.deepEqual(compareQuarterlyRows(previous,parsed.rows),{added:2,updated:0,unchanged:1,removed:1});
assert.deepEqual(compareQuarterlyRows(parsed.rows,parsed.rows),{added:0,updated:0,unchanged:3,removed:0});
assert.deepEqual(compareQuarterlyRows(previous,[{...parsed.rows[0],packageName:'Changed'}]),{added:0,updated:1,unchanged:0,removed:1});

(async()=>{
  const queries=[];
  await ensureQuarterlySheetSchema({query:async sql=>{queries.push(sql);return [[]];}});
  assert.equal(queries.length,3);
  assert.ok(queries.every(sql=>sql.includes('CREATE TABLE IF NOT EXISTS business_account_sheet_')));
  assert.ok(queries.every(sql=>!/\bUPDATE\s+clients\b/i.test(sql)));

  const page=fs.readFileSync('views/business-account-sheet.ejs','utf8');
  const locals={
    basePath:'/talk2me',title:'Business Account Quarterly Sheet',appVersion:'dev',assetVersion:'dev',
    client:{id:101,client_name:'Example Only'},
    account:{id:7,account_number:'ACC-001',display_name:'Example Business'},
    versions:[],current:null,lines:[],totalRows:0,page:1,pageCount:1,csrfToken:'b'.repeat(64),
    preview:null,message:null,error:null,canRestore:true
  };
  const html=ejs.render(page,locals,{filename:'views/business-account-sheet.ejs'});
  assert.match(html,/enctype="multipart\/form-data"/);
  assert.match(html,/name="sheet_csrf"/);
  assert.match(html,/Quarterly Account Sheet|Business Account Sheets/);
  assert.match(html,/Preview the New Sheet/);
  assert.match(html,/Previous sheets are archived/);
  const pagePreview=ejs.render(page,{
    ...locals,
    preview:{
      id:'f'.repeat(36),filename:'Example.xlsx',sheetName:'Worksheet',
      rowCount:parsed.rows.length,lines:[{...parsed.rows[0],matchedClientId:null,matchStatus:'not_found'}],
      matched:0,unmatched:3,differences:{added:3,updated:0,unchanged:0,removed:0}
    }
  });
  assert.match(pagePreview,/Confirm &amp; Replace Current Sheet|Confirm & Replace Current Sheet/);
  assert.match(pagePreview,/replac[e] the current|Make it the current/);
  const source=fs.readFileSync('src/routes/uat-business-account-sheets.js','utf8');
  for(const path of ['/preview','/confirm','/restore/','/download/'])assert.ok(source.includes(path),'Route missing '+path);
  assert.match(source,/timingSafeEqual/);
  assert.match(source,/FOR UPDATE/);
  assert.match(source,/beginTransaction/);
  assert.match(source,/rollback/);
  assert.match(source,/fileHash/);
  assert.match(source,/matchedClientId/);
  assert.ok(!/\bUPDATE\s+clients\b/i.test(source),'Never automatically mutate core clients');
  assert.match(source,/uploaded_by=:userId/);
  const server=fs.readFileSync('server.js','utf8');
  assert.match(server,/if \(UAT_MODE\)[\s\S]*uatViralcoSync/);
  const view=fs.readFileSync('views/customer-360.ejs','utf8');
  assert.match(view,/ViralCo Business Account Update/);
  assert.match(view,/viralco-sync/);
  console.log('UAT business quarterly sheet parser, safety limits, change detection, account UI and routes validated.');
})().catch(err=>{console.error(err);process.exitCode=1;});
