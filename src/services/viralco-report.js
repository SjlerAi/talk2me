'use strict';

// Direct ViralCo Subscriber Detailed Report parser. No intermediate staff spreadsheet.
const crypto=require('crypto');
const XLSX=require('xlsx');
const {normaliseSouthAfricanMobile}=require('./sa-phone-normalisation');
const {inspectZip}=require('./quarterly-account-sheet');

const MAX_ROWS=2000;
const MAX_FILE=4*1024*1024;
const REQUIRED_HEADERS=[
  'MSISDN','Subscriber Name','Invoice Name','Sponsored Acc',
  'Activation Date','Term Date','Upgradable','Earliest Update Date',
  'Last Upgrade Date/Activation Date','Pack Code','Pack Desc','Avg Spend',
  'Loyalty Status','SIM Number','Dealer ID','Line Status Code'
];
const asText=(value,max=255)=>String(value===null||value===undefined?'':value).replace(/\u00a0/g,' ').trim().slice(0,max);
const headerKey=value=>asText(value).toLowerCase().replace(/[^a-z0-9]+/g,'');
function exactDate(year,month,day) {
  const y=Number(year),m=Number(month),d=Number(day);
  if(y<1900||y>2150||m<1||m>12||d<1||d>31)return null;
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d
    ? String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')
    : null;
}
function parseDate(value) {
  if(value===null||value===undefined||value==='')return null;
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return exactDate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate());
  if(typeof value==='number'){
    const decoded=XLSX.SSF.parse_date_code(value);
    return decoded?exactDate(decoded.y,decoded.m,decoded.d):null;
  }
  const s=asText(value,40),ymd=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(ymd)return exactDate(ymd[1],ymd[2],ymd[3]);
  const sa=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return sa?exactDate(sa[3],sa[2],sa[1]):null;
}
function parseMoney(value) {
  const s=asText(value,80);
  if(!s||s==='-')return null;
  let clean=s.replace(/[\sR]/gi,'');
  if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(clean))clean=clean.replace(/,/g,'');
  else if(/^\d+,\d{1,2}$/.test(clean))clean=clean.replace(',','.');
  if(!/^\d+(\.\d{1,2})?$/.test(clean))return undefined;
  const n=Number(clean);
  return Number.isFinite(n)&&n>=0&&n<=99999999?n:undefined;
}
function normaliseViralCoMsisdn(input) {
  let s=asText(input,40).replace(/[\s().-]/g,'');
  if(/^\d{9}000$/.test(s))s='0'+s.slice(0,9);
  return normaliseSouthAfricanMobile(s);
}
function parseViralCo(buffer,filename) {
  if(!/\.xlsx$/i.test(asText(filename,250)))throw new Error('The original ViralCo report must be an .xlsx workbook.');
  if(!Buffer.isBuffer(buffer)||buffer.length>MAX_FILE)throw new Error('The report is too large (maximum 4 MB).');
  inspectZip(buffer);
  let book;
  try{book=XLSX.read(buffer,{type:'buffer',cellDates:true,cellFormula:false,cellHTML:false,bookVBA:false});}
  catch(_){throw new Error('The ViralCo workbook could not be opened. Export it again as XLSX.');}
  if(book.SheetNames.length!==1)throw new Error('ViralCo Subscriber Detailed Report must contain one worksheet.');
  const sheet=book.Sheets[book.SheetNames[0]];
  if(!sheet||!sheet['!ref'])throw new Error('The ViralCo workbook is empty.');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  if(range.e.r>MAX_ROWS+50||range.e.c>45)throw new Error('The report exceeds the allowed size.');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,blankrows:true});
  if(headerKey(matrix[0]?.[0])!=='subscriberdetailedreport')throw new Error('This is not a ViralCo Subscriber Detailed Report.');
  const meta={};
  for(const row of matrix.slice(0,Math.min(matrix.length,20))){
    const k=headerKey(row?.[0]);
    if(k==='accountnumber')meta.accountNumber=asText(row[1],80);
    if(k==='customername')meta.customerName=asText(row[1],180);
    if(k==='eligibleforupgrade')meta.upgradeFilter=asText(row[1],40);
    if(k==='dealerid')meta.dealerFilter=asText(row[1],40);
  }
  if(!meta.accountNumber||!meta.customerName)throw new Error('ViralCo account number or customer name is missing.');
  if(meta.upgradeFilter.toLowerCase()!=='all'||meta.dealerFilter.toLowerCase()!=='all')
    throw new Error('Re-export with Eligible for Upgrade = All AND Dealer ID = All. Partial reports cannot replace a full business account.');
  let index=-1,columns=null;
  for(let row=0;row<Math.min(matrix.length,25);row++){
    const headers=(matrix[row]||[]).map(headerKey);
    if(!headers.includes('msisdn')||!headers.includes('packdesc'))continue;
    const positions=REQUIRED_HEADERS.map(h=>headers.indexOf(headerKey(h)));
    if(positions.some(p=>p<0))throw new Error('ViralCo report missing mandatory subscriber detail columns.');
    index=row;columns=positions;break;
  }
  if(index<0)throw new Error('Subscriber detail headings were not found.');
  const rows=[],seen=new Set(),errors=[];
  for(let i=index+1;i<matrix.length;i++){
    const record=matrix[i]||[];
    if(record.every(cell=>cell===null||cell===''||cell===undefined))continue;
    const get=name=>record[columns[REQUIRED_HEADERS.indexOf(name)]];
    const rawMsisdn=asText(get('MSISDN'),40);
    // Some workbooks may contain footer lines; reject rather than silently dropping data.
    const phone=normaliseViralCoMsisdn(rawMsisdn);
    if(!phone){errors.push('Row '+(i+1)+': invalid MSISDN format.');continue;}
    if(seen.has(phone)){errors.push('Row '+(i+1)+': duplicate subscriber mobile number.');continue;}
    seen.add(phone);
    const dates=[
      ['activationDate','Activation Date'],['termDate','Term Date'],
      ['earliestUpgradeDate','Earliest Update Date'],['lastUpgradeDate','Last Upgrade Date/Activation Date']
    ];
    const parsedDates={};
    for(const [name,heading] of dates){
      const value=get(heading),result=parseDate(value);
      if(value!==null&&value!==undefined&&asText(value)!==''&&!result)errors.push('Row '+(i+1)+': invalid '+heading+'.');
      parsedDates[name]=result;
    }
    const flag=asText(get('Upgradable'),1).toUpperCase();
    if(!['Y','N'].includes(flag))errors.push('Row '+(i+1)+': Upgradable must be Y or N.');
    const pack=asText(get('Pack Desc'),180),packCode=asText(get('Pack Code'),80);
    if(!pack)errors.push('Row '+(i+1)+': Pack Desc is missing.');
    // Excel silently rounds identifiers with >15 numeric digits; never publish corrupted SIM values.
    const simValue=get('SIM Number');
    if(typeof simValue==='number'&&!Number.isSafeInteger(simValue))
      errors.push('Row '+(i+1)+': SIM Number was exported as an unsafe Excel number. Re-export it as text.');
    const spend=parseMoney(get('Avg Spend'));
    if(spend===undefined)errors.push('Row '+(i+1)+': invalid Avg Spend.');
    const line={
      sourceRow:i+1,msisdnOriginal:rawMsisdn,phone,subscriberName:asText(get('Subscriber Name'),160),
      invoiceName:asText(get('Invoice Name'),160),sponsoredAccount:asText(get('Sponsored Acc'),120),
      ...parsedDates,upgradable:flag,packCode,packDesc:pack,avgSpend:spend??null,
      loyaltyStatus:asText(get('Loyalty Status'),120)||null,
      simNumber:asText(get('SIM Number'),80)||null,dealerId:asText(get('Dealer ID'),80)||null,
      lineStatusCode:asText(get('Line Status Code'),30)||null
    };
    rows.push(line);
    if(rows.length>MAX_ROWS)throw new Error('The ViralCo report exceeds the 2,000-line limit.');
  }
  if(errors.length)throw new Error('Please correct or re-export the report: '+errors.slice(0,7).join(' ')+(errors.length>7?' And '+(errors.length-7)+' more.':''));
  if(!rows.length)throw new Error('There are no subscriber lines in this report.');
  return {source:'ViralCo Subscriber Detailed Report',...meta,sheetName:book.SheetNames[0],headers:REQUIRED_HEADERS,rows,
    fileHash:crypto.createHash('sha256').update(buffer).digest('hex')};
}
function normaliseAccountNumber(value){return asText(value,80).replace(/\s+/g,'').toUpperCase();}
function companyKey(value){
  return asText(value,180).toUpperCase().replace(/[\W_]+/g,' ').replace(/\b(?:PTY|LTD|LIMITED|PROPRIETARY)\b/g,' ').replace(/\s+/g,' ').trim();
}
module.exports={parseViralCo,normaliseViralCoMsisdn,normaliseAccountNumber,companyKey,parseDate,parseMoney,MAX_ROWS,MAX_FILE};
