'use strict';
// Optional opt-in AI interpretation. No CRM writes or personal reminders are
// executed by model output; server-side policy validates a structured proposal.
const {normal}=require('./clock');
function aiKey(){return process.env.ZIPPY_AI_API_KEY||process.env.ZIPPY_STT_API_KEY||process.env.OPENAI_API_KEY||'';}
function available(){return process.env.ZIPPY_AI_ENABLED==='1'&&Boolean(aiKey()&&process.env.ZIPPY_AI_MODEL);}
function validate(raw,original){
 if(!raw||typeof raw!=='object')return null;
 const route=String(raw.route||'');if(!['personal','office','agenda','question','conversation'].includes(route))return null;
 if(route==='office')return {kind:'office',original};
 if(route==='conversation')return {kind:'conversation',text:String(raw.answer||'').trim().slice(0,1200)||'What would you like to know?'};
 if(route==='agenda')return {kind:'agenda'};
 if(route==='question')return {kind:'question',question:String(raw.question||'What would you like me to do?').slice(0,180),partial:{original}};
 const title=String(raw.title||'').trim().slice(0,160),time=String(raw.dueAt||''),recurrence=raw.recurrence?String(raw.recurrence):null;
 if(title.length<2||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(time))return {kind:'question',question:'What date and time should I use?',partial:{original}};
 const dt=new Date(time);if(!Number.isFinite(dt.getTime())||dt<=new Date())return {kind:'question',question:'Please give me a future date and time.',partial:{original}};
 if(recurrence&&!/^(daily|weekdays|monthly|weekly:[0-6])$/.test(recurrence))return null;
 const entryType=raw.entryType==='appointment'?'appointment':'reminder';
 return {kind:'personal',title,dueAt:dt.toISOString(),entryType,recurrence,original};
}
async function optionalAICommand(message,{user=null,language='auto'}={}){
 if(!available())return null;
 const original=String(message||'').slice(0,2500);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
 const person=String(user?.firstName||'the signed-in user').replace(/[^\p{L}\p{N}' -]/gu,'').slice(0,45);
 const system=`You are Zippy, a bilingual conversational personal assistant to ${person}.
 Understand natural, possibly ungrammatical English and Afrikaans voice transcription. Do not limit tasks to preset categories.
 Answer in the user's language: ${language==='af-ZA'?'Afrikaans':language==='en-ZA'?'English':'whichever language the user used'}. Keep answers friendly, concise and grounded. Do not invent CRM facts.
 The current UTC time is ${new Date().toISOString()}; local timezone Africa/Johannesburg (UTC+02).
 PERSONAL: user's own reminders or appointments, even mentioning a CRM staff name: "Herinner my om Gerda te bel" is personal.
 OFFICE: instructions to somebody else, e.g. "vra Gerda my bel asseblief", "vra Gerda om my te bel", "ask Gerda to call me please", "ask vraag Gerda my bel".
 Office actions are NEVER sent by you. A separate signed CRM process looks up the real people and asks for the user's approval.
 AGENDA: user's private calendar/reminder query. CONVERSATION: normal general questions, explanations and brainstorming; fill in answer.
 QUESTION: one clarification only when a necessary name, date or time is genuinely missing. Never invent details.
 For private reminders return an exact future UTC dueAt only if the speech clearly specifies a date/time, otherwise question.
 English "me" and Afrikaans "my" refer to ${person}, who is logged in, NOT necessarily Gerda.
 You have no CRM records or personal contacts: never claim to have checked the database, sent messages, or completed tasks.
 The CRM, not your guess, determines whether a staff or customer exists. Keep arbitrary task wording intact.
 Recurrence can be daily, weekdays, monthly, or weekly:0 to weekly:6.`;
 const schema={type:'object',additionalProperties:false,properties:{route:{type:'string',enum:['personal','office','agenda','question','conversation']},title:{type:'string'},dueAt:{type:'string'},recurrence:{type:'string'},entryType:{type:'string',enum:['reminder','appointment']},question:{type:'string'},answer:{type:'string'}},required:['route','title','dueAt','recurrence','entryType','question','answer']};
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,
   headers:{'Authorization':'Bearer '+aiKey(),'Content-Type':'application/json'},
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
