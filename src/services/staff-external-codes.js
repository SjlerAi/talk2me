'use strict';

function normaliseExternalCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

async function resolveStaffByExternalCode(connection, value) {
  const code = normaliseExternalCode(value);
  if (!code) return { status: 'missing', code: '', staff: null, candidates: [] };
  const [rows] = await connection.execute(`
    SELECT sec.id code_id,sec.source_system,sec.external_code,sec.external_code_normalised,
      su.id staff_id,su.full_name,su.email,su.contact_number
    FROM staff_external_codes sec
    JOIN staff_users su ON su.id=sec.staff_id
    WHERE sec.external_code_normalised=:code AND sec.is_active=1 AND su.is_active=1
    ORDER BY su.id,sec.id
  `, { code });
  const byStaff = new Map();
  for (const row of rows) {
    const staffId = Number(row.staff_id);
    const existing = byStaff.get(staffId) || {
      id: staffId,
      fullName: row.full_name,
      email: row.email,
      contactNumber: row.contact_number,
      aliases: []
    };
    existing.aliases.push({ id: Number(row.code_id), sourceSystem: row.source_system, code: row.external_code });
    byStaff.set(staffId, existing);
  }
  const candidates = [...byStaff.values()];
  if (!candidates.length) return { status: 'unmapped', code, staff: null, candidates: [] };
  if (candidates.length > 1) return { status: 'conflict', code, staff: null, candidates };
  return { status: 'matched', code, staff: candidates[0], candidates };
}

module.exports = { normaliseExternalCode, resolveStaffByExternalCode };
