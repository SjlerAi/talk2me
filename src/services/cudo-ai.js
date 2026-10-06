'use strict';

const db = require('../config/db');
const { sendAgentInstruction, buildDailyResponsibilities } = require('./office-intelligence-agent');

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

function normaliseName(value) {
  return lower(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function phoneticToken(value) {
  return normaliseName(value)
    .replace(/\s+/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const prev = Array.from({ length:right.length + 1 }, (_,i) => i);
  const curr = new Array(right.length + 1);
  for (let i=1;i<=left.length;i+=1) {
    curr[0]=i;
    for (let j=1;j<=right.length;j+=1) {
      const cost = left[i-1] === right[j-1] ? 0 : 1;
      curr[j] = Math.min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost);
    }
    for (let j=0;j<=right.length;j+=1) prev[j]=curr[j];
  }
  return prev[right.length];
}

function nameSimilarity(a, b) {
  const left = phoneticToken(a);
  const right = phoneticToken(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const max = Math.max(left.length,right.length);
  return Math.max(0,1-(levenshtein(left,right)/max));
}

function scoreNameMatch(message, staff) {
  const q = normaliseName(message);
  const words = q.split(/\s+/).filter(word => word.length >= 3);
  const rawValues = [
    staff.full_name,
    staff.username,
    staff.email && String(staff.email).split('@')[0]
  ].filter(Boolean);

  let best = { score:0, matchedText:null, matchedCandidate:null, exact:false };
  for (const rawValue of rawValues) {
    const value = normaliseName(rawValue);
    if (!value) continue;
    if (q === value || q.includes(` ${value} `) || q.startsWith(`${value} `) || q.endsWith(` ${value}`)) {
      return { score:1, matchedText:value, matchedCandidate:rawValue, exact:true };
    }
    const candidateWords = value.split(/\s+/).filter(word => word.length >= 3);
    for (const candidate of candidateWords) {
      for (const word of words) {
        if (word === candidate) {
          const exact = { score:1, matchedText:word, matchedCandidate:candidate, exact:true };
          if (exact.score > best.score) best = exact;
          continue;
        }
        const score = nameSimilarity(word,candidate);
        if (score > best.score) {
          best = { score, matchedText:word, matchedCandidate:candidate, exact:false };
        }
      }
    }
  }
  return best;
}

async function resolveStaffMatch(message, fallbackId = null) {
  const staff = await activeStaff();
  const ranked = staff
    .map(row => ({ staff:row, ...scoreNameMatch(message,row) }))
    .sort((a,b) => b.score-a.score);

  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const fallback = fallbackId ? staff.find(row => Number(row.id) === Number(fallbackId)) || null : null;

  if (!best || best.score < 0.68) {
    return fallback
      ? { staff:fallback, confidence:1, exact:true, needsConfirmation:false, matchedText:null, candidates:[] }
      : { staff:null, confidence:0, exact:false, needsConfirmation:false, matchedText:null, candidates:[] };
  }

  const margin = best.score - Number(second?.score || 0);
  const confident = best.exact || best.score >= 0.95 || (best.score >= 0.79 && margin >= 0.08);
  return {
    staff:best.staff,
    confidence:Number(best.score.toFixed(3)),
    exact:Boolean(best.exact),
    needsConfirmation:!confident,
    matchedText:best.matchedText,
    candidates:ranked.slice(0,3).filter(item => item.score >= 0.6).map(item => ({
      id:Number(item.staff.id),
      name:item.staff.full_name || item.staff.username || item.staff.email,
      confidence:Number(item.score.toFixed(3))
    }))
  };
}

async function resolveStaff(message, fallbackId = null) {
  const match = await resolveStaffMatch(message,fallbackId);
  return match.staff && !match.needsConfirmation ? match.staff : null;
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
        dueAt: row.due_at || row.next_upgrade_date || row.follow_up_at || row.scheduled_at || null,
        assignedTo: Number(row.assigned_staff_id || row.assigned_to || 0) || null,
        assignedName: clean(row.staff_name || '', 180) || null
      })),
      ...extra
    }
  };
}

