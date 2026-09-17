'use strict';

const express = require('express');
const { buildOfficeReport, parseCommand } = require('../services/office-intelligence');

const router = express.Router();

function sourceFromRequest(req) {
  const agent = String(req.get('user-agent') || '').toLowerCase();
  return /android|iphone|ipad|mobile/.test(agent) ? 'mobile' : 'backoffice';
}

function requireOfficeIntelligenceAccess(req, res, next) {
  if (!req.session.user) {
    return res.redirect(`${res.locals.basePath}/login?return=office-intelligence`);
  }
  if (!['owner', 'manager'].includes(req.session.user.role)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Owner or manager access required.'
    });
  }
  next();
}

// Preserve the existing Talk2Me login handler, but when the login journey started
// from Gerda Agent, replace only its normal /workspace landing with Office Intelligence.
router.post('/login', (req, res, next) => {
  if (String(req.query.return || '') !== 'office-intelligence') return next();
  const originalRedirect = res.redirect.bind(res);
  res.redirect = target => {
    const normalWorkspace = `${res.locals.basePath}/workspace`;
    if (String(target) === normalWorkspace) {
      return originalRedirect(`${res.locals.basePath}/office-intelligence`);
    }
    return originalRedirect(target);
  };
  next();
});

router.get('/office-intelligence/manifest.webmanifest', (req, res) => {
  const basePath = res.locals.basePath || '';
  res.type('application/manifest+json').send({
    id: `${basePath}/office-intelligence`,
    name: 'Gerda - Talk2Me',
    short_name: 'Gerda',
    description: 'Talk2Me Office Intelligence - live shop oversight',
    start_url: `${basePath}/office-intelligence`,
    scope: `${basePath || ''}/`,
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      { src: `${basePath}/public/images/favicon-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${basePath}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${basePath}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
});

router.get('/office-intelligence', requireOfficeIntelligenceAccess, async (req, res, next) => {
  try {
    const rangeKey = String(req.query.range || 'today');
    const report = await buildOfficeReport({ rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req) });
    res.render('office-intelligence', { title: 'Office Intelligence', report, commandText: '', officeIntelligenceManifest: `${res.locals.basePath}/office-intelligence/manifest.webmanifest` });
  } catch (error) { next(error); }
});

router.post('/office-intelligence/check', requireOfficeIntelligenceAccess, async (req, res, next) => {
  try {
    const commandText = String(req.body.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.render('office-intelligence', { title: 'Office Intelligence', report, commandText, officeIntelligenceManifest: `${res.locals.basePath}/office-intelligence/manifest.webmanifest` });
  } catch (error) { next(error); }
});

router.get('/api/office-intelligence/check', requireOfficeIntelligenceAccess, async (req, res, next) => {
  try {
    const commandText = String(req.query.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.set('Cache-Control', 'no-store');
    res.json(report);
  } catch (error) { next(error); }
});

module.exports = router;
