'use strict';

const fs = require('fs');
const ejs = require('ejs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function need(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const route = read('src/routes/calendar-productivity.js');
const home = read('public/js/calendar-home-uat.js');
const view = read('views/calendar-item-detail.ejs');

need(route, "url: \`${res.locals.basePath}/calendar/items/${row.id}\`", 'personal reminder view URL');
need(route, "router.get('/calendar/items/:id'", 'calendar reminder detail route');
need(route, "p.assigned_to=:userId OR p.created_by=:userId", 'reminder detail permission');
need(home, "item.source === 'personal' ? 'View' : 'Open'", 'View action for personal reminders');
need(home, "talk2me:calendar-item-updated", 'calendar refresh after reminder detail action');
need(view, 'Reminder date & time', 'reminder scheduled time');
need(view, 'Created by', 'reminder creator');
need(view, 'Last updated', 'reminder update timestamp');
need(view, 'Completed', 'reminder completion timestamp');
need(view, 'data-reminder-toggle', 'reminder completion action');

ejs.compile(view, { filename: 'views/calendar-item-detail.ejs' });

console.log('UAT reminder view validation passed.');
