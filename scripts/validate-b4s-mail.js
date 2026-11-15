'use strict';
const assert=require('node:assert/strict'),ejs=require('ejs'),fs=require('fs'),path=require('path');
const mail=require('../src/services/office-mail'),inbox=require('../src/services/office-inbox');
const root=path.resolve(__dirname,'..');
const gerda={id:1,role:'owner',email:'gerda@talk-online.co.za'},
 stephan={id:9,role:'owner',email:'info@b4s.co.za'};
const oldLive=process.env.CRM_LIVE_MODE,oldUrl=process.env.APP_URL;
process.env.CRM_LIVE_MODE='true';process.env.APP_URL='https://crm.tk2m.co.za';
assert.equal(mail.identity(gerda).from,'gerda@tk2m.co.za');
assert.equal(mail.identity(stephan).from,'info@b4s.co.za');
assert.equal(mail.identity(stephan).replyTo,'info@b4s.co.za');
for(const user of [
 {id:1,role:'owner',email:'info@b4s.co.za'},
 {id:9,role:'manager',email:'info@b4s.co.za'},
 {id:9,role:'owner',email:'gerda@talk-online.co.za'}
])assert.equal(mail.allowed(user),null);
assert.equal(inbox.ID,'info@b4s.co.za');
assert.throws(()=>inbox.guard(gerda));
assert.doesNotThrow(()=>inbox.guard(stephan));
assert.throws(()=>inbox.uid('1 OR 1=1'));
assert.throws(()=>inbox.uid(-1));
assert.equal(inbox.uid('123'),123);
const privateMail=inbox.settings(stephan);
assert.equal(typeof privateMail.ready,'boolean');
if(privateMail.ready)assert.equal(privateMail.host,'mail.b4s.co.za');
assert.throws(()=>mail.cleanEmail('a@example.com,b@example.com'));
assert.throws(()=>mail.cleanSubject('Subject\nBcc:evil@example.com'));
const template=fs.readFileSync(path.join(root,'views/office-tools.ejs'),'utf8');
assert.doesNotThrow(()=>ejs.compile(template));
assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(path.join(root,'views/office-inbox-message.ejs'),'utf8')));
const bridge=fs.readFileSync(path.join(root,'src/routes/zippy-integration.js'),'utf8');
const guard=fs.readFileSync(path.join(root,'src/services/zippy-bridge-security.js'),'utf8');
for(const name of ['mail-status','mail-list','mail-read','mail-attachment','mail-mark-read']){
 assert(bridge.includes(name));assert(guard.includes('/api/integrations/zippy/'+name));
}
const routes=fs.readFileSync(path.join(root,'src/routes/office-tools.js'),'utf8');
assert.match(routes,/router\.get\(location\+'\/inbox\/:uid'/);
assert.match(routes,/router\.post\(location\+'\/inbox\/:uid\/mark-read',manager,checkForm/);
console.log('B4S_OWNER_EMAIL_AND_PRIVATE_INBOX_SECURITY_PASS');
process.env.CRM_LIVE_MODE=oldLive;process.env.APP_URL=oldUrl;
