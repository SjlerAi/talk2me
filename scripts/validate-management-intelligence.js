'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {detectIntent}=require('../src/services/cudo-ai');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const service=read('src/services/management-intelligence.js');
const route=read('src/routes/management-intelligence.js');
const cudo=read('src/services/cudo-ai.js');
const agentRoute=read('src/routes/office-intelligence.js');
const agentView=read('views/agent.ejs');
const managementView=read('views/management-intelligence.ejs');
const commandCentre=read('views/command-centre.ejs');
const runner=read('scripts/run-management-automation.js');
const uatRunner=read('scripts/run-management-automation-uat.py');
const server=read('server.js');
const communications=read('src/services/staff-communications.js');

assert(server.includes("require('./src/routes/management-intelligence')"),'Management route must be mounted');
assert(route.includes("router.get('/management'"),'CRM management page missing');
assert(route.includes("router.get('/api/management/overview'"),'Management overview API missing');
assert(route.includes("router.post('/api/management/ask'"),'Management ask API missing');
assert(route.includes("router.post('/management/mailbox/import'"),'Mailbox import missing');
assert(route.includes("router.post('/management/mailbox/:id/share'"),'Selected mailbox-to-staff sharing missing');
assert(route.includes("router.get('/weekly-stats'"),'Staff weekly-stats page route missing');
assert(route.includes("router.post('/weekly-stats/submit'"),'Staff weekly-stats submission route missing');
assert(route.includes("save-deals"),'Dealsheet save action missing');
assert(route.includes("notify-staff"),'Dealsheet staff notify action missing');

assert(service.includes('staffPerformance'),'Staff performance service missing');
assert(service.includes('clients_missing_email'),'Client missing-email metric missing');
assert(service.includes('clients_missing_id'),'Client missing-ID metric missing');
assert(service.includes('tasks_given'),'Tasks-given metric missing');
assert(service.includes('tasks_received'),'Tasks-received metric missing');
assert(service.includes('tasks_completed'),'Tasks-completed metric missing');
assert(service.includes('queryIntelligence'),'Query workload intelligence missing');
assert(service.includes('hours_without_progress'),'Stalled-query detection missing');
assert(service.includes('commercialIntelligence'),'Commercial intelligence missing');
assert(service.includes('package_name'),'Package intelligence missing');
assert(service.includes('city_town'),'Town intelligence missing');
assert(service.includes('management_mailbox_items'),'Gerda mailbox queue missing');
assert(service.includes("category,'Deals'") || service.includes("'Deals','all'"),'Deals library integration missing');
assert(service.includes('attendance-0900'),'09:00 attendance reminder missing');
assert(service.includes('tasks-1600'),'16:00 unfinished-task reminder missing');
assert(service.includes('weekly-reminder-1530'),'Wednesday stats reminder missing');
assert(service.includes('weekly-report-1700'),'Wednesday management report missing');
assert(service.includes('morning-mailbox'),'Morning mailbox summary missing');
assert(service.includes('shareMailboxItemWithStaff'),'Mailbox-to-selected-staff service missing');
assert(service.includes('/weekly-stats'),'Weekly reminder must point staff to the weekly stats page');
assert(communications.includes('ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS'),'External notification guardrail missing');
assert(service.includes('communicationStatus()'),'Management provider status must use the shared communication service');

assert(agentRoute.includes('buildManagementOverview'),'Gerda Agent must use shared management layer');
assert(agentView.includes('Gerda management wishlist'),'Gerda Agent management UI missing');
assert(managementView.includes('Staff performance'),'CRM management dashboard missing');
assert(managementView.includes('Queries taking the most time'),'Query intelligence UI missing');
assert(managementView.includes('Gerda mailbox & dealsheets'),'Mailbox/dealsheet UI missing');
assert(managementView.includes('Send to staff'),'Mailbox selected-staff UI missing');
assert(fs.existsSync(path.join(root,'views/weekly-stats.ejs')),'Weekly stats staff view missing');
assert(commandCentre.includes('/management'),'Command Centre must link to management intelligence');

assert(cudo.includes('answerManagementQuestion'),'Cudo must share Gerda management intelligence');
assert.equal(detectIntent('How many clients does Gerda have?'),'management_intelligence');
assert.equal(detectIntent('Which queries are stuck with no progress?'),'management_intelligence');
assert.equal(detectIntent('What package have we written the most?'),'management_intelligence');
assert.equal(detectIntent('In which towns are our clients?'),'management_intelligence');
assert.equal(detectIntent('Where should we focus?'),'management_intelligence');
assert.equal(detectIntent('Show me the dealsheets in the mailbox'),'management_intelligence');
assert.equal(detectIntent('Was all staff members at work today?'),'attendance');
assert.equal(detectIntent('How many clients are not allocated to staff?'),'unallocated_clients');

for(const mode of ['attendance-0900','tasks-1600','weekly-reminder-1530','weekly-report-1700','morning-mailbox']){
  assert(runner.includes(mode),`Automation runner missing ${mode}`);
  assert(uatRunner.includes(mode),`UAT automation wrapper missing ${mode}`);
}
assert(uatRunner.includes('uent_Crm-Uat'),'UAT automation wrapper must enforce the UAT DB user');
assert(uatRunner.includes('uent_Crm'),'UAT automation wrapper must enforce the UAT DB name');
assert(uatRunner.includes('talk2me_uat_private_uploads'),'UAT automation wrapper must enforce the isolated private upload directory');
assert(uatRunner.includes('/proc/'),'UAT automation wrapper must inherit the live Passenger environment');

console.log('MANAGEMENT_INTELLIGENCE_VALIDATION=PASS');