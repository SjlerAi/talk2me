const { createTransporter, smtpConfigured, escapeHtml, firstName, formatDateTime, formatDateOnly } = require('./mailer');

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
  return `<table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:0 0 20px"><tr>${cards.map(c => `<td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center"><div style="font-size:25px;font-weight:800;color:${c.color || '#111827'}">${escapeHtml(c.value)}</div><div style="font-size:12px;color:#667085;margin-top:4px">${escapeHtml(c.label)}</div></td>`).join('')}</tr></table>`;
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
    const info = await transporter.sendMail({ from:process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`, to, subject, text, html });
    return { sent:true, messageId:info.messageId || null };
  } catch (error) { return { sent:false, error:error.message }; }
}

async function sendStaffWorkDigest({ staff, tasks, cases, appUrl, digestDate }) {
  const name = firstName(staff.full_name);
  const overdue = tasks.filter(x => x.is_overdue).length + cases.filter(x => x.is_overdue).length;
  const dueToday = tasks.length + cases.length - overdue;
  const taskHtml = tasks.map(t => itemCard({
    title:t.title,
    meta:`${t.is_overdue ? '<strong style="color:#b42318">OVERDUE</strong> · ' : ''}Due: ${escapeHtml(formatDateTime(t.due_at))}${t.client_name ? ` · Client: ${escapeHtml(t.client_name)}${t.cell_number ? ` · ${escapeHtml(t.cell_number)}` : ''}` : ''}`,
    message:t.message,
    url:`${appUrl}/tasks/${t.id}`,
    buttonLabel:'Open Task', urgent:t.priority === 'urgent' || t.is_overdue
  })).join('');
  const caseHtml = cases.map(c => itemCard({
    title:c.query_text || `Case #${c.id}`,
    meta:`${c.is_overdue ? '<strong style="color:#b42318">OVERDUE</strong> · ' : ''}Follow-up: ${escapeHtml(formatDateTime(c.follow_up_at))} · Client: ${escapeHtml(c.client_name || 'Unknown')}${c.cell_number ? ` · ${escapeHtml(c.cell_number)}` : ''}`,
    message:c.action_taken || c.result_found || '',
    url:`${appUrl}/dashboard/inquiries/${c.id}`,
    buttonLabel:'Open Case', urgent:c.priority === 'urgent' || c.is_overdue
  })).join('');
  const empty = !tasks.length && !cases.length;
  const html = baseEmail({
    heading:`Good morning ${name}`,
    intro:empty ? `You’re all clear for ${escapeHtml(formatDateOnly(digestDate))}. There is no overdue work or work due today.` : `Here is the work currently waiting for you for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>.`,
    summaryHtml:summaryCards([{label:'Overdue',value:String(overdue),color:'#b42318'},{label:'Due today',value:String(dueToday),color:'#d97706'},{label:'Total actions',value:String(tasks.length + cases.length),color:'#111827'}]),
    sectionsHtml:`${tasks.length ? `<h2 style="font-size:19px;margin:20px 0 10px">Tasks</h2>${taskHtml}` : ''}${cases.length ? `<h2 style="font-size:19px;margin:20px 0 10px">Cases & follow-ups</h2>${caseHtml}` : ''}`,
    footer:'Have a productive day — Talk2Me CRM'
  });
  const text = `Hi ${name},\n\nOverdue: ${overdue}\nDue today: ${dueToday}\n\nOpen Talk2Me: ${appUrl}/tasks`;
  return deliver({to:staff.email,subject:`Your Talk2Me work for today — ${formatDateOnly(digestDate)}`,text,html});
}

