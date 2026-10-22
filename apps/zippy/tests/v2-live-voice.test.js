'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const Voice=require('../public/beta/voice-flow');

function voiceHarness(){
 const script=fs.readFileSync(path.join(__dirname,'../public/beta/app.js'),'utf8');
 const start=script.indexOf('function sendRecognisedMessage()');
 const end=script.indexOf('async function enableNotifications()',start);
 assert(start>=0&&end>start,'voice function boundaries');
 const snippet=script.slice(start,end);
 let clock=0,next=0,sent=0,draftSent=0;
 const tasks=new Map(),recognizers=[],messages=[];
 const setTimeoutFake=(fn,delay)=>{const id=++next;tasks.set(id,{at:clock+delay,fn});return id;};
 const clearTimeoutFake=id=>tasks.delete(id);
 function advance(ms){
  const target=clock+ms;
  while(true){
   const due=[...tasks].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!due)break;
   clock=due[1].at;tasks.delete(due[0]);due[1].fn();
  }
  clock=target;
 }
 class Recognition{
  constructor(){this.active=false;recognizers.push(this);}
  start(){this.active=true;}
  stop(){this.active=false;this.onend?.();}
  push(...results){
   assert(this.active,'recognizer must be active');
   this.onresult?.({results:results.map(([text,isFinal])=>
    Object.assign([{transcript:text}],{isFinal}))});
  }
 }
 const input={value:'',focus(){}},language={value:'en-ZA'};
 const state={busy:false,mediaRecorder:null,recognition:null,activeDraft:null,recognitionSource:'text'};
 const ctx={
  state,
  window:{SpeechRecognition:Recognition},
  navigator:{},
  ZippyVoice:{...Voice,silenceClock:(cb,delay)=>Voice.silenceClock(cb,delay,{
   setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake
  })},
  setTimeout:setTimeoutFake,
  clearTimeout:clearTimeoutFake,
  $:sel=>sel==='#command-input'?input:sel==='#language'?language:{},
  setMic(){},setStatus(s){messages.push(s);},
  submitCommand(){sent++;},draftSpeech(x){assert.equal(x,'send');draftSent++;},
  loading(){},result(){},
  console
 };
 vm.createContext(ctx);
 vm.runInContext(snippet,ctx);
 return {start:()=>ctx.startVoice(),advance,recognizers,messages,input,language,
  state,sent:()=>sent,draftSent:()=>draftSent};
}
test('Live speech displays interim words, freezes after 2 seconds, and sends only on the separate word Send',async()=>{
 const h=voiceHarness();
 await h.start();
 const rec=h.recognizers.at(-1);
 assert.equal(rec.interimResults,true);
 assert.equal(rec.continuous,true);
 rec.push(['Remind me',false]);
 assert.equal(h.input.value,'Remind me');
 h.advance(500);
 rec.push(['Remind me to phone mother',false]);
 assert.equal(h.input.value,'Remind me to phone mother');
 h.advance(1999);
 assert.equal(h.sent(),0);
 h.advance(1);
 assert(h.messages.at(-1).includes('Say “Send”'));
 assert.equal(h.sent(),0,'Silence never submits a message');
 assert.equal(h.input.value,'Remind me to phone mother');
 rec.push(['Remind me to phone mother',true],['Send',true]);
 assert.equal(h.sent(),1,'Only a separate completed Send instruction submits the draft');
 assert.equal(h.state.recognition,null);
 assert.equal(h.input.value,'Remind me to phone mother','spoken Send must not overwrite dictated text');
});
test('Live speech keeps dictated text after send window expires, and a longer phrase is not Send',async()=>{
 const h=voiceHarness();
 await h.start();
 const rec=h.recognizers.at(-1);
 rec.push(['Send this summary to Johnny',true]);
 h.advance(2000);
 assert.equal(h.sent(),0);
 rec.push(['Send this summary to Johnny',true],['when it is ready',true]);
 assert.equal(h.sent(),0,'additional spoken words continue the dictation');
 assert.equal(h.input.value,'Send this summary to Johnny when it is ready');
 h.advance(2000);
 h.advance(7000);
 assert.equal(h.sent(),0);
 assert.equal(h.state.recognition,null);
 assert.equal(h.input.value,'Send this summary to Johnny when it is ready');
});
test('Saying Stuur while a reviewed CRM draft is active reaches only the approval handler',async()=>{
 const h=voiceHarness();
 h.state.activeDraft={id:'preview-only'};
 await h.start();
 h.recognizers.at(-1).push(['Stuur',true]);
 assert.equal(h.sent(),0,'ordinary chat submit is not the CRM approval route');
 assert.equal(h.draftSent(),1,'existing CRM approval handler checks permissions and confirmed recipient');
});
