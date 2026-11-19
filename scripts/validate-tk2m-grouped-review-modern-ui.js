'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ejs=require('ejs');
const file=path.join(__dirname,'../views/grouped-upgrade-accounts.ejs');
const src=fs.readFileSync(file,'utf8');
ejs.compile(src,{filename:file});
assert.match(src,/Review grouped accounts, verify associated telephone lines/);
assert.match(src,/Back to Deals/);
assert.doesNotMatch(src,/inside UENT|Back to Black Friday/);
assert.match(src,/Import source details/);
assert.match(src,/Grouped_Upgrade_Customers.xlsx/);
for(const key of ['stats.distinct_numbers','stats.review_lines','grouped-upgrade-accounts\/master-review','grouped-upgrade-accounts\/account/','a.pending_lines','classified_lines','source_names_json']){
 assert.ok(src.includes(key),'grouped review capability missing: '+key);
}
console.log('TK2M_GROUPED_REVIEW_MODERN_UI_PASS source_provenance_preserved=true legacy_labels_removed=true');
