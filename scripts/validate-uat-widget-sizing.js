'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function need(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

function forbid(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`Forbidden ${label}: ${needle}`);
}

const js = read('public/js/uat-work-widgets.js');
const css = read('public/css/uat-work-widgets.css');
const polishJs = read('public/js/uat-widget-polish.js');
const polishCss = read('public/css/uat-widget-polish.css');

need(js, 'data-widget-max', 'widget maximise button');
need(js, 'toggleMaximize(widget,key)', 'widget maximise/restore logic');
need(js, 'data-widget-resize', 'visible resize handle');
need(js, 'enableResize(widget,grip,key,size={})', 'pointer resize logic');
need(js, "size:{width:840,height:700,minWidth:560,minHeight:420}", 'compact Work default size');
need(js, 'const chatWidget=workWidget', 'Messages must use shared Work window');
need(js, 'const taskWidget=workWidget', 'Tasks must use shared Work window');
need(js, 'Math.max(minWidth,wantedWidth)', 'old saved width clamp');
need(js, "handle.addEventListener('dblclick'", 'double-click header maximise');

need(css, '.t2m-float-widget.is-maximized', 'maximised widget geometry');
need(css, '.t2m-widget-resize-grip', 'visible resize grip');
need(css, '#t2m-task-widget:not(.is-collapsed):not(.is-maximized){min-width:520px;min-height:360px}', 'task minimum flexible size');
need(css, '#t2m-task-widget .t2m-float-widget-body{min-height:0;overflow:hidden!important;display:flex;flex-direction:column}', 'task shell controlled scrolling with flexible Work layout');
need(css, 'grid-template-columns:minmax(0,1fr)!important', 'single-column reschedule layout');
need(css, 'min-height:76px!important', 'readable follow-up reason field');

need(polishJs, 'ensureUsableSize(widget, 480, 420)', 'chat polish minimum size');
need(polishJs, 'ensureUsableSize(widget, 520, 360)', 'task polish minimum size');
forbid(polishJs, 'compactSize(widget, 340, 430)', 'chat forced compact size');
forbid(polishJs, 'compactSize(widget, 340, 440)', 'task forced compact size');

need(polishCss, '[data-chat-tab="system"]{grid-column:3;display:block!important}', 'visible System messages tab');
need(polishCss, '.t2m-chat-staff-select', 'staff member selector');
need(polishCss, '#t2m-task-widget .t2m-float-widget-body{overflow:hidden!important}', 'task scrolling controlled by core window layer');
need(polishCss, '#t2m-task-widget .t2m-task-form select', 'readable task staff assignment control');

console.log('UAT unified Work window sizing validation passed.');
