'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {dispatchIntent,parseDueAt,detectIntent}=require('../src/services/cudo-ai');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const dispatch=read('src/services/work-dispatch.js');
const cudoRoute=read('src/routes/cudo-ai.js');
const cudoService=read('src/services/cudo-ai.js');
const widget=read('public/js/cudo-widget.js');
const css=read('public/css/cudo-widget.css');
const taskRoute=read('src/routes/task-workflow.js');
const taskView=read('views/task-work-detail.ejs');
const taskCss=read('public/css/task-workflow.css');

assert(dispatch.includes('CREATE TABLE IF NOT EXISTS work_files'),'Canonical work file table missing');
assert(dispatch.includes('CREATE TABLE IF NOT EXISTS work_dispatches'),'Work dispatch table missing');
assert(dispatch.includes('CREATE TABLE IF NOT EXISTS work_dispatch_items'),'Dispatch item table missing');
assert(dispatch.includes('CREATE TABLE IF NOT EXISTS staff_task_attachments'),'Task attachment link table missing');
assert(dispatch.includes("storage_kind ENUM('uploaded','library')"),'Uploads and Library/Deals links must share one attachment model');
assert(dispatch.includes('sendAgentInstruction'),'Monitored dispatches must reuse Gerda task monitoring');
assert(dispatch.includes('agent_task_watches') || dispatch.includes('sendAgentInstruction'),'Monitored dispatch path missing');
assert(dispatch.includes("delivery_channel ENUM('internal','email','whatsapp')"),'Delivery-channel adapter field missing');
assert(dispatch.includes('notificationProviderStatus'),'External delivery must respect configured providers');
assert(dispatch.includes("PRIVATE_UPLOAD_DIR"),'Attachments must use private storage');
assert(dispatch.includes('40 * 1024 * 1024'),'Attachment size guardrail missing');

assert(cudoRoute.includes("router.post('/api/cudo/attachments'"),'Cudo upload API missing');
assert(cudoRoute.includes("router.get('/api/cudo/files/library'"),'Cudo Library/Deals picker API missing');
assert(cudoRoute.includes("confirm_dispatch"),'Confirmed dispatch action missing');
assert(cudoRoute.includes('createWorkDispatch'),'Cudo confirmation must use shared dispatch service');
assert(cudoRoute.includes('attachmentIds'),'Cudo chat must carry attachment references');
assert(cudoRoute.includes('cudo_work_dispatch_sent'),'Dispatch audit event missing');

assert(widget.includes('cudo-file-input'),'Paperclip file input missing');
assert(widget.includes('cudo-attach'),'Paperclip control missing');
assert(widget.includes('cudo-library-picker'),'Library/Deals picker missing');
assert(widget.includes("new FormData()"),'Multipart attachment upload missing');
assert(widget.includes('attachmentIds:attachments.map'),'Chat must send attachment IDs');
assert(widget.includes("confirm_dispatch:'Send now'"),'Dispatch preview Send button missing');
assert(widget.includes("action==='confirm_dispatch'"),'Dispatch confirmation UI missing');
assert(css.includes('.cudo-attachment-tray'),'Attachment tray styling missing');
assert(css.includes('.cudo-library-picker'),'Library picker styling missing');

assert(taskRoute.includes('getTaskAttachmentDownload'),'Recipient download route must enforce task access');
assert(taskRoute.includes('/attachments/:fileId/download'),'Task attachment download endpoint missing');
assert(taskView.includes('Attachments'),'Task/message attachment section missing');
assert(taskView.includes('/attachments/<%= file.id %>/download'),'Attachment download link missing');
assert(taskCss.includes('.task-attachment'),'Task attachment styling missing');

assert(dispatchIntent('send all outstanding work to Johnny for reply by Friday',[]),'Outstanding-work dispatch command not recognised');
assert(dispatchIntent('send this file to Johnny',[91]),'Attachment send command not recognised');
assert(!dispatchIntent('show me Johnny outstanding work',[]),'Read-only work query must not be treated as send');
assert(parseDueAt('send it by Friday 15:00'),'Dispatch deadline parsing missing');
assert.equal(detectIntent("Who hasn't replied to the files I sent yesterday?"),'dispatch_status');
assert(cudoService.includes('prepareDispatchAction'),'Dispatch preview builder missing');
assert(cudoService.includes('Nothing will be sent until you confirm'),'Explicit confirmation guardrail missing');
assert(cudoService.includes('queryDispatchStatus'),'Dispatch monitoring query missing');

const voiceEnd=widget.slice(widget.indexOf('recognition.onend'),widget.indexOf('async function sendMessage'));
assert(!voiceEnd.includes('sendMessage(full)'),'Voice must still require manual review before any send');

console.log('WORK_DISPATCH_VALIDATION=PASS');