const express = require('express');

const router = express.Router();

// Keep staff inside the task manager after completing or updating an item.
router.use(require('../middleware/task-return-navigation'));

// Mount the closed-loop task and message workflow before the legacy routes in
// src/routes/index.js. Routes not handled here, such as task creation and
// personal notes, continue through to the existing authenticated handlers.
router.use(require('./task-workflow'));

module.exports = router;
