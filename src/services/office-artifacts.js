'use strict';
// Private, account-owned Office output. No public file system paths or user-provided filenames.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const XLSX=require('xlsx');
const db=require('../config/db');
const ROOT='/home/talk/crm-live/generated-office-files';
let schemaPromise;
const esc=v=>String(v==null?'':v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const cleanTitle=v=>String(v||'').trim().replace(/[\r\n\t]+/g,' ').slice(0,150);
const safeFileTitle=v=>cleanTitle(v).replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,65)||'document';
const validActor=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
function guard(){
 if(process.env.CRM_LIVE_MODE!=='true'||String(process.env.APP_URL)!=='https://crm.tk2m.co.za')throw Error('Office documents require the verified TK2M production CRM');
 if(!fs.existsSync(ROOT)||!fs.statSync(ROOT).isDirectory())throw Error('Private Office documents directory is unavailable');
 if(fs.statSync(ROOT).mode&0o077)throw Error('Office document directory permissions are unsafe');
}
async function ensureSchema(){
 if(!schemaPromise)schemaPromise=db.execute(`CREATE TABLE IF NOT EXISTS crm_office_files (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 staff_id INT NOT NULL,
 source VARCHAR(20) NOT NULL,
 title VARCHAR(160) NOT NULL,
 format VARCHAR(8) NOT NULL,
 storage_name VARCHAR(90) NOT NULL UNIQUE,
 filename VARCHAR(190) NOT NULL,
 size_bytes INT NOT NULL,
 sha256 CHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_crm_office_files_staff (staff_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e=>{schemaPromise=null;throw e});
 await schemaPromise;
}
function normaliseRows(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>250)throw Error('Excel requires between 1 and 250 rows');
 return rows.map(row=>{
  if(!Array.isArray(row)||row.length<1||row.length>15)throw Error('Each Excel row must have 1 to 15 cells');
  return row.map(v=>{
   const value=String(v==null?'':v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,350);
   return /^\s*[=+@-]/.test(value)?"'"+value:value;
  });
 });
}
function excelBuffer(rows){
 const data=normaliseRows(rows);
 const sheet=XLSX.utils.aoa_to_sheet(data);
 sheet['!cols']=Array.from({length:Math.max(...data.map(r=>r.length))},()=>({wch:24}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Report');
 return XLSX.write(wb,{bookType:'xlsx',type:'buffer',compression:true});
}
function wordParagraph(s,heading=false){
 const rich=heading?'<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>':'';
 return '<w:p><w:r>'+rich+'<w:t xml:space="preserve">'+esc(s)+'</w:t></w:r></w:p>';
}
function wordBuffer(title,body){
 const temp=fs.mkdtempSync(path.join(ROOT,'.build-'));
 try{
  fs.mkdirSync(path.join(temp,'_rels'),{mode:0o700});
  fs.mkdirSync(path.join(temp,'word'),{mode:0o700});
  const write=(file,content)=>fs.writeFileSync(path.join(temp,file),content,{mode:0o600});
  write('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
   '<Default Extension="xml" ContentType="application/xml"/>'+
   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  write('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paras=String(body||'').replace(/\r/g,'').slice(0,14000).split('\n').slice(0,200);
  write('word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
   '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
   wordParagraph(title,true)+paras.map(p=>wordParagraph(p)).join('')+
   '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1200" w:bottom="1440" w:left="1200"/></w:sectPr></w:body></w:document>');
  const output=path.join(temp,'working.docx');
  const zip=cp.spawnSync('/bin/zip',['-q','-X','-r',output,'[Content_Types].xml','_rels','word'],{cwd:temp,timeout:9000,encoding:'utf8'});
  if(zip.error||zip.status!==0)throw Error('DOCX ZIP generation failed');
  return fs.readFileSync(output);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function create({staffId,source,title,format,body='',rows=[]}){
 guard();if(!validActor(staffId)||!['backoffice','zippy'].includes(source))throw Error('Unauthorised document actor');
 const heading=cleanTitle(title);
 if(!heading)throw Error('Document title required');
 if(!['docx','xlsx'].includes(format))throw Error('Only Word and Excel documents are supported');
 const bytes=format==='xlsx'?excelBuffer(rows):wordBuffer(heading,body);
 if(bytes.length<100||bytes.length>2000000)throw Error('Document size exceeds 2 MB');
 await ensureSchema();
 const stored=crypto.randomBytes(24).toString('hex')+'.'+format;
 const output=path.join(ROOT,stored),filename=safeFileTitle(heading)+'.'+format;
 fs.writeFileSync(output,bytes,{mode:0o600,flag:'wx'});
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 try{
  const [r]=await db.execute('INSERT INTO crm_office_files(staff_id,source,title,format,storage_name,filename,size_bytes,sha256) VALUES(?,?,?,?,?,?,?,?)',
   [Number(staffId),source,heading,format,stored,filename,bytes.length,sha]);
  return {id:Number(r.insertId),title:heading,format,filename,size:bytes.length,download_url:'/api/office-files/'+r.insertId};
 }catch(e){fs.unlinkSync(output);throw e}
}
async function list(staffId){
 guard();await ensureSchema();
 const [rows]=await db.execute('SELECT id,title,filename,format,source,size_bytes,created_at FROM crm_office_files WHERE staff_id=? ORDER BY id DESC LIMIT 50',[Number(staffId)]);
 return rows;
}
async function find(staffId,id){
 guard();await ensureSchema();
 if(!Number.isSafeInteger(Number(id))||Number(id)<=0)return null;
 const [[r]]=await db.execute('SELECT id,title,filename,format,storage_name,size_bytes,sha256 FROM crm_office_files WHERE id=? AND staff_id=? LIMIT 1',[Number(id),Number(staffId)]);
 if(!r||!/^([a-f0-9]{48})\.(xlsx|docx)$/.test(r.storage_name))return null;
 const filepath=path.join(ROOT,r.storage_name);
 if(!fs.existsSync(filepath)||!fs.statSync(filepath).isFile())return null;
 return {...r,filepath,mime:r.format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
}
module.exports={create,list,find,ensureSchema,normaliseRows,excelBuffer,wordBuffer};
