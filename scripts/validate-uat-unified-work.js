'use strict';

const fs = require('fs');
const assert = require('assert');

const widgets = fs.readFileSync('public/js/uat-work-widgets.js','utf8');
const widgetCss = fs.readFileSync('public/css/uat-work-widgets.css','utf8');
const widgetRoutes = fs.readFileSync('src/routes/uat-work-widgets.js','utf8');
const shell = fs.readFileSync('views/os-shell.ejs','utf8');
const calendar = fs.readFileSync('public/js/calendar-home-uat.js','utf8');
const telemetry = fs.readFileSync('src/services/usage-telemetry.js','utf8');
const telemetryRoute = fs.readFileSync('src/routes/usage-telemetry.js','utf8');
const auth = fs.readFileSync('src/middleware/auth.js','utf8');
const indexRoutes = fs.readFileSync('src/routes/index.js','utf8');
const attendance = fs.readFileSync('src/routes/attendance.js','utf8');
const nightly = fs.readFileSync('src/services/nightly-logout.js','utf8');
const office = fs.readFileSync('src/services/office-intelligence.js','utf8');
const officeView = fs.readFileSync('views/office-intelligence.ejs','utf8');
const server = fs.readFileSync('server.js','utf8');
const loader = fs.readFileSync('public/js/os-v6-alpha21-17.js','utf8');

assert(shell.includes('data-os-app="work"'), 'OS shell must expose one Work application');
assert(!shell.includes('data-os-app="tasks" aria-label="Tasks"'), 'OS shell must not present Tasks as a separate app');
assert(!shell.includes('data-os-app="messages" aria-label="Messages"'), 'OS shell must not present Messages as a separate app');
assert(!shell.includes('data-os-app="notifications"'), 'duplicate top notification counter must be removed');
assert(shell.includes('data-badge="work"'), 'sidebar Work entry must retain the one Work counter');
assert(widgets.includes("document.querySelectorAll('[data-badge=\"work\"]')"), 'Work counter must be refreshed from unified Work state');
assert(!widgets.includes("data-badge=\"notifications\""), 'Work widget code must not maintain a second notification counter');
assert(calendar.includes("dataset.osApp = 'work'"), 'desktop launcher must expose unified Work');
assert(calendar.includes('data-badge="work" hidden'), 'desktop Work launcher must carry the single Work counter');
assert(calendar.includes('data-os-app="work"'), 'mobile/simple navigation must expose unified Work');

assert(widgets.includes("title:'Work'"), 'shared floating widget must be titled Work');
assert(widgets.includes('const chatWidget=workWidget'), 'Messages must use the shared Work window');
assert(widgets.includes('const taskWidget=workWidget'), 'Tasks must use the shared Work window');
assert(widgets.includes("data-work-mode=\"inbox\""), 'Work window must contain inbox mode');
assert(widgets.includes("data-work-mode=\"messages\""), 'Work window must contain messages mode');
assert(widgets.includes("data-work-mode=\"new\""), 'Work window must contain New task mode');
assert(widgets.includes("workModeNav('new')"), 'New task form must keep the Work navigation visible');
assert(widgets.includes("else if(next==='new')openTaskWidget({new:true})"), 'New task tab must open inside the shared Work window');
assert(widgetCss.includes('.t2m-work-mode-nav + .t2m-task-form'), 'New task form must fit below the shared Work tabs');
assert(widgets.includes("${workModeNav('inbox')}<div class=\"t2m-task-detail\""), 'task detail must keep Work navigation visible');
assert(widgetCss.includes('.t2m-work-mode-nav + .t2m-task-detail'), 'task detail must fit below the shared Work tabs');
assert(widgets.includes("workMode!=='messages'"), 'chat poller must not repaint Work inbox mode');
assert(widgets.includes("clearInterval(chatPoll);showWidget(workWidget)"), 'switching to Work inbox must stop the message poller');
assert(widgetCss.includes('.t2m-work-mode-nav'), 'unified Work mode switch must be styled');

