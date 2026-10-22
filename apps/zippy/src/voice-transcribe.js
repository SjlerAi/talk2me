'use strict';
// Stateless, on-demand speech transcription. No audio is saved on this server.
// Requires HTTPS, an authenticated Zippy owner, and an explicitly enabled API.
const MAX_BYTES=4*1024*1024;
const MIME_EXT={'audio/webm':'webm','audio/mp4':'mp4','audio/ogg':'ogg','audio/wav':'wav','audio/mpeg':'mp3'};
const calls=new Map();
function apiKey(){return process.env.ZIPPY_STT_API_KEY||process.env.ZIPPY_AI_API_KEY||process.env.OPENAI_API_KEY||'';}
function available(){return process.env.ZIPPY_STT_ENABLED==='1'&&Boolean(apiKey());}
function validateAudio(contentType,bytes){
 const mime=String(contentType||'').split(';')[0].trim().toLowerCase();
 if(!Object.hasOwn(MIME_EXT,mime))return {ok:false,error:'This audio recording format is not supported.'};
 if(!Number.isSafeInteger(bytes)||bytes<200||bytes>MAX_BYTES)return {ok:false,error:'Please record a short message, up to 4 MB.'};
 return {ok:true,mime,extension:MIME_EXT[mime]};
}
function allow(owner){
 const key=String(owner||'').toLowerCase(),now=Date.now();
 const recent=(calls.get(key)||[]).filter(time=>now-time<60000);
 if(recent.length>=5)return false;
 recent.push(now);calls.set(key,recent);
 if(calls.size>200)for(const [k,v] of calls)if(!v.some(t=>now-t<60000))calls.delete(k);
 return true;
}
async function transcribe(buffer,contentType,{language='auto',fetcher=fetch}={}){
 if(!available())throw Object.assign(Error('Multilingual transcription is not enabled on this server.'),{status:503});
 const validation=validateAudio(contentType,buffer?.length);
 if(!validation.ok)throw Object.assign(Error(validation.error),{status:400});
 const body=new FormData();
 body.append('file',new Blob([buffer],{type:validation.mime}),'zippy-recording.'+validation.extension);
 body.append('model',process.env.ZIPPY_STT_MODEL||'gpt-4o-mini-transcribe');
 body.append('response_format','json');
 // No language override in automatic mode: the provider must detect it.
 if(language==='af-ZA')body.append('language','af');
 if(language==='en-ZA')body.append('language','en');
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),20000);
 try{
  const response=await fetcher('https://api.openai.com/v1/audio/transcriptions',{
   method:'POST',headers:{Authorization:'Bearer '+apiKey()},body,signal:ctrl.signal
  });
  if(!response.ok)throw Object.assign(Error('Speech transcription is temporarily unavailable.'),{status:502});
  const data=await response.json();
  const text=String(data?.text||'').trim().slice(0,2500);
  if(!text)throw Object.assign(Error('I could not make out the words. Please try again or type them.'),{status:422});
  return {text};
 }finally{clearTimeout(timer);}
}
module.exports={available,validateAudio,allow,transcribe,MAX_BYTES};
