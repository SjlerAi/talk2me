'use strict';

const db = require('../config/db');
const { sendAgentInstruction } = require('./office-intelligence-agent');

const ACTIVE_TASK = "('unread','seen','in_progress')";
const OPEN_INQUIRY = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const MAX_RESULTS = 100;
const MAX_BATCH_TASKS = 50;

function clean(value, max = 5000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function lower(value) {
  return clean(value, 5000).toLowerCase();
}

function sqlDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sqlDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:00`;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function addMonths(date, amount) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + amount);
  return d;
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parsePeriod(message) {
  const q = lower(message);
  const now = new Date();
  let start = startOfDay(now);
  let end = endOfDay(now);
  let label = 'today';

  const months = q.match(/(?:last|past|previous)\s+(\d{1,2})\s+months?/);
  const weeks = q.match(/(?:last|past|previous)\s+(\d{1,2})\s+weeks?/);
  const days = q.match(/(?:last|past|previous)\s+(\d{1,3})\s+days?/);

  if (months) {
    start = startOfDay(addMonths(now, -Math.min(Number(months[1]), 24)));
    label = `the last ${Number(months[1])} months`;
  } else if (weeks) {
    start = startOfDay(addDays(now, -Math.min(Number(weeks[1]) * 7, 730)));
    label = `the last ${Number(weeks[1])} weeks`;
  } else if (days) {
    start = startOfDay(addDays(now, -Math.min(Number(days[1]), 730)));
    label = `the last ${Number(days[1])} days`;
  } else if (/last\s+month|past\s+month|previous\s+month/.test(q)) {
    start = startOfDay(addMonths(now, -1));
    label = 'the last month';
  } else if (/last\s+week|past\s+week|previous\s+week/.test(q)) {
    start = startOfDay(addDays(now, -7));
    label = 'the last week';
  } else if (/yesterday/.test(q)) {
    start = startOfDay(addDays(now, -1));
    end = endOfDay(addDays(now, -1));
    label = 'yesterday';
  } else if (/this\s+week/.test(q)) {
    const weekday = (now.getDay() + 6) % 7;
    start = startOfDay(addDays(now, -weekday));
    label = 'this week';
  } else if (/this\s+month/.test(q)) {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    label = 'this month';
  } else if (/last\s+year|past\s+year|previous\s+year/.test(q)) {
    start = startOfDay(addMonths(now, -12));
    label = 'the last year';
  } else if (/today/.test(q)) {
    label = 'today';
  } else {
    start = startOfDay(addMonths(now, -6));
    label = 'the last 6 months';
  }

  return { start, end, startSql: sqlDate(start), endSql: sqlDate(end), label };
}

function nextWeekday(target, base = new Date()) {
  const d = new Date(base);
  const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function parseDueAt(message) {
  const q = lower(message);
  const now = new Date();
  let due = null;

  if (/tomorrow/.test(q)) due = addDays(now, 1);
  const weekdayMap = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  for (const [name, day] of Object.entries(weekdayMap)) {
    if (q.includes(name)) {
      due = nextWeekday(day, now);
      break;
    }
  }

  const dateMatch = q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (dateMatch) due = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));

  if (!due) return null;

  const timeMatch = q.match(/\b([01]?\d|2[0-3])(?::|h)([0-5]\d)\b/) || q.match(/\b([01]?\d|2[0-3])\s*(?:am|pm)\b/);
  let hour = 16;
  let minute = 0;
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    if (/pm\b/.test(timeMatch[0]) && hour < 12) hour += 12;
    if (/am\b/.test(timeMatch[0]) && hour === 12) hour = 0;
  }
  due.setHours(hour, minute, 0, 0);
  return sqlDateTime(due);
}

async function activeStaff() {
  const [rows] = await db.execute(`SELECT id,full_name,email,username,role
    FROM staff_users WHERE is_active=1 ORDER BY full_name`);
  return rows;
}

function scoreNameMatch(message, staff) {
  const q = lower(message);
  const values = [staff.full_name, staff.username, staff.email && String(staff.email).split('@')[0]]
    .filter(Boolean).map(v => lower(v));
  let score = 0;
  for (const value of values) {
    if (!value) continue;
    if (q.includes(value)) score = Math.max(score, value.length + 20);
    for (const token of value.split(/[^a-z0-9]+/).filter(t => t.length >= 3)) {
      if (q.includes(token)) score = Math.max(score, token.length);
    }
  }
  return score;
}

async function resolveStaff(message, fallbackId = null) {
  const staff = await activeStaff();
  let best = null;
  let bestScore = 0;
  for (const row of staff) {
    const score = scoreNameMatch(message, row);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  if (best) return best;
  if (fallbackId) return staff.find(row => Number(row.id) === Number(fallbackId)) || null;
  return null;
}

function resultState(kind, rows, staff, extra = {}) {
  return {
    selection: {
      kind,
      staffId: staff ? Number(staff.id) : null,
      staffName: staff ? (staff.full_name || staff.username || staff.email) : null,
      items: rows.slice(0, MAX_BATCH_TASKS).map(row => ({
        id: Number(row.id || row.client_id || row.item_id || 0) || null,
        clientId: Number(row.client_id || row.id || 0) || null,
        title: clean(row.title || row.client_name || row.customer_name || row.primary_text || 'Item', 180),
        detail: clean(row.detail || row.package_name || row.reason || row.query_text || row.status || '', 600),
        dueAt: row.due_at || row.next_upgrade_date || row.follow_up_at || row.scheduled_at || null
      })),
      ...extra
    }
  };
}

async function queryUpgrades(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ' AND ca.assigned_staff_id=:staffId';
  }

  const [rows] = await db.execute(`SELECT DISTINCT c.id,c.id client_id,c.client_name,c.cell_number,c.account_number,c.package_name,
      c.next_upgrade_date,ca.assigned_staff_id,COALESCE(s.full_name,'Unassigned') staff_name,
      DATEDIFF(CURRENT_DATE(),DATE(c.next_upgrade_date)) days_overdue
    FROM clients c
    LEFT JOIN client_assignments ca ON ca.is_active=1
      AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
    LEFT JOIN staff_users s ON s.id=ca.assigned_staff_id
    WHERE c.is_active=1
      AND COALESCE(c.line_status,'active')<>'cancelled'
      AND c.next_upgrade_date IS NOT NULL
      AND DATE(c.next_upgrade_date) BETWEEN :start AND :end
      AND DATE(c.next_upgrade_date)<=CURRENT_DATE()
      ${staffSql}
    ORDER BY c.next_upgrade_date ASC,c.client_name ASC
    LIMIT ${MAX_RESULTS}`, params);

  const older90 = rows.filter(row => Number(row.days_overdue || 0) > 90).length;
  const person = staff ? ` for ${staff.full_name || staff.username}` : '';
  const text = rows.length
    ? `I found ${rows.length} outstanding upgrade${rows.length === 1 ? '' : 's'}${person} in ${period.label}. ${older90 ? `${older90} are more than 90 days overdue.` : 'None are more than 90 days overdue.'}`
    : `I could not find any outstanding upgrades${person} in ${period.label}.`;

  return {
    intent:'upgrades',
    text,
    rows: rows.slice(0, 20).map(row => ({
      id:row.id,
      title:row.client_name || 'Customer',
      detail:[row.package_name,row.cell_number,row.staff_name].filter(Boolean).join(' · '),
      meta:row.next_upgrade_date ? `Due ${sqlDate(row.next_upgrade_date)}` : ''
    })),
    actions: rows.length ? ['show_all','create_tasks','open_agent'] : ['open_agent'],
    state: resultState('upgrade', rows, staff, { period })
  };
}

async function queryBirthdays(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ' AND ca.assigned_staff_id=:staffId';
  }

  const years = [];
  for (let y = period.start.getFullYear(); y <= period.end.getFullYear(); y += 1) years.push(y);
  const all = [];

  for (const year of years) {
    const occurrence = `STR_TO_DATE(CONCAT(${Number(year)},'-',DATE_FORMAT(c.birthday,'%m-%d')),'%Y-%m-%d')`;
    const [rows] = await db.execute(`SELECT DISTINCT c.id,c.id client_id,c.client_name,c.cell_number,c.account_number,
        ca.assigned_staff_id,COALESCE(s.full_name,'Unassigned') staff_name,${occurrence} birthday_occurrence,
        CASE WHEN
          EXISTS(SELECT 1 FROM inquiries i
            WHERE (i.client_id=c.id OR (COALESCE(i.cell_number,'')<>'' AND i.cell_number=c.cell_number))
              AND DATE(COALESCE(i.completed_at,i.updated_at,i.created_at))
                BETWEEN ${occurrence} AND DATE_ADD(${occurrence},INTERVAL 7 DAY))
          OR EXISTS(SELECT 1 FROM customer_followups f
            WHERE f.client_id=c.id AND f.status='completed'
              AND DATE(COALESCE(f.completed_at,f.updated_at,f.created_at))
                BETWEEN ${occurrence} AND DATE_ADD(${occurrence},INTERVAL 7 DAY))
          OR EXISTS(SELECT 1 FROM agent_responsibility_checks r
            WHERE r.staff_id=ca.assigned_staff_id AND r.source_type='birthday'
              AND r.source_key=CAST(c.id AS CHAR) AND r.status='completed'
              AND r.work_date BETWEEN ${occurrence} AND DATE_ADD(${occurrence},INTERVAL 7 DAY))
          THEN 1 ELSE 0 END followed_up
      FROM clients c
      LEFT JOIN client_assignments ca ON ca.is_active=1
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      LEFT JOIN staff_users s ON s.id=ca.assigned_staff_id
      WHERE c.is_active=1 AND c.birthday IS NOT NULL
        AND ${occurrence} BETWEEN :start AND :end
        ${staffSql}
      ORDER BY birthday_occurrence,c.client_name
      LIMIT ${MAX_RESULTS}`, params);
    all.push(...rows);
  }

  const q = lower(message);
  const unresolvedOnly = /not\s+(?:been\s+)?followed|not\s+followed|hasn'?t\s+been\s+followed|outstanding|missed/.test(q);
  const selected = unresolvedOnly ? all.filter(row => !Number(row.followed_up)) : all;
  const notDone = all.filter(row => !Number(row.followed_up));
  const person = staff ? ` for ${staff.full_name || staff.username}` : '';

  let text;
  if (unresolvedOnly) {
    text = selected.length
      ? `I found ${selected.length} birthday follow-up${selected.length === 1 ? '' : 's'} still outstanding${person} in ${period.label}.`
      : `I could not find any birthday follow-ups still outstanding${person} in ${period.label}.`;
  } else {
    text = `There were ${all.length} customer birthdays${person} in ${period.label}. ${all.length - notDone.length} show follow-up evidence and ${notDone.length} still need attention.`;
  }

  const grouped = {};
  for (const row of notDone) grouped[row.staff_name || 'Unassigned'] = (grouped[row.staff_name || 'Unassigned'] || 0) + 1;
  const rowsForUi = selected.slice(0, 20).map(row => ({
    id:row.id,
    title:row.client_name || 'Customer',
    detail:[row.staff_name,row.cell_number,Number(row.followed_up) ? 'Followed up' : 'Not followed up'].filter(Boolean).join(' · '),
    meta:sqlDate(row.birthday_occurrence)
  }));

  return {
    intent:'birthdays',
    text,
    rows:rowsForUi,
    grouped,
    actions:selected.length ? ['show_all','create_tasks','open_agent'] : ['open_agent'],
    state:resultState('birthday', selected, staff, { period })
  };
}

async function queryTasks(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const q = lower(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ' AND t.assigned_to=:staffId';
  }
  let condition = `t.status IN ${ACTIVE_TASK}`;
  if (/completed|done|finished/.test(q) && !/not\s+completed|not\s+done|unfinished|outstanding/.test(q)) {
    condition = "t.status='completed'";
  }
  if (/overdue|late|missed/.test(q)) condition += ' AND t.due_at IS NOT NULL AND t.due_at<NOW()';

  const [rows] = await db.execute(`SELECT t.id,t.title,t.message detail,t.priority,t.status,t.due_at,t.created_at,t.completed_at,
      t.assigned_to,COALESCE(s.full_name,'Unknown') staff_name
    FROM staff_tasks t
    LEFT JOIN staff_users s ON s.id=t.assigned_to
    WHERE ${condition}
      AND DATE(COALESCE(t.due_at,t.created_at)) BETWEEN :start AND :end
      ${staffSql}
    ORDER BY t.due_at IS NULL,t.due_at,t.created_at DESC
    LIMIT ${MAX_RESULTS}`, params);

  const person = staff ? ` for ${staff.full_name || staff.username}` : '';
  const text = rows.length
    ? `I found ${rows.length} matching task${rows.length === 1 ? '' : 's'}${person} in ${period.label}.`
    : `I could not find matching tasks${person} in ${period.label}.`;

  return {
    intent:'tasks',
    text,
    rows:rows.slice(0,20).map(row => ({
      id:row.id,title:row.title,detail:[row.staff_name,row.priority,row.status].filter(Boolean).join(' · '),
      meta:row.due_at ? `Due ${sqlDate(row.due_at)}` : ''
    })),
    actions:['open_agent'],
    state:resultState('task', rows, staff, { period })
  };
}

async function queryFollowups(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const q = lower(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffFollow = '', staffInquiry = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffFollow = ' AND x.assigned_to=:staffId';
    staffInquiry = ' AND COALESCE(i.assigned_staff_id,i.staff_id)=:staffId';
  }
  const unresolved = /not\s+(?:been\s+)?completed|not\s+done|outstanding|overdue|late|missed|open/.test(q);
  const followStatus = unresolved ? "AND x.status<>'completed'" : '';
  const inquiryStatus = unresolved ? `AND i.status IN ${OPEN_INQUIRY}` : '';

  const [followRows] = await db.execute(`SELECT x.id,x.client_id,x.customer_name,x.contact_number,x.reason,x.notes,
      x.scheduled_at,x.status,x.assigned_to,COALESCE(s.full_name,'Unassigned') staff_name,'follow_up' source_type
    FROM customer_followups x LEFT JOIN staff_users s ON s.id=x.assigned_to
    WHERE DATE(x.scheduled_at) BETWEEN :start AND :end ${followStatus} ${staffFollow}
    ORDER BY x.scheduled_at LIMIT ${MAX_RESULTS}`, params);

  const [callbackRows] = await db.execute(`SELECT x.id,x.client_id,x.customer_name,x.contact_number,x.reason,x.notes,
      x.scheduled_at,x.status,x.assigned_to,COALESCE(s.full_name,'Unassigned') staff_name,'callback' source_type
    FROM customer_callbacks x LEFT JOIN staff_users s ON s.id=x.assigned_to
    WHERE DATE(x.scheduled_at) BETWEEN :start AND :end ${unresolved ? "AND x.status<>'completed'" : ''} ${staffFollow}
    ORDER BY x.scheduled_at LIMIT ${MAX_RESULTS}`, params);

  const [inquiryRows] = await db.execute(`SELECT i.id,i.client_id,i.client_name customer_name,i.cell_number contact_number,
      i.query_text reason,i.action_taken notes,i.follow_up_at scheduled_at,i.status,
      COALESCE(i.assigned_staff_id,i.staff_id) assigned_to,COALESCE(s.full_name,'Unassigned') staff_name,'inquiry' source_type
    FROM inquiries i LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
    WHERE i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at) BETWEEN :start AND :end
      ${inquiryStatus} ${staffInquiry}
    ORDER BY i.follow_up_at LIMIT ${MAX_RESULTS}`, params);

  const rows = [...followRows,...callbackRows,...inquiryRows]
    .sort((a,b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0))
    .slice(0,MAX_RESULTS);
  const person = staff ? ` for ${staff.full_name || staff.username}` : '';
  return {
    intent:'followups',
    text: rows.length
      ? `I found ${rows.length} matching follow-up/callback item${rows.length === 1 ? '' : 's'}${person} in ${period.label}.`
      : `I could not find matching follow-ups or callbacks${person} in ${period.label}.`,
    rows:rows.slice(0,20).map(row=>({
      id:row.id,title:row.customer_name || 'Customer follow-up',
      detail:[row.source_type.replace('_',' '),row.staff_name,row.reason].filter(Boolean).join(' · '),
      meta:row.scheduled_at ? sqlDateTime(row.scheduled_at) : ''
    })),
    actions:rows.length ? ['show_all','create_tasks','open_agent'] : ['open_agent'],
    state:resultState('followup', rows.map(row=>({...row,title:row.customer_name || 'Customer follow-up',detail:row.reason || row.notes || ''})), staff, { period })
  };
}

async function queryDeals(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ` AND EXISTS(SELECT 1 FROM client_assignments ca
      WHERE ca.is_active=1 AND ca.assigned_staff_id=:staffId
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number)))`;
  }
  const q = lower(message);
  let statusSql = '';
  if (/not\s+completed|not\s+closed|outstanding|open|active/.test(q)) {
    statusSql = " AND COALESCE(c.lead_status,'new') NOT IN ('won','converted','closed','lost')";
  }
  const [rows] = await db.execute(`SELECT c.id,c.id client_id,c.client_name,c.cell_number,c.account_number,c.lead_status,c.lead_source,
      c.created_at,c.updated_at,
      (SELECT COALESCE(s.full_name,'Unassigned') FROM client_assignments ca
       LEFT JOIN staff_users s ON s.id=ca.assigned_staff_id
       WHERE ca.is_active=1 AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
       ORDER BY ca.id DESC LIMIT 1) staff_name
    FROM clients c
    WHERE c.is_active=1 AND c.lifecycle_status='prospect'
      AND DATE(c.created_at) BETWEEN :start AND :end
      ${statusSql}${staffSql}
    ORDER BY c.updated_at DESC,c.created_at DESC
    LIMIT ${MAX_RESULTS}`, params);

  const person = staff ? ` for ${staff.full_name || staff.username}` : '';
  return {
    intent:'deals',
    text: rows.length
      ? `I found ${rows.length} CRM deal/prospect${rows.length === 1 ? '' : 's'}${person} in ${period.label}.`
      : `I could not find matching CRM deals/prospects${person} in ${period.label}.`,
    rows:rows.slice(0,20).map(row=>({
      id:row.id,title:row.client_name || 'Prospect',
      detail:[row.staff_name,row.lead_status,row.lead_source,row.cell_number].filter(Boolean).join(' · '),
      meta:sqlDate(row.created_at)
    })),
    actions:rows.length ? ['show_all','create_tasks','open_agent'] : ['open_agent'],
    state:resultState('deal', rows.map(row=>({...row,title:row.client_name || 'Prospect',detail:[row.lead_status,row.lead_source].filter(Boolean).join(' · ')})), staff, { period })
  };
}

async function queryStaffActivity(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ' AND su.id=:staffId';
  }
  const [rows] = await db.execute(`SELECT su.id,su.full_name,su.email,
      (SELECT COUNT(*) FROM inquiries i WHERE COALESCE(i.assigned_staff_id,i.staff_id)=su.id AND DATE(i.created_at) BETWEEN :start AND :end) inquiries,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND DATE(t.created_at) BETWEEN :start AND :end) tasks_received,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.completed_at IS NOT NULL AND DATE(t.completed_at) BETWEEN :start AND :end) tasks_completed,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.status IN ${ACTIVE_TASK} AND t.due_at<NOW()) overdue_tasks,
      (SELECT COUNT(*) FROM audit_log a WHERE a.staff_id=su.id AND DATE(a.created_at) BETWEEN :start AND :end) audited_actions
    FROM staff_users su
    WHERE su.is_active=1 ${staffSql}
    ORDER BY su.full_name`, params);

  const text = staff
    ? `Here is ${staff.full_name || staff.username}'s CRM activity for ${period.label}.`
    : `Here is the staff activity summary for ${period.label}.`;
  return {
    intent:'staff',
    text,
    rows:rows.slice(0,20).map(row=>({
      id:row.id,title:row.full_name || row.email,
      detail:`${Number(row.tasks_completed||0)} tasks completed · ${Number(row.overdue_tasks||0)} overdue · ${Number(row.inquiries||0)} inquiries`,
      meta:`${Number(row.audited_actions||0)} audited actions`
    })),
    actions:['open_agent'],
    state:{ selection:null }
  };
}

