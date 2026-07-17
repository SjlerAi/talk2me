let nodemailer = null;
try {
  // Load lazily so the CRM can still save tasks when the package has not yet
  // been installed on the hosting environment.
  nodemailer = require('nodemailer');
} catch (error) {
  nodemailer = null;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function createTransporter() {
  if (!nodemailer) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function firstName(value) {
  return String(value || 'there').trim().split(/\s+/)[0] || 'there';
}

function formatDateTime(value) {
  if (!value) return 'No due date has been set.';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

async function sendTaskEmail({ to, staffName, task, appUrl }) {
  if (!nodemailer) return { sent: false, error: 'Email module is not installed. Run NPM Install in cPanel.' };
  if (!smtpConfigured()) return { sent: false, error: 'SMTP is not configured.' };
  if (!to) return { sent: false, error: 'Staff member has no login email.' };

  const transporter = createTransporter();
  const baseUrl = String(appUrl || '').replace(/\/$/, '');
  const url = `${baseUrl}/tasks/${task.id}`;
  const logoUrl = `${baseUrl}/public/images/talk2me-logo.png`;
  const due = formatDateTime(task.due_at);
  const sender = task.created_by_name || 'the Talk2Me team';
  const recipientName = firstName(staffName);
  const isTask = task.type === 'task';
  const itemLabel = isTask ? 'task' : 'notification';
  const subject = isTask ? '🔔 New Talk2Me task for you' : '🔔 New Talk2Me notification for you';
  const priority = String(task.priority || 'normal').toLowerCase();
  const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
  const priorityColor = priority === 'urgent' ? '#b42318' : priority === 'high' ? '#d97706' : '#475467';

  const text = `Hi ${recipientName},\n\nA new Talk2Me ${itemLabel} has arrived from ${sender}.\n\n${task.title}\n${task.message}\n\nPriority: ${priorityLabel}\nDue: ${due}\n\nOpen this ${itemLabel}: ${url}\n\nThis message was sent by ${sender} through Talk2Me CRM.`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <tr><td style="padding:28px 34px 18px;text-align:center"><img src="${escapeHtml(logoUrl)}" alt="Talk2Me" style="width:190px;max-width:70%;height:auto"></td></tr>
      <tr><td style="padding:8px 34px 34px">
        <p style="font-size:18px;margin:0 0 16px">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="font-size:16px;line-height:1.55;margin:0 0 22px">A new <strong>Talk2Me ${escapeHtml(itemLabel)}</strong> has arrived from <strong>${escapeHtml(sender)}</strong>.</p>
        <div style="border:1px solid #fecaca;background:#fff7f7;border-radius:14px;padding:20px;margin-bottom:22px">
          <span style="display:inline-block;background:${priorityColor};color:#fff;border-radius:999px;padding:6px 11px;font-size:12px;font-weight:700;text-transform:uppercase">${escapeHtml(priorityLabel)}</span>
          <h2 style="font-size:24px;margin:15px 0 10px;color:#111827">${escapeHtml(task.title)}</h2>
          <p style="font-size:16px;line-height:1.6;white-space:pre-wrap;margin:0 0 14px">${escapeHtml(task.message)}</p>
          <p style="font-size:14px;margin:0"><strong>Due:</strong> ${escapeHtml(due)}</p>
        </div>
        <div style="text-align:center;margin:26px 0">
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#fa1c1d;color:#fff;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:10px">Open ${isTask ? 'Task' : 'Notification'} in Talk2Me</a>
        </div>
        <p style="font-size:13px;line-height:1.5;color:#667085;margin:24px 0 0;text-align:center">This message was sent by ${escapeHtml(sender)} through Talk2Me CRM.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html
    });
    return { sent: true, messageId: info.messageId || null };
  } catch (error) {
    return { sent: false, error: error.message };
  }
}

function formatDateOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-ZA', { day:'2-digit', month:'long', year:'numeric', timeZone:process.env.TZ || 'Africa/Johannesburg' }).format(date);
}

module.exports = { sendTaskEmail, createTransporter, smtpConfigured, escapeHtml, firstName, formatDateTime, formatDateOnly };
