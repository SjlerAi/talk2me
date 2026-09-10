const { createTransporter, smtpConfigured, talk2meSender, escapeHtml, firstName, formatDateOnly } = require('./mailer');

function baseEmail({ heading, intro, summaryHtml, sectionsHtml, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:26px 12px"><tr><td align="center">
  <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
    <tr><td style="padding:26px 34px 12px;text-align:center"><div style="font-size:30px;font-weight:900;color:#ef1b23;letter-spacing:-1px">Talk2Me</div><div style="font-size:12px;color:#667085;margin-top:3px">Daily Action Brief</div></td></tr>
    <tr><td style="padding:12px 34px 34px">
      <h1 style="font-size:25px;margin:0 0 12px;color:#111827">${escapeHtml(heading)}</h1>
      <p style="font-size:16px;line-height:1.55;margin:0 0 20px">${intro}</p>
      ${summaryHtml || ''}${sectionsHtml || ''}
      <p style="font-size:13px;line-height:1.5;color:#667085;margin:26px 0 0;text-align:center">${escapeHtml(footer || 'Talk2Me CRM')}</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function summaryCards(cards) {
  return `<table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:0 0 20px"><tr>${cards.map(c => {
    const content = `<div style="font-size:25px;font-weight:800;color:${c.color || '#111827'}">${escapeHtml(c.value)}</div><div style="font-size:12px;color:#667085;margin-top:4px">${escapeHtml(c.label)}</div>${c.url ? '<div style="font-size:11px;color:#ef1b23;margin-top:7px;font-weight:700">Open in CRM →</div>' : ''}`;
    return `<td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center">${c.url ? `<a href="${escapeHtml(c.url)}" style="display:block;text-decoration:none;color:inherit">${content}</a>` : content}</td>`;
  }).join('')}</tr></table>`;
}

function button(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#ef1b23;color:#fff;text-decoration:none;font-weight:800;padding:10px 15px;border-radius:9px;font-size:13px">${escapeHtml(label)}</a>`;
}

function itemCard({ title, meta, message, url, buttonLabel = 'Open in Talk2Me', urgent = false }) {
  return `<div style="border:1px solid ${urgent ? '#fecaca' : '#e2e8f0'};background:${urgent ? '#fff7f7' : '#fff'};border-radius:13px;padding:16px;margin:0 0 12px">
    <h3 style="font-size:17px;margin:0 0 7px;color:#111827">${escapeHtml(title)}</h3>
    ${meta ? `<div style="font-size:13px;color:#667085;line-height:1.5;margin-bottom:8px">${meta}</div>` : ''}
    ${message ? `<div style="font-size:14px;line-height:1.55;white-space:pre-wrap;margin-bottom:12px">${escapeHtml(message)}</div>` : ''}
    ${url ? button(url, buttonLabel) : ''}
  </div>`;
}

async function deliver({ to, subject, text, html }) {
  if (!smtpConfigured()) return { sent:false, error:'SMTP is not configured.' };
  const transporter = createTransporter();
  if (!transporter) return { sent:false, error:'Email module is not installed.' };
  try {
    const info = await transporter.sendMail({ from:talk2meSender(), to, subject, text, html });
    return { sent:true, messageId:info.messageId || null };
  } catch (error) { return { sent:false, error:error.message }; }
}

async function sendStaffWorkDigest({ staff, tasks, cases, appUrl, digestDate }) {
  const name = firstName(staff.full_name);
  const overdueTasks = tasks.filter(x => x.is_overdue).length;
  const dueTodayTasks = tasks.length - overdueTasks;
  const caseCount = cases.length;
  const empty = !tasks.length && !caseCount;
  const taskUrl = `${appUrl}/tasks?view=active`;
  const todayTaskUrl = `${appUrl}/tasks?view=today`;
  const caseUrl = `${appUrl}/workspace`;
  const caseHtml = caseCount ? `<div style="border:1px solid #e2e8f0;background:#fff;border-radius:12px;padding:14px 16px;margin:0 0 18px;text-align:center"><strong>${caseCount} case${caseCount === 1 ? '' : 's'} / follow-up${caseCount === 1 ? '' : 's'} due</strong><div style="margin-top:10px">${button(caseUrl,'Open CRM Workspace')}</div></div>` : '';
  const html = baseEmail({
    heading:`Good morning ${name}`,
    intro:empty ? `You’re all clear for ${escapeHtml(formatDateOnly(digestDate))}. There are no overdue tasks, tasks due today or follow-ups due.` : `Your Talk2Me work summary for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>. Click a block to open the live CRM — the email no longer repeats the task details.`,
    summaryHtml:summaryCards([
      {label:'Overdue tasks',value:String(overdueTasks),color:'#b42318',url:todayTaskUrl},
      {label:'Due today',value:String(dueTodayTasks),color:'#d97706',url:todayTaskUrl},
      {label:'Total tasks',value:String(tasks.length),color:'#111827',url:taskUrl}
    ]),
    sectionsHtml:caseHtml,
    footer:'Have a productive day — Talk2Me CRM'
  });
  const text = `Hi ${name},\n\nOverdue tasks: ${overdueTasks}\nDue today: ${dueTodayTasks}\nTotal tasks: ${tasks.length}\nCases / follow-ups due: ${caseCount}\n\nOpen Talk2Me tasks due now: ${todayTaskUrl}\nOpen all active tasks: ${taskUrl}\nOpen CRM workspace: ${caseUrl}`;
  return deliver({to:staff.email,subject:`Talk2Me Daily Action Brief — ${formatDateOnly(digestDate)}`,text,html});
}