async function queryCurrentCustomer(context) {
  const route = clean(context && context.route, 500);
  const clientMatch = route.match(/\/customers\/(\d+)/);
  const clientId = clientMatch ? Number(clientMatch[1]) : Number(context && context.clientId || 0);
  if (!clientId) {
    return {
      intent:'context',
      text:'I can use the customer currently open on screen when that screen exposes a customer ID. Open a customer record and ask me again.',
      rows:[],
      actions:['open_agent'],
      state:{selection:null}
    };
  }

  const [[client]] = await db.execute(`SELECT id,client_name,cell_number,account_number,package_name,next_upgrade_date,birthday,line_status,lifecycle_status
    FROM clients WHERE id=:id LIMIT 1`,{id:clientId});
  if (!client) return {intent:'context',text:'I could not find that customer record.',rows:[],actions:['open_agent'],state:{selection:null}};

  const [open] = await db.execute(`SELECT id,query_text title,status,follow_up_at due_at
    FROM inquiries WHERE client_id=:id AND status IN ${OPEN_INQUIRY}
    ORDER BY follow_up_at IS NULL,follow_up_at,created_at DESC LIMIT 20`,{id:clientId});
  const [tasks] = await db.execute(`SELECT id,title,status,due_at FROM staff_tasks
    WHERE related_client_id=:id AND status IN ${ACTIVE_TASK}
    ORDER BY due_at IS NULL,due_at LIMIT 20`,{id:clientId});

  const upgradeDue = client.next_upgrade_date && new Date(client.next_upgrade_date).getTime() <= Date.now();
  const text = `${client.client_name || 'This customer'} has ${open.length} open inquiry/follow-up item${open.length===1?'':'s'} and ${tasks.length} open task${tasks.length===1?'':'s'}.${upgradeDue ? ' The upgrade date is also due or overdue.' : ''}`;
  const rows = [
    ...open.map(row=>({id:row.id,title:row.title || 'Inquiry',detail:row.status,meta:row.due_at?sqlDateTime(row.due_at):''})),
    ...tasks.map(row=>({id:row.id,title:row.title,detail:row.status,meta:row.due_at?sqlDateTime(row.due_at):''}))
  ].slice(0,20);
  return {intent:'context',text,rows,actions:['open_agent'],state:{selection:null}};
}

