const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { normaliseSouthAfricanMobile } = require('../services/sa-phone-normalisation');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';

async function mobileDataSchemaReady() {
  const [rows] = await db.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('mobile_base_current','mobile_events')
  `);
  return new Set(rows.map(row => row.TABLE_NAME)).size === 2;
}

async function safeSection(customerId, label, fallback, loader, warnings) {
  try {
    return await loader();
  } catch (error) {
    console.error(`[Customer360 ${customerId}] ${label} failed:`, error.code || '', error.message || error);
    warnings.push(label);
    return fallback;
  }
}

function safeDiagnostic(error) {
  const code = String(error?.code || 'ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 40);
  const message = String(error?.message || 'Unknown route failure')
    .replace(/\s+/g, ' ')
    .replace(/\/home\/[^\s]+/g, '[server-path]')
    .slice(0, 220);
  return `${code}: ${message}`;
}

router.get('/customers/:id/360', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('error', { title: 'Invalid customer', message: 'The customer record could not be identified.' });
    }

    const [[client]] = await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1', { id });
    if (!client) {
      return res.status(404).render('error', { title: 'Not found', message: 'Client line could not be found.' });
    }

    const warnings = [];
    const accountNumber = String(client.account_number || '').trim();

    const lines = await safeSection(id, 'Account lines', [client], async () => {
      const [rows] = await db.execute(
        `SELECT * FROM clients
         WHERE id=:id OR (:account<>'' AND account_number=:account)
         ORDER BY line_status='active' DESC,next_upgrade_date,cell_number`,
        { id, account: accountNumber }
      );
      return rows.length ? rows : [client];
    }, warnings);

    const lineIds = lines.map(line => Number(line.id)).filter(value => Number.isInteger(value) && value > 0);
    if (!lineIds.includes(id)) lineIds.unshift(id);
    const phoneNumbers = [...new Set(lines.map(line => String(line.cell_number || '').trim()).filter(Boolean))];
    const canonicalPhones = [...new Set(lines.flatMap(line => [
      line.cell_number_normalised, line.cell_number,
      line.main_contact_number_normalised, line.main_contact_number, line.alt_number
    ]).map(normaliseSouthAfricanMobile).filter(Boolean))];

    const history = await safeSection(id, 'Interaction history', [], async () => {
      const clauses = [`i.client_id IN (${lineIds.map(() => '?').join(',')})`];
      const params = [...lineIds];
      if (phoneNumbers.length) {
        clauses.push(`i.cell_number IN (${phoneNumbers.map(() => '?').join(',')})`);
        params.push(...phoneNumbers);
      }
      const [rows] = await db.query(
        `SELECT i.*,ic.category_name,COALESCE(a.full_name,s.full_name,'Unassigned') responsible_name
         FROM inquiries i
         LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
         LEFT JOIN staff_users a ON a.id=i.assigned_staff_id
         LEFT JOIN staff_users s ON s.id=i.staff_id
         WHERE ${clauses.join(' OR ')}
         ORDER BY i.created_at DESC LIMIT 100`,
        params
      );
      return rows;
    }, warnings);

    const tasks = await safeSection(id, 'Related tasks', [], async () => {
      const [rows] = await db.query(
        `SELECT t.*,s.full_name assigned_name
         FROM staff_tasks t
         LEFT JOIN staff_users s ON s.id=t.assigned_to
         WHERE t.related_client_id IN (${lineIds.map(() => '?').join(',')})
         ORDER BY t.created_at DESC LIMIT 50`,
        lineIds
      );
      return rows;
    }, warnings);

    const assignment = await safeSection(id, 'Client assignment', null, async () => {
      const [[row]] = await db.execute(
        `SELECT COALESCE(su.full_name,'Unknown staff') full_name,a.assigned_staff_id id
         FROM client_assignments a
         LEFT JOIN staff_users su ON su.id=a.assigned_staff_id
         WHERE a.is_active=1
           AND (a.client_id=:id OR (:account<>'' AND a.account_number=:account))
         ORDER BY (a.client_id=:id) DESC,a.updated_at DESC LIMIT 1`,
        { id, account: accountNumber }
      );
      return row || null;
    }, warnings);

    const assignmentStaff = ['owner','manager','admin'].includes(req.session.user.role)
      ? await safeSection(id, 'Staff assignment list', [], async () => {
        const [rows] = await db.query('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
        return rows;
      }, warnings)
      : [];

    let accountRecord = null;
    if (client.account_id) {
      accountRecord = await safeSection(id, 'Customer account', null, async () => {
        const [[row]] = await db.execute(
          `SELECT a.*,s.full_name assigned_staff_name
           FROM customer_accounts a
           LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
           WHERE a.id=:accountId LIMIT 1`,
          { accountId: client.account_id }
        );
        return row || null;
      }, warnings);
    } else if (accountNumber) {
      accountRecord = await safeSection(id, 'Customer account', null, async () => {
        const [[row]] = await db.execute(
          `SELECT a.*,s.full_name assigned_staff_name
           FROM customer_accounts a
           LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
           WHERE a.account_number_normalised=UPPER(REPLACE(TRIM(:account),' ','')) LIMIT 1`,
          { account: accountNumber }
        );
        return row || null;
      }, warnings);
    }

    let pendingClaim = null;
    if (accountRecord) {
      pendingClaim = await safeSection(id, 'Pending ownership claim', null, async () => {
        const [[row]] = await db.query(
          `SELECT r.id,r.requested_by,u.full_name requested_by_name,r.created_at
           FROM data_change_requests r
           LEFT JOIN staff_users u ON u.id=r.requested_by
           WHERE r.request_type IN ('claim_account','claim_client')
             AND (r.record_id=? OR r.client_id IN (${lineIds.map(() => '?').join(',')}))
             AND r.status IN ('pending_manager','pending_owner')
           ORDER BY r.created_at LIMIT 1`,
          [accountRecord.id, ...lineIds]
        );
        return row || null;
      }, warnings);
    }

    const pendingAccountRequest = await safeSection(id, 'Pending account-number request', null, async () => {
      const [[row]] = await db.execute(
        `SELECT r.id,r.created_at,r.status,u.full_name requested_by_name
         FROM data_change_requests r
         LEFT JOIN staff_users u ON u.id=r.requested_by
         WHERE r.request_type='assign_account_number'
           AND r.status IN ('pending_manager','pending_owner')
           AND (r.client_id=:id OR r.record_id=:id)
         ORDER BY r.created_at LIMIT 1`,
        { id }
      );
      return row || null;
    }, warnings);

    let fixedAccounts = [];
    if (accountNumber) {
      fixedAccounts = await safeSection(id, 'Fixed services', [], async () => {
        const [rows] = await db.execute(
          `SELECT fa.*,COUNT(fs.id) fixed_service_count
           FROM fixed_accounts fa
           LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
           WHERE fa.account_number=:account OR fa.linked_mobile_account_number=:account
           GROUP BY fa.id`,
          { account: accountNumber }
        );
        return rows;
      }, warnings);
    }

    let currentMobileServices = [];
    let mobileEvents = [];
    let currentMobileDataReady = false;
    const mobileReady = await safeSection(id, 'Vodacom service schema', false, mobileDataSchemaReady, warnings);
    if (mobileReady) {
      currentMobileDataReady = true;
      const serviceClauses = [];
      const serviceParams = [];
      if (lineIds.length) {
        serviceClauses.push(`mb.client_id IN (${lineIds.map(() => '?').join(',')})`);
        serviceParams.push(...lineIds);
      }
      if (client.account_id) {
        serviceClauses.push('mb.account_id=?');
        serviceParams.push(Number(client.account_id));
      }
      if (canonicalPhones.length) {
        serviceClauses.push(`mb.msisdn_normalised IN (${canonicalPhones.map(() => '?').join(',')})`);
        serviceParams.push(...canonicalPhones);
      }
      if (serviceClauses.length) {
        currentMobileServices = await safeSection(id, 'Current Vodacom services', [], async () => {
          const [rows] = await db.query(`
            SELECT mb.*
            FROM mobile_base_current mb
            WHERE ${serviceClauses.join(' OR ')}
            ORDER BY mb.msisdn_normalised
          `, serviceParams);
          return rows;
        }, warnings);
      }

      const eventClauses = [];
      const eventParams = [];
      if (lineIds.length) {
        eventClauses.push(`me.client_id IN (${lineIds.map(() => '?').join(',')})`);
        eventParams.push(...lineIds);
      }
      if (client.account_id) {
        eventClauses.push('me.account_id=?');
        eventParams.push(Number(client.account_id));
      }
      if (canonicalPhones.length) {
        eventClauses.push(`me.msisdn_normalised IN (${canonicalPhones.map(() => '?').join(',')})`);
        eventParams.push(...canonicalPhones);
      }
      if (eventClauses.length) {
        mobileEvents = await safeSection(id, 'Activation and upgrade history', [], async () => {
          const [rows] = await db.query(`
            SELECT me.*,su.full_name staff_name
            FROM mobile_events me
            LEFT JOIN staff_users su ON su.id=me.staff_id
            WHERE ${eventClauses.join(' OR ')}
            ORDER BY me.event_date DESC,me.id DESC
            LIMIT 100
          `, eventParams);
          return rows;
        }, warnings);
      }
    }

    res.render('customer-360', {
      title: client.client_name || 'Customer Workspace',
      client,
      lines,
      history,
      tasks,
      assignment,
      assignmentStaff,
      accountRecord,
      pendingClaim,
      pendingAccountRequest,
      fixedAccounts,
      currentMobileDataReady,
      currentMobileServices,
      mobileEvents,
      sectionWarnings: [...new Set(warnings)],
      assigned: req.query.assigned,
      claimRequested: req.query.claim_requested,
      claimConflict: req.query.claim_conflict,
      claimOwner: String(req.query.claim_owner || '').trim().slice(0, 255),
      changeRequested: req.query.change_requested,
      detailsSaved: String(req.query.details_saved || '') === '1',
      converted: String(req.query.converted || '') === '1'
    });
  } catch (error) {
    console.error(`[Customer360 ${req.params.id}] fatal open failure:`, error.code || '', error.message || error);
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (!IS_UAT) return next(error);
  console.error('[Customer360 UAT route diagnostic]', error);
  if (res.headersSent) return next(error);
  return res.status(500).render('error', {
    title: 'Customer open error',
    message: 'The customer was found, but the customer workspace could not be opened.',
    diagnostic: safeDiagnostic(error)
  });
});

module.exports = router;
