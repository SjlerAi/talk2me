const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/os/quick-add/prospect', requireAuth, (req, res) => {
  res.render('os-quick-add', {
    layout: false,
    title: 'Add Prospect Inquiry',
    type: 'prospect',
    error: null,
    saved: false,
    values: {
      prospect_name: String(req.query.prospect_name || '').trim(),
      cell_number: String(req.query.cell_number || '').trim(),
      email: String(req.query.email || '').trim(),
      lead_source: String(req.query.lead_source || 'Customer search').trim()
    }
  });
});

module.exports = router;