function actionIntent(message) {
  const q = lower(message);
  return /(assign|give|send|create|make).{0,30}(task|tasks|these|those|them)|(?:task|tasks).{0,30}(assign|give|send|create)/.test(q);
}

async function prepareBatchAction(message, state) {
  const selection = state && state.selection;
  if (!selection || !Array.isArray(selection.items) || !selection.items.length) {
    return {
      intent:'action',
      text:'I do not have a current result set to turn into tasks yet. Ask me to find the items first, then tell me who should get them and by when.',
      rows:[],actions:[],state:state || {selection:null}
    };
  }

  const staff = await resolveStaff(message, selection.staffId);
  if (!staff) {
    return {
      intent:'action',
      text:'Tell me which staff member should receive these tasks.',
      rows:[],actions:[],state
    };
  }
  const dueAt = parseDueAt(message);
  if (!dueAt) {
    return {
      intent:'action',
      text:`I have the ${selection.items.length} item${selection.items.length===1?'':'s'} and ${staff.full_name || staff.username}. Tell me the deadline, for example “Friday 15:00”.`,
      rows:[],actions:[],state
    };
  }

  const items = selection.items.slice(0,MAX_BATCH_TASKS);
  return {
    intent:'action',
    text:`Ready to create ${items.length} task${items.length===1?'':'s'} for ${staff.full_name || staff.username}, due ${dueAt.slice(0,16).replace(' ',' at ')}. I will put each one under Cudo deadline monitoring.`,
    rows:items.slice(0,10).map((item,index)=>({id:index+1,title:item.title,detail:item.detail || '',meta:item.dueAt ? `Source due ${String(item.dueAt).slice(0,10)}` : ''})),
    actions:['confirm_tasks','cancel_action'],
    pendingAction:{
      type:'create_tasks',
      assignedTo:Number(staff.id),
      assignedName:staff.full_name || staff.username || staff.email,
      dueAt,
      priority:/urgent/.test(lower(message))?'urgent':/high/.test(lower(message))?'high':'normal',
      sourceKind:selection.kind,
      items
    },
    state
  };
}

