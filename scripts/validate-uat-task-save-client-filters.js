'use strict';

const fs = require('fs');
const ejs = require('ejs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function need(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const taskRoute = read('src/routes/uat-work-widgets.js');
const taskUi = read('public/js/uat-work-widgets.js');
const clientRoute = read('src/routes/uat-client-visibility.js');
const clientsView = read('views/clients-admin.ejs');
const indexRoute = read('src/routes/index.js');

need(taskRoute, "DATE_FORMAT(due_at,'%Y-%m-%d %H:%i:%s') persisted_due", 'task database save verification');
need(taskRoute, "verified: true", 'verified reschedule response');
need(taskRoute, "requested === 'all' && !isManager", 'staff All task scope');
need(taskRoute, "(t.assigned_to=:userId OR t.assigned_to IS NULL)", 'staff All task restriction');

need(taskUi, 'data-task-reschedule-notice', 'visible task save confirmation');
need(taskUi, '✓ Saved — follow-up is now', 'task saved message');
need(taskUi, 'data-task-scope="all">All</button>', 'staff All task filter');
need(taskUi, 'data-task-scope="mine">My Own</button>', 'staff My Own task filter');

need(clientRoute, "scope === 'staff'", 'management staff selection scope');
need(clientRoute, "if (management && scope === 'all') return '1=1'", 'management full shop visibility');
need(clientRoute, "OR ${unassignedClause()}", 'staff All own plus unassigned visibility');
need(clientRoute, "staffVisibilityManagement: management", 'role-aware customer filter view data');

need(clientsView, '>All Staff</a>', 'owner All Staff filter');
need(clientsView, '>My Own</a>', 'owner and staff My Own filter');
need(clientsView, 'Choose staff member', 'owner staff member filter');
need(clientsView, 'return_scope', 'assignment filter preservation');
need(indexRoute, "returnScope==='staff'&&returnStaffId", 'assignment redirect staff filter preservation');

ejs.compile(clientsView, { filename: 'views/clients-admin.ejs' });

console.log('UAT task save and customer filter validation passed.');
