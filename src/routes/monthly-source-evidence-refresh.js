'use strict';

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { refreshMonthlySourceEvidence } = require('../services/monthly-source-evidence-refresh');

const router = express.Router();
const acceptedMimeTypes = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter(req, file, done) {
    const name = String(file.originalname || '').toLowerCase();
    const validExtension = name.endsWith('.xls') || name.endsWith('.xlsx');
    const validMime = acceptedMimeTypes.has(String(file.mimetype || '').toLowerCase());
    return done(validExtension && validMime ? null : new Error('Only genuine .xls and .xlsx spreadsheet reports are accepted.'), validExtension && validMime);
  }
});

router.post('/backoffice/data-import/refresh-source-evidence', requireAuth, requireRole('owner','manager'), upload.single('source_evidence_report'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Select the exact original report file that is already in Monthly Import.');
    const result = await refreshMonthlySourceEvidence({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      userId: req.session.user.id
    });
    const notice = `Source evidence refreshed for batch #${result.batchId}: ${result.refreshedRows} row(s). Matching, approvals and customer records were not changed.`;
    return res.redirect(`${res.locals.basePath}/backoffice/data-import?tab=upload&notice=${encodeURIComponent(notice)}`);
  } catch (error) {
    return res.redirect(`${res.locals.basePath}/backoffice/data-import?tab=upload&error=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router;
