'use strict';
const fs=require('fs');
const assert=require('assert');

const mobile=fs.readFileSync('public/css/uat-mobile-first.css','utf8');
const loader=fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');
const shell=fs.readFileSync('views/os-shell.ejs','utf8');
const layout=fs.readFileSync('views/layout.ejs','utf8');
const calendar=fs.readFileSync('public/js/calendar-home-uat.js','utf8');
const loader=fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');

assert(shell.includes('name="viewport" content="width=device-width, initial-scale=1"'), 'OS shell must declare a responsive viewport');
assert(layout.includes('name="viewport" content="width=device-width,initial-scale=1"'), 'route layout must declare a responsive viewport');
assert(loader.indexOf('data-uat-mobile-first') > loader.indexOf('data-uat-widget-polish'), 'mobile-first stylesheet must load after widget polish');
assert(layout.includes('/public/css/uat-mobile-first.css'), 'UAT route pages must load the mobile-first layer');

assert(mobile.includes('@media (min-width:761px) and (max-width:920px)'), 'tablet portrait breakpoint must exist');
assert(mobile.includes('@media (max-width:760px)'), 'phone breakpoint must exist');
assert(mobile.includes('grid-template-rows:116px 60px minmax(0,1fr) 46px!important'), 'phone shell must reserve separated rows for search/actions, launcher, workspace and taskbar');
assert(mobile.includes('.t2m-calendar-home-shell .t2m-os-launcher{'), 'mobile launcher override must exist');
assert(mobile.includes('.t2m-home-calendar-layout{'), 'mobile calendar layout override must exist');
assert(mobile.includes('#t2m-task-widget:not(.is-collapsed)'), 'mobile task full-screen rule must exist');
assert(mobile.includes('height:100dvh!important'), 'mobile work widgets must use dynamic viewport height');
assert(mobile.includes('.t2m-os-window{'), 'route window mobile rule must exist');
assert(mobile.includes('font-size:16px!important'), 'mobile form controls must avoid iOS focus zoom');
assert(mobile.includes('.t2m-os-taskbar-label{display:none!important}'), 'mobile taskbar must preserve space for window buttons');
assert(mobile.includes('.assignment-form{'), 'UAT route assignment forms must stack on mobile');
assert(calendar.includes('data-mobile-menu-toggle'), 'mobile navigation toggle must exist');
assert(calendar.includes('data-mobile-menu-grid'), 'mobile navigation drawer must render CRM navigation');
assert(calendar.includes("{ app: 'tasks'"), 'mobile navigation must expose Tasks');
assert(calendar.includes("{ app: 'messages'"), 'mobile navigation must expose Messages');
assert(mobile.includes('.t2m-mobile-menu{'), 'mobile navigation drawer must be styled');
assert(mobile.includes('inset:0!important'), 'mobile menu backdrop must cover the screen for tap-away closing');
assert(mobile.includes('z-index:12000!important'), 'mobile top bar must stay above launcher content');
assert(mobile.includes('background:#111820!important'), 'mobile hamburger/menu must use the dark Talk2Me treatment');
assert(mobile.includes('width:min(330px,calc(100vw - 16px))!important'), 'mobile navigation must be a compact popover, not a full page block');
assert(mobile.includes('grid-template-columns:1fr!important'), 'mobile menu choices must use a clean one-column list');
assert(mobile.includes('.t2m-os-top-actions .t2m-os-icon-button>.t2m-os-badge'), 'top mobile badges must have an explicit inset rule');
assert(mobile.includes('top:2px!important'), 'top mobile badges must sit inside their buttons');
assert(loader.includes('widgets-3'), 'UAT asset version must change so phones receive the new mobile CSS');

console.log('UAT mobile-first responsive validation passed at phone/tablet breakpoints.');
