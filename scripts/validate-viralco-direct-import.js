'use strict';

const assert=require('node:assert/strict');
const fs=require('fs');
const XLSX=require('xlsx');
const ejs=require('ejs');
const {
  parseViralCo,normaliseViralCoMsisdn,normaliseAccountNumber,
  companyKey,parseDate,parseMoney
}=require('../src/services/viralco-report');
const {
  matchReport,crmState,intendedState,crmDigest,loadGlobalPhoneMatches,belongsToAccount
}=require('../src/services/viralco-reconcile');

const columns=[
  'MSISDN','Subscriber Name','Invoice Name','Sponsored Acc','Activation Date','Term Date',
  'Upgradable','Earliest Update Date','Last Upgrade Date/Activation Date','Pack Code','Pack Desc',
  'Avg Spend','Loyalty Status','SIM Number','Dealer ID','Line Status Code'
];
const line=(n,date='2026-10-01',flag='Y',desc='RED 50GB')=>
  [n,'Sample Subscriber','SAMPLE COMPANY (PTY) LTD','UNKNOWN','2023-01-01','2028-10-14',flag,date,'2025-07-24','R50',desc,'R2124.92','', '89330000000011897498','G0163','1'];
function makeReport(rows,opts={}){
  const wb=XLSX.utils.book_new();
  const data=[
    ['Subscriber Detailed Report'],[],['Account Number:',opts.account||'NM000904'],
    ['Eligible for Upgrade:',opts.upgradeFilter||'All'],['Dealer ID:',opts.dealerFilter||'All'],
    ['Customer Name:',opts.company||'SAMPLE COMPANY (PTY) LTD'],[],columns,...rows
  ];
  const worksheet=XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb,worksheet,'Sheet1');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx',cellDates:true});
}
const raw=makeReport([line('828551167000'),line('824917018000','2027-03-16','N')]);
const parsed=parseViralCo(raw,'Subscriber Detailed Report (15).xlsx');
assert.equal(parsed.accountNumber,'NM000904');
assert.equal(parsed.upgradeFilter,'All');
assert.equal(parsed.dealerFilter,'All');
assert.equal(parsed.rows.length,2);
assert.equal(parsed.rows[0].msisdnOriginal,'828551167000');
assert.equal(parsed.rows[0].phone,'27828551167');
assert.equal(parsed.rows[0].packDesc,'RED 50GB');
assert.equal(parsed.rows[0].earliestUpgradeDate,'2026-10-01');
assert.equal(parsed.rows[0].termDate,'2028-10-14');
assert.equal(parsed.rows[0].lastUpgradeDate,'2025-07-24');
assert.equal(parsed.rows[0].upgradable,'Y');
assert.equal(parsed.rows[0].avgSpend,2124.92);
assert.equal(parsed.rows[0].simNumber,'89330000000011897498');
assert.equal(parsed.rows[0].lineStatusCode,'1');
assert.equal(parsed.fileHash.length,64);
assert.equal(normaliseAccountNumber(' nM 000904 '),'NM000904');
assert.equal(companyKey('SAMPLE COMPANY (PTY) LTD'),companyKey('SAMPLE COMPANY'));
assert.equal(normaliseViralCoMsisdn('828551167000'),'27828551167');
assert.equal(normaliseViralCoMsisdn('828551167999'),'');
assert.equal(parseDate('2026-02-30'),null);
assert.equal(parseDate('17/10/2026'),'2026-10-17');
assert.equal(parseMoney('R1,419.16'),1419.16);
assert.equal(parseMoney('R1419.16'),1419.16);
assert.equal(parseMoney('RABC'),undefined);
assert.throws(()=>parseViralCo(makeReport([line('828551167000')],{upgradeFilter:'Yes'}),'report.xlsx'),/Eligible for Upgrade = All/);
assert.throws(()=>parseViralCo(makeReport([line('828551167000')],{dealerFilter:'G0163'}),'report.xlsx'),/Eligible for Upgrade = All/);
assert.throws(()=>parseViralCo(makeReport([line('828551167999')]),'report.xlsx'),/invalid MSISDN/);
assert.throws(()=>parseViralCo(makeReport([line('828551167000'),line('828551167000')]),'report.xlsx'),/duplicate/);
assert.throws(()=>parseViralCo(makeReport([line('828551167000','2026-02-30')]),'report.xlsx'),/invalid Earliest Update Date/);
assert.throws(()=>parseViralCo(makeReport([line('828551167000')]),'report.csv'),/xlsx/);
const unsafeSim=line('828551167000');unsafeSim[13]=89330000000011897498;
assert.throws(()=>parseViralCo(makeReport([unsafeSim]),'report.xlsx'),/SIM Number was exported as an unsafe Excel number/);

