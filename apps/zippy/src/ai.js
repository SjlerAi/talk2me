'use strict';
// Optional opt-in AI interpretation. No CRM writes or personal reminders are
// executed by model output; server-side policy validates a structured proposal.
const {normal}=require('./clock');
function available(){return process.env.ZIPPY_AI_ENABLED==='1'&&Boolean(process.env.ZIPPY_AI_API_KEY&&process.env.ZIPPY_AI_MODEL);}
function validate(raw,original){
 if(!raw||typeof raw!=='object')return null;
 const route=String(raw.route||'');if(!['personal','office','agenda','question'].includes(route))return null;
 if(route==='office')return {kind:'office',original};
 if(route==='agenda')return {kind:'agenda'};
 if(route==='question')return {kind:'question',question:String(raw.question||'What would you like me to do?').slice(0,180),partial:{original}};
 const title=String(raw.title||'').trim().slice(0,160),time=String(raw.dueAt||''),recurrence=raw.recurrence?String(raw.recurrence):null;
 if(title.length<2||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(time))return {kind:'question',question:'What date and time should I use?',partial:{original}};
 const dt=new Date(time);if(!Number.isFinite(dt.getTime())||dt<=new Date())return {kind:'question',question:'Please give me a future date and time.',partial:{original}};
 if(recurrence&&!/^(daily|weekdays|monthly|weekly:[0-6])$/.test(recurrence))return null;
 const entryType=raw.entryType==='appointment'?'appointment':'reminder';
 return {kind:'personal',title,dueAt:dt.toISOString(),entryType,recurrence,original};
}
async function optionalAICommand(message){
 if(!available())return null;
 const original=String(message||'').slice(0,2500);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
 const system=`You are Zippy, Gerda's private English/Afrikaans assistant. Classify one natural utterance without preset task categories. Current UTC time: ${new Date().toISOString()}; timezone: Africa/Johannesburg (UTC+02). Route staff/customer/Talk2Me messages to office; never send or claim to send them. Route Gerda's personal reminders/appointments to personal. Extract an exact UTC dueAt only when the spoken words specify enough date and time; otherwise question. Preserve free-form activity wording. "me/my" means the signed-in Gerda, not a customer record. Recurrence must be daily, weekdays, monthly or weekly:0 through weekly:6. Do not invent recipients, times, or dates.`;
 const schema={type:'object',additionalProperties:false,properties:{route:{type:'string',enum:['personal','office','agenda','question']},title:{type:'string'},dueAt:{type:'string'},recurrence:{type:'string'},entryType:{type:'string',enum:['reminder','appointment']},question:{type:'string'}},required:['route','title','dueAt','recurrence','entryType','question']};
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,
   headers:{'Authorization':'Bearer '+process.env.ZIPPY_AI_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({model:process.env.ZIPPY_AI_MODEL,instructions:system,input:original,
    store:false,text:{format:{type:'json_schema',name:'zippy_intent',strict:true,schema}}})});
  if(!response.ok)throw Error('AI provider status '+response.status);
  const payload=await response.json();const value=payload.output?.flatMap(item=>item.content||[]).find(part=>part.type==='output_text')?.text;
  if(!value)return null;
  return validate(JSON.parse(value),original);
 }catch(err){console.error('[zippy] Optional AI unavailable:',err.name||'error');return null;}
 finally{clearTimeout(timer);}
}
module.exports={available,validate,optionalAICommand};
