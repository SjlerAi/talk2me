'use strict';
// Regression: TK2M Login must never display the authenticated toolbar, while
// the calendar-first My Day always has its own priority-card grid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const get = p => fs.readFileSync(path.join(root,p),'utf8');

const layout = get('views/layout.ejs');
const login = get('src/routes/index.js');
const shell = get('views/os-shell.ejs');
assert.match(login,/router\.get\('\/login', \(req, res\) => \{\s*\/\/ A valid logged-in session/);
assert.match(login,/if \(req\.session\.user\) \{\s*return res\.redirect/);

const actor = {id:99,full_name:'QA Owner',role:'owner',email:'tester@example.org'};
const base = {
  title:'Login',body:'<section>Staff Login</section>',basePath:'',
  assetVersion:'qa',appVersion:'qa',appBuild:'qa',isUat:true,isStaging:true,
  cudoDisabled:true,panelMode:false,unreadTaskCount:18,approvalCentreCount:3
};
for (const user of [null,actor]) {
  const html=ejs.render(layout,{...base,currentUser:user});
  assert.ok(html.includes('Staff Login'),'Staff Login must render cleanly');
  assert.ok(!html.includes('id="sidebar-toggle"'),'No authenticated toolbar on Login');
  assert.ok(!html.includes('Clock Out & Logout'),'No logout action on Login');
  assert.ok(!html.includes('id="universal-client-search"'),'No customer search on Login');
}

const loggedIn=ejs.render(layout,{...base,currentUser:actor,title:'Settings'});
assert.ok(loggedIn.includes('id="sidebar-toggle"'),'After login the toolbar must remain available');
assert.ok(loggedIn.includes('Clock Out & Logout'),'Authenticated logout must remain');

const cssStart=shell.indexOf('<style id="tk2m-myday-focus-critical">');
const cssEnd=shell.indexOf('</style>',cssStart);
assert.ok(cssStart > 0 && cssEnd > cssStart,'TK2M My Day must include critical inline CSS');
const critical=shell.slice(cssStart,cssEnd);
for (const rule of ['t2m-home-focus','display:grid!important','grid-template-columns:repeat(4,minmax(0,1fr))',
  'grid-template-rows:auto auto auto auto minmax(0,1fr)','max-width:760px']) {
  assert.ok(critical.includes(rule),'Missing layout rule '+rule);
}
assert.match(shell,/<% if\(isStaging\)\{ %>\s*<style id="tk2m-myday-focus-critical">/);
console.log('TK2M_LOGIN_AND_MYDAY_CSS_REGRESSION=PASS');
