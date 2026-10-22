'use strict';
const SHELL='zippy-shell-v3-one-screen-reminders';const ASSETS=['/','/index.html','/style.css','/app.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).pathname.startsWith('/api/'))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok&&event.request.url.startsWith(self.location.origin)){const clone=response.clone();caches.open(SHELL).then(cache=>cache.put(event.request,clone));}return response;}).catch(()=>caches.match(event.request)));});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let payload={title:'Zippy reminder',body:'You have a personal reminder.',url:'/'};
  try{payload={...payload,...event.data.json()};}catch(_){}
  if(!payload.ownerEmail)return;
  let user=null;
  try{
   const response=await fetch('/api/me',{credentials:'include',cache:'no-store'});
   if(!response.ok)return;
   user=await response.json();
  }catch(_){return;}
  if(!user||!user.authenticated||String(user.email||'').toLowerCase()!==String(payload.ownerEmail||'').toLowerCase())return;
  await self.registration.showNotification(payload.title,{body:payload.body,
   tag:payload.tag||'zippy-reminder',icon:'/icons/icon-192.png',
   badge:'/icons/icon-192.png',silent:false,renotify:true,
   requireInteraction:true,vibrate:[250,140,250,140,350],
   data:{url:payload.url||'/'},actions:[{action:'open',title:'Open Zippy'}]});
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const win of windows){try{win.postMessage({type:'zippy-push',ownerEmail:payload.ownerEmail});}catch(_){}}
 })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const existing=clients.find(client=>client.url.startsWith(self.location.origin));if(existing){existing.focus();return existing.navigate('/');}return self.clients.openWindow('/');}));});
