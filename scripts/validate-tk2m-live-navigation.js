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
assert.match(osShell, /<small>Cellular CRM<\/small>/,'new branding does not show the legacy version stripe');

const appSource = read('server.js');
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

console.log('TK2M_LIVE_NAVIGATION_AND_BANNER_PASS');