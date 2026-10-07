'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {
  GERDA_WHATSAPP_E164,
  normalizeSouthAfricanMobile,
  communicationStatus
}=require('../src/services/staff-communications');
const {
  emailProfileConfig,
  GERDA_PRIMARY_EMAIL,
  GERDA_PRIMARY_NAME
}=require('../src/services/mailer');
const {
  dispatchIntent
}=require('../src/services/cudo-ai');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const migration=read('migrations/027_staff_contact_directory_20261007.sql');
const comms=read('src/services/staff-communications.js');
const mailer=read('src/services/mailer.js');
const dispatch=read('src/services/work-dispatch.js');
const cudo=read('src/services/cudo-ai.js');
const cudoRoute=read('src/routes/cudo-ai.js');
const management=read('src/services/management-intelligence.js');
const managementView=read('views/management-intelligence.ejs');
const envExample=read('.env.example');

const contacts=[
  ['Gertruida Johanna Le Roux','0829222877','gerda@talk-online.co.za'],
  ['Jonathan Olivier','0795489561','jonathan@talk-online.co.za'],
  ['Annazel Lategan','0764810410','annazel@talk-online.co.za'],
  ['Brabant Allan Van Onselen','0675862527','sales3@talk-online.co.za'],
  ['Van Zyl Hetzel','0663904422','sales4@talk-online.co.za'],
  ['Esias Booyens','0794979287','sias@talk-online.co.za'],
  ['Gerhard van der Westhuizen','0728301373','gerhard@talk-online.co.za']
];

for(const [name,phone,email] of contacts){
  assert(migration.includes(name),`Missing staff contact: ${name}`);
  assert(migration.includes(phone),`Missing staff mobile: ${phone}`);
  assert(migration.includes(email),`Missing staff email: ${email}`);
}

assert.equal(normalizeSouthAfricanMobile('082 922 2877'),'+27829222877');
assert.equal(normalizeSouthAfricanMobile('0795489561'),'+27795489561');
assert.equal(normalizeSouthAfricanMobile('27 76 481 0410'),'+27764810410');
assert.equal(normalizeSouthAfricanMobile('+27 67 586 2527'),'+27675862527');
assert.equal(normalizeSouthAfricanMobile('123'),null);
assert.equal(GERDA_WHATSAPP_E164,'+27829222877','Gerda WhatsApp sender identity must be fixed');
assert.equal(GERDA_PRIMARY_EMAIL,'gerda@talk-online.co.za','Gerda primary email sender must be fixed');
assert.equal(GERDA_PRIMARY_NAME,'Gerda','Gerda primary sender display name must be fixed');
assert.equal(emailProfileConfig('primary').address,'gerda@talk-online.co.za','Primary sender profile must always use Gerda email');

assert(mailer.includes("emailProfileConfig(key='primary')"),'Primary sender profile missing');
assert(mailer.includes("TALK2ME_EMAIL_SECONDARY_"),'Secondary sender profile missing');
assert(mailer.includes("fallback = selected === 'primary'"),'Legacy SMTP fallback should only apply to primary');

assert(comms.includes('WHATSAPP_PHONE_NUMBER_ID'),'WhatsApp phone number id support missing');
assert(comms.includes('WHATSAPP_SENDER_NUMBER'),'WhatsApp sender-number verification missing');
assert(comms.includes('senderIdentityMatches'),'WhatsApp sender identity match guardrail missing');
assert(comms.includes('verifyGerdaWhatsAppSender'),'Meta sender verification function missing');
assert(comms.includes('display_phone_number'),'Meta sender verification must inspect the registered display phone number');
assert(comms.includes("status:'sender_mismatch'"),'WhatsApp must fail closed if Meta is not registered to Gerda');
assert(comms.includes('WHATSAPP_GRAPH_VERSION'),'WhatsApp Graph version must be explicitly configured');
assert(comms.includes("type:'text'"),'WhatsApp text sending missing');
assert(comms.includes("type=isImage?'image':'document'"),'WhatsApp attachment sending missing');
assert(comms.includes('CUDO_EXTERNAL_SEND_ENABLED'),'External-send safety gate missing');
assert(comms.includes('ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS'),'Management external-send gate missing');

assert(dispatch.includes('sendExternalCommunication'),'Work dispatch must call shared external communications');
assert(dispatch.includes('recipient_email'),'Dispatch must persist recipient email');
assert(dispatch.includes('recipient_mobile'),'Dispatch must persist recipient mobile');
assert(dispatch.includes('sender_address'),'Dispatch must persist sender mailbox');
assert(dispatch.includes('external_message_id'),'Dispatch must persist provider message id');
assert(dispatch.includes("channel.channel!=='internal'"),'Internal and external dispatch paths must remain distinct');

assert(dispatchIntent('email this file to Gerda',[1]),'Email file dispatch command not recognised');
assert(dispatchIntent('WhatsApp Johnny and ask him to call me',[]),'Text-only WhatsApp command not recognised');
assert(dispatchIntent('send this to Annazel by email',[2]),'Email send wording not recognised');
assert(!dispatchIntent('show me Johnny outstanding work',[]),'Read-only query must not become an external send');

assert(cudo.includes("senderKey=draft.senderKey || 'primary'"),'Cudo sender mailbox state missing');
assert(cudo.includes("senderKey='secondary'"),'Cudo secondary mailbox selection missing');
assert(cudo.includes('recipientContact'),'Cudo preview must show recipient contact');
assert(cudo.includes("from Gerda (${availability.senderNumber || '+27829222877'})"),'Cudo WhatsApp preview must show Gerda sender number');
assert(cudo.includes("gerda@talk-online.co.za"),'Cudo email preview must use Gerda as primary sender');
assert(cudo.includes('Nothing will be sent until you confirm.'),'External dispatch must require confirmation');
assert(cudoRoute.includes("actionName === 'confirm_dispatch'"),'Confirmed send action missing');
assert(cudoRoute.includes('externalStatus'),'Audit must capture external delivery status');

assert(management.includes('communicationStatus()'),'Gerda management must use shared communication provider status');
assert(managementView.includes('Email senders'),'Management sender readiness panel missing');
assert(managementView.includes('contact_number'),'Management staff telephone directory missing');
assert(managementView.includes('Primary: Gerda'),'Management UI must identify Gerda primary email sender');
assert(managementView.includes('whatsappSenderNumber'),'Management UI must identify Gerda WhatsApp sender');

for(const key of [
  'TALK2ME_EMAIL_PRIMARY_',
  'TALK2ME_EMAIL_SECONDARY_',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_SENDER_NUMBER',
  'WHATSAPP_GRAPH_VERSION',
  'WHATSAPP_API_TOKEN'
]){
  assert(envExample.includes(key),`Missing environment documentation for ${key}`);
}

const status=communicationStatus();
assert(status.email && status.whatsapp,'Communication status must expose email and WhatsApp');
assert.equal(status.email.profiles.find(p=>p.key==='primary').address,'gerda@talk-online.co.za');
assert.equal(status.whatsapp.intendedSenderNumber,'+27829222877');

console.log('STAFF_COMMUNICATIONS_VALIDATION=PASS');
