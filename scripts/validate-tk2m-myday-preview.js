'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const calendar = read('public/js/calendar-home-uat.js');
const shell = read('views/os-shell.ejs');
const layout = read('views/layout.ejs');
const css = read('public/css/tk2m-workspace-preview.css');
const admin = read('views/backoffice-home.ejs');

assert.match(calendar, /const tk2mPreview = Boolean\(config\.isStaging\)/);
assert.match(calendar, /launcher\?\.removeAttribute\('hidden'\)/, 'Daily app launcher must remain available on TK2M.');
assert.match(calendar, /t2m-tk2m-test-shell/, 'New layout must be scoped to staging.');
assert.match(calendar, /state\.selected = iso\(now\)/, 'Today control must select the current date.');
assert.match(calendar, /selected: today/, 'My Day must auto-select today.');
assert.match(calendar, /data-home-scope="team"/, 'Managers need team scope.');
assert.match(calendar, /data-home-scope="mine"/, 'Managers need mine scope.');
assert.match(calendar, /data-home-team-filter/, 'Management needs per-staff calendar filters.');
assert.match(calendar, /data-uat-work-launcher/, 'Work must remain in the launcher.');
assert.match(calendar, /data-uat-library-launcher/, 'Library must remain in the launcher.');
assert.match(calendar, /data-os-managed-launcher/, 'Managed daily applications must remain available in the shell.');

for (const name of ['tasks','reminders','messages','overdue']) {
  assert.ok(calendar.includes('data-home-focus="'+name+'"'), 'Missing My Day action '+name);
  assert.ok(calendar.includes('data-home-focus-count="'+name+'"'), 'Missing count '+name);
}
assert.match(calendar, /item\.date === state\.selected/, 'Selected-day information must follow calendar selection.');
assert.match(calendar, /jsonFetch\('\/api\/uat\/chat\/bootstrap'\)/, 'Unread staff messages must use real, permission-gated chat data.');
assert.match(calendar, /jsonFetch\('\/api\/os\/status'\)/, 'Overdue counts must use logged-in user status.');
assert.ok(calendar.includes('/api/calendar/events?start='), 'Calendar dates must use current CRM events.');
assert.match(calendar, /data-os-app="messages"/, 'Messages must open the existing Work chat.');
assert.match(calendar, /data-os-app="tasks"/, 'Tasks must open the existing Work inbox.');
assert.match(calendar, /data-home-add-reminder/, 'Existing reminder creation must remain.');
assert.match(calendar, /data-home-add-task/, 'Existing task creation must remain.');
assert.match(calendar, /openWorkWindow\(\{/, 'Overdue tasks must remain actionable.');

const previewStart = calendar.indexOf('section.innerHTML = tk2mPreview ?');
const previewEnd = calendar.indexOf('sidebar-label">Work', previewStart);
assert.ok(previewStart >= 0 && previewEnd > previewStart, 'Preview sidebar branch missing');
const previewNavigation = calendar.slice(previewStart, previewEnd);
for (const title of ['My Day','Customers','Library','Reports','Administration','Help']) {
  assert.ok(previewNavigation.includes('<strong>'+title+'</strong>'), 'Preview sidebar missing '+title);
}
assert.ok(!previewNavigation.includes('<strong>Work</strong>'), 'Work is an everyday launcher, not a duplicate sidebar item');
assert.ok(!previewNavigation.includes('Command Centre'), 'Command Centre belongs under Administration');
assert.ok(!previewNavigation.includes('Upgrade Centre'), 'Upgrade Centre belongs under Administration');
assert.ok(shell.includes('isStaging:Boolean(isStaging)'), 'OS shell must supply preview gating');
assert.ok(shell.includes('data-os-managed-launcher'), 'Launchers must remain server-provisioned');
assert.ok(shell.includes('/public/css/tk2m-workspace-preview.css'));
assert.ok(layout.includes('/public/css/tk2m-workspace-preview.css'));
assert.match(css, /grid-template-rows:70px 70px minmax\(0,1fr\) 46px!important/, 'Desktop launcher must have own row');
assert.match(css, /grid-template-rows:116px 60px minmax\(0,1fr\) 46px!important/, 'Phone launcher needs own row');
assert.match(css, /t2m-home-focus/, 'Priorities need responsive styling');
assert.match(css, /@media \(max-width:760px\)/, 'Phone rules required');
assert.match(admin, /Administration Centre/);
for (const name of ['Staff &amp; Access','Customers &amp; CRM Data','Workflows &amp; Approvals','Reports &amp; Performance','System &amp; Communication']) {
  assert.ok(admin.includes(name), 'Missing admin group '+name);
}
assert.match(admin, /<details class="t2m-admin-group"/, 'Administration categories must be expandable');
assert.match(admin, /currentUser\.role/, 'Administration must preserve roles');
for (const route of ['/backoffice/staff','/backoffice/attendance','/backoffice/clients',
  '/upgrade-centre','/backoffice/data-import','/backoffice/monthly-import-management',
  '/backoffice/legacy-client-claim-reconciliation','/tasks?view=all','/work-centre',
  '/backoffice/inquiries','/office-intelligence','/backoffice/reports/new-contacts',
  '/backoffice/contact-lists','/backoffice/os-launchers','/command-centre','/approvals']) {
  assert.ok(admin.includes(route), 'Existing admin destination removed: '+route);
}
console.log('TK2M_MY_DAY_NAVIGATION_PREVIEW=PASS');