async function createTasks({ userId, action }) {
  if (!action || action.type !== 'create_tasks') throw new Error('Invalid Cudo action.');
  const assignedTo = Number(action.assignedTo || 0);
  const dueAt = clean(action.dueAt, 30);
  const priority = ['normal','high','urgent'].includes(action.priority) ? action.priority : 'normal';
  const items = Array.isArray(action.items) ? action.items.slice(0,MAX_BATCH_TASKS) : [];
  if (!userId || !assignedTo || !dueAt || !items.length) throw new Error('Staff member, items and deadline are required.');

  const [[staff]] = await db.execute(`SELECT id,full_name,email,is_active FROM staff_users WHERE id=:id LIMIT 1`,{id:assignedTo});
  if (!staff || !Number(staff.is_active)) throw new Error('The selected staff member is not active.');

  const created = [];
  const skipped = [];
  for (const item of items) {
    const sourceTitle = clean(item.title || 'CRM item', 120);
    const kind = clean(action.sourceKind || 'item', 40);
    const prefix = kind === 'upgrade' ? 'Upgrade follow-up' : kind === 'birthday' ? 'Birthday follow-up' : kind === 'deal' ? 'Deal follow-up' : kind === 'followup' ? 'Follow-up' : 'Cudo task';
    const title = `${prefix} · ${sourceTitle}`.slice(0,180);
    const message = [
      `Created by Cudo from a management result set.`,
      item.detail ? `Context: ${clean(item.detail,700)}` : '',
      item.clientId ? `Customer record: #${Number(item.clientId)}` : '',
      item.dueAt ? `Original/source date: ${String(item.dueAt).slice(0,19)}` : ''
    ].filter(Boolean).join('\n');

    const [[duplicate]] = await db.execute(`SELECT id FROM staff_tasks
      WHERE assigned_to=:assignedTo AND title=:title
        AND status IN ${ACTIVE_TASK}
        AND due_at=:dueAt LIMIT 1`,{assignedTo,title,dueAt});
    if (duplicate) {
      skipped.push({title,taskId:duplicate.id});
      continue;
    }

    const result = await sendAgentInstruction({
      issuedBy:userId,assignedTo,title,message,dueAt,priority
    });
    created.push({title,taskId:result.taskId});
  }

  return {
    created,
    skipped,
    staffName:staff.full_name || staff.email,
    dueAt
  };
}

