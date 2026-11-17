'use strict';
// Contract for live TK2M popups migrated from UENT; synthetic paths only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const legacy=require('../src/services/tk2m-legacy-route');
const good={
 '/talk2me/customers/123/360?panel=1':'/customers/123/360?panel=1',
 '/talk2me/mobile-base/456':'/mobile-base/456',
 '/talk2me/fixed/accounts/789':'/fixed/accounts/789',
 '/talk2me/master-register/service/mobile%3Aabc':'/master-register/service/mobile%3Aabc',
 '/talk2me/backoffice/clients':'/backoffice/clients',
 '/talk2me/search/all?q=safe':'/search/all?q=safe',
 '/talk2me':'/',
 '/talk2me?from=old':'/?from=old'
};
for(const [from,to] of Object.entries(good))assert.equal(legacy.legacyRootPath(from),to);
for(const invalid of ['/talk2me//evil.example','/talk2me\\\\evil.example','/talk2me/%0aevil','/talk2me/%5cevil','/talk2mefoo','//evil.example','https://uent.co.za/talk2me',''])assert.equal(legacy.legacyRootPath(invalid),null);

const source=read('public/js/os-v6.js');
const start=source.indexOf('  const tk2mProductionHost =');
const end=source.indexOf('\n  class WindowManager',start);
assert.ok(start>0 && end>start,'browser URL canonicalizer must exist before window manager');
const chunk=source.slice(start,end);
function browserPanel(locationUrl){
 const parsed=new URL(locationUrl);
 const location={href:parsed.href,hostname:parsed.hostname,protocol:parsed.protocol,
   host:parsed.host,origin:parsed.origin};
 return vm.runInNewContext('(function(){'+chunk+'\nreturn panelUrl;})()',{location,URL});
}
const live=browserPanel('https://crm.tk2m.co.za/workspace');
const legacyBrowser=browserPanel('https://uent.co.za/talk2me/workspace');
for(const suffix of ['/customers/123/360','/mobile-base/456','/fixed/accounts/789',
  '/master-register/service/mobile%3Aabc','/backoffice/clients']){
 const target='https://crm.tk2m.co.za'+suffix+'?panel=1';
 assert.equal(live(suffix),target);
 assert.equal(live('/talk2me'+suffix),target);
 assert.equal(live('https://uent.co.za/talk2me'+suffix),target);
 assert.equal(live('https://crm.tk2m.co.za/talk2me'+suffix),target);
 assert.equal(legacyBrowser('/talk2me'+suffix),'https://uent.co.za/talk2me'+suffix+'?panel=1');
}
assert.equal(live('https://external.example/portal'),'https://external.example/portal');
const customerOpen=source.slice(source.indexOf('  function openCustomer(row) {'),source.indexOf('  async function search(query)',source.indexOf('  function openCustomer(row) {')));
assert.match(customerOpen,/destination = panelUrl\(row\.url\)/);
assert.match(customerOpen,/new URL\(destination\)\.origin !== location\.origin/);
assert.match(customerOpen,/url: destination/);
const windowOpen=source.slice(source.indexOf('    open(options) {'),source.indexOf('    render(record) {'));
assert.match(windowOpen,/existingFrame\.src !== resolvedUrl/);
assert.match(windowOpen,/this\.render\(existing\)/);
const server=read('server.js');
assert.match(server,/if \(CRM_LIVE_MODE\) \{\s*const \{ legacyRootPath \}/);
assert.match(server,/app\.use\('\/talk2me'/);
assert.match(server,/req\.method !== 'GET' && req\.method !== 'HEAD'/);
assert.match(server,/return res\.redirect\(302, destination\)/);
console.log('TK2M_POPUP_LEGACY_CANONICALIZATION_PASS');