'use strict';
// Approved owner/manager visual refresh. Read-only structural regression gate.
// Every full-document EJS template must load the shared theme, while all
// legacy partials continue to inherit it from the OS or Command parent.
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const cssPath=path.join(root,'public/css/tk2m-blue-red-refresh.css');
const css=fs.readFileSync(cssPath,'utf8');
const templates=fs.readdirSync(path.join(root,'views')).filter(v=>v.endsWith('.ejs'));
const full=templates.filter(name=>/<!doctype/i.test(fs.readFileSync(path.join(root,'views',name),'utf8')));
assert.equal(full.length,13,'unexpected top-level view count: review new full-document screens');
for(const name of full){
  const src=fs.readFileSync(path.join(root,'views',name),'utf8');
  assert.match(src,/data-tk2m-blue-refresh/,'missing shared theme in '+name);
  assert.equal((src.match(/data-tk2m-blue-refresh/g)||[]).length,1,'duplicate theme in '+name);
  assert.ok(src.indexOf('data-tk2m-blue-refresh')<src.indexOf('</head>'),'theme must be in <head>: '+name);
  assert.ok(src.indexOf('data-tk2m-blue-refresh')>src.lastIndexOf('<link rel="stylesheet"'),'theme must follow existing CSS: '+name);
  require('ejs').compile(src,{filename:path.join(root,'views',name)});
}
// A full-screen visual release cannot silently leave a broken partial or a
// stylesheet URL outside the express.static('/public') mount.
for(const name of templates){
  const src=fs.readFileSync(path.join(root,'views',name),'utf8');
  require('ejs').compile(src,{filename:path.join(root,'views',name)});
  assert.doesNotMatch(src, /<%= basePath %>\/(?:css|js)\//,'broken static asset mount in '+name);
}
const clients=fs.readFileSync(path.join(root,'views/clients-admin.ejs'),'utf8');
assert.match(clients,/\/public\/css\/uat-customer-filters\.css/,'Customers responsive layout CSS required');
for(const [key,marker] of Object.entries({
  shell:'#talk2me-os .t2m-os-topbar',
  sidebar:'#talk2me-os .t2m-os-sidebar',
  nav:'#talk2me-os .t2m-os-launcher',
  myday:'#talk2me-os .t2m-home-calendar',
  communications:'#talk2me-os .t2m-home-priority-item',
  calendar:'#talk2me-os .t2m-home-month',
  outstanding:'#talk2me-os .t2m-home-carry-panel',
  windows:'#talk2me-os .t2m-os-window',
  classic:'body.command-body .command-sidebar',
  table:'body.command-body th',
  library:'.library-topbar,.library-toolbar,.library-featured',
  deals:'.deals-head,.deals-toolbar,.deals-results'
})){
 assert.ok(css.includes(marker),'missing theme surface '+key);
}
for(const tok of ['--tk2m-navy: #153b64','--tk2m-blue: #22649d','--tk2m-accent: #bb3948','@media (max-width: 760px)','@media (prefers-reduced-motion: reduce)']){
 assert.ok(css.includes(tok),'missing design/accessibility token '+tok);
}
assert.match(css, /t2m-home-priority-actions button\.is-done/,'Done theme');
assert.match(css, /t2m-home-priority-reply button/,'Send theme');
assert.match(css, /:focus-visible/,'keyboard focus styling');
assert.match(css,/\.t2m-home-day\.is-selected/,'selected date styling');
assert.match(css,/\.t2m-home-priority-open strong/,'message preview');
for(const marker of ['.stats-grid.report-stats','.report-stats .stat-card','.report-filters>.form-grid','.two-col:has(> .card .table-wrap)']) {
  assert.ok(css.includes(marker),'missing responsive inquiry/report styling '+marker);
}
// A half-width Owner window must show every staff field and its action buttons.
const staffRoster=fs.readFileSync(path.join(root,'views/staff-list.ejs'),'utf8');
assert.match(staffRoster,/class="card table-card tk2m-staff-roster"/);
assert.match(staffRoster,/class="page-head tk2m-staff-roster-head"/);
for(const label of ['Staff member','Login','Role','Contact','Status','Last login','Actions']){
  assert.ok(staffRoster.includes('data-label="'+label+'"'),'staff roster missing '+label);
}
assert.ok(css.includes('body.command-body .tk2m-staff-roster tbody'),'missing staff card layout');
assert.ok(css.includes('content:attr(data-label)'),'missing visible staff field labels');
assert.ok(css.includes('width:calc(100vw - 100px) !important'),'split-screen Staff width must be viewport capped');
assert.ok(css.includes('grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))'),'staff cards must fit narrow windows');
// Production My Day previously rendered preview-only content with no preview
// layout stylesheet: the top communication header and calendar overflowed the
// actual 970px browser viewport. Require the approved layout on live without
// ever labelling the live shell as staging or UAT.
const approvedShell=fs.readFileSync(path.join(root,'views/os-shell.ejs'),'utf8');
const approvedCss=fs.readFileSync(path.join(root,'public/css/tk2m-workspace-preview.css'),'utf8');
assert.match(approvedShell,/if\(isStaging \|\| isLive\)/,'approved My Day stylesheet must load in production');
assert.match(approvedShell,/isLive\?' t2m-approved-home-shell'/,'live My Day requires a dedicated production class');
assert.match(approvedCss,/:is\(\.t2m-tk2m-test-shell,\.t2m-approved-home-shell\)/,'approved layout shared by staging and live');
assert.match(approvedCss,/#talk2me-os\.t2m-approved-home-shell \.t2m-home-priority-list/);
assert.match(approvedCss,/grid-template-columns:minmax\(0,1fr\)!important;/,'priority cards/calendar must fit narrow OS workspace');
assert.match(approvedCss,/grid-template-rows:auto auto auto auto minmax\(0,1fr\)!important;/,'My Day five content rows required');
assert.match(approvedShell,/if\(isStaging\)\{ %>data-tk2m-preview="1"/,'only staging receives preview data flag');
assert.ok(approvedCss.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important;'),'3 concise communication cards must stay on a horizontal row');
assert.match(approvedCss,/grid-template-rows:minmax\(380px,auto\) minmax\(210px,auto\)!important;/,'month and outstanding panel must not collapse at 970px');
assert.ok(approvedCss.includes('min-height:380px!important;'),'visible month required in desktop split-screen');
// The running TK2M production config sets BOTH isStaging and isLive.
// Render the real shell class expression to prevent a ternary silently
// dropping the production layout when isStaging takes precedence.
const shellClassTemplate=approvedShell.match(/class="t2m-os-shell[^"]*"/)?.[0];
assert.ok(shellClassTemplate,'My Day OS shell class declaration missing');
const liveClass=require('ejs').render(shellClassTemplate,{isStaging:true,isLive:true});
assert.match(liveClass,/t2m-approved-home-shell/,'running live configuration must receive approved layout');
const stageClass=require('ejs').render(shellClassTemplate,{isStaging:true,isLive:false});
assert.doesNotMatch(stageClass,/t2m-approved-home-shell/,'staging must not claim live class');
assert.match(stageClass,/t2m-tk2m-test-shell/,'staging preview class must remain');
const liveOnlyClass=require('ejs').render(shellClassTemplate,{isStaging:false,isLive:true});
assert.match(liveOnlyClass,/t2m-approved-home-shell/);
// Fixed-line lists must retain their service/account fields and Open actions
// when the same CRM is used beside the Desktop app at actual 970px width.
for(const [file,labels] of [
  ['fixed-accounts.ejs',['Customer','Account','Contact','Fixed services','Mobile lines','Assigned','Status','Actions']],
  ['fixed-services.ejs',['Customer / account','Branch','Solution / order','Router / MAC','SIM','Package','Activated','Status','Actions']]
]){
 const fixedSrc=fs.readFileSync(path.join(root,'views',file),'utf8');
 assert.match(fixedSrc,/tk2m-fixed-listing/,'scoped fixed-listing wrapper '+file);
 assert.match(fixedSrc,/tk2m-fixed-list-table/,'responsive fixed-listing table '+file);
 for(const label of labels){
  assert.ok(fixedSrc.includes('data-label="'+label+'"'),'missing fixed-line field '+label+' in '+file);
 }
 assert.match(fixedSrc,/\bOpen<\/a>/,'fixed record link must remain available '+file);
}
assert.match(css,/tk2m-fixed-list-table tbody tr/,'narrow fixed cards missing');
assert.match(css,/content:attr\(data-label\)/,'fixed card label missing');
assert.ok(css.includes('width:calc(100vw - 100px)!important'),'fixed table must be constrained to split-screen viewport');
assert.match(css,/body\.command-body \.login-greeting \{[\s\S]*?display:none !important;/,'classic welcome overlay must not cover management screens');
console.log('TK2M_APPROVED_BLUE_RED_THEME_GATE_PASS full_documents='+full.length+' all_templates='+templates.length);
