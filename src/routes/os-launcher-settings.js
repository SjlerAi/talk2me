const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const DEFAULTS = [
  { slot_key: 'slot_1', display_name: 'Vodacom', icon_text: 'V', portal_url: '', sort_order: 1, is_enabled: 1 },
  { slot_key: 'slot_2', display_name: 'MTN', icon_text: 'MTN', portal_url: '', sort_order: 2, is_enabled: 1 },
 