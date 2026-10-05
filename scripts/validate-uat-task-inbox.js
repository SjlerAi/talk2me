'use strict';
const fs=require('fs');
const assert=require('assert');

const route=fs.readFileSync('src/routes/uat-work-widgets.js','utf8');
const ui=fs.readFileSync('public/js/uat-work-widgets.js','utf8');
const polish=fs.readFileSync('public/css/uat-widget-polish.css','utf8');

assert(route.includes("['latest','urgent','attention']"), 'task API must whitelist inbox views');
assert(route.includes("requestedFilter"), 'task API must support date/status filters');
assert(route.includes("last_activity_at"), 'task API must calculate last activity');
assert(route.includes("unread_count"), 'task API must expose unread task activity');
assert(route.includes("action_count"), 'task API must expose action-required task activity');
assert(route.includes("needs_attention"), 'task API must flag tasks that need attention');
assert(route.includes("attachment_count"), 'task API must expose attachment counts');
assert(route.includes("ORDER BY ${orderBy}"), 'task API must use view-specific ordering');

assert(ui.includes("view:'latest'"), 'Tasks must default to Latest');
assert(ui.includes('data-task-view="latest"'), 'Latest inbox tab must exist');
assert(ui.includes('data-task-view="urgent"'), 'Urgent inbox tab must exist');
assert(ui.includes('data-task-view="attention"'), 'Needs attention inbox tab must exist');
assert(ui.includes('data-task-filter="today"'), 'Today task filter must exist');
assert(ui.includes('data-task-filter="week"'), 'This week task filter must exist');
assert(ui.includes('data-task-filter="overdue"'), 'Overdue task filter must exist');
assert(ui.includes('data-task-filter="upcoming"'), 'Upcoming task filter must exist');
assert(ui.includes('data-task-filter="completed"'), 'Completed task filter must exist');
assert(ui.includes('data-task-context="sent"'), 'Sent task filter must exist');
assert(ui.includes("scope:'mine',view:'latest',filter:'all'"), 'Opening Tasks must always start on Mine Latest');
assert(ui.includes('latest_update'), 'Task cards must show the latest update');
assert(ui.includes('attachment_count'), 'Task cards must show file counts');

assert(polish.includes('.t2m-task-inbox-primary'), 'Task inbox primary controls must be styled');
assert(polish.includes('.t2m-task-inbox-badge.is-overdue'), 'Overdue tasks must have a strong visual status');
assert(polish.includes('.t2m-task-inbox-card.is-unread'), 'Unread task cards must be visually distinct');

console.log('UAT task inbox regression checks passed.');
