'use strict';
// Synthetic regression: TK2M production runs at /, while legacy paths may
// use a non-empty prefix. Search must return URLs on the active host path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/base-details-search.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/services/master-customer-search.js'), 'utf8');

// The route must preserve the empty string, not substitute /talk2me.
assert.match(route, /basePath:res\.locals\.basePath \?\? '\/talk2me'/);
assert.doesNotMatch(route, /basePath:res\.locals\.basePath\|\|'\/talk2me'/);

const samples = [
  {service_key:'mobile:synthetic',service_type:'mobile',link_state:'crm_customer_linked',
    crm_client_id:123,phone:'0710000000',master_customer_name:'Synthetic Mobile'},
  {service_key:'mobile:base-only',service_type:'mobile',link_state:'account_only_no_customer',
    mobile_base_id:456,phone:'0720000000',master_customer_name:'Synthetic Base'},
  {service_key:'fixed:synthetic',service_type:'fixed',link_state:'verified_crm_supplier_link',
    fixed_account_id:789,phone:'',master_customer_name:'Synthetic Fixed'},
  {service_key:'mobile:needs-review',service_type:'mobile',link_state:'needs_conflict_review',
    crm_client_id:111,mobile_base_id:null,phone:'0730000000',master_customer_name:'Synthetic Review'}
];
const sandbox = {
  module:{exports:{}},
  require(name) {
    if(name==='../config/db') return {execute:async()=>[samples]};
    throw new Error('Unexpected dependency '+name);
  }
};
vm.runInNewContext(source,sandbox,{filename:'master-customer-search.js'});
const searchMaster = sandbox.module.exports.searchMaster;

(async()=>{
  for(const [basePath, prefix] of [['',''],['/talk2me','/talk2me']]) {
    const results = await searchMaster({query:'synthetic',user:{id:1,role:'owner'},basePath});
    assert.equal(results.length,4);
    assert.equal(results[0].url,prefix+'/customers/123/360');
    assert.equal(results[1].url,prefix+'/mobile-base/456');
    assert.equal(results[2].url,prefix+'/fixed/accounts/789');
    assert.equal(results[3].url,prefix+'/master-register/service/mobile%3Aneeds-review');
    assert.ok(results.every(r=>r.url.startsWith('/') && !r.url.startsWith('//')));
  }
  // No database mutation: search only reads the active master snapshot.
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:clients|customer_accounts)/i);
  console.log('TK2M_MASTER_SEARCH_ROOT_LINKS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
