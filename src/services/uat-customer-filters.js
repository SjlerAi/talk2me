'use strict';

// Read-only, UAT-only Customer Centre filter helpers.
// Dates are calculated in the office's business timezone, not the browser's timezone.
const CHOICES = Object.freeze({
  work: ['all','upgrades','tasks','followups'],
  status: ['all','outstanding','overdue','completed'],
  date: ['any','today','this_week','next_week','next_7','next_14','next_30','custom'],
  sort: ['recent','name_asc','name_desc','new_work','upgrade_soon']
});

const pick = (value, values, fallback) => values.includes(String(value || '')) ? String(value) : fallback;
const validDay = value => {
  const valueText = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) &&
    !Number.isNaN(Date.parse(valueText + 'T00:00:00Z')) &&
    new Date(valueText + 'T00:00:00Z').toISOString().slice(0,10) === valueText;
};
function plusDays(day, count) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0,10);
}
function todayInSouthAfrica(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB',{
    timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return value.year + '-' + value.month + '-' + value.day;
}
function monthBounds(month) {
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y,m] = month.split('-').map(Number);
  return { start:month+'-01', end:(m===12 ? y+1 : y)+'-'+String(m===12?1:m+1).padStart(2,'0')+'-01' };
}
function normaliseFilters(query, now = new Date()) {
  const str = (v,max=130) => String(Array.isArray(v)?v[0]:(v||'')).trim().slice(0,max);
  const f = {
    q:str(query.q,120),
    work:pick(query.work,CHOICES.work,'all'),
    status:pick(query.status,CHOICES.status,'all'),
    date:pick(query.date,CHOICES.date,'any'),
    sort:pick(query.sort,CHOICES.sort,'recent'),
    month:str(query.upgrade_month,7),
    from:str(query.from,10),
    to:str(query.to,10),
    requestedPage:Math.min(100000,Math.max(1,parseInt(str(query.page,7),10)||1)),
    dateWindow:null,
    error:null
  };
  if (f.work==='upgrades') f.status='all'; // Upgrade eligibility has no task status.
  if (f.month && !monthBounds(f.month)) f.error='Choose a valid upgrade month and year.';
  const today=todayInSouthAfrica(now);
  const dayOfWeek=new Date(today+'T00:00:00Z').getUTCDay();
  const thisMonday=plusDays(today,-((dayOfWeek+6)%7));
  const periods={
    today:[today,today],
    this_week:[thisMonday,plusDays(thisMonday,6)],
    next_week:[plusDays(thisMonday,7),plusDays(thisMonday,13)],
    next_7:[today,plusDays(today,6)],
    next_14:[today,plusDays(today,13)],
    next_30:[today,plusDays(today,29)]
  };
  if (f.date==='custom') {
    if (!validDay(f.from) || !validDay(f.to) || f.from>f.to) {
      f.error='Choose a valid custom start and end date.';
    } else f.dateWindow={from:f.from,to:f.to};
  } else if (periods[f.date]) {
    f.dateWindow={from:periods[f.date][0],to:periods[f.date][1]};
  }
  return f;
}
function dateCondition(column, filters) {
  return filters.dateWindow ? `(${column} >= :workFrom AND ${column} < DATE_ADD(:workTo,INTERVAL 1 DAY))` : '';
}
function buildWorkConditions(filters, { management, scope, staffId }) {
  const workStaffRestricted=!management || scope!=='all';
  const staffFilter=(alias)=>workStaffRestricted ? ` AND ${alias}.assigned_to=:workStaffId` : '';
  const params=workStaffRestricted ? {workStaffId:staffId} : {};
  if (filters.dateWindow) { params.workFrom=filters.dateWindow.from;params.workTo=filters.dateWindow.to; }
  const requiredStatus=filters.status;
  const makeTask=()=>{
    let where="t.related_client_id=c.id AND t.type='task' AND t.status<>'cancelled'"+staffFilter('t');
    if(requiredStatus==='outstanding'||requiredStatus==='overdue') where+=" AND t.status IN ('unread','seen','in_progress')";
    if(requiredStatus==='completed') where+=" AND t.status='completed'";
    if(requiredStatus==='overdue') where+=" AND t.due_at<NOW()";
    const dueDate=requiredStatus==='completed' ? 'COALESCE(t.completed_at,t.updated_at)' : 't.due_at';
    const timeSql=dateCondition(dueDate,filters);
    if(timeSql) where+=' AND '+timeSql;
    return 'EXISTS (SELECT 1 FROM staff_tasks t WHERE '+where+')';
  };
  const makeFollowup=(table,alias,openState)=>{
    let where=alias+'.client_id=c.id'+staffFilter(alias);
    if(requiredStatus==='outstanding'||requiredStatus==='overdue') where+=" AND "+alias+".status='"+openState+"'";
    else if(requiredStatus==='completed') where+=" AND "+alias+".status='completed'";
    else where+=" AND "+alias+".status<>'cancelled' AND "+alias+".status<>'archived'";
    if(requiredStatus==='overdue') where+=' AND '+alias+'.scheduled_at<NOW()';
    const dateCol=requiredStatus==='completed' ? 'COALESCE('+alias+'.completed_at,'+alias+'.scheduled_at)' : alias+'.scheduled_at';
    const timeSql=dateCondition(dateCol,filters);
    if(timeSql) where+=' AND '+timeSql;
    return 'EXISTS (SELECT 1 FROM '+table+' '+alias+' WHERE '+where+')';
  };
  const makeUpgrade=()=>{
    let condition="c.next_upgrade_date IS NOT NULL AND c.line_status<>'cancelled'";
    const timeSql=dateCondition('c.next_upgrade_date',filters);
    if(timeSql) condition+=' AND '+timeSql;
    return '('+condition+')';
  };
  const clauses=[];
  // A month always restricts to lines with an actual NEXT upgrade date.
  if(filters.month) {
    const bounds=monthBounds(filters.month);
    if(bounds) {params.monthFrom=bounds.start;params.monthTo=bounds.end;
      clauses.push("c.next_upgrade_date >= :monthFrom AND c.next_upgrade_date < :monthTo AND c.line_status<>'cancelled'");
    }
  }
  if(filters.work!=='all' || filters.dateWindow || requiredStatus!=='all') {
    const candidates=[];
    if((filters.work==='all' || filters.work==='upgrades') && requiredStatus==='all') candidates.push(makeUpgrade());
    if(filters.work==='all' || filters.work==='tasks') candidates.push(makeTask());
    if(filters.work==='all' || filters.work==='followups') {
      candidates.push(makeFollowup('customer_followups','f','open'));
      candidates.push(makeFollowup('customer_callbacks','cb','scheduled'));
    }
    clauses.push('('+candidates.join(' OR ')+')');
  }
  let join='';
  if(filters.sort==='new_work') {
    const condition=workStaffRestricted?' WHERE assigned_to=:workStaffId':'';
    join=` LEFT JOIN (
      SELECT items.client_id,MAX(items.created_on) latest_at
      FROM (
        SELECT related_client_id client_id,created_at created_on FROM staff_tasks ${condition ? condition+' AND' : ' WHERE'} type='task' AND related_client_id IS NOT NULL
        UNION ALL SELECT client_id,created_at FROM customer_followups ${condition}
        UNION ALL SELECT client_id,created_at FROM customer_callbacks ${condition}
      ) items GROUP BY items.client_id
    ) latest_work ON latest_work.client_id=c.id`;
  }
  const sort={
    recent:"COALESCE(c.updated_at,c.created_at) DESC,c.id DESC",
    name_asc:"c.client_name ASC,c.id ASC",
    name_desc:"c.client_name DESC,c.id DESC",
    new_work:"(latest_work.latest_at IS NULL) ASC,latest_work.latest_at DESC,c.id DESC",
    upgrade_soon:"(c.next_upgrade_date IS NULL) ASC,c.next_upgrade_date ASC,c.client_name ASC,c.id ASC"
  }[filters.sort];
  return { clauses, params, join, sort };
}
module.exports={ normaliseFilters,buildWorkConditions,monthBounds,todayInSouthAfrica,plusDays,validDay };
