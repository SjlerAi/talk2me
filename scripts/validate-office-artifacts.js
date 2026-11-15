'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process'),path=require('node:path'),XLSX=require('xlsx');
const docs=require('../src/services/office-artifacts');
const rows=docs.normaliseRows([['Name','Amount'],['Gerda','=1+1'],['Johnny','35']]);
assert.equal(rows[1][1],"'=1+1");
const excel=docs.excelBuffer(rows);
assert(Buffer.isBuffer(excel)&&excel.length>200);
const wb=XLSX.read(excel,{type:'buffer'});
assert.equal(wb.SheetNames[0],'Report');
const parsed=XLSX.utils.sheet_to_json(wb.Sheets.Report,{header:1});
assert.equal(parsed[1][0],'Gerda');assert.equal(parsed[1][1],"'=1+1");
const word=docs.wordBuffer('Document test','Alpha & Omega\n<not a tag>');
const dir='/home/talk/crm-live/generated-office-files';
const dest=path.join(dir,'.validation-'+crypto.randomBytes(8).toString('hex')+'.docx');
fs.writeFileSync(dest,word,{mode:0o600,flag:'wx'});
try{
 const result=cp.spawnSync('/bin/unzip',['-t',dest],{encoding:'utf8'});
 assert.equal(result.status,0);
 const xml=cp.spawnSync('/bin/unzip',['-p',dest,'word/document.xml'],{encoding:'utf8'});
 assert.equal(xml.status,0);assert.match(xml.stdout,/Alpha &amp; Omega/);assert.match(xml.stdout,/&lt;not a tag&gt;/);
}finally{fs.unlinkSync(dest)}
console.log('TK2M_OFFICE_WORD_AND_EXCEL_VALIDATED');
