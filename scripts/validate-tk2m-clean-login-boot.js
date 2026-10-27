'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const layout=read('views/tk2m-login-layout.ejs');
const login=read('views/login.ejs');
const shell=read('views/os-shell.ejs');
const legacy=read('views/layout.ejs');
const route=read('src/routes/index.js');
const calendar=read('public/js/calendar-home-uat.js');
const css=read('public/css/tk2m-login.css');
const context={
  basePath:'',appVersion:'6.0.0-alpha.21.26',assetVersion:'test-release',appBuild:'test',
  isUat:true,cudoDisabled:true,panelMode:false,isManagement:true,returnTo:null,error:null,
  title:'Login',currentUser:null,
  status:{queueCount:0,taskCount:0,dueTodayTaskCount:0,overdueTaskCount:0},
  osLaunchers:[{slot_key:'tobi',display_name:'Tobi',icon_text:'T',is_enabled:1}]
};
const form=ejs.render(login,{...context,isStaging:true});
const page=ejs.render(layout,{...context,isStaging:true,body:form});
assert.match(page,/Staff Login/);
assert.match(page,/TK2M TEST CRM/);
assert.match(page,/tk2m-login\.css/);
assert.match(page,/<body class="tk2m-login-body">/);
assert.match(page,/<form id="login-form" method="post" action="\/login"/);
assert.doesNotMatch(page,/TALK2ME UAT/);
assert.doesNotMatch(page,/Clock Out & Logout/);
assert.doesNotMatch(page,/Approvals Needed/);
for(const asset of ['command-4.0.1.css','attendance-tabs.css','cudo-widget.js','customer-actions.js','layout-polish.css','os-v6.js','session-status-monitor.js']){
 assert.ok(!page.includes(asset),'Old asset leaked into stand-alone login: '+asset);
}
assert.equal((page.match(/rel="stylesheet"/g)||[]).length,1,'TK2M login should load one stylesheet');
assert.ok(css.includes('#e9f3ff'),'Login needs distinctive soft blue background');
assert.match(route,/layout: res\.locals\.isStaging \? 'tk2m-login-layout' : 'layout'/);
assert.equal(route.split("layout: res.locals.isStaging ? 'tk2m-login-layout' : 'layout'").length-1,2,'GET and failed POST should use separate shell');
assert.match(legacy,/title !== 'Login'/);

const shellUser={id:1,full_name:'Test Owner',role:'owner',username:'qa'};
const stage=ejs.render(shell,{...context,isStaging:true,currentUser:shellUser});
const uent=ejs.render(shell,{...context,isStaging:false,currentUser:shellUser});
assert.match(stage,/id="tk2m-start-screen"/);
assert.match(stage,/class="t2m-os-body tk2m-booting"/);
assert.match(stage,/id="tk2m-boot-critical"/);
assert.match(stage,/body\.tk2m-booting #talk2me-os/);
assert.doesNotMatch(stage,/id="os-desk-widgets"/);
assert.doesNotMatch(stage,/Today’s Work/);
assert.doesNotMatch(stage,/Client Care Today/);
assert.match(stage,/id="tk2m-boot-controller"/);
assert.match(stage,/window\.Talk2MeBoot = \{ ready, fail \}/);
assert.match(stage,/tk2m-start-retry/);
assert.match(stage,/window\.setTimeout\(\(\) => \{ if \(!completed\) fail\(\); \}, 11000\)/);
assert.match(stage,/data-os-managed-launcher="tobi"/);
assert.match(uent,/id="os-desk-widgets"/);
assert.match(uent,/Today’s Work/);
assert.doesNotMatch(uent,/id="tk2m-start-screen"/);
assert.doesNotMatch(uent,/class="t2m-os-body tk2m-booting"/);
assert.match(calendar,/window\.Talk2MeBoot\.ready\(\)/);
assert.match(calendar,/window\.Talk2MeBoot\?\.fail\(\)/);
assert.match(calendar,/calendarReady && navigationReady/);
assert.match(calendar,/shell\.dataset\.calendarHomeReady = '1'/);
console.log('PASS: TK2M light login, no legacy navbar, fast standalone CSS, atomic calendar boot, UENT unchanged');
