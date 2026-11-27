'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const p=require('../src/services/account-intelligence-presentation');
test('billing periods use readable full month names',()=>{
 assert.equal(p.monthLabel('2026-10'),'October 2026');
 assert.equal(p.monthLabel('2026-11'),'November 2026');
 assert.equal(p.monthLabel('2026-13'),'Period not recognised');
});
test('supplier account holder comes from an explicit source header only',()=>{
 assert.equal(p.accountHolderFromText('Account Holder: synthetic example traders\nAccount Number: B0000001'),'synthetic example traders');
 assert.equal(p.accountHolderFromText('Account Number: B0000001\nNo holder named'),null);
});
test('unconfirmed CRM matches do not falsely become confirmed names',()=>{
 const pending={status:'candidate',account:{display_name:'Some Other Firm'}};
 assert.equal(p.customerName(pending,'synthetic example traders'),'Synthetic Example Traders');
 assert.equal(p.customerName({status:'linked',account:{display_name:'Verified Customer'}},'Wrong Name'),'Verified Customer');
});
test('email default distinguishes savings from increases and is never sent automatically',()=>{
 const x=p.defaultEmail({customer:'Synthetic Example Traders',account:'B0000001',previousMonth:'2026-10',
 currentMonth:'2026-11',netChangeCents:-21377,rand:x=>(x/100).toFixed(2)});
 assert.match(x.subject,/November 2026 compared with October 2026/);
 assert.match(x.body,/decreased by R213\.77/);
 assert.doesNotMatch(x.body,/verified reason:|roaming charges were/);
});
