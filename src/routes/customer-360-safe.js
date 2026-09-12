const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function logSectionFailure(section, clientId, error) {
  console.error(`[customer-360] ${section} failed for client ${clientId}:`, error && error.message ? error.message : error);
}

async function optionalSection(section, clientId, fallback, loader) {
  try {
    return await loader();
  } catch (error) {
    logSectionFailure(section, clientId, error);
    return fallback;
  }
}

router.get('/customers/:id/360', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('error', { title: 'Invalid customer', message: 'The customer record could not be identified.' });
    }

    // CORE CONTRACT: if the customer exists in clients, Customer 360 must open.
    // Everything else on the page is enrichment and may degrade independently.
    const [[client]] = await db.execute('SELECT * FROM clients WHERE id=:id LIMIT 1', { id });
    if (!client) {
      return res.status(404).render('error', { title: 'Not found', message: 'Client line could not be found.' });
    }

    const accountNumber = String(client.account_number || '').trim();

    const lines = await optionalSection('account lines', id, [client], async () => {
      const [rows] = await db.execute(
        `SELECT * FROM clients
         WHERE id=:id OR (:account<>'' AND account_number=:account)
         ORDER BY line_status='active' DESC,next_upgrade_date,cell_number`,
        { id, account: accountNumber }
      );
      return rows.length ? rows : [client];
    });

    const lineIds = lines.map(line => Number(line.id)).filter(Boolean);
    const phoneNumbers = [...new Set(lines.map(line => String(line.cell_number || '').trim()).filter(Boolean))];

    const history = await optionalSection('interaction history', id, [], async () => {
      if (!lineIds.length) return [];
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
    });

    const tasks = await optionalSection('related tasks', id, [], async () => {
      if (!lineIds.length) return [];
      const [rows] = await db.query(
        `SELECT t.*,s.full_name assigned_name
         FROM staff_tasks t
         JOIN staff_users s ON s.id=t.assigned_to
         WHERE t.related_client_id IN (${lineIds.map(() => '?').join(',')})
         ORDER BY t.created_at DESC LIMIT 50`,
        lineIds
      );
      return rows;
    });

    const assignment = await optionalSection('assignment', id, null, async () => {
      const [[row]] = await db.execute(
        `SELECT su.full_name,su.id
         FROM client_assignments a
         JOIN staff_users su ON su.id=a.assigned_staff_id
         WHERE a.is_active=1
           AND (a.client_id=:id OR (:account<>'' AND a.account_number=:account))
         ORDER BY (a.client_id=:id) DESC,a.updated_at DESC LIMIT 1`,
        { id, account: accountNumber }
      );
      return row || null;
    });

    const assignmentStaff = ['owner','manager','admin'].includes(req.session.user.role)
      ? await optionalSection('assignment staff', id, [], async () => {
          const [rows] = await db.query('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
          return rows;
        })
      : [];

    const accountRecord = await optionalSection('customer account', id, null, async () => {
      if (client.account_id) {
        const [[row]] = await db.execute(
          `SELECT a.*,s.full_name assigned_staff_name
           FROM customer_accounts a
           LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
           WHERE a.id=:accountId LIMIT 1`,
          { accountId: client.account_id }
        );
        return row || null;
      }
      if (!accountNumber) return null;
      const [[row]] = await db.execute(
        `SELECT a.*,s.full_name assigned_staff_name
         FROM customer_accounts a
         LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
         WHERE a.account_number_normalised=UPPER(REPLACE(TRIM(:account),' ','')) LIMIT 1`,
        { account: accountNumber }
      );
      return row || null;
    });

    const pendingClaim = await optionalSection('pending claim', id, null, async () => {
      if (!accountRecord || !lineIds.length) return null;
      const [[row]] = await db.query(
        `SELECT r.id,r.requested_by,u.full_name requested_by_name,r.created_at
         FROM data_change_requests r
         JOIN staff_users u ON u.id=r.requested_by
         WHERE r.request_type IN ('claim_account','claim_client')
           AND (r.record_id=? OR r.client_id IN (${lineIds.map(() => '?').join(',')}))
           AND r.status IN ('pending_manager','pending_owner')
         ORDER BY r.created_at LIMIT 1`,
        [accountRecord.id, ...lineIds]
      );
      return row || null;
    });

    const pendingAccountRequest = await optionalSection('pending account request', id, null, async () => {
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
    });

    const fixedAccounts = await optionalSection('fixed services', id, [], async () => {
      if (!accountNumber) return [];
      const [rows] = await db.execute(
        `SELECT fa.*,COUNT(fs.id) fixed_service_count
         FROM fixed_accounts fa
         LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
         WHERE fa.account_number=:account OR fa.linked_mobile_account_number=:account
         GROUP BY fa.id`,
        { account: accountNumber }
      );
      return rows;
    });

    // Base Details stays preserved and independently accessible while the merged read model is rebuilt.
    // It must never prevent the core CRM customer record from opening.
    const currentMobileServices = [];
    const mobileEvents = [];
    const currentMobileDataReady = false;

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
      assigned: req.query.assigned,
      claimRequested: req.query.claim_requested,
      claimConflict: req.query.claim_conflict,
      claimOwner: String(req.query.claim_owner || '').trim().slice(0, 255),
      changeRequested: req.query.change_requested,
      detailsSaved: String(req.query.details_saved || '') === '1',
      converted: String(req.query.converted || '') === '1'
    });
  } catch (error) {
    // Only the core customer lookup/render path should reach this handler.
    next(error);
  }
});

module.exports = router;
