'use strict';
// Production regression guard for TK2M's domain-root routes and live branding.
// All tests are synthetic: no customer records or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const routeFiles = [
  'src/routes/base-details-search.js',
  'src/routes/grouped-upgrade-accounts.js',
  'src/routes/grouped-upgrade-line-review.js'
];
for (const routePath of routeFiles) {
  const source = read(routePath);
  assert.doesNotMatch(source, /res\.locals\.basePath\s*\|\|\s*['"]\/talk2me['"]/,
    routePath + ' must not turn the production empty base path into /talk2me');
  assert.match(source, /res\.locals\.basePath\s*\?\?\s*['"]\/talk2me['"]/,
    routePath + ' must preserve explicit empty base path');
}

const routes = routeFiles.map(read).join('\n');
const rootPath = '';
const legacyPath = '/talk2me';
for (const [base, prefix] of [[rootPath,''],[legacyPath,'/talk2me']]) {
  const resolved = base ?? '/talk2me';
  for (const suffix of [
    '/customers/123/360',
    '/mobile-base/456',
    '/fixed/accounts/789',
    '/grouped-upgrade-accounts/line/22/review',
    '/grouped-upgrade-accounts/account/23/customer',
    '/master-register/service/mobile%3Aabc'
  ]) {
    assert.equal(resolved + suffix, prefix + suffix);
    assert.ok(!(resolved + suffix).startsWith('//'));
  }
}
assert.match(routes, /grouped-upgrade-accounts\/line/);
const layout = read('views/layout.ejs');
const render = ({isUat,isLive}) => ejs.render(layout, {
  basePath:'',assetVersion:'navigation-check',appVersion:'navigation-check',
  isUat,isLive,isStaging:false,cudoDisabled:true,currentUser:null,
  panelMode:false,title:'Navigation smoke',body:'<p>synthetic</p>'
}, {filename:path.join(root,'views/layout.ejs')});

const production=render({isUat:true,isLive:true});
const uat=render({isUat:true,isLive:false});
assert.doesNotMatch(production, /\/public\/uat-safety\.css/);
assert.match(production, /\/public\/css\/uat-mobile-first\.css/);
assert.match(uat, /\/public\/uat-safety\.css/);
assert.match(uat, /\/public\/css\/uat-mobile-first\.css/);

// Production must visually suppress cached old UAT CSS inside customer iframe
// layouts while preserving the warning in actual legacy test environments.
assert.match(production, /id="tk2m-production-no-uat-banner"/);
assert.match(production, /body\.command-body::before\{content:none!important;display:none!important\}/);
assert.match(production, /body\.command-body\{padding-top:0!important\}/);
assert.doesNotMatch(uat, /id="tk2m-production-no-uat-banner"/);

const osShell = read('views/os-shell.ejs');
const match = osShell.match(/(data-tk2m-environment="<%= isLive\?[^%]+%>")/);
assert.ok(match, 'TK2M workspace live-vs-staging identity must remain explicit');
const environment = ({isLive,isStaging}) => ejs.render(match[1],{isLive,isStaging});
assert.match(environment({isLive:true,isStaging:true}), /TK2M LIVE/);
assert.doesNotMatch(environment({isLive:true,isStaging:true}), /TEST|NOT LIVE/);
assert.match(environment({isLive:false,isStaging:true}), /TK2M TEST/);
const taglineMatch = osShell.match(/(<small><%= isLive\?[^%]+%>Cellular CRM<\/small>)/);
assert.ok(taglineMatch, 'visual CRM tagline requires LIVE-first display logic');
const tagline = ({isLive,isStaging}) => ejs.render(taglineMatch[1],{isLive,isStaging});
assert.doesNotMatch(tagline({isLive:true,isStaging:true}), /TEST|NOT LIVE|OS v/);
assert.match(tagline({isLive:false,isStaging:true}), /TEST · Cellular CRM/);

const appSource = read('server.js');
assert.match(appSource, /if \\(UAT_MODE && !CRM_LIVE_MODE\\) \\{\\s*const publicUatWidgets/, 'Live site must not expose UAT-only widget/telemetry health endpoints');
const legacyWorkHealth = read('src/routes/uat-work-widgets.js');
assert.equal((legacyWorkHealth.match(/if \\(!IS_UAT \\|\\| String\\(process\\.env\\.CRM_LIVE_MODE/g)||[]).length,2, 'Two UAT-only work diagnostics must be disabled in production');
const liveNeutralizer = appSource.match(/if \(CRM_LIVE_MODE\) \{\s*app\.get\('\/public\/uat-safety\.css'[\s\S]*?\n\}/);
assert.ok(liveNeutralizer, 'production-only UAT CSS neutralizer must exist');
assert.match(liveNeutralizer[0], /res\.type\('text\/css'\)\.send/);
assert.match(liveNeutralizer[0], /content:none!important;display:none!important/);
assert.ok(appSource.indexOf("app.get('/public/uat-safety.css'") <
  appSource.indexOf("app.use('/public', express.static"), 'neutralizer must run before static assets');


// The live site must never offer a direct link into the former UENT domain.
for(const filePath of routeFiles.concat(['views/layout.ejs','views/os-shell.ejs','public/js/os-v6.js'])){
  assert.doesNotMatch(read(filePath), /https?:\/\/uent\.co\.za/i);
}

// The production CRM must not expose expired cleanup links, retired widgets
// or UAT-only diagnostics, even when UAT_MODE remains true for API compatibility.
const ownerHtml=ejs.render(layout,{
  basePath:'',assetVersion:'live-cleanup-check',appVersion:'live-cleanup-check',
  isUat:true,isLive:true,isStaging:true,cudoDisabled:false,
  currentUser:{id:1,role:'owner',full_name:'Owner',email:'owner@example.invalid'},
  panelMode:false,title:'Customers',body:'<p>Normal operation</p>'
},{filename:path.join(root,'views/layout.ejs')});
const visibleText=ownerHtml.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi,'')
 .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi,'')
 .replace(/<[^>]*>/g,' ');
assert.doesNotMatch(visibleText,/\\bUAT\\b|Cleanup Centre \\(Temporary\\)|\\bTEST CRM\\b/i,'Live owner navigation must contain no UAT-only controls');
assert.doesNotMatch(ownerHtml,/cudo-widget\\.(?:js|css)/,'Retired Cudo widget must not load on the live CRM');
assert.doesNotMatch(ownerHtml,/href="\\/temporary-cleanup"/,'Expired historical cleanup screen must not appear in live navigation');
const errorView=read('views/error.ejs');
const productionError=ejs.render(errorView,{
  isLive:true,diagnostic:'SENSITIVE_INTERNAL_DIAGNOSTIC',title:'Unavailable',message:'Please try again',basePath:''
});
assert.doesNotMatch(productionError,/SENSITIVE_INTERNAL_DIAGNOSTIC|UAT diagnostic/i,'Production errors must not reveal internal diagnostics');
assert.match(productionError,/href="\\/workspace"/,'Error page must return staff to My Day');
for(const [file,obsolete] of [
 ['views/backoffice-home.ejs',/migration differences/i],
 ['views/base-details-centre.ejs',/one-off SQL|Staging writes|PR #110/i],
 ['views/monthly-data-import.ejs',/one-off SQL|generic migration system|Technical batch/i],
 ['views/tk2m-review-portal.ejs',/TK2M test data|Friday's transfer|Currently live \\(UENT\\)/i]
])assert.doesNotMatch(read(file),obsolete,file+' must use operational copy');
const liveShellOpening=osShell.match(/<div class="t2m-os-shell[\\s\\S]*?data-tk2m-preview="1"<% } %>>/)?.[0];
assert.ok(liveShellOpening,'Expected the preserved staging-only shell marker');
const liveShellHtml=ejs.render(liveShellOpening,{isLive:true,isStaging:true});
assert.doesNotMatch(liveShellHtml,/tk2m-test-shell|data-tk2m-preview="1"/i,'Live CRM must not inherit staging-only shell markers');
assert.match(liveShellHtml,/t2m-approved-home-shell/,'Live CRM must retain approved layout styling');
console.log('TK2M_LIVE_NAVIGATION_AND_BANNER_PASS');