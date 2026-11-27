'use strict';
// Local, read-only document preflight. No customer content is copied, logged,
// uploaded or committed. Pass TK2M_DOCS explicitly to select a trusted folder.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {extractPdfText}=require('../src/services/account-intelligence-pdf');
const core=require('../src/services/account-intelligence-core');
const root=process.env.TK2M_DOCS;
if(!root||!path.isAbsolute(root)||!fs.existsSync(root)){console.error('LOCAL_DOCS_PATH_UNAVAILABLE');process.exit(2)}
function maskAccount(v){if(!v)return null;return String(v).slice(0,1)+'***'+String(v).slice(-3)}
function rowShape(line){return line.slice(0,130).replace(/[A-Za-z]/g,'A').replace(/[0-9]/g,'9').replace(/[\u0080-\uffff]/g,'?')}
(async()=>{
 const names=fs.readdirSync(root).filter(n=>/\.jsp$/i.test(n)).sort();
 console.log('LOCAL_AUDIT_ONLY files='+names.length+' no_changes=true');
 let ok=0;
 for(const name of names){
  const full=path.join(root,name),raw=fs.readFileSync(full);
  try{
   const text=await extractPdfText(raw),p=core.parseStatement(text);
   const months=[...new Set(p.entries.map(x=>x.month))].sort();
   const dateLines=text.split(/\r?\n/).filter(x=>/^\s*(?:\d{4}[\/\-]\d{2}[\/\-]\d{2}|\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/.test(x));
   const accountLabels=(text.match(/account(?:\s+number|\s+no\.?|\s*#|\s*nr)/gi)||[]).length;
   const transactions={invoice:0,credit:0,payment:0,journal:0};
   for(const item of p.entries)if(Object.hasOwn(transactions,item.category))transactions[item.category]++;
   const result={name,size:raw.length,shaPrefix:crypto.createHash('sha256').update(raw).digest('hex').slice(0,12),
    validPdf:raw.subarray(0,5).toString('latin1')==='%PDF-',account:maskAccount(p.accountNumber),
    parsedTransactions:p.entries.length,months,types:transactions,warnings:p.notes.length,
    dateLines:dateLines.length,accountLabels,textLength:text.length};
   if(p.accountNumber&&p.entries.length&&months.includes('2026-10')&&months.includes('2026-11')){
    const c=core.compareMonths(p.entries,'2026-10','2026-11');
    result.octNov={priorInvoiceCents:c.previous.invoices,currentInvoiceCents:c.current.invoices,
      deltaCents:c.netChangeCents,creditCents:c.current.credits,paymentCents:c.current.payments,
      differences:c.changeCount,topShown:c.top.length,
      arithmeticReconciled:c.changes.reduce((n,x)=>n+x.deltaCents,0)===c.netChangeCents};
   }
   result.allDatedRowsParsed=dateLines.length===p.entries.length;
   // Independent ledger test: where statement rows contain a debit/credit and
   // a running balance, compare consecutive balances with signed movements.
   const pairRows=dateLines.map(line=>[...line.matchAll(/R?\\s*-?\\d[\\d,]*\\.\\d{2}/g)]
     .map(m=>core.cents(m[0])));
   let comparable=0,matched=0,mismatched=0;
   for(let i=1;i<pairRows.length;i++){
     if(pairRows[i].length<2||pairRows[i-1].length<2||
        p.entries[i]?.month!==p.entries[i-1]?.month)continue;
     comparable++;
     const actualDelta=pairRows[i].at(-1)-pairRows[i-1].at(-1);
     if(actualDelta===pairRows[i][0])matched++;
     else mismatched++;
   }
   result.ledgerBalanceCrossCheck={comparable,matched,mismatched};
   if(!p.accountNumber||!p.entries.length){
    // Shapes mask all alphanumeric content. Safe diagnostic: punctuation/layout only.
    result.dateRowShapes=dateLines.slice(0,3).map(rowShape);
    result.accountLabelPresent=/account/i.test(text);
    result.invoiceTokenPresent=/\b(?:INV|INVOICE|FAKTUUR)\b/i.test(text);
   }else ok++;
   console.log('DOC_AUDIT '+JSON.stringify(result));
  }catch(error){console.log('DOC_AUDIT '+JSON.stringify({name,errorClass:error.name||'Error',errorCode:'SOURCE_PARSE_FAILED',message:String(error.message||'').slice(0,100)}));}
 }
 console.log('LOCAL_SOURCE_READY_FOR_IMPORT '+ok+'/'+names.length);
})().catch(e=>{console.error('AUDIT_FAILURE '+String(e.message||e).slice(0,150));process.exitCode=1});
