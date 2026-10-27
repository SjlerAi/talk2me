'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const template = read('views/os-shell.ejs');
const login = read('views/login.ejs');
const layout = read('views/layout.ejs');
const cal = read('public/js/calendar-home-uat.js');

const common = {
  title:'Talk2Me OS',appVersion:'6.0.0',appBuild:'qa',assetVersion:'release-qa',basePath:'',
  isUat:true,cudoDisabled:true,
  isManagement:true,panelMode:false,
  currentUser:{id:1,role:'owner',full_name:'Test Owner',username:'qa'},
  status:{taskCount:0,queueCount:0,dueTodayTaskCount:0,overdueTaskCount:0},
  osLaunchers:[{slot_key:'test',display_name:'Test',icon_text:'T',is_enabled:1}]
};
const stage=ejs.render(template,{...common,isStaging:true});
const live=ejs.render(template,{...common,isStaging:false});
assert.match(stage,/class="t2m-os-shell t2m-tk2m-test-shell t2m-calendar-home-shell" id="talk2me-os"/);
assert.match(stage,/data-tk2m-preview="1"/);
assert.ok(stage.indexOf('t2m-tk2m-test-shell') < stage.indexOf('public/js/calendar-home-uat.js'), 'Shell class must be rendered before calendar JavaScript');
assert.match(stage,/id="tk2m-myday-focus-critical"/);
assert.match(stage,/#talk2me-os \.t2m-home-focus \{/);
assert.match(stage,/#talk2me-os \.t2m-home-focus>button \{/);
assert.match(stage,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
assert.match(stage,/grid-template-rows:auto auto auto auto minmax\(0,1fr\)!important/);
assert.match(stage,/TK2M TEST · OS/);
assert.match(stage,/data-os-managed-launcher="test"/);
assert.doesNotMatch(live,/t2m-tk2m-test-shell/);
assert.doesNotMatch(live,/data-tk2m-preview="1"/);
assert.doesNotMatch(live,/id="tk2m-myday-focus-critical"/);

const stageLogin=ejs.render(login,{...common,isStaging:true,error:null});
const liveLogin=ejs.render(login,{...common,isStaging:false,error:null});
assert.match(stageLogin,/TK2M TEST CRM · NOT LIVE/);
assert.doesNotMatch(liveLogin,/TK2M TEST CRM · NOT LIVE/);
for(const user of [null,common.currentUser]){
  const page=ejs.render(layout,{...common,currentUser:user,title:'Login',isStaging:true,body:stageLogin});
  assert.ok(page.includes('Staff Login'));
  assert.ok(page.includes('TK2M TEST CRM'));
  assert.doesNotMatch(page,/id="sidebar-toggle"/);
  assert.doesNotMatch(page,/Clock Out & Logout/);
}
assert.match(cal,/const tk2mPreview = Boolean\(config\.isStaging\)/);
assert.match(cal,/class="t2m-home-focus"/);
assert.match(cal,/classList\.add\('t2m-tk2m-test-shell'\)/);
console.log('TK2M_PRE_RENDERED_SHELL_CLASS_AND_LOGIN_IDENTITY=PASS');
