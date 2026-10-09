'use strict';

const fs=require('fs');
const assert=require('assert');

const read=path=>fs.readFileSync(path,'utf8');

const route=read('src/routes/uat-work-widgets.js');
const service=read('src/services/work-operating-model.js');
const widget=read('public/js/uat-work-widgets.js');
const ui=read('public/js/uat-work-operating-model.js');
const css=read('public/css/uat-work-operating-model.css');
const loader=read('public/js/os-v6-alpha21-17.js');
const cudo=read('src/services/cudo-ai.js');
const agent=read('src/services/office-intelligence-agent.js');
const agentView=read('views/agent.ejs');

assert(route.includes("const { ensureWorkOperatingSchema, getMyWorkOverview, getOfficeScorecard, getTargetCentre, saveTargetGoal, getMonthlyImportSummary }"),'UAT work route must use the shared operating model.');
assert(route.includes("const where = scope === 'sent'"),'Task scope query missing.');
assert(route.includes(": 't.assigned_to=:userId';"),'Mine must be assigned-to only.');
assert(!route.includes("requestedScope === 'all' && !isManager"),'Ordinary staff must not receive an All scope.');
assert(route.includes("router.get('/api/uat/work/overview'"),'My Work API missing.');
assert(route.includes("router.get('/api/uat/work/scorecard'"),'Office Scorecard API missing.');
assert(route.includes("router.get('/api/uat/work/targets'"),'Target Centre API missing.');
assert(route.includes("router.get('/api/uat/work/import-summary'"),'Monthly Import Summary API missing.');
assert(route.includes("router.get('/api/uat/work/health'"),'Work operating-model health proof missing.');
assert(route.includes("String(req.session.user.role||'').toLowerCase()!=='owner'"),'Owner-only management protection missing.');

assert(service.includes('CREATE TABLE IF NOT EXISTS staff_target_goals'),'Target goal table missing.');
assert(service.includes('CREATE TABLE IF NOT EXISTS staff_target_weekly'),'Weekly target table missing.');
for(const label of ['Upgrades','New Lines','Transfers','Versekering','Siebel simplified','E20','Office','LTE','Wireless','Management','Smart Homes','Printers','Telefoon Sistem','Business Connections','Solar']){
  assert(service.includes("'"+label+"'"),'Missing approved target category: '+label);
}
for(const heading of ['Queries handeled','Upgrade Updated','New Clients added','Tasks Send','Task Updated','Task Completed','Client Claimed','U/S Task','Over Due Upgrades']){
  assert(ui.includes(heading),'Missing approved scorecard heading: '+heading);
}
assert(service.includes(".filter(row=>targetTemplateFor({full_name:row.staff_name}).length>0)"),'Office Scorecard must stay limited to staff represented in the approved workbooks.');
assert(agentView.includes('Queries handeled'),'Gerda Agent scorecard must preserve the approved workbook terminology.');
assert(agentView.includes('U/S Task'),'Gerda Agent scorecard must preserve U/S Task terminology.');
assert(agentView.includes('Over Due Upgrades'),'Gerda Agent scorecard must preserve Over Due Upgrades terminology.');

for(const fn of ['getMyWorkOverview','getOfficeScorecard','getTargetCentre','saveTargetGoal','getMonthlyImportSummary','getManagementSnapshot']){
  assert(service.includes('async function '+fn),'Shared service function missing: '+fn);
}
for(const metric of ['queries_handled','upgrades_updated','new_clients_added','tasks_sent','tasks_updated','tasks_completed','clients_claimed','outstanding_tasks','overdue_upgrades']){
  assert(service.includes(metric),'Scorecard metric missing: '+metric);
}
assert(service.includes("t.created_by<>:id"),'My Work must identify delegated management work.');
assert(service.includes("t.priority='urgent'"),'Delegated work urgency must be calculated.');
assert(service.includes("SUM(CASE WHEN LOWER(import_type) LIKE '%upgrade%'"),'Import Summary upgrade count missing.');
assert(service.includes("new_lines"),'Import Summary new-line count missing.');
assert(service.includes("m.classification='exact_match'"),'Import Summary exact-match count missing.');
assert(service.includes("m.classification='conflict'"),'Import Summary conflict-review count missing.');
assert(!service.includes('a.applied_client_id'),'Import Summary must not depend on non-existent applied_client_id.');
assert(!service.includes('a.applied_account_id'),'Import Summary must not depend on non-existent applied_account_id.');

assert(ui.includes('What must I do now?'),'My Work question is missing.');
assert(ui.includes('Delegated to me'),'Delegated work card missing.');
assert(ui.includes('From Gerda / management'),'Gerda/management delegated section missing.');
assert(ui.includes("label:'URGENT'"),'Urgent display missing.');
assert(ui.includes("label:'IMPORTANT'"),'Important display missing.');
assert(ui.includes('Office Scorecard'),'Owner Office Scorecard missing.');
assert(ui.includes('Target Centre'),'Owner Target Centre missing.');
assert(ui.includes('Monthly Import Summary'),'Owner Import Summary missing.');
assert(ui.includes('Complete / Close'),'Task Complete/Close language missing.');
assert(ui.includes('Reply with what you did, or attach a file'),'Task conversation reply language missing.');
assert(ui.includes('shortStaff'),'First-name display helper missing.');
assert(css.includes('.t2m-om-delegated.is-urgent'),'Urgent delegated styling missing.');
assert(css.includes('.t2m-om-delegated.is-high'),'Important delegated styling missing.');
assert(css.includes('.t2m-task-comment.t2m-om-thread-bubble'),'WhatsApp-style task conversation styling missing.');

assert(loader.includes('data-uat-work-operating-model'),'Operating model assets must load in UAT.');
assert(loader.includes('/public/js/uat-work-operating-model.js'),'Operating model JS asset missing from UAT loader.');
assert(loader.includes('/public/css/uat-work-operating-model.css'),'Operating model CSS asset missing from UAT loader.');
assert(widget.includes("window.Talk2MeOperatingModel?.openWork"),'Main Work launcher must open My Work when available.');

assert(cudo.includes("require('./work-operating-model')"),'Cudo must use the same shared operating model.');
for(const intent of ["'my_work'","'targets'","'office_scorecard'","'import_summary'"]){
  assert(cudo.includes(intent),'Cudo operating-model intent missing: '+intent);
}
for(const fn of ['queryMyWorkOperating','queryTargetsOperating','queryOfficeScorecardOperating','queryImportSummaryOperating']){
  assert(cudo.includes('async function '+fn),'Cudo shared query missing: '+fn);
}
assert(agent.includes("require('./work-operating-model')"),'Gerda Agent must use the shared operating model.');
assert(agent.includes('getManagementSnapshot({rangeKey})'),'Gerda Agent shared management snapshot missing.');
assert(agent.includes('operatingModel,'),'Gerda Agent report must expose the operating model snapshot.');
assert(agentView.includes('CRM work summary'),'Gerda Agent must show the shared CRM work summary.');
assert(agentView.includes('om.delegatedWork'),'Gerda Agent must show delegated work status.');
assert(agentView.includes('om.scorecard'),'Gerda Agent must show the shared Office Scorecard.');
assert(agentView.includes('om.importSummary'),'Gerda Agent must show the shared Monthly Import Summary.');
assert(agentView.includes('om.targets'),'Gerda Agent must show the shared Target Centre progress.');
assert(agentView.includes('shortName'),'Gerda Agent staff displays must use short names.');

console.log('APPROVED_WORK_OPERATING_MODEL_VALIDATION=PASS');
