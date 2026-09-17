'use strict';

const express = require('express');
const { buildOfficeReport, parseCommand } = require('../services/office-intelligence');

const router = express.Router();

function sourceFromRequest(req) {
  const agent = String(req.get('user-agent') || '').toLowerCase();
  return /android|iphone|ipad|mobile/.test(agent) ? 'mobile' : 'backoffice';
}

function hasAgentAccess(user) {
  return Boolean(user && ['owner', 'manager'].includes(user.role));
}

function requireOfficeIntelligenceAccess(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login?return=office-intelligence`);
  if (!hasAgentAccess(req.session.user)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Owner or manager access required.' });
  }
  next();
}

function requireStandaloneAgentAccess(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/agent/login`);
  if (!hasAgentAccess(req.session.user)) {
    return res.status(403).render('agent-login', {
      layout: false,
      title: 'Gerda Agent',
      error: 'This private management agent is available only to authorised owner or manager accounts.'
    });
  }
  next();
}

router.post('/login', (req, res, next) => {
  const returnTarget = String(req.query.return || '');
  if (!['office-intelligence', 'agent'].includes(returnTarget)) return next();

  const originalRedirect = res.redirect.bind(res);
  const originalRender = res.render.bind(res);

  res.redirect = target => {
    const normalWorkspace = `${res.locals.basePath}/workspace`;
    if (String(target) === normalWorkspace) {
      const path = returnTarget === 'agent' ? '/agent' : '/office-intelligence';
      return originalRedirect(`${res.locals.basePath}${path}`);
    }
    return originalRedirect(target);
  };

  if (returnTarget === 'agent') {
    res.render = (view, locals = {}, callback) => {
      if (view === 'login') {
        return originalRender('agent-login', {
          layout: false,
          title: 'Gerda Agent',
          error: locals.error || 'Invalid login details.'
        }, callback);
      }
      return originalRender(view, locals, callback);
    };
  }

  next();
});

router.post('/logout', (req, res, next) => {
  if (String(req.query.return || '') !== 'agent') return next();
  const originalRedirect = res.redirect.bind(res);
  res.redirect = target => {
    const normalLogin = `${res.locals.basePath}/login`;
    if (String(target) === normalLogin) return originalRedirect(`${res.locals.basePath}/agent/login`);
    return originalRedirect(target);
  };
  next();
});

router.get('/agent/login', (req, res) => {
  if (hasAgentAccess(req.session.user)) return res.redirect(`${res.locals.basePath}/agent`);
  res.render('agent-login', { layout: false, title: 'Gerda Agent', error: null });
});

router.get('/agent/manifest.webmanifest', (req, res) => {
  const basePath = res.locals.basePath || '';
  res.type('application/manifest+json').send({
    id: `${basePath}/agent`,
    name: 'Gerda Agent - Talk2Me',
    short_name: 'Gerda Agent',
    description: 'Private Talk2Me live management agent',
    start_url: `${basePath}/agent`,
    scope: `${basePath}/agent`,
    display: 'standalone',
    background_color: '#fff8ef',
    theme_color: '#9d3f74',
    icons: [
      { src: `${basePath}/public/images/favicon-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${basePath}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${basePath}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
});

router.get('/agent', requireStandaloneAgentAccess, async (req, res, next) => {
  try {
    const rangeKey = String(req.query.range || 'today');
    const report = await buildOfficeReport({ rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req) });
    res.render('agent', { layout: false, title: 'Gerda Agent', report, commandText: '' });
  } catch (error) { next(error); }
});

router.post('/agent/check', requireStandaloneAgentAccess, async (req, res, next) => {
  try {
    const commandText = String(req.body.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.render('agent', { layout: false, title: 'Gerda Agent', report, commandText });
  } catch (error) { next(error); }
});

router.get('/api/agent/check', requireStandaloneAgentAccess, async (req, res, next) => {
  try {
    const commandText = String(req.query.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.set('Cache-Control', 'no-store');
    res.json(report);
  } catch (error) { next(error); }
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
