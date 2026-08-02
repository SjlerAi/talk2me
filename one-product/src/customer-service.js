'use strict';

function cleanText(value, max = 255) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function searchCustomers(pool, rawQuery) {
  const query = cleanText(rawQuery, 180);
  if (!query || query.length < 2) return [];
  const like = `%${query}%`;
  const [rows] = await pool.execute(`
    SELECT
      c.id,
      c.customer_type,
      c.display_name,
      c.responsible_person,
      c.primary_mobile,
      c.primary_email,
      c.town,
      c.status,
      o.assigned_staff_id,
      s.full_name AS owner_name,
      GROUP_CONCAT(DISTINCT a.account_number ORDER BY a.account_number SEPARATOR ', ') AS account_numbers,
      COUNT(DISTINCT ml.id) AS mobile_line_count
    FROM customers c
    LEFT JOIN customer_accounts a
      ON a.customer_id = c.id AND a.archived_at IS NULL
    LEFT JOIN mobile_lines ml
      ON ml.customer_id = c.id AND ml.archived_at IS NULL
    LEFT JOIN customer_ownership o
      ON o.customer_id = c.id AND o.is_current = 1
    LEFT JOIN staff_users s
      ON s.id = o.assigned_staff_id
    WHERE c.archived_at IS NULL
      AND (
        c.display_name LIKE :like
        OR c.responsible_person LIKE :like
        OR c.primary_mobile LIKE :like
        OR c.primary_email LIKE :like
        OR c.town LIKE :like
        OR EXISTS (
          SELECT 1 FROM customer_accounts ca
          WHERE ca.customer_id = c.id
            AND ca.archived_at IS NULL
            AND ca.account_number LIKE :like
        )
        OR EXISTS (
          SELECT 1 FROM mobile_lines x
          WHERE x.customer_id = c.id
            AND x.archived_at IS NULL
            AND x.mobile_number LIKE :like
        )
      )
    GROUP BY c.id, o.assigned_staff_id, s.full_name
    ORDER BY c.display_name
    LIMIT 25`, { like });
  return rows;
}

async function getCustomer360(pool, rawId) {
  const id = positiveId(rawId);
  if (!id) return null;

  const [[customer]] = await pool.execute(`
    SELECT c.*, o.assigned_staff_id, s.full_name AS owner_name
    FROM customers c
    LEFT JOIN customer_ownership o
      ON o.customer_id = c.id AND o.is_current = 1
    LEFT JOIN staff_users s
      ON s.id = o.assigned_staff_id
    WHERE c.id = :id AND c.archived_at IS NULL
    LIMIT 1`, { id });

  if (!customer) return null;

  const [accounts, mobileLines, contacts, audit] = await Promise.all([
    pool.execute(`
      SELECT * FROM customer_accounts
      WHERE customer_id = :id AND archived_at IS NULL
      ORDER BY is_primary DESC, account_number`, { id }).then(([rows]) => rows),
    pool.execute(`
      SELECT * FROM mobile_lines
      WHERE customer_id = :id AND archived_at IS NULL
      ORDER BY mobile_number`, { id }).then(([rows]) => rows),
    pool.execute(`
      SELECT * FROM customer_contacts
      WHERE customer_id = :id AND archived_at IS NULL
      ORDER BY is_primary DESC, full_name`, { id }).then(([rows]) => rows),
    pool.execute(`
      SELECT action_type, entity_type, entity_id, description, created_at, actor_staff_id
      FROM audit_log
      WHERE customer_id = :id
      ORDER BY created_at DESC
      LIMIT 100`, { id }).then(([rows]) => rows)
  ]);

  return { customer, accounts, mobileLines, contacts, audit };
}

module.exports = { searchCustomers, getCustomer360 };
