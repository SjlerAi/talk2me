'use strict';

// Pure, read-only billing comparison. Every monetary calculation uses integer cents.
const MONEY = /R?\s*-?\d[\d,]*\.\d{2}/g;
const TYPES = new Set(['INV','CRN','CSH','PAY','JRN']);
function cents(value) {
  const cleaned = String(value || '').replace(/[R,\s]/gi, '');
  if (!/^-?\d+\.\d{2}$/.test(cleaned)) throw new Error('Invalid monetary value');
  const negative = cleaned.startsWith('-');
  const digits = (negative ? cleaned.slice(1) : cleaned).split('.');
  const amount = Number(digits[0]) * 100 + Number(digits[1]);
  if (!Number.isSafeInteger(amount)) throw new Error('Monetary value exceeds safe range');
  return negative ? -amount : amount;
}
function rand(value) { return (value / 100).toFixed(2); }
function monthFromDate(value) {
  const date = String(value || '');
  if (/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(date)) return date.slice(0,7).replace('/', '-');
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date.slice(6,10) + '-' + date.slice(3,5);
  return null;
}
function normaliseAccount(value) {
  return String(value || '').toUpperCase().replace(/[\s]/g,'');
}
function accountFromText(text) {
  const m = String(text || '').match(/Account\s*(?:Number|number)\s*:\s*([A-Z]{1,3}\d{5,12}(?:-\d+)?)/i);
  return m ? normaliseAccount(m[1]) : null;
}
function classify(type) {
  if (type === 'INV') return 'invoice';
  if (type === 'CRN') return 'credit';
  if (type === 'CSH' || type === 'PAY') return 'payment';
  return 'journal';
}
function stableKey(row) {
  const ref = String(row.reference || '').trim().toUpperCase();
  if (/^\d{7,15}$/.test(ref)) return 'LINE:' + ref;
  if (/^VT2-[A-Z0-9]+$/.test(String(row.itemNo || ''))) return 'SERVICE:VT2';
  // Monthly VT1 invoice IDs are transient; compare their recurring category total, not the generated invoice number.
  if (/^VT1-[A-Z0-9]+$/.test(String(row.itemNo || ''))) return 'SERVICE:VT1';
  if (/^[A-Z][A-Z0-9-]{3,}$/.test(ref)) return 'REFERENCE:' + ref;
  // Changing invoice IDs must not masquerade as reliable line matches.
  return 'UNMATCHED:' + String(row.itemNo || row.lineNo);
}
function row(type, date, itemNo, reference, amount, lineNo) {
  if (!TYPES.has(type)) return null;
  const month = monthFromDate(date);
  if (!month) return null;
  return {
    date: String(date), month, type, category: classify(type),
    itemNo: String(itemNo || ''), reference: String(reference || ''),
    amountCents: cents(amount), lineNo,
    matchingKey: stableKey({itemNo, reference, lineNo})
  };
}
function parseStatement(text) {
  if (typeof text !== 'string' || text.length > 4000000) throw new Error('Invalid PDF text');
  const accountNumber = accountFromText(text);
  const entries = [];
  const notes = [];
  const lines = text.replace(/\r/g,'').split('\n');
  for (let i=0; i<lines.length; i++) {
    const line = lines[i].replace(/\u00a0/g,' ').trim();
    if (!/^\d{4}\/\d{2}\/\d{2}\s+|^\d{2}\/\d{2}\/\d{4}\s+/.test(line)) continue;
    // Invoice-statement export: date | INV/CRN/CSH/JRN | item | reference | debit/credit | balance.
    const modern = line.match(/^(\d{4}\/\d{2}\/\d{2})\s+(INV|CRN|CSH|JRN|PAY)\s+([A-Z0-9-]+)\s*(.*)$/i);
    if (modern) {
      const tail = modern[4];
      const values = [...tail.matchAll(new RegExp(MONEY.source, 'g'))].map(x=>x[0]);
      if (!values.length) { notes.push('Missing amount on statement line '+(i+1)); continue; }
      const before = tail.slice(0,tail.indexOf(values[0])).trim();
      const ref = before.match(/^([A-Z0-9-]+)/i)?.[1] || '';
      entries.push(row(modern[2].toUpperCase(),modern[1],modern[3],ref,values[0],i+1));
      continue;
    }
    // Older Vodacom copy-statement format: date description item ref amount running total.
    const old = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
    if (!old || /BALANCE\s+FWD/i.test(old[2])) continue;
    const typeName = old[2].match(/^(Invoice|Payment|Journal)\b/i)?.[1]?.toLowerCase();
    if (!typeName) continue;
    const matches = [...old[2].matchAll(/-?\d[\d,]*\.\d{2}/g)];
    if (matches.length < 2) { notes.push('Unclear amount on line '+(i+1)); continue; }
    const money = matches[matches.length-2][0];
    const before = old[2].slice(0,matches[matches.length-2].index);
    const id = before.match(/\b(VT2-[A-Z0-9]+|B\d{7,}|SCZ\d+|SJ\d+)\b/i)?.[1] || '';
    const refs = before.match(/\b\d{9,12}\b/g) || [];
    const ref = refs.length ? refs[refs.length-1] : '';
    const type = typeName==='invoice'?'INV':typeName==='payment'?'PAY':'JRN';
    entries.push(row(type,old[1],id,ref,money,i+1));
  }
  if (!accountNumber) notes.push('Account number not confidently extracted');
  if (!entries.length) notes.push('No supported statement transactions extracted');
  return {accountNumber, entries:entries.filter(Boolean), notes, inspectedLines:lines.length};
}
function summarise(entries, month) {
  const totals = {invoices:0,credits:0,payments:0,journals:0};
  const invoice = new Map();
  for (const item of entries) {
    if (item.month !== month) continue;
    if (item.category === 'invoice') {
      totals.invoices += item.amountCents;
      const key=item.matchingKey;
      const old=invoice.get(key) || {key,reference:item.reference || item.itemNo,amountCents:0,items:0,needsReview:key.startsWith('UNMATCHED:')||key==='SERVICE:VT1'};
      old.amountCents += item.amountCents;
      old.items++;invoice.set(key,old);
    } else if (item.category === 'credit') totals.credits += Math.abs(item.amountCents);
    else if (item.category === 'payment') totals.payments += Math.abs(item.amountCents);
    else totals.journals += item.amountCents;
  }
  totals.netCharges = totals.invoices - totals.credits;
  return {totals,lines:[...invoice.values()]};
}
function compareMonths(entries, priorMonth, currentMonth, limit=10) {
  if (!/^\d{4}-\d{2}$/.test(priorMonth) || !/^\d{4}-\d{2}$/.test(currentMonth) || priorMonth===currentMonth)
    throw new Error('Choose two different valid billing months');
  const previous=summarise(entries,priorMonth);
  const current=summarise(entries,currentMonth);
  const before=new Map(previous.lines.map(x=>[x.key,x]));
  const after=new Map(current.lines.map(x=>[x.key,x]));
  const all=new Set([...before.keys(),...after.keys()]);
  const changes=[...all].map(key=>{
    const a=before.get(key),b=after.get(key);
    const oldCents=a?.amountCents||0,newCents=b?.amountCents||0;
    return {key,reference:b?.reference||a?.reference||'',oldCents,newCents,
      deltaCents:newCents-oldCents,kind:!a?'added':!b?'removed':oldCents!==newCents?'changed':'unchanged',
      needsReview:Boolean(a?.needsReview||b?.needsReview)};
  }).sort((a,b)=>Math.abs(b.deltaCents)-Math.abs(a.deltaCents)||a.key.localeCompare(b.key));
  const sum = changes.reduce((n,x)=>n+x.deltaCents,0);
  const totalDelta = current.totals.invoices-previous.totals.invoices;
  if(sum!==totalDelta)throw new Error('Billing differences failed to reconcile');
  return {priorMonth,currentMonth,previous:previous.totals,current:current.totals,
    netChangeCents:totalDelta,top:changes.filter(x=>x.deltaCents!==0).slice(0,limit),
    changes,changeCount:changes.filter(x=>x.deltaCents!==0).length,reviewCount:changes.filter(x=>x.needsReview).length,
    categoryMatchedPending:changes.some(x=>x.key==='SERVICE:VT1'&&x.needsReview)};
}
module.exports={cents,rand,monthFromDate,normaliseAccount,accountFromText,parseStatement,summarise,compareMonths,stableKey};
