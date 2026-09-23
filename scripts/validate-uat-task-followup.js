'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function need(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const route = read('src/routes/uat-work-widgets.js');
const widget = read('public/js/uat-work-widgets.js');

need(route, "router.post('/api/uat/tasks/:id/reschedule'", 'task reschedule endpoint');
need(route, "overdue_alerted_at=NULL", 'deadline watch reset');
need(route, "event_type IN ('agent_deadline_reminder','agent_deadline_missed')", 'old deadline notification cleanup');
need(route, "scope === 'completed'", 'completed task scope');
need(route, "canReschedule", 'reschedule permission');
need(route, "INSERT INTO agent_task_watches", 'task deadline watch creation');
need(route, "Task completed —", 'completion history entry');

need(widget, 'data-task-scope="completed"', 'Completed task tab');
need(widget, 'data-task-reschedule', 'task reschedule control');
need(widget, 'Update follow-up date', 'reschedule action label');
need(widget, 'Current follow-up', 'prominent current follow-up summary');
need(widget, 'data-task-reschedule-reason', 'follow-up reason editor');
need(widget, 'latestFollowupReason', 'latest follow-up reason rendering');
need(widget, 'Completed work will appear here with its completion date.', 'completed history empty state');
need(widget, 'data-chat-related-task', 'linked task control in chat');
need(widget, 'Open follow-up task', 'chat linked task label');
need(widget, "await openTask(t.id);window.dispatchEvent", 'completion confirmation stays visible');

const calendarRoute = read('src/routes/calendar-productivity.js');
const calendarHome = read('public/js/calendar-home-uat.js');
const officeAgent = read('src/services/office-intelligence-agent.js');
const staffDigest = read('scripts/send-staff-work-digest.js');
need(calendarRoute, "latest_followup_reason", 'calendar follow-up reason query');
need(calendarRoute, "type: hasFollowupReason ? 'follow-up' : 'task'", 'rescheduled task calendar follow-up type');
need(calendarHome, "window.addEventListener('workspace:refresh'", 'My Day refresh after task update');
need(officeAgent, "detail:t.latest_followup_reason || t.message || ''", 'daily responsibility current follow-up reason');
need(officeAgent, "Follow-up reminder:", 'deadline reminder current follow-up wording');
need(staffDigest, "Follow-up moved from %", 'morning digest current follow-up reason');

console.log('UAT task follow-up validation passed.');