async function getAlerts() {
  const [[summary]] = await db.execute(`SELECT
    (SELECT COUNT(*) FROM staff_tasks WHERE status IN ${ACTIVE_TASK} AND due_at<NOW()) overdue_tasks,
    (SELECT COUNT(*) FROM clients WHERE is_active=1 AND COALESCE(line_status,'active')<>'cancelled' AND next_upgrade_date<CURRENT_DATE()) overdue_upgrades,
    (SELECT COUNT(*) FROM inquiries WHERE status IN ${OPEN_INQUIRY} AND follow_up_at<NOW()) overdue_followups`);
  const items = [
    {key:'overdue_tasks',label:'Overdue tasks',count:Number(summary?.overdue_tasks||0)},
    {key:'overdue_upgrades',label:'Overdue upgrades',count:Number(summary?.overdue_upgrades||0)},
    {key:'overdue_followups',label:'Overdue follow-ups',count:Number(summary?.overdue_followups||0)}
  ];
  return { count:items.reduce((sum,item)=>sum+item.count,0), items };
}

async function answerCudo({ message, state = null, context = null }) {
  const q = lower(message);
  if (!q) return {intent:'help',text:'Ask me about upgrades, birthdays, deals, tasks, follow-ups, staff activity or the customer currently open on screen.',rows:[],actions:['open_agent'],state:state || {selection:null}};

  if (actionIntent(message)) return prepareBatchAction(message,state);
  if (/this\s+customer|current\s+customer|what('?s| is)\s+outstanding\s+(here|for\s+this)|who\s+last\s+spoke/.test(q)) return queryCurrentCustomer(context || {});
  if (/birthday|birthdays/.test(q)) return queryBirthdays(message);
  if (/upgrade|upgrades/.test(q)) return queryUpgrades(message);
  if (/deal|deals|prospect|prospects|opportunit/.test(q)) return queryDeals(message);
  if (/follow[- ]?up|callback|call back|callbacks/.test(q)) return queryFollowups(message);
  if (/task|tasks|unfinished|outstanding work|overdue work/.test(q)) return queryTasks(message);
  if (/staff|activity|what did|who has|who is|performance/.test(q)) return queryStaffActivity(message);

  return {
    intent:'help',
    text:'I can investigate upgrades, birthdays, CRM deals/prospects, tasks, follow-ups/callbacks, staff activity, and the customer you currently have open. You can also ask me to turn a result set into staff tasks with a deadline.',
    rows:[],
    actions:['open_agent'],
    state:state || {selection:null},
    suggestions:['Birthdays not followed up this month','Johnny outstanding upgrades last 6 months','Who has overdue work today?']
  };
}

module.exports = {
  answerCudo,
  createTasks,
  getAlerts,
  parsePeriod,
  parseDueAt,
  resolveStaff
};