const account={id:1511,account_number:'NM000904',display_name:'OLD INCORRECT NAME'};
const own=[
  {id:1001,account_id:1511,account_number:'NM000904',cell_number:'0828551167',cell_number_normalised:'27828551167',
    package_name:'OLD PACKAGE',next_upgrade_date:'2025-01-01',upgrade_date:'2025-01-01',previous_upgrade_date:'2024-01-01',
    updated_at:new Date('2026-10-01T00:00:00Z')},
  {id:1002,account_id:1511,account_number:'NM000904',cell_number:'0835555555',cell_number_normalised:'27835555555',
    package_name:'OTHER',next_upgrade_date:'2027-01-01',upgrade_date:'2027-01-01',previous_upgrade_date:null,
    updated_at:new Date('2026-10-01T00:00:00Z')}
];
const across=[
  {...own[0]},
  {id:2001,account_id:99,account_number:'OTHER',cell_number:'0824917018',cell_number_normalised:'27824917018'}
];
const matches=matchReport(parsed,account,own,across);
assert.equal(matches.total,2);
assert.equal(matches.matched,1);
assert.equal(matches.changed,1);
assert.equal(matches.conflicts,1);
assert.equal(matches.missingCount,1);
assert.equal(matches.nameMismatch,true);
assert.equal(belongsToAccount({account_id:99,account_number:'NM000904'},account),false);
assert.equal(belongsToAccount({account_id:null,account_number:'NM000904'},account),true);
assert.equal(matches.rows[0].action,'update');
assert.equal(matches.rows[1].action,'conflict');
assert.equal(matches.rows[0].previous.next_upgrade_date,'2025-01-01');
assert.equal(matches.rows[0].proposed.next_upgrade_date,'2026-10-01');
assert.equal(matches.rows[0].proposed.previous_upgrade_date,'2025-07-24');
assert.equal(matches.rows[0].previous.package_name,'OLD PACKAGE');
assert.equal(matches.rows[0].proposed.package_name,'RED 50GB');
assert.notEqual(crmDigest(own),crmDigest([{...own[0],package_name:'Changed'},own[1]]));
assert.deepEqual(crmState(own[0]),{package_name:'OLD PACKAGE',next_upgrade_date:'2025-01-01',
  upgrade_date:'2025-01-01',previous_upgrade_date:'2024-01-01'});
assert.equal(intendedState({...parsed.rows[0],earliestUpgradeDate:null},own[0]).next_upgrade_date,'2025-01-01');

(async()=>{
  // UAT copies JS service modules but not standalone SQL migrations. Schema must be self-contained.
  const ddl=[];
  await require('../src/services/viralco-reconcile').ensureSchema({query:async sql=>{ddl.push(sql);return [[]];}});
  assert.equal(ddl.length,3);
  assert.ok(ddl.every(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS viralco_import_')));
  assert.ok(ddl.every(sql=>!sql.includes('DROP TABLE')&&!sql.includes('UPDATE clients')));
  const page=fs.readFileSync('views/viralco-account-sync.ejs','utf8');
  const locals={basePath:'/talk2me',appVersion:'dev',assetVersion:'dev',
    client:{id:1001,client_name:'SAMPLE COMPANY'},
    account,current:null,versions:[],preview:null,manager:false,ownerManager:false,
    lines:[],totalRows:0,page:1,pageCount:1,csrfToken:'a'.repeat(64),message:'',error:''};
  const html=ejs.render(page,locals,{filename:'views/viralco-account-sync.ejs'});
  assert.match(html,/Upload the original ViralCo report/);
  assert.match(html,/enctype="multipart\/form-data"/);
  assert.match(html,/name="viralco_csrf"/);
  assert.match(html,/Eligible for Upgrade = All/);
  const preview={id:'f'.repeat(36),filename:'ViralCo.xlsx',report:parsed,...matches,
    baselineChanged:false,versionChanged:false,accountMatches:true,canConfirmName:false};
  const staff=ejs.render(page,{...locals,preview},{filename:'views/viralco-account-sync.ejs'});
  assert.match(staff,/Ask Gerda or a manager/);
  assert.match(staff,/Confirm &amp; Update CRM|Confirm & Update CRM/);
  assert.match(staff,/disabled/);
  const manager=ejs.render(page,{...locals,preview:{...preview,canConfirmName:true,safeNew:1},manager:true,ownerManager:true},
    {filename:'views/viralco-account-sync.ejs'});
  assert.match(manager,/verify_company/);
  assert.match(manager,/create_new/);
  assert.match(manager,/update_company/);
  assert.match(manager,/OLD INCORRECT NAME/);

  const route=fs.readFileSync('src/routes/uat-viralco-sync.js','utf8');
  assert.match(route,/SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=:id FOR UPDATE/);
  assert.match(route,/crmDigest/);
  assert.match(route,/timingSafeEqual/);
  assert.match(route,/beginTransaction/);
  assert.match(route,/await conn.rollback/);
  assert.match(route,/uploaded_by=:staffId/);
  assert.match(route,/create_new/);
  assert.match(route,/next_upgrade_date=COALESCE/);
  assert.doesNotMatch(route,/UPDATE\s+clients\s+SET[^\n]*monthly_invoice_amount/i);
  assert.doesNotMatch(route,/UPDATE\s+clients\s+SET[^\n]*line_status=/i);
  const server=fs.readFileSync('server.js','utf8');
  assert.match(server,/if \(UAT_MODE\)[\s\S]*uatViralcoSync/);
  assert.doesNotMatch(server,/app.use\('\/', uatBusinessAccountSheets\)/);
  assert.match(fs.readFileSync('views/customer-360.ejs','utf8'),/Verified Subscriber Details/);
  console.log('PASS: ViralCo direct parser, complete export checks, MSISDN suffix, dates, account match, audit, role UI and guarded import.');
})().catch(e=>{console.error(e);process.exitCode=1;});
