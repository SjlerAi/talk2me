'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { normaliseSouthAfricanMobile } = require('../services/sa-phone-normalisation');

const router = express.Router();

async function baseSchemaReady() {
  const [[row]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mobile_base_current'
  `);
  return Number(row?.total || 0) === 1;
}

async function safeSection(label, fallback, loader, warnings) {
  try {
    return await loader();
  } catch (error) {
    console.error(`[MobileBase] ${label} failed:`, error.code || '', error.message || error);
    warnings.push(label);
    return fallback;
  }
}

router.get('/search/all', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q}%`;
    const phone = normaliseSouthAfricanMobile(q);

    const [mobile] = await db.execute(`
      SELECT c.id,c.account_number,c.client_name,c.cell_number,c.email,c.handset,c.package_name,
        'mobile' record_type
      FROM clients c
      WHERE (:phone IS NOT NULL AND c.cell_number_normalised=:phone)
         OR c.client_name LIKE :like OR c.cell_number LIKE :like OR c.email LIKE :like
         OR c.account_number LIKE :like OR c.id_number LIKE :like
      ORDER BY CASE WHEN :phone IS NOT NULL AND c.cell_number_normalised=:phone THEN 0 ELSE 1 END,c.client_name
      LIMIT 12
    `, { phone, like });

    let currentBase = [];
    if (await baseSchemaReady()) {
      [currentBase] = await db.execute(`
        SELECT mb.id,mb.account_code account_number,
          COALESCE(NULLIF(TRIM(mb.account_name),''),NULLIF(TRIM(CONCAT_WS(' ',mb.first_name,mb.surname)),''),mb.msisdn_original) client_name,
          mb.msisdn_original cell_number,mb.email_address email,
          NULLIF(TRIM(CONCAT_WS(' ',mb.device_manufacturer,mb.device_name)),'') handset,
          COALESCE(NULLIF(TRIM(mb.tariff_name),''),NULLIF(TRIM(mb.price_plan),'')) package_name,
          'mobile_base' record_type,
          mb.client_id,mb.account_id,mb.icc_id,mb.imsi
        FROM mobile_base_current mb
        WHERE mb.client_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM clients c2
            WHERE c2.cell_number_normalised=mb.msisdn_normalised
          )
          AND (
            (:phone IS NOT NULL AND mb.msisdn_normalised=:phone)
            OR mb.msisdn_original LIKE :like OR mb.account_code LIKE :like OR mb.account_name LIKE :like
            OR mb.first_name LIKE :like OR mb.surname LIKE :like OR mb.email_address LIKE :like
            OR mb.id_number LIKE :like OR mb.icc_id LIKE :like OR mb.imsi LIKE :like
          )
        ORDER BY CASE WHEN :phone IS NOT NULL AND mb.msisdn_normalised=:phone THEN 0 ELSE 1 END,
          mb.account_name,mb.msisdn_normalised
        LIMIT 12
      `, { phone, like });
    }

    const [fixed] = await db.execute(`
      SELECT DISTINCT fa.id,fa.account_number,fa.customer_name client_name,
        fa.contact_number cell_number,fa.email,fs.router_model handset,fs.package_name,
        fs.id fixed_service_id,fs.branch_name,fs.solution_id,fs.order_number,'fixed' record_type
      FROM fixed_accounts fa
      LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
      WHERE (:phone IS NOT NULL AND fa.contact_number_normalised=:phone)
         OR fa.customer_name LIKE :like OR fa.contact_name LIKE :like OR fa.contact_number LIKE :like
         OR fa.email LIKE :like OR fa.account_number LIKE :like OR fs.branch_name LIKE :like
         OR fs.solution_id LIKE :like OR fs.order_number LIKE :like OR fs.sim_number LIKE :like OR fs.mac_address LIKE :like
      ORDER BY fa.customer_name,fs.branch_name
      LIMIT 12
    `, { phone, like });

    const rows = [
      ...mobile.map(row => ({ ...row, url: `${res.locals.basePath}/customers/${row.id}/360` })),
      ...currentBase.map(row => ({ ...row, url: `${res.locals.basePath}/mobile-base/${row.id}` })),
      ...fixed.map(row => ({ ...row, url: `${res.locals.basePath}/fixed/accounts/${row.id}` }))
    ];
    return res.json(rows.slice(0, 20));
  } catch (error) { next(error); }
});

router.get('/mobile-base/:id', requireAuth, async (req, res, next) => {
  try {
    if (!await baseSchemaReady()) return res.status(404).render('error', { title: 'Current mobile service unavailable', message: 'The Base Details service layer is not installed.' });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).render('error', { title: 'Invalid mobile service', message: 'Select a valid current mobile service.' });

    // The Base line itself is the only fatal dependency. Linked CRM/account/history
    // data must never stop a valid current Vodacom service from opening.
    const [[line]] = await db.execute(`SELECT * FROM mobile_base_current WHERE id=:id LIMIT 1`, { id });
    if (!line) return res.status(404).render('error', { title: 'Current mobile service not found', message: 'This current Base Details service line does not exist.' });

    const warnings = [];

    if (line.account_id) {
      const account = await safeSection('Canonical account', null, async () => {
        const [[row]] = await db.execute('SELECT account_number,display_name FROM customer_accounts WHERE id=:id LIMIT 1', { id: line.account_id });
        return row || null;
      }, warnings);
      line.canonical_account_number = account?.account_number || null;
      line.canonical_account_name = account?.display_name || null;
    }

    if (line.client_id) {
      const crmClient = await safeSection('CRM customer link', null, async () => {
        const [[row]] = await db.execute('SELECT client_name FROM clients WHERE id=:id LIMIT 1', { id: line.client_id });
        return row || null;
      }, warnings);
      line.crm_client_name = crmClient?.client_name || null;
    }

    const events = await safeSection('Activation and upgrade history', [], async () => {
      const [rows] = await db.execute(`
        SELECT me.*,su.full_name staff_name
        FROM mobile_events me
        LEFT JOIN staff_users su ON su.id=me.staff_id
        WHERE me.mobile_base_current_id=:id OR me.msisdn_normalised=:phone
        ORDER BY me.event_date DESC,me.id DESC
        LIMIT 50
      `, { id, phone: line.msisdn_normalised });
      return rows;
    }, warnings);

    const snapshots = await safeSection('Base snapshot history', [], async () => {
      const [rows] = await db.execute(`
        SELECT id,batch_id,source_row_number,captured_at
        FROM mobile_base_snapshots
        WHERE mobile_base_current_id=:id
        ORDER BY captured_at DESC,id DESC
        LIMIT 24
      `, { id });
      return rows;
    }, warnings);

    return res.render('mobile-base-view', {
      title: line.account_name || line.msisdn_original || 'Current Vodacom Service',
      line,events,snapshots,sectionWarnings:[...new Set(warnings)]
    });
  } catch (error) {
    console.error(`[MobileBase ${req.params.id}] fatal open failure:`, error.code || '', error.message || error);
    next(error);
  }
});

module.exports = router;
