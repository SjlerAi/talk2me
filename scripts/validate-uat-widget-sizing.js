'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function need(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const js = read('public/js/uat-work-widgets.js');
const css = read('public/css/uat-work-widgets.css');

need(js, 'data-widget-max', 'widget maximise button');
need(js, 'toggleMaximize(widget,key)', 'widget maximise/restore logic');
need(js, "size:{width:620,height:720,minWidth:520,minHeight:580}", 'larger task default size');
need(js, "size:{width:520,height:660,minWidth:440,minHeight:500}", 'larger chat default size');
need(js, 'Math.max(minWidth,wantedWidth)', 'old saved width clamp');
need(js, "handle.addEventListener('dblclick'", 'double-click header maximise');

need(css, '.t2m-float-widget.is-maximized', 'maximised widget geometry');
need(css, '#t2m-task-widget:not(.is-collapsed):not(.is-maximized){min-width:520px;min-height:580px}', 'task minimum usable size');
need(css, '#t2m-task-widget .t2m-task-detail{height:100%;min-height:0;overflow:auto', 'scrollable task detail');
need(css, 'grid-template-columns:minmax(0,1fr)!important', 'single-column reschedule layout');
need(css, 'min-height:76px!important', 'readable follow-up reason field');
need(css, 'font-size:12px!important', 'readable follow-up input text');

console.log('UAT widget sizing validation passed.');