for (const filter of ['new','old','7days','14days','month','history_all']) {
  assert(widgets.includes(`data-task-filter="${filter}"`), `Work UI must include ${filter} history filter`);
  assert(widgetRoutes.includes(`'${filter}'`), `Work API must support ${filter} history filter`);
}
assert(widgets.includes('>7 days<'), 'Work history must visibly expose 7 days');
assert(widgets.includes('>14 days<'), 'Work history must visibly expose 14 days');
assert(widgets.includes('>Month<'), 'Work history must visibly expose Month');
assert(widgets.includes('data-task-filter="history_all">All'), 'Work history must visibly expose All');
assert(widgetRoutes.includes("const historyFilter = ['new','old','7days','14days','month','history_all']"), 'history filters must include completed work instead of only active tasks');

assert(telemetry.includes('CREATE TABLE IF NOT EXISTS crm_usage_events'), 'usage telemetry schema must exist');
assert(telemetry.includes("eventType: isScreen ? 'screen_view' : 'http_action'"), 'server telemetry must record screen views and actions');
assert(telemetry.includes('Usage telemetry must never interrupt normal CRM work'), 'telemetry must fail open');
assert(telemetryRoute.includes("router.post('/api/usage/events'"), 'client telemetry endpoint must exist');
assert(loader.includes('/api/usage/events'), 'OS launcher/app opens must be tracked');
assert(loader.includes("event_type:'feature_open'"), 'feature opens must have a distinct telemetry event');
assert(server.includes('app.use(usageMiddleware())'), 'usage middleware must be active globally');
assert(server.includes('/api/uat/telemetry/health'), 'telemetry must have a UAT health proof');
assert(widgetRoutes.includes("eventType:'work_task_created'"), 'Work task creation must have semantic telemetry');
assert(widgetRoutes.includes("eventType:'work_message_sent'"), 'Work messages must have semantic telemetry');

assert(auth.includes("BUSINESS_TIMEZONE = 'Africa/Johannesburg'"), 'daily login must use the South Africa business timezone');
assert(auth.includes('req.session.loginDate !== businessDate()'), 'authenticated routes must reject a previous-day session');
assert(auth.includes('dailySessionMiddleware'), 'global daily session middleware must exist');
assert(server.includes('app.use(dailySessionMiddleware())'), 'daily session enforcement must be active globally');
assert(indexRoutes.includes('req.session.loginDate=businessDate()'), 'successful login must stamp the business date');
assert(indexRoutes.includes("eventType:'login'"), 'login must be tracked');
assert(attendance.includes("eventType:'logout'"), 'manual clock-out/logout must be tracked');
assert(nightly.includes("const DEFAULT_LOGOUT_TIME = IS_UAT ? '18:00:00' : '22:00:00'"), 'UAT forgotten sessions must close at 18:00 without changing production default');
assert(nightly.includes('SET enabled=1,logout_time=:logoutTime,timezone=:timezone'), 'UAT 18:00 policy must be enforced');
assert(server.includes("String(logout.logout_time) === '18:00:00'"), 'health proof must verify the 18:00 logout policy');

assert(office.includes("case 'last_14_days'"), 'Office Intelligence must support last 14 days');
assert(office.includes('featureUsage'), 'Office Intelligence must report feature usage');
assert(office.includes('logoutCompliance'), 'Office Intelligence must report login/logout compliance');
assert(officeView.includes('Last 14 days'), 'management UI must expose last 14 days');
assert(officeView.includes('Feature and action usage'), 'management UI must show feature usage');
assert(officeView.includes('Login / logout compliance'), 'management UI must show logout compliance');

assert(loader.includes('widgets-5'), 'UAT asset version must be bumped for final unified Work controls');

console.log('UAT unified Work, telemetry and daily-login validation passed.');
