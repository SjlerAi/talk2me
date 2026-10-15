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

console.log('OWNER_MY_DAY_BOOTSTRAP_VALIDATION=PASS');
