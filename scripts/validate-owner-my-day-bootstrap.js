'use strict';

const fs=require('fs');
const assert=require('assert');

const source=fs.readFileSync('public/js/calendar-home-uat.js','utf8');

assert(source.includes("if (!configNode) return;"),'My Day may only require the OS config node to bootstrap.');
assert(!source.includes("if (!configNode || !window.Talk2MeOS?.windows) return;"),'My Day must not abort when the OS window manager is unavailable.');
assert(source.includes('function openWorkWindow(options = {})'),'My Day must provide a safe window/navigation fallback.');
assert(source.includes('const manager = window.Talk2MeOS?.windows;'),'My Day may use the OS window manager when available.');
assert(source.includes("window.location.assign(new URL(options.url, window.location.href).href);"),'My Day fallback must still open routed work.');
assert(source.includes("shell.dataset.calendarHomeReady = '1';"),'Successful My Day mounting must leave a readiness sentinel.');
assert(source.indexOf('mountCalendar();') < source.lastIndexOf('simplifyShell();'),'My Day calendar must mount before optional shell enhancement.');
assert(source.includes("console.error('Talk2Me My Day shell enhancement failed:'"),'Optional shell failures must not remove My Day.');


const shell=fs.readFileSync('views/os-shell.ejs','utf8');
const loader=fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');
assert(shell.includes('data-calendar-home-uat src="<%= basePath %>/public/js/calendar-home-uat.js?v=<%= encodeURIComponent(assetVersion || appVersion) %>"'),'The calendar must load directly from the versioned OS shell.');
assert(shell.includes('data-calendar-home-uat href="<%= basePath %>/public/css/calendar-home-uat.css?v=<%= encodeURIComponent(assetVersion || appVersion) %>"'),'The My Day stylesheet must load directly from the versioned OS shell.');
assert(shell.indexOf('data-calendar-home-uat src=') < shell.indexOf('os-v6-alpha21-17.js?v='),'My Day must load before optional productivity enhancements.');
assert(!loader.includes("addScript('data-calendar-home-uat'"),'Optional productivity assets must not gate My Day script loading.');
assert(!loader.includes("addStylesheet('data-calendar-home-uat'"),'Calendar stylesheet should not depend on the optional loader.');
assert(shell.includes('id="t2m-uat-myday-first-paint"') && shell.includes('t2m-my-day-bootstrap'),'UAT first paint must describe My Day, rather than the legacy fallback.');
assert(shell.includes('#talk2me-os:not([data-calendar-home-ready="1"]) #os-desk-widgets'),'The obsolete UAT desk widgets must be hidden while My Day is starting.');
assert(source.includes("if (shell.dataset.calendarHomeReady === '1') return;"),'The calendar mount must be idempotent.');

console.log('OWNER_MY_DAY_BOOTSTRAP_VALIDATION=PASS');
