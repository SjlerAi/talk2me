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
// Real 970px split-window GUI review: My Day must retain 3 horizontal
// paged Reply / Done cards and fit its calendar with the sidebar still open.
assert.ok(css.includes('My Day at a TRUE 970px browser width'),'missing split-screen My Day correction');
const compactMyDay=css.slice(css.indexOf('My Day at a TRUE 970px browser width'));
for(const marker of [
  '#talk2me-os .t2m-home-priority-list',
  'grid-template-columns:repeat(3,minmax(0,1fr))!important',
  '#talk2me-os .t2m-home-priority-carousel.has-pages',
  '#talk2me-os .t2m-home-calendar-layout',
  'grid-template-columns:minmax(0,1fr)!important',
  '#talk2me-os .t2m-home-calendar-controls',
  '#talk2me-os .t2m-home-focus>button'
]){
  assert.ok(compactMyDay.includes(marker),'missing compact My Day surface '+marker);
}
assert.doesNotMatch(compactMyDay,/\.is-sidebar-collapsed\s*\{/,'compact view must not force saved sidebar state');
console.log('TK2M_APPROVED_BLUE_RED_THEME_GATE_PASS full_documents='+full.length+' all_templates='+templates.length);
