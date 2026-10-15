'use strict';

const fs=require('fs');
const assert=require('assert');

const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('views/os-shell.ejs','utf8');
const layout=fs.readFileSync('views/layout.ejs','utf8');
const loader=fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');
const pwa=fs.readFileSync('public/js/pwa-install.js','utf8');

assert(server.includes('function assetVersionForRelease()'),'Release-aware asset version helper is required.');
assert(server.includes("res.locals.assetVersion = assetVersionForRelease();"),'Views must receive the release asset version.');
assert(server.includes("const version = assetVersionForRelease().replace"),'Service worker cache namespace must include release identity.');
assert(server.includes("if (${UAT_MODE ? 'true' : 'false'})"),'UAT service worker must select network-first static delivery.');
assert(server.includes("fetch(request, { cache: 'no-store' })"),'UAT service worker must bypass stale HTTP cache for static assets.');
assert(shell.includes('encodeURIComponent(assetVersion || appVersion)'),'OS shell assets must be release-versioned.');
assert(shell.includes('appVersion,assetVersion,user:'),'OS bootstrap config must expose assetVersion to dynamic loaders.');
assert(layout.includes('encodeURIComponent(assetVersion || appVersion)'),'Standard layout assets must be release-versioned.');
assert(loader.includes("const assetVersion = String(config.assetVersion || appVersion || '');"),'UAT dynamic loader must use release asset version.');
assert(loader.includes('const uatAssetVersion = `${assetVersion}-widgets-7`;'),'UAT dynamic asset URLs must change every release.');
assert(pwa.includes("updateViaCache: 'none'"),'Service worker registration must bypass browser cache.');
assert(pwa.includes('await registration.update().catch(() => {});'),'Service worker registration must actively check for updates.');
assert(!shell.includes('encodeURIComponent(appVersion)'),'OS shell must not pin static assets to the package version only.');

console.log('UAT_ASSET_FRESHNESS_VALIDATION=PASS');
