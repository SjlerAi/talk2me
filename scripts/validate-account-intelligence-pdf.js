'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const crypto=require('node:crypto');
const {extractPdfText}=require('../src/services/account-intelligence-pdf');
const {parseStatement,compareMonths}=require('../src/services/account-intelligence-core');
function makePdf(lines){
  const escape=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const content=['BT','/F1 9 Tf','12 TL','40 750 Td'];
  for(const [i,line] of lines.entries()){
    if(i)content.push('T*');
    content.push('('+escape(line)+') Tj');
  }
  content.push('ET');
  const stream=Buffer.from(content.join('\n'),'latin1');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream.toString('latin1')+'\nendstream'
  ];
  let pdf='%PDF-1.4\n',offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(Buffer.byteLength(pdf,'latin1'));
    pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';
  }
  const start=Buffer.byteLength(pdf,'latin1');
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';
  return Buffer.from(pdf,'latin1');
}
test('real PDF bytes are extracted and reconciled from two billing months', async()=>{
 const pdf=makePdf([
  'Account Number: B0000001',
  '2026/10/03 INV B600000003 999111112 R17.29 R600.00',
  '2026/10/03 INV B600000004 999111113 R200.00 R800.00',
  '2026/11/03 INV B600000005 999111112 R30.00 R830.00',
  '2026/11/03 INV B600000006 999111113 R200.00 R1030.00',
  '2026/11/03 INV B600000007 999111114 R60.00 R1090.00',
  '2026/11/03 CRN CND123456 CND123456 R-10.00 R1080.00',
  '2026/11/09 CSH SCZ314817 496395817 R-220.00 R860.00'
 ]);
 const text=await extractPdfText(pdf);
 assert.match(text,/Account Number/);
 const parsed=parseStatement(text);
 assert.equal(parsed.accountNumber,'B0000001');
 assert.equal(parsed.entries.length,7);
 const result=compareMonths(parsed.entries,'2026-10','2026-11');
 assert.equal(result.netChangeCents,7271);
 assert.equal(result.current.credits,1000);
 assert.equal(result.current.payments,22000);
});
test('rejects spoofed PDF extension without a PDF signature',async()=>{
 await assert.rejects(()=>extractPdfText(Buffer.from('NOT_PDF')),/not a supported PDF/);
});