async function sendOwnerDailyBrief({ owner, birthdays, upgrades, claims=[], operational, appUrl, digestDate }) {
  const name=firstName(owner.full_name);
  const bHtml=birthdays.map(c=>itemCard({title:c.client_name,meta:`Birthday: ${escapeHtml(formatDateOnly(c.birthday))} · Tel: ${escapeHtml(c.cell_number || '—')} · Email: ${escapeHtml(c.email || '—')}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const uHtml=upgrades.map(c=>itemCard({title:c.client_name,meta:`Upgrade: ${escapeHtml(formatDateOnly(c.upgrade_date))} · Tel: ${escapeHtml(c.cell_number || '—')} · Account: ${escapeHtml(c.account_number || '—')} · Handset: ${escapeHtml(c.handset || '—')}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.account_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const cHtml=claims.map(c=>itemCard({title:c.summary,meta:`Requested by ${escapeHtml(c.requested_by_name)} · Account ${escapeHtml(c.account_number||'—')}`,url:`${appUrl}/approvals`,buttonLabel:'Review Claim'})).join('');
  const html=baseEmail({heading:`Good morning ${name}`,intro:`Here is the Talk2Me daily brief for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>.`,summaryHtml:summaryCards([{label:'Birthdays today',value:String(birthdays.length),color:'#7c3aed'},{label:'Upgrades today',value:String(upgrades.length),color:'#2563eb'},{label:'Pending claims',value:String(claims.length),color:'#f79009'},{label:'Open cases',value:String(operational.open_cases || 0),color:'#d97706'}]),sectionsHtml:`<h2 style="font-size:19px;margin:20px 0 10px">Claims awaiting approval</h2>${cHtml || '<p style="color:#667085">No staff claims are waiting.</p>'}<h2 style="font-size:19px;margin:20px 0 10px">Birthdays today</h2>${bHtml || '<p style="color:#667085">No birthdays today.</p>'}<h2 style="font-size:19px;margin:22px 0 10px">Upgrades today</h2>${uHtml || '<p style="color:#667085">No upgrades today.</p>'}<div style="text-align:center;margin-top:24px">${button(`${appUrl}/command-centre`,'Open Command Centre')}</div>`,footer:'Talk2Me Management Daily Brief'});
  return deliver({to:owner.email,subject:`Talk2Me Daily Brief — ${formatDateOnly(digestDate)}`,text:`Pending claims: ${claims.length}\nBirthdays: ${birthdays.length}\nUpgrades: ${upgrades.length}\nOpen approvals: ${appUrl}/approvals`,html});
}

async function sendStaffClientDigest({ staff, birthdays, upgrades, appUrl, digestDate }) {
  const name=firstName(staff.full_name);
  const bHtml=birthdays.map(c=>itemCard({title:c.client_name,meta:`Birthday today · Tel: ${escapeHtml(c.cell_number || '—')} · Email: ${escapeHtml(c.email || '—')} · Lines: ${escapeHtml(c.line_count || 1)}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const uHtml=upgrades.map(c=>itemCard({title:c.client_name,meta:`Upgrade: ${escapeHtml(formatDateOnly(c.upgrade_date))} · Tel: ${escapeHtml(c.cell_number || '—')} · Handset: ${escapeHtml(c.handset || '—')} · Lines: ${escapeHtml(c.line_count || 1)}`,url:`${appUrl}/backoffice/clients?q=${encodeURIComponent(c.cell_number || c.account_number || c.client_name || '')}`,buttonLabel:'Open Client'})).join('');
  const html=baseEmail({heading:`Your clients for today, ${name}`,intro:`Here are your assigned birthday and upgrade opportunities for <strong>${escapeHtml(formatDateOnly(digestDate))}</strong>.`,summaryHtml:summaryCards([{label:'Birthdays today',value:String(birthdays.length),color:'#7c3aed'},{label:'Upgrades next 7 days',value:String(upgrades.length),color:'#2563eb'}]),sectionsHtml:`<h2 style="font-size:19px;margin:20px 0 10px">Birthdays</h2>${bHtml || '<p style="color:#667085">No assigned birthdays today.</p>'}<h2 style="font-size:19px;margin:22px 0 10px">Upgrades in the next 7 days</h2>${uHtml || '<p style="color:#667085">No assigned upgrades in the next 7 days.</p>'}`,footer:'Talk2Me Client Opportunity Digest'});
  return deliver({to:staff.email,subject:'Your Talk2Me clients for today',text:`Birthdays: ${birthdays.length}\nUpgrades next 7 days: ${upgrades.length}`,html});
}

module.exports={sendStaffWorkDigest,sendOwnerDailyBrief,sendStaffClientDigest};
