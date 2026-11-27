'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const core=require('../src/services/account-intelligence-core');

test('modern multi-month statement separates invoices, credits and payments',()=>{
 const sample = [
 'Account Number: B0000001',
 'Date Type Item No Item Reference Debit Credit Balance',
 '2026/10/03 INV B600000003 999111112 R17.29 R600.00',
 '2026/10/03 INV B600000004 999111113 R200.00 R800.00',
 '2026/11/03 INV B600000005 999111112 R30.00 R830.00',
 '2026/11/03 INV B600000006 999111113 R200.00 R1030.00',
 '2026/11/03 INV B600000007 999111114 R60.00 R1090.00',
 '2026/11/03 CRN CND123456 CND123456 R-10.00 R1080.00',
 '2026/11/09 CSH SCZ314817 496395817 R-220.00 R860.00',
 '2026/11/12 JRN SJ1639 R0.00 R860.00'
 ].join('\n');
 const parsed=core.parseStatement(sample);
 assert.equal(parsed.accountNumber,'B0000001');
 assert.equal(parsed.entries.length,8);
 const cmp=core.compareMonths(parsed.entries,'2026-10','2026-11');
 assert.equal(cmp.previous.invoices,21729);
 assert.equal(cmp.current.invoices,29000);
 assert.equal(cmp.current.credits,1000);
 assert.equal(cmp.current.payments,22000);
 assert.equal(cmp.netChangeCents,7271);
 assert.equal(cmp.top[0].deltaCents,6000);
 assert.equal(cmp.changeCount,2);
 assert.equal(cmp.changes.filter(x=>x.kind==='unchanged').length,1);
 assert.equal(cmp.changes.reduce((n,x)=>n+x.deltaCents,0),cmp.netChangeCents);
});
test('historical statement format tracks stable line reference despite changing item number',()=>{
 const txt=[
 'Account number: B0000002-1',
 '01/07/2026 Invoice VT2-FAKE1 5,142.95 5,142.95',
 '03/07/2026 Invoice LE ROUX B600000001 999111111 2,502.34 7,645.29',
 '01/08/2026 Invoice VT2-FAKE2 5,142.95 5,142.95',
 '03/08/2026 Invoice LE ROUX B600000002 999111111 2,521.85 7,664.80',
 '03/08/2026 Journal SJ6540 0.00 7,664.80'
 ].join('\n');
 const p=core.parseStatement(txt);
 assert.equal(p.entries.length,5);
 const cmp=core.compareMonths(p.entries,'2026-07','2026-08');
 assert.equal(cmp.netChangeCents,1951);
 assert.equal(cmp.changeCount,1);
 assert.equal(cmp.top[0].reference,'999111111');
});
test('does not fabricate a tenth change and refuses corrupt amounts',()=>{
 const p=core.parseStatement('Account Number: C0000001\n2026/11/03 INV B600000008 999111115 R845.84 R145000.00');
 const cmp=core.compareMonths(p.entries,'2026-10','2026-11');
 assert.equal(cmp.top.length,1);
 assert.throws(()=>core.cents('100000'),/Invalid/);
 assert.throws(()=>core.compareMonths([], 'invalid','2026-11'),/valid/);
});
test('only exact account identifiers are treated as equal before approval',()=>{
 assert.notEqual(core.normaliseAccount('B0000002-1'),core.normaliseAccount('B0000002'));
 assert.equal(core.stableKey({itemNo:'VT2-AB123',reference:''}),'SERVICE:VT2');
});

test('transient VT1 invoice IDs do not create false matching amount movements',()=>{
 const example=[
 'Account Number: B0000001',
 '2026/10/03 INV VT1-DEMOA R1940.80 R1940.80',
 '2026/11/03 INV VT1-DEMOB R1940.80 R1940.80'
 ].join('\n');
 const parsed=core.parseStatement(example);
 const result=core.compareMonths(parsed.entries,'2026-10','2026-11');
 assert.equal(result.netChangeCents,0);
 assert.equal(result.changeCount,0);
 assert.equal(result.categoryMatchedPending,true);
});
