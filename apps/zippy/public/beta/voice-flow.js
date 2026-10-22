'use strict';
// Tiny standalone voice helpers. No provider calls, no credentials, no audio storage.
(function(root,factory){
 const helpers=factory();
 if(typeof module==='object'&&module.exports)module.exports=helpers;
 if(root)root.ZippyVoice=helpers;
})(typeof window==='undefined'?null:window,function(){
 const SILENCE_MS=2000;
 const SEND_WINDOW_MS=7000;
 const MAX_RECORD_MS=30000;
 function tidy(value){
  return String(value||'').normalize('NFKC').toLowerCase().replace(/[.!?,;:]+$/g,'').trim().replace(/\s+/g,' ');
 }
 function command(value){
  const phrase=tidy(value);
  if(/^(?:send|send it|send message|send the message|yes send|stuur|stuur dit|ja stuur|ja stuur dit)$/.test(phrase))return 'send';
  if(/^(?:cancel|do not send|don't send|stop|kanselleer|moenie stuur nie)$/.test(phrase))return 'cancel';
  return null;
 }
 function after(previous,current){
  const before=String(previous||'').trim();
  const all=String(current||'').trim();
  return all.startsWith(before)?all.slice(before.length).trim():'';
 }
 function rms(samples){
  if(!samples||!samples.length)return 0;
  let total=0;
  for(const sample of samples)total+=sample*sample;
  return Math.sqrt(total/samples.length);
 }
 function silenceClock(onIdle,delay=SILENCE_MS,timers={}){
  const schedule=timers.setTimeout||setTimeout,clear=timers.clearTimeout||clearTimeout;
  let id=null;
  return {
   activity(){
    if(id!==null)clear(id);
    id=schedule(()=>{id=null;onIdle();},delay);
   },
   stop(){if(id!==null){clear(id);id=null;}}
  };
 }
 return {SILENCE_MS,SEND_WINDOW_MS,MAX_RECORD_MS,tidy,command,after,rms,silenceClock};
});
