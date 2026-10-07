'use strict';

const fs = require('fs');
const path = require('path');

const GERDA_WHATSAPP_E164 = '+27829222877';
const {
  createTransporter,
  smtpConfigured,
  talk2meSender,
  emailSenderProfiles,
  escapeHtml
} = require('./mailer');

function clean(value,max=5000){
  return String(value == null ? '' : value).trim().slice(0,max);
}

function externalSendingEnabled(){
  return (
    String(process.env.ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS || '').trim().toLowerCase() === 'true'
    && String(process.env.CUDO_EXTERNAL_SEND_ENABLED || '').trim().toLowerCase() === 'true'
  );
}

function normalizeSouthAfricanMobile(value){
  const raw=clean(value,40);
  if(!raw) return null;
  let digits=raw.replace(/[^0-9+]/g,'');
  if(digits.startsWith('+')) digits='+'+digits.slice(1).replace(/\D/g,'');
  else digits=digits.replace(/\D/g,'');

  if(/^0\d{9}$/.test(digits)) return '+27'+digits.slice(1);
  if(/^27\d{9}$/.test(digits)) return '+'+digits;
  if(/^\+27\d{9}$/.test(digits)) return digits;
  if(/^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}

function emailProviderStatus(){
  const profiles=emailSenderProfiles();
  return {
    enabled:externalSendingEnabled(),
    profiles,
    configuredProfiles:profiles.filter(profile=>profile.configured).map(profile=>profile.key),
    readyProfiles:profiles.filter(profile=>profile.configured && externalSendingEnabled()).map(profile=>profile.key)
  };
}

function whatsappProviderStatus(){
  const provider=clean(process.env.WHATSAPP_PROVIDER || 'meta',30).toLowerCase();
  const graphVersion=clean(process.env.WHATSAPP_GRAPH_VERSION,30);
  const phoneNumberId=clean(process.env.WHATSAPP_PHONE_NUMBER_ID,120);
  const token=clean(process.env.WHATSAPP_API_TOKEN,500);
  const configuredSender=normalizeSouthAfricanMobile(process.env.WHATSAPP_SENDER_NUMBER || '');
  const senderIdentityMatches=configuredSender ? configuredSender === GERDA_WHATSAPP_E164 : null;
  const configured=Boolean(
    provider === 'meta'
    && graphVersion
    && phoneNumberId
    && token
    && senderIdentityMatches !== false
  );
  return {
    provider,
    enabled:externalSendingEnabled(),
    configured,
    ready:Boolean(configured && externalSendingEnabled()),
    intendedSenderNumber:GERDA_WHATSAPP_E164,
    configuredSenderNumber:configuredSender,
    senderIdentityMatches,
    phoneNumberIdConfigured:Boolean(phoneNumberId),
    graphVersionConfigured:Boolean(graphVersion),
    tokenConfigured:Boolean(token)
  };
}

function communicationStatus(){
  return {
    externalEnabled:externalSendingEnabled(),
    email:emailProviderStatus(),
    whatsapp:whatsappProviderStatus()
  };
}

function senderProfileStatus(key='primary'){
  const selected=key === 'secondary' ? 'secondary' : 'primary';
  const profile=emailSenderProfiles().find(item=>item.key===selected) || {key:selected,address:'',name:'Talk2Me CRM',configured:false};
  return {
    ...profile,
    ready:Boolean(profile.configured && externalSendingEnabled())
  };
}

async function sendEmail({senderKey='primary',to,subject,body,attachments=[]}){
  const selected=senderKey === 'secondary' ? 'secondary' : 'primary';
  if(!externalSendingEnabled()) return {sent:false,status:'disabled',error:'External sending is disabled.'};
  if(!smtpConfigured(selected)) return {sent:false,status:'not_configured',error:`The ${selected} Talk2Me sender mailbox is not configured.`};
  const recipient=clean(to,255);
  if(!recipient) return {sent:false,status:'invalid_recipient',error:'Recipient email is missing.'};

  const transporter=createTransporter(selected);
  if(!transporter) return {sent:false,status:'not_configured',error:'Email transporter is unavailable.'};
  const sender=talk2meSender(selected);
  const files=(attachments||[]).filter(file=>file && file.path && fs.existsSync(file.path)).map(file=>({
    filename:path.basename(clean(file.name,255) || 'attachment'),
    path:file.path,
    contentType:clean(file.mime,140) || 'application/octet-stream'
  }));

  try{
    const info=await transporter.sendMail({
      from:sender,
      to:recipient,
      subject:clean(subject,255) || 'Talk2Me',
      text:clean(body,20000),
      html:`<div style="font-family:Arial,sans-serif;line-height:1.55"><p style="white-space:pre-wrap">${escapeHtml(clean(body,20000))}</p></div>`,
      attachments:files
    });
    return {
      sent:true,
      status:'sent',
      messageId:info.messageId || null,
      senderKey:selected,
      senderAddress:sender.address || '',
      recipient
    };
  }catch(error){
    return {sent:false,status:'failed',error:clean(error.message,500),senderKey:selected,senderAddress:sender.address||'',recipient};
  }
}

function whatsappGraphBase(){
  return clean(process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com',300).replace(/\/$/,'');
}

function whatsappPhoneNumberUrl(){
  const status=whatsappProviderStatus();
  if(!status.configured) return null;
  const version=clean(process.env.WHATSAPP_GRAPH_VERSION,30).replace(/^\/+|\/+$/g,'');
  const phoneNumberId=clean(process.env.WHATSAPP_PHONE_NUMBER_ID,120);
  return `${whatsappGraphBase()}/${version}/${phoneNumberId}`;
}

function whatsappEndpoint(resource){
  const base=whatsappPhoneNumberUrl();
  return base ? `${base}/${resource}` : null;
}

async function metaRequest(url,{method='POST',body,headers={}}={}){
  const token=clean(process.env.WHATSAPP_API_TOKEN,500);
  const response=await fetch(url,{
    method,
    headers:{Authorization:`Bearer ${token}`,...headers},
    body
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const providerMessage=clean(data?.error?.message || data?.message || `WhatsApp provider returned ${response.status}`,500);
    throw new Error(providerMessage);
  }
  return data;
}

async function verifyGerdaWhatsAppSender(){
  const base=whatsappPhoneNumberUrl();
  if(!base) return {ok:false,error:'Meta WhatsApp Cloud API credentials/version are not configured.'};
  try{
    const data=await metaRequest(`${base}?fields=display_phone_number,verified_name`,{method:'GET'});
    const providerNumber=normalizeSouthAfricanMobile(data?.display_phone_number || '');
    if(providerNumber !== GERDA_WHATSAPP_E164){
      return {
        ok:false,
        error:`Configured Meta WhatsApp sender is ${providerNumber || 'unknown'}, not Gerda ${GERDA_WHATSAPP_E164}.`,
        providerNumber,
        verifiedName:clean(data?.verified_name,180)||null
      };
    }
    return {
      ok:true,
      providerNumber,
      verifiedName:clean(data?.verified_name,180)||null
    };
  }catch(error){
    return {ok:false,error:clean(error.message,500)||'Could not verify the Meta WhatsApp sender.'};
  }
}

async function uploadWhatsAppMedia(file){
  const url=whatsappEndpoint('media');
  if(!url) throw new Error('WhatsApp media upload is not configured.');
  const bytes=fs.readFileSync(file.path);
  const form=new FormData();
  form.append('messaging_product','whatsapp');
  form.append('file',new Blob([bytes],{type:clean(file.mime,140)||'application/octet-stream'}),path.basename(clean(file.name,255)||'attachment'));
  const data=await metaRequest(url,{body:form});
  if(!data?.id) throw new Error('WhatsApp media upload did not return a media id.');
  return String(data.id);
}

async function sendWhatsAppMessage(payload){
  const url=whatsappEndpoint('messages');
  if(!url) throw new Error('WhatsApp sending is not configured.');
  return metaRequest(url,{
    body:JSON.stringify(payload),
    headers:{'Content-Type':'application/json'}
  });
}

async function sendWhatsApp({to,body,attachments=[]}){
  const status=whatsappProviderStatus();
  if(!status.ready){
    return {
      sent:false,
      status:status.configured?'disabled':'not_configured',
      error:status.configured
        ? 'External sending is disabled.'
        : status.senderIdentityMatches === false
          ? 'Configured WhatsApp sender number does not match Gerda +27829222877.'
          : 'Meta WhatsApp Cloud API credentials/version are not configured.'
    };
  }
  const e164=normalizeSouthAfricanMobile(to);
  if(!e164) return {sent:false,status:'invalid_recipient',error:'Recipient mobile number is invalid.'};
  const recipient=e164.replace(/^\+/,'');
  const messageIds=[];
  try{
    const senderVerification=await verifyGerdaWhatsAppSender();
    if(!senderVerification.ok){
      return {
        sent:false,
        status:'sender_mismatch',
        error:senderVerification.error,
        senderNumber:senderVerification.providerNumber || null,
        recipient:e164
      };
    }
    const textData=await sendWhatsAppMessage({
      messaging_product:'whatsapp',
      recipient_type:'individual',
      to:recipient,
      type:'text',
      text:{preview_url:false,body:clean(body,4096)}
    });
    if(textData?.messages?.[0]?.id) messageIds.push(textData.messages[0].id);

    for(const file of attachments||[]){
      if(!file?.path || !fs.existsSync(file.path)) continue;
      const mediaId=await uploadWhatsAppMedia(file);
      const isImage=/^image\/(jpeg|png|webp)$/i.test(clean(file.mime,140));
      const type=isImage?'image':'document';
      const mediaPayload=isImage
        ? {id:mediaId,caption:clean(file.name,1024)}
        : {id:mediaId,filename:path.basename(clean(file.name,255)||'attachment')};
      const data=await sendWhatsAppMessage({
        messaging_product:'whatsapp',
        recipient_type:'individual',
        to:recipient,
        type,
        [type]:mediaPayload
      });
      if(data?.messages?.[0]?.id) messageIds.push(data.messages[0].id);
    }

    return {sent:true,status:'sent',messageIds,recipient:e164,senderNumber:GERDA_WHATSAPP_E164};
  }catch(error){
    return {sent:false,status:'failed',error:clean(error.message,500),messageIds,recipient:e164};
  }
}

async function sendExternalCommunication({channel,senderKey='primary',recipient,subject,body,attachments=[]}){
  if(channel==='email') return sendEmail({
    senderKey,
    to:recipient.email,
    subject,
    body,
    attachments
  });
  if(channel==='whatsapp') return sendWhatsApp({
    to:recipient.mobile,
    body,
    attachments
  });
  return {sent:false,status:'unsupported',error:'Unsupported external delivery channel.'};
}

module.exports={
  GERDA_WHATSAPP_E164,
  externalSendingEnabled,
  normalizeSouthAfricanMobile,
  emailProviderStatus,
  whatsappProviderStatus,
  verifyGerdaWhatsAppSender,
  communicationStatus,
  senderProfileStatus,
  sendEmail,
  sendWhatsApp,
  sendExternalCommunication
};
