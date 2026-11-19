'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const ejs=require('ejs');
const file=path.join(__dirname,'../views/command-centre.ejs');
const s=fs.readFileSync(file,'utf8');
ejs.compile(s,{filename:file});
assert.match(s,/Shop Command Centre/);
assert.match(s,/global search above/);
assert.doesNotMatch(s,/id="command-search"/);
assert.doesNotMatch(s,/id="command-search-button"/);
assert.doesNotMatch(s,/All Messages & Tasks/);
assert.doesNotMatch(s,/My Workspace/);
for(const marker of ['command-stats','stats.open_inquiries','stats.open_tasks','stats.upgrades_today','stats.unassigned_clients','stats.active_fixed_services','stats.pending_claims','Needs Attention','Upgrade Opportunities','Birthdays Today','/management','/approvals']){
 assert.ok(s.includes(marker),'Management capability unexpectedly removed: '+marker);
}
console.log('TK2M_COMMAND_CENTRE_SIMPLIFICATION_PASS global_search_single=true metrics_preserved=true');
