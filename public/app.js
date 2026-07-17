const $=s=>document.querySelector(s), tokenKey='pest_token'; let token=localStorage.getItem(tokenKey)||'', state={}, noticeTimer;
async function api(url,opt={}){opt.headers={...(opt.headers||{}),'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})};const r=await fetch(url,opt);const d=await r.json().catch(()=>({success:false,message:'Invalid server response'}));if(r.status===401){logout();throw Error('Session expired');}if(!r.ok)throw Error(d.message||'Request failed');return d}
function showHome(v){$('#login').classList.toggle('hidden',v);$('#home').classList.toggle('hidden',!v)}
function geo(){return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy_meters:p.coords.accuracy}),e=>reject(Error(e.message)),{enableHighAccuracy:true,timeout:20000,maximumAge:0}):reject(Error('GPS is not available')))}
function flashAction(message,type='success'){
  clearTimeout(noticeTimer);
  const el=$('#actionNotice');
  el.textContent=message;
  el.className=`action-notice ${type}`;
  noticeTimer=setTimeout(()=>{el.className='action-notice hidden';el.textContent=''},3000);
}
async function load(){
  const [w,s]=await Promise.all([api('/api/my-worksite'),api('/api/attendance/status')]);
  state=s;$('#worksite').textContent=w.worksite?.name||'Not assigned';
  const open=!!s.open_session;
  $('#clockIn').disabled=open;$('#clockOut').disabled=!open;
  document.querySelectorAll('.lunch button').forEach(b=>{
    const selected=Number(b.dataset.min)===Number(s.working_lunch_minutes);
    b.disabled=!open||Number(s.working_lunch_minutes)>0;
    b.classList.toggle('selected',selected);
  });
  $('#msg').textContent=s.working_lunch_minutes?`Work lunch selected: ${s.working_lunch_minutes} minutes`:'';
  showHome(true);
}
$('#loginBtn').onclick=async()=>{try{$('#loginMsg').textContent='Logging in…';const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({identifier:$('#identifier').value.trim(),password:$('#password').value})});token=d.token;localStorage.setItem(tokenKey,token);$('#loginMsg').textContent='';await load()}catch(e){$('#loginMsg').textContent=e.message}};
$('#clockIn').onclick=async()=>{try{$('#msg').textContent='Getting GPS…';const p=await geo();const d=await api('/api/attendance/clock-in',{method:'POST',body:JSON.stringify(p)});$('#msg').textContent='';await load();flashAction(d.message||'Clocked in','success')}catch(e){$('#msg').textContent=e.message}};
$('#clockOut').onclick=async()=>{try{$('#msg').textContent='Getting GPS…';const p=await geo();const d=await api('/api/attendance/clock-out',{method:'POST',body:JSON.stringify(p)});$('#msg').textContent='';await load();flashAction(d.message||'Clocked out','out')}catch(e){$('#msg').textContent=e.message}};
document.querySelectorAll('.lunch button').forEach(b=>b.onclick=async()=>{try{$('#msg').textContent='Saving work lunch…';const p=await geo().catch(()=>({}));const minutes=Number(b.dataset.min);const d=await api('/api/attendance/working-lunch',{method:'POST',body:JSON.stringify({...p,worked_minutes:minutes})});await load();$('#msg').textContent=`Work lunch selected: ${minutes} minutes`;flashAction(d.message||'Work lunch saved','success')}catch(e){$('#msg').textContent=e.message}});
function logout(){token='';localStorage.removeItem(tokenKey);showHome(false)}
$('#logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'}).catch(()=>{});logout()};
window.addEventListener('online',()=>$('#sync').textContent='Online');window.addEventListener('offline',()=>$('#sync').textContent='Offline — a connection is required');
if(token)load().catch(()=>logout());else showHome(false);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js?v=2.1.1');