function detectIntent(message) {
  const q = lower(message);
  const clientWords = /\b(?:client|clients|customer|customers)\b/;
  const followedWords = /\bfollow(?:ed|ing)?[- ]?up\b|\bfollow[- ]?ups\b|\bcontact(?:ed|ing)?\b|\bphoned\b|\bcalled\b|\bspoke\s+to\b|\bspoken\s+to\b/;

  if (/this\s+customer|current\s+customer|what('?s| is)\s+outstanding\s+(here|for\s+this)|who\s+last\s+spoke/.test(q)) return 'context';
  if (/\bbirthdays?\b/.test(q)) return 'birthdays';
  if (/\bupgrades?\b/.test(q)) return 'upgrades';
  if (/\bdeals?\b|\bprospects?\b|opportunit/.test(q)) return 'deals';
  if (clientWords.test(q) && followedWords.test(q)) return 'client_followup_activity';
  if (followedWords.test(q) || /\bcallbacks?\b|\bcall\s+back\b/.test(q)) return 'followups';
  if (
    (/\b(?:work|jobs?|things?)\b/.test(q) && /\b(?:left|outstanding|open|still|today|to\s+do|todo)\b/.test(q))
    || /what\s+(?:work|jobs?).*\btoday\b/.test(q)
    || /what\s+(?:has|does).*(?:left|to\s+do).*\btoday\b/.test(q)
  ) return 'office_work';
  if (/\btasks?\b|unfinished|outstanding\s+tasks?|overdue\s+tasks?/.test(q)) return 'tasks';
  if (/\bstaff\b|\bactivity\b|what\s+did|who\s+has|who\s+is|performance/.test(q)) return 'staff';
  return null;
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
              AND DATE(COALESCE(f.completed_at,f.created_at))
                BETWEEN ${occurrence} AND DATE_ADD(${occurrence},INTERVAL 7 DAY))
          OR EXISTS(SELECT 1 FROM agent_responsibility_checks r
            WHERE r.staff_id=ca.assigned_staff_id AND r.source_type='birthday'
              AND r.source_key=CONCAT('client:',c.id) AND r.status='completed'
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

async function queryClientFollowupActivity(message) {
  const period = parsePeriod(message);
  const staff = await resolveStaff(message);
  const q = lower(message);
  const params = { start: period.startSql, end: period.endSql };
  let staffSql = '';
  if (staff) {
    params.staffId = Number(staff.id);
    staffSql = ' AND ca.assigned_staff_id=:staffId';
  }

  const evidence = `(
    EXISTS(SELECT 1 FROM customer_followups f
      WHERE f.client_id=c.id AND f.status='completed'
        AND DATE(COALESCE(f.completed_at,f.created_at)) BETWEEN :start AND :end)
    OR EXISTS(SELECT 1 FROM customer_callbacks cb
      WHERE cb.client_id=c.id AND cb.status='completed'
        AND DATE(COALESCE(cb.completed_at,cb.created_at)) BETWEEN :start AND :end)
    OR EXISTS(SELECT 1 FROM inquiries i
      WHERE i.client_id=c.id AND i.status='completed'
        AND DATE(COALESCE(i.completed_at,i.updated_at,i.created_at)) BETWEEN :start AND :end)
  )`;

  const baseFrom = `FROM clients c
    JOIN client_assignments ca ON ca.is_active=1
      AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
    LEFT JOIN staff_users s ON s.id=ca.assigned_staff_id
    WHERE c.is_active=1
      AND COALESCE(c.line_status,'active')<>'cancelled'
      ${staffSql}`;

  const [[totalRow]] = await db.execute(`SELECT COUNT(DISTINCT c.id) total_clients ${baseFrom}`, params);
  const [[followedRow]] = await db.execute(`SELECT COUNT(DISTINCT c.id) followed_clients ${baseFrom} AND ${evidence}`, params);

  const totalClients = Number(totalRow?.total_clients || 0);
  const followedClients = Number(followedRow?.followed_clients || 0);
  const notFollowedClients = Math.max(0, totalClients - followedClients);
  const wantsMissing = /not\s+(?:been\s+)?follow(?:ed)?[- ]?up|hasn'?t\s+(?:been\s+)?follow(?:ed)?[- ]?up|not\s+contact(?:ed)?|uncontacted|without\s+(?:a\s+)?follow[- ]?up/.test(q);
  const condition = wantsMissing ? `NOT ${evidence}` : evidence;

  const [rows] = await db.execute(`SELECT c.id,c.id client_id,c.client_name,c.cell_number,
      MAX(ca.assigned_staff_id) assigned_staff_id,
      MAX(COALESCE(NULLIF(s.full_name,''),s.email,'Unassigned')) staff_name
    ${baseFrom}
      AND ${condition}
    GROUP BY c.id,c.client_name,c.cell_number
    ORDER BY c.client_name
    LIMIT ${MAX_RESULTS}`, params);

  let grouped = null;
  if (!staff) {
    const [groupRows] = await db.execute(`SELECT COALESCE(NULLIF(s.full_name,''),s.email,'Unassigned') staff_name,
        COUNT(DISTINCT c.id) item_count
      ${baseFrom}
        AND ${condition}
      GROUP BY ca.assigned_staff_id,COALESCE(NULLIF(s.full_name,''),s.email,'Unassigned')
      ORDER BY item_count DESC,staff_name`, params);
    grouped = Object.fromEntries(groupRows.map(row => [row.staff_name, Number(row.item_count || 0)]));
  }

  const person = staff ? `${staff.full_name || staff.username}'s` : 'the office';
  const selectedCount = wantsMissing ? notFollowedClients : followedClients;
  const text = wantsMissing
    ? `${selectedCount} of ${totalClients} active assigned client${totalClients===1?'':'s'} for ${person} have no completed follow-up evidence in ${period.label}. ${followedClients} do show completed follow-up evidence.`
    : `${followedClients} of ${totalClients} active assigned client${totalClients===1?'':'s'} for ${person} show completed follow-up evidence in ${period.label}. ${notFollowedClients} do not.`;

  return {
    intent:'client_followup_activity',
    text,
    rows:rows.slice(0,20).map(row => ({
      id:row.id,
      title:row.client_name || 'Customer',
      detail:[row.staff_name,row.cell_number,wantsMissing?'No completed follow-up':'Followed up'].filter(Boolean).join(' · '),
      meta:period.label
    })),
    grouped,
    actions:rows.length
      ? (wantsMissing ? ['show_all','create_tasks','open_agent'] : ['show_all','open_agent'])
      : ['open_agent'],
    state:resultState('client_followup_activity', rows.map(row => ({
      ...row,
      title:row.client_name || 'Customer',
      detail:wantsMissing ? 'No completed follow-up evidence' : 'Completed follow-up evidence'
    })), staff, { period, wantsMissing, totalClients, followedClients, notFollowedClients })
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

async function queryOfficeWork(message) {
  const staff = await resolveStaff(message);
  if (!staff) {
    return {
      intent:'office_work',
      text:'Tell me which staff member you mean. I will check their tasks, follow-ups, callbacks, inquiries, birthdays, upgrades and management instructions together.',
      rows:[],
      actions:[],
      state:{selection:null}
    };
  }

  const daily = await buildDailyResponsibilities(Number(staff.id));
  const openItems = (daily.items || []).filter(item => !['completed','awaiting_approval'].includes(String(item.status || '')));
  const typeCounts = {};
  for (const item of openItems) {
    const key = String(item.sourceType || 'work').replace(/_/g,' ');
    typeCounts[key]=(typeCounts[key]||0)+1;
  }
  const breakdown = Object.entries(typeCounts)
    .sort((a,b)=>b[1]-a[1])
    .map(([key,count])=>`${count} ${key}`)
    .join(', ');

  const name = staff.full_name || staff.username || staff.email;
  const overdue = openItems.filter(item => item.status === 'overdue').length;
  const outstanding = openItems.filter(item => item.status === 'outstanding').length;
  const text = openItems.length
    ? `${name} has ${openItems.length} item${openItems.length===1?'':'s'} still open for today: ${overdue} overdue and ${outstanding} outstanding.${breakdown ? ` Breakdown: ${breakdown}.` : ''}`
    : `${name} has no outstanding or overdue work showing for today across tasks, follow-ups, callbacks, inquiries, birthdays, upgrades and management instructions.`;

  const rows = openItems.slice(0,MAX_RESULTS).map((item,index)=>({
    id:index+1,
    title:item.title || 'Work item',
    detail:[String(item.sourceType || 'work').replace(/_/g,' '),item.status,item.detail].filter(Boolean).join(' · '),
    due_at:item.dueAt || null,
    assigned_staff_id:Number(staff.id),
    staff_name:name,
    source_type:item.sourceType || 'work'
  }));

  return {
    intent:'office_work',
    text,
    rows:rows.slice(0,20).map(row=>({
      id:row.id,
      title:row.title,
      detail:row.detail,
      meta:row.due_at ? `Due ${sqlDateTime(row.due_at) || sqlDate(row.due_at) || ''}` : ''
    })),
    grouped:typeCounts,
    actions:['open_agent'],
    state:resultState('office_work',rows,staff,{dailySummary:daily.summary || null})
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

  const explicitDistribute = /responsible|each\s+(?:person|staff)|everyone|everybody|their\s+(?:own|responsible)|assigned\s+staff/.test(lower(message));
  const distribute = explicitDistribute || Boolean(state?.actionDraft?.distribute);
  const fallbackStaffId = Number(state?.actionDraft?.staffId || selection.staffId || 0) || null;
  const staff = distribute ? null : await resolveStaff(message, fallbackStaffId);
  if (!distribute && !staff) {
    return {
      intent:'action',
      text:'Tell me which staff member should receive these tasks, or say “assign each to the responsible person”.',
      rows:[],actions:[],state:{...state,actionDraft:{distribute:false,staffId:null}}
    };
  }
  if (distribute && !selection.items.some(item => Number(item.assignedTo || 0))) {
    return {
      intent:'action',
      text:'These results do not contain responsible staff assignments yet. Tell me which staff member should receive them.',
      rows:[],actions:[],state:{...state,actionDraft:{distribute:true,staffId:null}}
    };
  }
  const dueAt = parseDueAt(message);
  if (!dueAt) {
    return {
      intent:'action',
      text:distribute
        ? `I have the ${selection.items.length} item${selection.items.length===1?'':'s'} and their responsible staff. Tell me the deadline, for example “Friday 15:00”.`
        : `I have the ${selection.items.length} item${selection.items.length===1?'':'s'} and ${staff.full_name || staff.username}. Tell me the deadline, for example “Friday 15:00”.`,
      rows:[],actions:[],state:{...state,actionDraft:{distribute,staffId:staff ? Number(staff.id) : null}}
    };
  }

  const items = selection.items.slice(0,MAX_BATCH_TASKS);
  return {
    intent:'action',
    text:distribute
      ? `Ready to create up to ${items.length} task${items.length===1?'':'s'} for the responsible staff, due ${dueAt.slice(0,16).replace(' ',' at ')}. I will put each one under Cudo deadline monitoring.`
      : `Ready to create ${items.length} task${items.length===1?'':'s'} for ${staff.full_name || staff.username}, due ${dueAt.slice(0,16).replace(' ',' at ')}. I will put each one under Cudo deadline monitoring.`,
    rows:items.slice(0,10).map((item,index)=>({id:index+1,title:item.title,detail:item.detail || '',meta:item.dueAt ? `Source due ${String(item.dueAt).slice(0,10)}` : ''})),
    actions:['confirm_tasks','cancel_action'],
    pendingAction:{
      type:'create_tasks',
      assignedTo:staff ? Number(staff.id) : null,
      assignedName:staff ? (staff.full_name || staff.username || staff.email) : null,
      distribute,
      dueAt,
      priority:/urgent/.test(lower(message))?'urgent':/high/.test(lower(message))?'high':'normal',
      sourceKind:selection.kind,
      items
    },
    state:{...state,actionDraft:{distribute,staffId:staff ? Number(staff.id) : null}}
  };
}

async function createTasks({ userId, action }) {
  if (!action || action.type !== 'create_tasks') throw new Error('Invalid Cudo action.');
  const assignedTo = Number(action.assignedTo || 0);
  const distribute = Boolean(action.distribute);
  const dueAt = clean(action.dueAt, 30);
  const priority = ['normal','high','urgent'].includes(action.priority) ? action.priority : 'normal';
  const items = Array.isArray(action.items) ? action.items.slice(0,MAX_BATCH_TASKS) : [];
  if (!userId || (!assignedTo && !distribute) || !dueAt || !items.length) throw new Error('Staff member, items and deadline are required.');

  let staff = null;
  if (!distribute) {
    [[staff]] = await db.execute(`SELECT id,full_name,email,is_active FROM staff_users WHERE id=:id LIMIT 1`,{id:assignedTo});
    if (!staff || !Number(staff.is_active)) throw new Error('The selected staff member is not active.');
  }

  const created = [];
  const skipped = [];
  for (const item of items) {
    const targetStaffId = distribute ? Number(item.assignedTo || 0) : assignedTo;
    if (!targetStaffId) {
      skipped.push({title:clean(item.title || 'CRM item',180),reason:'No responsible staff assigned'});
      continue;
    }
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
      WHERE assigned_to=:targetStaffId AND title=:title
        AND status IN ${ACTIVE_TASK}
        AND due_at=:dueAt LIMIT 1`,{targetStaffId,title,dueAt});
    if (duplicate) {
      skipped.push({title,taskId:duplicate.id});
      continue;
    }

    const result = await sendAgentInstruction({
      issuedBy:userId,assignedTo:targetStaffId,title,message,dueAt,priority
    });
    created.push({title,taskId:result.taskId});
  }

  return {
    created,
    skipped,
    staffName:distribute ? 'responsible staff' : (staff.full_name || staff.email),
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
  let workingMessage = clean(message,5000);
  let workingState = state || {};
  let q = lower(workingMessage);
  if (!q) return {intent:'help',text:'Ask me about upgrades, birthdays, deals, tasks, follow-ups, staff activity or the customer currently open on screen.',rows:[],actions:['open_agent'],state:workingState || {selection:null}};

  const pendingStaff = workingState?.pendingStaff || null;
  if (pendingStaff) {
    if (/^(yes|yes please|correct|right|that'?s right|use that|use them|ok|okay)\b/.test(q)) {
      workingMessage = `${pendingStaff.originalMessage} ${pendingStaff.staffName}`;
      workingState = {...workingState,pendingStaff:null};
      q = lower(workingMessage);
    } else if (!detectIntent(workingMessage) && workingMessage.split(/\s+/).length <= 5) {
      workingMessage = `${pendingStaff.originalMessage} ${workingMessage}`;
      workingState = {...workingState,pendingStaff:null};
      q = lower(workingMessage);
    }
  }

  const selectionKind = workingState?.selection?.kind || null;
  const looksLikeActionContinuation = Boolean(selectionKind) && (
    actionIntent(workingMessage)
    || /\b(deadline|due)\b/.test(q)
    || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/.test(q)
    || /^make\b/.test(q)
  );
  if (looksLikeActionContinuation) return prepareBatchAction(workingMessage,workingState);

  const staffMatch = await resolveStaffMatch(workingMessage,workingState?.selection?.staffId || null);
  if (staffMatch.staff && staffMatch.needsConfirmation) {
    const staffName = staffMatch.staff.full_name || staffMatch.staff.username || staffMatch.staff.email;
    return {
      intent:'staff_confirmation',
      text:`I found a near staff-name match. I think “${staffMatch.matchedText || 'that name'}” means ${staffName}. Type “yes” to use ${staffName}, or type the correct staff name before I search the CRM.`,
      rows:[],
      actions:[],
      suggestions:[`Yes, use ${staffName}`],
      state:{
        ...workingState,
        pendingStaff:{
          staffId:Number(staffMatch.staff.id),
          staffName,
          originalMessage:workingMessage,
          confidence:staffMatch.confidence
        }
      }
    };
  }

  if (staffMatch.staff && !staffMatch.exact) {
    const canonical = staffMatch.staff.full_name || staffMatch.staff.username || staffMatch.staff.email;
    workingMessage = `${workingMessage} ${canonical}`;
    q = lower(workingMessage);
  }

  const directIntent = detectIntent(workingMessage);
  if (directIntent === 'context') return queryCurrentCustomer(context || {});
  if (directIntent === 'birthdays') return queryBirthdays(workingMessage);
  if (directIntent === 'upgrades') return queryUpgrades(workingMessage);
  if (directIntent === 'deals') return queryDeals(workingMessage);
  if (directIntent === 'client_followup_activity') return queryClientFollowupActivity(workingMessage);
  if (directIntent === 'followups') return queryFollowups(workingMessage);
  if (directIntent === 'office_work') return queryOfficeWork(workingMessage);
  if (directIntent === 'tasks') return queryTasks(workingMessage);
  if (directIntent === 'staff') return queryStaffActivity(workingMessage);

  const periodRefinement = Boolean(selectionKind)
    && /(last|past|previous|today|yesterday|this\s+week|this\s+month|\d+\s+(?:days?|weeks?|months?))/.test(q);
  if (periodRefinement) {
    const staffName = workingState?.selection?.staffName || '';
    const synthetic = [selectionKind === 'followup' ? 'follow-up' : selectionKind, staffName, workingMessage].filter(Boolean).join(' ');
    if (selectionKind === 'birthday') return queryBirthdays(synthetic);
    if (selectionKind === 'upgrade') return queryUpgrades(synthetic);
    if (selectionKind === 'deal') return queryDeals(synthetic);
    if (selectionKind === 'client_followup_activity') return queryClientFollowupActivity(synthetic);
    if (selectionKind === 'followup') return queryFollowups(synthetic);
    if (selectionKind === 'office_work') return queryOfficeWork(synthetic);
    if (selectionKind === 'task') return queryTasks(synthetic);
  }

  if (actionIntent(workingMessage)) return prepareBatchAction(workingMessage,workingState);

  return {
    intent:'help',
    text:'I can investigate upgrades, birthdays, CRM deals/prospects, tasks, follow-ups/callbacks, complete daily work across the CRM, staff activity, and the customer you currently have open. You can also turn outstanding result sets into staff tasks with a deadline.',
    rows:[],
    actions:['open_agent'],
    state:workingState || {selection:null},
    suggestions:['What work has Gerda got left for today?','How many of Johnny\'s clients were followed up this month?','Birthdays not followed up this month']
  };
}

module.exports = {
  answerCudo,
  createTasks,
  getAlerts,
  parsePeriod,
  parseDueAt,
  resolveStaff,
  resolveStaffMatch,
  nameSimilarity,
  detectIntent
};
