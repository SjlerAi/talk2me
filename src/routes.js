const express = require('express');

const router = express.Router();

// Keep the existing route bundle intact while adding the owner-only
// contact audience module as a focused extension.
router.use(require('./routes/contact-list-builder'));
router.use(require('./routes/index'));

module.exports = router;
