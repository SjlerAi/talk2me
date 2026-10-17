'use strict';

// Read-only UAT-only Customer Centre attention rules.
// "No recorded contact" is not proof a call/WhatsApp outside the CRM did not happen.
const {plusDays,todayInSouthAfrica}=require('./uat-customer-filters');
const FOCUSES=['all','needs_attention','birthdays','contact','unallocated'];
const BIRTHDAYS=['today','tomorrow','this_week','this_month','missed'];
const CONTACTS=['no_record','no_recent','overdue'];
const UNALLOCATED=['customers','customer_work'];

const pick=(value,values,fallback)=>values.includes(String(value||''))?String(value):fallback;
function parseAttention(query,now=new Date()) {
  return {
    focus:pick(query.focus,FOCUSES,'all'),
    birthday:pick(query.birthday,BIRTHDAYS,'today'),
    contact:pick(query.contact,CONTACTS,'overdue'),
    unallocated:pick(query.unallocated,UNALLOCATED,'customers'),
    today:todayInSouthAfrica(now)
  };
}
function birthdayPeriod(kind,today) {
  const dayOfWeek=new Date(today+'T00:00:00Z').getUTCDay();
  const monday=plusDays(today,-((dayOfWeek+6)%7));
  const first=today.slice(0,7)+'-01';
  const monthEnd=plusDays(plusDays(first,32).slice(0,7)+'-01',-1);
  switch(kind) {
    case 'tomorrow':return {start:plusDays(today,1),end:plusDays(today,1)};
    case 'this_week':return {start:monday,end:plusDays(monday,6)};
    case 'this_month':return {start:first,end:monthEnd};
    case 'missed':return {start:plusDays(today,-7),end:plusDays(today,-1)};
    default:return {start:today,end:today};
  }
}
function birthdayDays(start,end,prefix,params) {
  const values=[];
  for(let day=start;day<=end;day=plusDays(day,1)){
    if(values.length>=40)throw Error('Birthday window exceeds supported range');
    const key=prefix+values.length;
    params[key]=day.slice(5);
    values.push(':'+key);
  }
  return "c.birthday IS NOT NULL AND DATE_FORMAT(c.birthday,'%m-%d') IN ("+values.join(',')+")";
}
function buildAttentionConditions(settings,{management,scope,staffId,unassignedClause}) {
  const {focus,birthday,contact,unallocated,today}=settings;
  // Preserve the original fast customer listing when no attention view is selected.
  if(focus==='all')return {clauses:[],params:{},projection:'',sort:null};
  const restricted=!management||scope!=='all';
  const params={attToday:today};
  if(restricted)params.attStaffId=staffId;
  const assignee=(alias,key='assigned_to')=>restricted?' AND '+alias+'.'+key+'=:attStaffId':'';
  const inquirer=restricted?' AND COALESCE(i.assigned_staff_id,i.staff_id)=:attStaffId':'';
  const active="c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'";
  const upgrade="c.next_upgrade_date IS NOT NULL AND c.next_upgrade_date<:attToday";
  const task="EXISTS (SELECT 1 FROM staff_tasks t WHERE t.related_client_id=c.id AND t.type='task' AND t.status IN ('unread','seen','in_progress') AND t.due_at<NOW()"+assignee('t')+")";
  const followup="EXISTS (SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='open' AND f.scheduled_at<NOW()"+assignee('f')+")";
  const callback="EXISTS (SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='scheduled' AND cb.scheduled_at<NOW()"+assignee('cb')+")";
  const inquiry="EXISTS (SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')"+inquirer+")";
  const overdueInquiry="EXISTS (SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND i.follow_up_at<NOW()"+inquirer+")";
  const unassigned=unassignedClause();
  const openWork='('+[
    "EXISTS (SELECT 1 FROM staff_tasks t WHERE t.related_client_id=c.id AND t.type='task' AND t.status IN ('unread','seen','in_progress')"+assignee('t')+")",
    "EXISTS (SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='open'"+assignee('f')+")",
    "EXISTS (SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='scheduled'"+assignee('cb')+")",
    inquiry
  ].join(' OR ')+')';
  // Birthday occurrence rolls over at New Year. A leap-day DOB is matched on Feb 29.
  const occurred="DATE_ADD(c.birthday, INTERVAL (YEAR(:attToday)-YEAR(c.birthday)-IF(DATE_FORMAT(c.birthday,'%m-%d')>DATE_FORMAT(:attToday,'%m-%d'),1,0)) YEAR)";
  // Completed CRM contact / existing Gerda Agent birthday completion only, never a plain inquiry.
  const birthdayEvidence='('+[
    "EXISTS (SELECT 1 FROM customer_followups bdf WHERE bdf.client_id=c.id AND bdf.status='completed' AND DATE(COALESCE(bdf.completed_at,bdf.created_at)) BETWEEN "+occurred+" AND :attToday)",
    "EXISTS (SELECT 1 FROM customer_callbacks bdc WHERE bdc.client_id=c.id AND bdc.status='completed' AND DATE(COALESCE(bdc.completed_at,bdc.created_at)) BETWEEN "+occurred+" AND :attToday)",
    "EXISTS (SELECT 1 FROM inquiries bdi WHERE bdi.client_id=c.id AND bdi.status IN ('resolved','completed') AND NULLIF(TRIM(bdi.action_taken),'') IS NOT NULL AND DATE(COALESCE(bdi.completed_at,bdi.updated_at,bdi.created_at)) BETWEEN "+occurred+" AND :attToday)",
    "EXISTS (SELECT 1 FROM agent_responsibility_checks bdr WHERE bdr.source_type='birthday' AND bdr.source_key=CONCAT('client:',c.id) AND bdr.status='completed' AND bdr.work_date BETWEEN "+occurred+" AND :attToday)"
  ].join(' OR ')+')';
  const selectedPeriod=birthdayPeriod(birthday,today);
  const selectedBirthdayDays=birthdayDays(selectedPeriod.start,selectedPeriod.end,'attSelectedBd',params);
  const selectedBirthday='('+selectedBirthdayDays+(birthday==='missed'?' AND NOT '+birthdayEvidence:'')+')';
  const recentBirthday='('+birthdayDays(plusDays(today,-7),today,'attRecentBd',params)+' AND NOT '+birthdayEvidence+')';

  function contactEvidence(recent) {
    const timed=(alias,date)=>recent?' AND DATE('+date+')>=:attRecentFrom':'';
    return '('+[
      "EXISTS (SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='completed'"+timed('f','COALESCE(f.completed_at,f.created_at)')+")",
      "EXISTS (SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='completed'"+timed('cb','COALESCE(cb.completed_at,cb.created_at)')+")",
      "EXISTS (SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND NULLIF(TRIM(i.action_taken),'') IS NOT NULL"+timed('i','COALESCE(i.completed_at,i.updated_at,i.created_at)')+")"
    ].join(' OR ')+')';
  }
  params.attRecentFrom=plusDays(today,-29);
  const missingContact='NOT '+contactEvidence(false);
  const noRecentContact='NOT '+contactEvidence(true);
  const overdueContact='('+[followup,callback,overdueInquiry].join(' OR ')+')';
  const needsAttention='('+[followup,callback,task,overdueInquiry,inquiry,upgrade,recentBirthday,unassigned].join(' OR ')+')';

  const clauses=[];
  if(focus==='needs_attention')clauses.push('('+active+' AND '+needsAttention+')');
  if(focus==='birthdays')clauses.push('('+active+' AND '+selectedBirthday+')');
  if(focus==='contact')clauses.push('('+active+' AND '+({no_record:missingContact,no_recent:noRecentContact,overdue:overdueContact}[contact])+')');
  if(focus==='unallocated')clauses.push('('+active+' AND '+unassigned+(unallocated==='customer_work'?' AND '+openWork:'')+')');

  let projection='';
  let sort=null;
  if(focus==='needs_attention'){
    projection=[
      'CASE WHEN '+followup+' THEN 1 ELSE 0 END att_followup',
      'CASE WHEN '+callback+' THEN 1 ELSE 0 END att_callback',
      'CASE WHEN '+task+' THEN 1 ELSE 0 END att_task',
      'CASE WHEN '+overdueInquiry+' THEN 1 ELSE 0 END att_inquiry_overdue',
      'CASE WHEN '+inquiry+' THEN 1 ELSE 0 END att_inquiry',
      'CASE WHEN '+upgrade+' THEN 1 ELSE 0 END att_upgrade',
      'CASE WHEN '+recentBirthday+' THEN 1 ELSE 0 END att_birthday',
      'CASE WHEN '+unassigned+' THEN 1 ELSE 0 END att_unassigned'
    ].join(', ');
    sort='att_followup DESC,att_callback DESC,att_task DESC,att_inquiry_overdue DESC,att_inquiry DESC,att_upgrade DESC,att_birthday DESC,att_unassigned DESC,c.client_name ASC,c.id ASC';
  }
  if(focus==='unallocated'&&unallocated==='customer_work')projection='CASE WHEN '+openWork+' THEN 1 ELSE 0 END att_open_work';
  return {clauses,params,projection,sort};
}
function reasonLabels(row,settings){
  if(settings.focus==='birthdays')return settings.birthday==='missed'?['Birthday follow-up not recorded']:['Customer birthday'];
  if(settings.focus==='contact')return [{
    no_record:'No CRM contact action recorded',no_recent:'No recorded follow-up in 30 days',overdue:'Contact follow-up overdue'
  }[settings.contact]];
  if(settings.focus==='unallocated')return settings.unallocated==='customer_work'
    ?['Customer has no owner','Open work linked to customer']:['Customer has no owner'];
  if(settings.focus!=='needs_attention')return [];
  return [
    row.att_followup?'Overdue follow-up':null,
    row.att_callback?'Overdue callback':null,
    row.att_task?'Overdue task':null,
    row.att_inquiry_overdue?'Overdue inquiry':row.att_inquiry?'Open inquiry':null,
    row.att_upgrade?'Upgrade overdue':null,
    row.att_birthday?'Birthday contact not recorded':null,
    row.att_unassigned?'No customer owner':null
  ].filter(Boolean);
}
module.exports={parseAttention,birthdayPeriod,buildAttentionConditions,reasonLabels};
