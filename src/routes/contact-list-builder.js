const express = require('express');
const { requireRole } = require('../middleware/permissions');
const { createTransporter, smtpConfigured, escapeHtml } = require('../services/mailer');
const { audit } = require('../services/audit');
const { CATEGORY_LABELS, loadAudience, audienceCsv, normaliseEmail } = require('../services/contact-audience');

const router = express.Router();
const ownerOnly = requireRole('owner');

function filtersFrom(req) {
  return {
    category: String(req.query.category || req.body.category || 'all'),
    preset: String(req.query.preset || req.body.preset || '6m'),
    from: String(req.query.from || req.body.from || ''),
    to: String(req.query.to || req.body.to || '')
  };
}

function safeBodyHtml(body) {
  return escapeHtml(String(body || '')).replace(/\r?\n/g, '<br>');
}

router.get('/backoffice/contact-lists', ownerOnly, async (req, res, next) => {
  try {
    const filters = filtersFrom(req);
    const audience = await loadAudience(filters);
    res.render('contact-list-builder', {
      title: 'Contact Lists & Customer Communication',
      audience,
      categories: CATEGORY_LABELS,
      filters: { ...filters, ...audience.range },
      message: req.query.message || null,
      error: null,
      campaign: null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/backoffice/contact-lists/export.csv', ownerOnly, async (req, res, next) => {
  try {
    const audience = await loadAudience(filtersFrom(req));
    const stamp = new Date().toISOString().slice(0, 10);
    const safeCategory = audience.category.replace(/[^a-z0-9_-]/gi, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="talk2me-${safeCategory}-${stamp}.csv"`);
    res.send('\ufeff' + audienceCsv(audience));
    await audit(req, {
      actionType: 'contact_list_exported',
      entityType: 'contact_audience',
      description: `Owner exported ${audience.counts.contacts} contacts from ${audience.categoryLabel}`,
      after: { category: audience.category, range: audience.range, counts: audience.counts }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/backoffice/contact-lists/test-email', ownerOnly, async (req, res, next) => {
  try {
    const filters = filtersFrom(req);
    const audience = await loadAudience(filters);
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    const testTo = normaliseEmail(req.session.user.email);
    if (!subject || !body) throw new Error('Enter both a subject and message before sending a test.');
    if (!testTo) throw new Error('Your owner account does not have a valid email address for the test send.');
    if (!smtpConfigured()) throw new Error('SMTP is not configured.');
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`,
      to: testTo,
      subject: `[TEST] ${subject}`,
      text: body,
      html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933"><div style="max-width:680px;margin:auto"><p style="font-size:13px;color:#667085">Talk2Me customer communication test</p><div style="font-size:16px;line-height:1.6">${safeBodyHtml(body)}</div></div></body></html>`
    });
    await audit(req, {
      actionType: 'contact_campaign_test_sent',
      entityType: 'contact_audience',
      description: `Owner sent a customer communication test email`,
      after: { category: audience.category, range: audience.range, recipient_count: audience.counts.emails, message_id: info.messageId || null }
    });
    res.render('contact-list-builder', {
      title: 'Contact Lists & Customer Communication',
      audience,
      categories: CATEGORY_LABELS,
      filters: { ...filters, ...audience.range },
      message: `Test email sent to ${testTo}.`,
      error: null,
      campaign: { subject, body }
    });
  } catch (error) {
    try {
      const filters = filtersFrom(req);
      const audience = await loadAudience(filters);
      return res.status(400).render('contact-list-builder', {
        title: 'Contact Lists & Customer Communication',
        audience,
        categories: CATEGORY_LABELS,
        filters: { ...filters, ...audience.range },
        message: null,
        error: error.message,
        campaign: { subject: req.body.subject || '', body: req.body.body || '' }
      });
    } catch (renderError) {
      next(renderError);
    }
  }
});

router.post('/backoffice/contact-lists/send-email', ownerOnly, async (req, res, next) => {
  try {
    const filters = filtersFrom(req);
    const audience = await loadAudience(filters);
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    const confirmed = String(req.body.confirm_send || '') === '1';
    if (!subject || !body) throw new Error('Enter both a subject and message.');
    if (!confirmed) throw new Error('Confirm the recipient count before sending.');
    if (!audience.emails.length) throw new Error('This audience contains no valid email addresses.');
    if (audience.emails.length > 250) throw new Error('The owner pilot currently sends a maximum of 250 recipients at once. Narrow the date range or export the list. A queued bulk sender can be added after owner testing.');
    if (!smtpConfigured()) throw new Error('SMTP is not configured.');

    const transporter = createTransporter();
    const from = process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`;
    const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933"><div style="max-width:680px;margin:auto"><div style="font-size:16px;line-height:1.6">${safeBodyHtml(body)}</div><hr style="border:0;border-top:1px solid #e5e7eb;margin:30px 0"><p style="font-size:12px;color:#667085">Sent through Talk2Me CRM.</p></div></body></html>`;
    let sent = 0;
    const failures = [];
    for (const to of audience.emails) {
      try {
        await transporter.sendMail({ from, to, subject, text: body, html });
        sent += 1;
      } catch (error) {
        failures.push({ to, error: String(error.message || 'Email delivery failed').slice(0, 180) });
      }
    }

    await audit(req, {
      actionType: 'contact_campaign_sent',
      entityType: 'contact_audience',
      description: `Owner sent customer communication to ${sent} recipients; ${failures.length} failed`,
      after: { category: audience.category, range: audience.range, requested: audience.emails.length, sent, failed: failures.length }
    });

    res.render('contact-list-builder', {
      title: 'Contact Lists & Customer Communication',
      audience,
      categories: CATEGORY_LABELS,
      filters: { ...filters, ...audience.range },
      message: `Campaign completed: ${sent} sent${failures.length ? `, ${failures.length} failed` : ''}.`,
      error: failures.length ? `Some emails failed. ${failures.slice(0, 3).map(x => `${x.to}: ${x.error}`).join(' | ')}` : null,
      campaign: { subject, body }
    });
  } catch (error) {
    try {
      const filters = filtersFrom(req);
      const audience = await loadAudience(filters);
      return res.status(400).render('contact-list-builder', {
        title: 'Contact Lists & Customer Communication',
        audience,
        categories: CATEGORY_LABELS,
        filters: { ...filters, ...audience.range },
        message: null,
        error: error.message,
        campaign: { subject: req.body.subject || '', body: req.body.body || '' }
      });
    } catch (renderError) {
      next(renderError);
    }
  }
});

module.exports = router;
