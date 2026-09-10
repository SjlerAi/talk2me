const express = require('express');
const multer = require('multer');
const { requireRole } = require('../middleware/permissions');
const { createTransporter, smtpConfigured, escapeHtml } = require('../services/mailer');
const { audit } = require('../services/audit');
const { CATEGORY_LABELS, loadAudience, audienceCsv, normaliseEmail } = require('../services/contact-audience');
const { MAX_IMPORT_BYTES, parseImportedMessage, nodemailerAttachments } = require('../services/imported-email');

const router = express.Router();
const ownerOnly = requireRole('owner');
const uploadImport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 }
}).single('email_file');

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

function currentImported(req) {
  const imported = req.session?.talk2meImportedEmail;
  return imported && imported.html ? imported : null;
}

function clearImported(req) {
  if (req.session) delete req.session.talk2meImportedEmail;
}

function composeMessage(req) {
  const requestedMode = String(req.body.email_mode || 'manual');
  const imported = currentImported(req);
  if (requestedMode === 'imported' && imported) {
    return {
      mode: 'imported',
      subject: String(req.body.subject || imported.subject || '').trim(),
      body: imported.text || '',
      html: imported.html,
      attachments: nodemailerAttachments(imported)
    };
  }
  const body = String(req.body.body || '').trim();
  return {
    mode: 'manual',
    subject: String(req.body.subject || '').trim(),
    body,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933"><div style="max-width:680px;margin:auto"><div style="font-size:16px;line-height:1.6">${safeBodyHtml(body)}</div><hr style="border:0;border-top:1px solid #e5e7eb;margin:30px 0"><p style="font-size:12px;color:#667085">Sent through Talk2Me CRM.</p></div></body></html>`,
    attachments: []
  };
}

async function renderPage(req, res, options = {}) {
  const filters = options.filters || filtersFrom(req);
  const audience = options.audience || await loadAudience(filters);
  return res.status(options.status || 200).render('contact-list-builder', {
    title: 'Contact Lists & Customer Communication',
    audience,
    categories: CATEGORY_LABELS,
    filters: { ...filters, ...audience.range },
    message: options.message || null,
    error: options.error || null,
    campaign: options.campaign || null,
    importedEmail: currentImported(req)
  });
}

router.get('/backoffice/contact-lists', ownerOnly, async (req, res, next) => {
  try {
    await renderPage(req, res, { message: req.query.message || null });
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

router.post('/backoffice/contact-lists/import-email', ownerOnly, (req, res, next) => {
  uploadImport(req, res, async uploadError => {
    try {
      if (uploadError) throw uploadError;
      if (!req.file) throw new Error('Choose an .eml or HTML email file to import.');
      const imported = parseImportedMessage(req.file);
      req.session.talk2meImportedEmail = {
        ...imported,
        importedAt: new Date().toISOString(),
        sourceFilename: req.file.originalname
      };
      await audit(req, {
        actionType: 'contact_campaign_email_imported',
        entityType: 'contact_audience',
        description: 'Owner imported an existing email for customer communication',
        after: {
          filename: req.file.originalname,
          original_from: imported.originalFrom || null,
          attachment_count: imported.attachments.length,
          inline_image_count: imported.inlineImageCount
        }
      });
      await renderPage(req, res, {
        message: `Imported ${req.file.originalname}. Review the preview, send a test, then send to the selected audience.`,
        campaign: { subject: imported.subject || '', body: imported.text || '', mode: 'imported' }
      });
    } catch (error) {
      try {
        await renderPage(req, res, { status: 400, error: error.message });
      } catch (renderError) {
        next(renderError);
      }
    }
  });
});

router.post('/backoffice/contact-lists/clear-import', ownerOnly, async (req, res, next) => {
  try {
    clearImported(req);
    await renderPage(req, res, { message: 'Imported email cleared. You can write a new message or import another email.' });
  } catch (error) {
    next(error);
  }
});

router.post('/backoffice/contact-lists/test-email', ownerOnly, async (req, res, next) => {
  try {
    const filters = filtersFrom(req);
    const audience = await loadAudience(filters);
    const message = composeMessage(req);
    const testTo = normaliseEmail(req.session.user.email);
    if (!message.subject || (!message.body && !message.html)) throw new Error('Enter a subject and message, or import an email, before sending a test.');
    if (!testTo) throw new Error('Your owner account does not have a valid email address for the test send.');
    if (!smtpConfigured()) throw new Error('SMTP is not configured.');
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`,
      to: testTo,
      subject: `[TEST] ${message.subject}`,
      text: message.body || undefined,
      html: message.html,
      attachments: message.attachments
    });
    await audit(req, {
      actionType: 'contact_campaign_test_sent',
      entityType: 'contact_audience',
      description: 'Owner sent a customer communication test email',
      after: { category: audience.category, range: audience.range, recipient_count: audience.counts.emails, mode: message.mode, message_id: info.messageId || null }
    });
    await renderPage(req, res, {
      filters,
      audience,
      message: `Test email sent to ${testTo}.`,
      campaign: { subject: message.subject, body: message.body, mode: message.mode }
    });
  } catch (error) {
    try {
      await renderPage(req, res, {
        status: 400,
        error: error.message,
        campaign: { subject: req.body.subject || '', body: req.body.body || '', mode: req.body.email_mode || 'manual' }
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
    const message = composeMessage(req);
    const confirmed = String(req.body.confirm_send || '') === '1';
    if (!message.subject || (!message.body && !message.html)) throw new Error('Enter a subject and message, or import an email.');
    if (!confirmed) throw new Error('Confirm the recipient count before sending.');
    if (!audience.emails.length) throw new Error('This audience contains no valid email addresses.');
    if (audience.emails.length > 250) throw new Error('The owner pilot currently sends a maximum of 250 recipients at once. Narrow the date range or export the list. A queued bulk sender can be added after owner testing.');
    if (!smtpConfigured()) throw new Error('SMTP is not configured.');

    const transporter = createTransporter();
    const from = process.env.MAIL_FROM || `Talk2Me CRM <${process.env.SMTP_USER}>`;
    let sent = 0;
    const failures = [];
    for (const to of audience.emails) {
      try {
        await transporter.sendMail({
          from,
          to,
          subject: message.subject,
          text: message.body || undefined,
          html: message.html,
          attachments: message.attachments
        });
        sent += 1;
      } catch (error) {
        failures.push({ to, error: String(error.message || 'Email delivery failed').slice(0, 180) });
      }
    }

    await audit(req, {
      actionType: 'contact_campaign_sent',
      entityType: 'contact_audience',
      description: `Owner sent customer communication to ${sent} recipients; ${failures.length} failed`,
      after: { category: audience.category, range: audience.range, requested: audience.emails.length, sent, failed: failures.length, mode: message.mode }
    });

    await renderPage(req, res, {
      filters,
      audience,
      message: `Campaign completed: ${sent} sent${failures.length ? `, ${failures.length} failed` : ''}.`,
      error: failures.length ? `Some emails failed. ${failures.slice(0, 3).map(x => `${x.to}: ${x.error}`).join(' | ')}` : null,
      campaign: { subject: message.subject, body: message.body, mode: message.mode }
    });
  } catch (error) {
    try {
      await renderPage(req, res, {
        status: 400,
        error: error.message,
        campaign: { subject: req.body.subject || '', body: req.body.body || '', mode: req.body.email_mode || 'manual' }
      });
    } catch (renderError) {
      next(renderError);
    }
  }
});

module.exports = router;