async function sendOwnerDailyBrief({ owner, birthdays, upgrades, claims=[], operational, appUrl, digestDate }) {
  const name=firstName(owner.full_name);
  const dashboardUrl=`${appUrl}/dashboard`;
  const approvalsUrl=`${appUrl}/approvals`;
  const html=baseEmail({
    heading:`Good morning ${name}`,
    intro:`Your Talk2Me management summary for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>. Click any block to go directly to that area in the live CRM.`,
    summaryHtml:summaryCards([
      {label:'Birthdays today',value:String(birthdays.length),color:'#7c3aed',url:`${dashboardUrl}#birthdays`},
      {label:'Upgrades today',value:String(upgrades.length),color:'#2563eb',url:`${dashboardUrl}#upgrades`},
      {label:'Pending claims',value:String(claims.length),color:'#f79009',url:approvalsUrl},
      {label:'Open cases',value:String(operational.open_cases || 0),color:'#d97706',url:`${dashboardUrl}#open-cases`}
    ]),
    sectionsHtml:`<div style="text-align:center;margin-top:24px">${button(`${appUrl}/command-centre`,'Open Command Centre')}</div>`,
    footer:'Talk2Me Management Daily Brief'
  });
  return deliver({
    to:owner.email,
    subject:`Talk2Me Daily Brief — ${formatDateOnly(digestDate)}`,
    text:`Birthdays today: ${birthdays.length}\nUpgrades today: ${upgrades.length}\nPending claims: ${claims.length}\nOpen cases: ${operational.open_cases || 0}\n\nDashboard: ${dashboardUrl}\nApprovals: ${approvalsUrl}`,
    html
  });
}

async function sendStaffClientDigest({ staff, birthdays, upgrades, appUrl, digestDate }) {
  const name=firstName(staff.full_name);
  const bHtml=birthdays.map(c=>itemCard({title:c.client_name,meta:`Birthday today · Tel: ${escapeHtml(c.cell_number || '—')} · Email: ${escapeHtml(c.email || '—')} · Lines: ${escapeHtml(c.line_count || 1)}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const uHtml=upgrades.map(c=>itemCard({title:c.client_name,meta:`Upgrade: ${escapeHtml(formatDateOnly(c.upgrade_date))} · Tel: ${escapeHtml(c.cell_number || '—')} · Handset: ${escapeHtml(c.handset || '—')} · Lines: ${escapeHtml(c.line_count || 1)}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.account_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const html=baseEmail({heading:`Your clients for today, ${name}`,intro:`Here are your assigned birthday and upgrade opportunities for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>.`,summaryHtml:summaryCards([{label:'Birthdays today',value:String(birthdays.length),color:'#7c3aed'},{label:'Upgrades next 7 days',value:String(upgrades.length),color:'#2563eb'}]),sectionsHtml:`<h2 style="font-size:19px;margin:20px 0 10px">Birthdays</h2>${bHtml || '<p style="color:#667085">No assigned birthdays today.</p>'}<h2 style="font-size:19px;margin:22px 0 10px">Upgrades in the next 7 days</h2>${uHtml || '<p style="color:#667085">No assigned upgrades in the next 7 days.</p>'}`,footer:'Talk2Me Client Opportunity Digest'});
  return deliver({to:staff.email,subject:'Your Talk2Me clients for today',text:`Birthdays: ${birthdays.length}\nUpgrades next 7 days: ${upgrades.length}`,html});
}

module.exports={sendStaffWorkDigest,sendOwnerDailyBrief,sendStaffClientDigest};
