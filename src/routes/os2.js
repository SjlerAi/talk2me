const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function isManagementRole(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

router.get('/os2', requireAuth, (req, res) => {
  res.render('os2-shell', {
    layout: false,
    title: 'Talk2Me OS2',
    isManagement: isManagementRole(req.session.user)
  });
});

module.exports = router;
