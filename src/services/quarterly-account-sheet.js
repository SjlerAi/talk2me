'use strict';

const crypto = require('crypto');
const XLSX = require('xlsx');
const { normaliseSouthAfricanMobile } = require('./sa-phone-normalisation');

const FILE_LIMIT = 4 * 1024 * 1024;
const MAX_LINES = 2000;
const MAX_COLUMNS = 32;
const MAX_UNCOMPRESSED = 24 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1200;

const clean = (value,limit=500) => String(value == null ? '' : value).replace(/\u00a0/g,' ').trim().slice(0,limit);
const key = value => clean(value,100).toLowerCase().replace(/[^a-z0-9]+/g,' ');
const mapAliases = {
  number:['number','cell number','mobile number','msisdn','telephone number','line number'],
  package:['package','tariff','package name','current package'],
  upgradeDate:['upgrade date','upgrade due','upgrade eligibility date','next upgrade'],
  endDate:['end date','contract end','contract end date','expiry date'],
  usage:['usage','usage status','active usage','usage notes'],
  currentCost:['current cost','monthly cost','monthly invoice','monthly invoice amount','cost']
};
const iso = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  if (typeof value==='number' && Number.isFinite(value)) {
    const parts=XLSX.SSF.parse_date_code(value);
    if(parts && parts.y && parts.m && parts.d) return [parts.y,String(parts.m).padStart(2,'0'),String(parts.d).padStart(2,'0')].join('-');
    return null;
  }
  const s=clean(value,60);
  if(!s)return null;
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if(m)return validDate(Number(m[1]),Number(m[2]),Number(m[3]));
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if(m)return validDate(Number(m[3]),Number(m[2]),Number(m[1])); // South African dd/mm/yyyy
  return null;
};
function validDate(y,m,d) {
  if(y<1900||y>2150||m<1||m>12||d<1||d>31)return null;
  const s=[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
  return new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)===s?s:null;
}
function monetary(value) {
  let v=clean(value,70).replace(/[\s\u00a0R]/gi,'');
  if(!v || v==='-' || v.toLowerCase()==='n/a')return null;
  if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(v))v=v.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(v))v=v.replace(/,/g,'');
  else if(/^\d+,\d{1,2}$/.test(v))v=v.replace(',','.');
  if(!/^\d+(\.\d{1,2})?$/.test(v))return undefined;
  const n=Number(v);
  return Number.isFinite(n)&&n>=0&&n<100000000?n:null;
}
function inspectZip(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length<30||buffer.length>FILE_LIMIT||buffer.readUInt32LE(0)!==0x04034b50) {
    throw new Error('Upload a genuine .xlsx file smaller than 4 MB.');
  }
  const start=Math.max(0,buffer.length-66000);
  let eocd=-1;
  for(let i=buffer.length-22;i>=start;i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error('Invalid Excel ZIP workbook.');
  const entries=buffer.readUInt16LE(eocd+10);
  const directorySize=buffer.readUInt32LE(eocd+12);
  const directoryOffset=buffer.readUInt32LE(eocd+16);
  if(entries<1||entries>MAX_ZIP_ENTRIES||directorySize>buffer.length||directoryOffset+directorySize>buffer.length)
    throw new Error('Workbook ZIP size exceeds the safety limits.');
  let offset=directoryOffset,expanded=0;
  for(let i=0;i<entries;i++){
    if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid Excel ZIP directory.');
    const method=buffer.readUInt16LE(offset+10);
    const uncompressed=buffer.readUInt32LE(offset+24);
    const nameLength=buffer.readUInt16LE(offset+28);
    const extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32);
    const filename=buffer.toString('utf8',offset+46,offset+46+nameLength);
    if(method!==0&&method!==8)throw new Error('Unsupported Excel compression method.');
    if(/(?:xl\/vbaProject\.bin|xl\/externalLinks\/)/i.test(filename))throw new Error('Macro-enabled or externally linked workbooks are not supported.');
    expanded+=uncompressed;
    if(expanded>MAX_UNCOMPRESSED)throw new Error('The uncompressed workbook is too large.');
    offset+=46+nameLength+extra+comment;
  }
  if(offset>directoryOffset+directorySize)throw new Error('Invalid Excel ZIP entries.');
}
function parseQuarterlySheet(buffer,filename) {
  if(!/\.xlsx$/i.test(clean(filename,250)))throw new Error('Use a .xlsx workbook (not CSV or macro-enabled Excel).');
  inspectZip(buffer);
  let workbook;
  try { workbook=XLSX.read(buffer,{type:'buffer',cellDates:true,cellFormula:false,cellHTML:false,bookVBA:false}); }
  catch(_){throw new Error('The spreadsheet could not be opened. Save it as a valid .xlsx and try again.');}
  if(!workbook.SheetNames.length||workbook.SheetNames.length>8)throw new Error('The workbook must contain between 1 and 8 worksheets.');
  let sheet,headers,columnMap,headerIndex;
  for(const name of workbook.SheetNames){
    const candidate=workbook.Sheets[name];
    if(!candidate || !candidate['!ref'])continue;
    const range=XLSX.utils.decode_range(candidate['!ref']);
    if(range.e.r>MAX_LINES+30||range.e.c>MAX_COLUMNS-1)throw new Error('Workbook exceeds 2,000 rows or 32 columns.');
    const matrix=XLSX.utils.sheet_to_json(candidate,{header:1,defval:null,blankrows:true,raw:true});
    for(let i=0;i<Math.min(matrix.length,12);i++){
      const row=matrix[i],col={};
      for(const [field,aliases] of Object.entries(mapAliases)) {
        col[field]=row.findIndex(item=>aliases.includes(key(item).trim()));
      }
      if(col.number>=0&&col.package>=0){
        if(sheet)throw new Error('More than one worksheet contains a line list. Please upload one business account list.');
        sheet={name,matrix,startRow:range.s.r,original:candidate};headers=row.map((v,j)=>clean(v,100)||'Column '+(j+1));columnMap=col;headerIndex=i;
        break;
      }
    }
  }
  if(!sheet)throw new Error('Could not find Number and Package columns. Use the supplied business account sheet format.');
  const rows=[],errors=[],seen=new Set();
  for(let i=headerIndex+1;i<sheet.matrix.length;i++){
    const raw=sheet.matrix[i];
    if(!raw.some(item=>item!==null&&clean(item)!==''))continue;
    const display=clean(raw[columnMap.number],45);
    let number=display.replace(/\s+/g,'');
    // Excel General-format numbers can drop the leading zero of an SA mobile.
    if(/^[6-8]\d{8}$/.test(number))number='0'+number;
    const phone=normaliseSouthAfricanMobile(number);
    const pack=clean(raw[columnMap.package],255);
    const rowNumber=sheet.startRow+i+1;
    if(!phone){errors.push('Row '+rowNumber+': invalid or missing South African cellphone number.');continue;}
    if(!pack){errors.push('Row '+rowNumber+': package is required.');continue;}
    if(seen.has(phone)){errors.push('Row '+rowNumber+': duplicate number in this workbook.');continue;}
    seen.add(phone);
    const get=name=>columnMap[name]>=0?raw[columnMap[name]]:null;
    const dUpgrade=get('upgradeDate'),dEnd=get('endDate');
    const upgradeDate=iso(dUpgrade),endDate=iso(dEnd);
    if(clean(dUpgrade)&&!upgradeDate)errors.push('Row '+rowNumber+': invalid Upgrade Date.');
    if(clean(dEnd)&&!endDate)errors.push('Row '+rowNumber+': invalid End Date.');
    const cost=monetary(get('currentCost'));
    if(cost===undefined)errors.push('Row '+rowNumber+': Current Cost is not a valid amount.');
    const rawFields={};
    headers.forEach((h,j)=>{const v=raw[j];rawFields[h]=v instanceof Date?v.toISOString().slice(0,10):v==null?null:String(v).slice(0,1000);});
    rows.push({
      sourceRow:rowNumber,number:(number.startsWith('0')&&display.length===9?number:display),phone,packageName:pack,
      upgradeDate,endDate,usage:clean(get('usage'),500)||null,currentCost:cost??null,
      rawFields
    });
    if(rows.length>MAX_LINES)throw new Error('The file exceeds the 2,000-line account limit.');
  }
  if(errors.length)throw new Error('Correct these Excel errors before importing: '+errors.slice(0,8).join(' ') +(errors.length>8?' And '+(errors.length-8)+' more.':''));
  if(!rows.length)throw new Error('The selected worksheet has no valid business account lines.');
  return {sheetName:sheet.name,headers,rows,fileHash:crypto.createHash('sha256').update(buffer).digest('hex')};
}
function lineFingerprint(row){
  return JSON.stringify([row.packageName,row.upgradeDate,row.endDate,row.usage,row.currentCost]);
}
function compareQuarterlyRows(previous,next){
  const old=new Map(previous.map(x=>[x.phone,x]));
  const incoming=new Map(next.map(x=>[x.phone,x]));
  let added=0,updated=0,unchanged=0,removed=0;
  for(const row of next){
    const oldRow=old.get(row.phone);
    if(!oldRow)added++;
    else if(lineFingerprint(oldRow)===lineFingerprint(row))unchanged++;
    else updated++;
  }
  for(const row of previous)if(!incoming.has(row.phone))removed++;
  return {added,updated,unchanged,removed};
}
let schemaPromise;
async function ensureQuarterlySheetSchema(db){
  if(schemaPromise)return schemaPromise;
  schemaPromise=(async()=>{
    await db.query("CREATE TABLE IF NOT EXISTS business_account_sheet_previews ("+
      "id CHAR(36) NOT NULL PRIMARY KEY,account_id BIGINT UNSIGNED NOT NULL,client_id BIGINT UNSIGNED NOT NULL,"+
      "uploaded_by BIGINT UNSIGNED NOT NULL,filename VARCHAR(255) NOT NULL,file_hash CHAR(64) NOT NULL,"+
      "sheet_json MEDIUMTEXT NOT NULL,file_data MEDIUMBLOB NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"+
      "expires_at DATETIME NOT NULL,KEY idx_basp_account (account_id,uploaded_by,expires_at)"+
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS business_account_sheet_versions ("+
      "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,account_id BIGINT UNSIGNED NOT NULL,"+
      "version_no INT UNSIGNED NOT NULL,filename VARCHAR(255) NOT NULL,file_hash CHAR(64) NOT NULL,"+
      "file_data MEDIUMBLOB NOT NULL,sheet_name VARCHAR(160) NULL,headers_json TEXT NULL,"+
      "line_count INT UNSIGNED NOT NULL,matched_count INT UNSIGNED NOT NULL DEFAULT 0,"+
      "unmatched_count INT UNSIGNED NOT NULL DEFAULT 0,uploaded_by BIGINT UNSIGNED NOT NULL,"+
      "uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,is_current TINYINT(1) NOT NULL DEFAULT 1,"+
      "restored_from_id BIGINT UNSIGNED NULL,UNIQUE KEY uq_basv_account_version (account_id,version_no),"+
      "KEY idx_basv_active (account_id,is_current,uploaded_at)"+
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS business_account_sheet_lines ("+
      "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,version_id BIGINT UNSIGNED NOT NULL,"+
      "source_row INT UNSIGNED NOT NULL,phone_original VARCHAR(45) NOT NULL,phone_normalised VARCHAR(20) NOT NULL,"+
      "package_name VARCHAR(255) NOT NULL,upgrade_date_sheet DATE NULL,end_date_sheet DATE NULL,"+
      "usage_text VARCHAR(500) NULL,current_cost DECIMAL(14,2) NULL,matched_client_id BIGINT UNSIGNED NULL,"+
      "match_status ENUM('matched','not_found','ambiguous') NOT NULL DEFAULT 'not_found',"+
      "raw_json TEXT NULL,UNIQUE KEY uq_basl_version_row (version_id,source_row),"+
      "KEY idx_basl_number (phone_normalised),KEY idx_basl_version (version_id),"+
      "CONSTRAINT fk_basl_version FOREIGN KEY (version_id) REFERENCES business_account_sheet_versions(id) ON DELETE RESTRICT"+
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  })().catch(error=>{schemaPromise=null;throw error;});
  return schemaPromise;
}

module.exports={parseQuarterlySheet,compareQuarterlyRows,ensureQuarterlySheetSchema,monetary,iso,FILE_LIMIT,MAX_LINES};
