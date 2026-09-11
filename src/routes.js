const express = require('express');

const router = express.Router();

// Keep the existing route bundle intact while adding focused extensions.
router.use(require('./routes/contact-list-builder'));
router.use(require('./routes/customer-details'));
router.use(require('./routes/staff-import-identities'));
router.use(require('./routes/base-details-centre'));
router.use(require('./routes/monthly-source-evidence-refresh'));
router.use(require('./routes/index'));

module.exports = router;
