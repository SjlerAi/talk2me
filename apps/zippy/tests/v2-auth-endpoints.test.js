'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('Conversation history and audio transcription refuse unauthenticated requests',async()=>{
 const {app}=require('../server');
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const history=await fetch(base+'/api/conversation');
  assert.equal(history.status,401);
  const audio=await fetch(base+'/api/voice/transcribe',{method:'POST',
   headers:{'Content-Type':'audio/webm','X-Zippy-Action':'1'},body:Buffer.alloc(512,10)});
  assert.equal(audio.status,401);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
