'use strict';

const express = require('express');
const { requireOwner } = require('../middleware/auth');
const { buildOfficeReport, parseCommand } = require('../services/office-intelligence');

const router = express.Router();

function sourceFromRequest(req) {
  const agent = String(req.get('user-agent') || '').toLowerCase();
  return /android|iphone|ipad|mobile/.test(agent) ? 'mobile' : 'backoffice';
}

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

router.get('/office-intelligence', requireOwner, async (req, res, next) => {
  try {
    const rangeKey = String(req.query.range || 'today');
    const report = await buildOfficeReport({ rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req) });
    res.render('office-intelligence', { title: 'Office Intelligence', report, commandText: '', officeIntelligenceManifest: `${res.locals.basePath}/office-intelligence/manifest.webmanifest` });
  } catch (error) { next(error); }
});

router.post('/office-intelligence/check', requireOwner, async (req, res, next) => {
  try {
    const commandText = String(req.body.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.render('office-intelligence', { title: 'Office Intelligence', report, commandText, officeIntelligenceManifest: `${res.locals.basePath}/office-intelligence/manifest.webmanifest` });
  } catch (error) { next(error); }
});

router.get('/api/office-intelligence/check', requireOwner, async (req, res, next) => {
  try {
    const commandText = String(req.query.command || 'check for me').trim();
    const parsed = parseCommand(commandText);
    const report = await buildOfficeReport({ rangeKey: parsed.rangeKey, requestedBy: req.session.user.id, requestSource: sourceFromRequest(req), commandText });
    res.set('Cache-Control', 'no-store');
    res.json(report);
  } catch (error) { next(error); }
});

module.exports = router;
