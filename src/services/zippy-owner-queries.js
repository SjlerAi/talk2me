'use strict';
// Bounded, read-only CRM answers for Zippy, never arbitrary SQL.
// All access is still checked at the signed owner-only bridge.
const pad=n=>String(n).padStart(2,'0');
function todaySA(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function monthBounds(month,now=new Date()){
 const choice=/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month||''))?String(month):todaySA(now).slice(0,7);
 const year=Number(choice.slice(0,4)),m=Number(choice.slice(5));
 return {month:choice,from:choice+'-01',to:m===12?(year+1)+'-01-01':year+'-'+pad(m+1)+'-01'};
}
const clean=s=>String(s||'').trim().slice(0,160);
async function lookupOwnerCrm(db,{intent,month,staff,language}={},now=new Date()){
 const af=language==='af-ZA',date=todaySA(now),source='Talk2Me CRM';
 if(intent==='birthdays'){
  const sql=[
   'SELECT c.id,c.client_name,c.cell_number,c.account_number,',
   '(SELECT su.first_name FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id',
   " WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))",
   ' ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) assigned_staff',
   'FROM clients c WHERE c.is_active=1 AND COALESCE(c.line_status,\'active\')<>\'cancelled\'',
   "AND c.birthday IS NOT NULL AND DATE_FORMAT(c.birthday,'%m-%d')=:monthDay",
   'ORDER BY c.client_name,c.id LIMIT 31'
  ].join(' ');
  const [rows]=await db.execute(sql,{monthDay:date.slice(5)});
  const more=rows.length>30,shown=rows.slice(0,30);
  const details=shown.map(r=>clean(r.client_name)+(r.cell_number?' · '+clean(r.cell_number):'')+
   (r.assigned_staff?' ('+clean(r.assigned_staff)+')':'')).join('\n');
  const intro=af?'Ek het '+shown.length+' verjaarsdaginskrywings vir vandag in Talk2Me gevind.':
   'I found '+shown.length+' customer birthday records for today in Talk2Me.';
  return {intent,source,asOf:date,count:shown.length,more,
   text:intro+(details?'\n'+details:'')+(more?(af?'\nDaar is nog inskrywings.':'\nMore records exist.'):'')};
 }
 if(intent==='attendance'){
  const sql=[
   'SELECT su.id,su.first_name,su.role,',
   '(SELECT MIN(a.clock_in_at) FROM attendance_sessions a',
   'WHERE a.staff_id=su.id AND a.work_date=:workDay) AS clock_in_at,',
   '(SELECT MAX(l.login_at) FROM staff_login_sessions l',
   'WHERE l.staff_id=su.id AND l.login_at>=:startAt AND l.login_at<:endAt) AS login_at',
   "FROM staff_users su WHERE su.is_active=1 AND su.role IN ('staff','manager')",
   'ORDER BY su.first_name,su.id LIMIT 41'
  ].join(' ');
  const [rows]=await db.execute(sql,{workDay:date,startAt:date+' 00:00:00',endAt:date+' 23:59:59'});
  const more=rows.length>40,shown=rows.slice(0,40),missing=shown.filter(r=>!r.clock_in_at&&!r.login_at).length;
  const details=shown.map(r=>clean(r.first_name)+': '+
   (r.clock_in_at?(af?'Inklok aangeteken':'Clock-in recorded'):
    r.login_at?(af?'Aanmelding aangeteken; geen inklok':'Login recorded; no clock-in'):
    af?'Geen CRM-aanmelding of inklok aangeteken':'No CRM login or clock-in recorded')).join('\n');
  const intro=af?'Talk2Me se personeelaanwesigheidsrekords vir vandag:':'Talk2Me staff attendance records for today:';
  const qualifier=af?' Geen rekord bewys nie iemand was afwesig nie.':' Missing records do not prove someone was absent.';
  return {intent,source,asOf:date,count:shown.length,withoutEvidence:missing,more,
   text:intro+(details?'\n'+details:'')+qualifier};
 }
 if(intent==='upgrades'){
  const range=monthBounds(month,now);
  const name=String(staff||'').toLowerCase().replace(/[^a-z]/g,'').slice(0,30);
  const params={from:range.from,to:range.to};
  let staffWhere='';
  if(name){
   params.staff=name;
   staffWhere=[
    ' AND EXISTS (SELECT 1 FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id',
    "WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))",
    'AND LOWER(su.first_name)=:staff)'
   ].join(' ');
  }
  const sql=[
   'SELECT c.id,c.client_name,c.cell_number,c.account_number,c.next_upgrade_date',
   "FROM clients c WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'",
   'AND c.next_upgrade_date>=:from AND c.next_upgrade_date<:to'
  ].join(' ')+staffWhere+' ORDER BY c.next_upgrade_date ASC,c.client_name ASC LIMIT 31';
  const [rows]=await db.execute(sql,params);
  const more=rows.length>30,shown=rows.slice(0,30);
  const details=shown.map(r=>clean(r.client_name)+' · '+String(r.next_upgrade_date).slice(0,10)+
   (r.account_number?' · '+clean(r.account_number):'')).join('\n');
  const head=af?'Talk2Me-opgraderings vir '+range.month+': ':'Talk2Me upgrades for '+range.month+': ';
  return {intent,source,asOf:date,month:range.month,count:shown.length,more,
   text:head+shown.length+(name?' · '+clean(name):'')+(details?'\n'+details:'')+
    (more?(af?'\nMeer resultate is beskikbaar in die CRM.':'\nMore results are available in the CRM.'):'')};
 }
 throw Object.assign(Error('Unsupported CRM question'),{status:400});
}
module.exports={lookupOwnerCrm,todaySA,monthBounds};
