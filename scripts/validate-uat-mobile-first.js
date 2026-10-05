'use strict';
const fs=require('fs');
const assert=require('assert');

const mobile=fs.readFileSync('public/css/uat-mobile-first.css','utf8');
const loader=fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');
const shell=fs.readFileSync('views/os-shell.ejs','utf8');
const layout=fs.readFileSync('views/layout.ejs','utf8');

assert(shell.includes('name="viewport" content="width=device-width, initial-scale=1"'), 'OS shell must declare a responsive viewport');
assert(layout.includes('name="viewport" content="width=device-width,initial-scale=1"'), 'route layout must declare a responsive viewport');
assert(loader.indexOf('data-uat-mobile-first') > loader.indexOf('data-uat-widget-polish'), 'mobile-first stylesheet must load after widget polish');
assert(layout.includes('/public/css/uat-mobile-first.css'), 'UAT route pages must load the mobile-first layer');

assert(mobile.includes('@media (min-width:761px) and (max-width:920px)'), 'tablet portrait breakpoint must exist');
assert(mobile.includes('@media (max-width:760px)'), 'phone breakpoint must exist');
assert(mobile.includes('grid-template-rows:108px 58px minmax(0,1fr) 46px!important'), 'phone shell must reserve rows for search, launcher, workspace and taskbar');
assert(mobile.includes('.t2m-calendar-home-shell .t2m-os-launcher{'), 'mobile launcher override must exist');
assert(mobile.includes('.t2m-home-calendar-layout{'), 'mobile calendar layout override must exist');
assert(mobile.includes('#t2m-task-widget:not(.is-collapsed)'), 'mobile task full-screen rule must exist');
assert(mobile.includes('height:100dvh!important'), 'mobile work widgets must use dynamic viewport height');
assert(mobile.includes('.t2m-os-window{'), 'route window mobile rule must exist');
assert(mobile.includes('font-size:16px!important'), 'mobile form controls must avoid iOS focus zoom');
assert(mobile.includes('.t2m-os-taskbar-label{display:none!important}'), 'mobile taskbar must preserve space for window buttons');
assert(mobile.includes('.assignment-form{'), 'UAT route assignment forms must stack on mobile');

console.log('UAT mobile-first responsive validation passed at phone/tablet breakpoints.');
