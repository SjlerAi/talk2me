'use strict';

const MANAGED_SLOT_KEYS = Object.freeze(Array.from({ length: 10 }, (_, index) => `slot_${index + 1}`));
const OPEN_MODES = Object.freeze(['embedded', 'separate']);
const DEFAULTS = Object.freeze(MANAGED_SLOT_KEYS.map((slotKey, index) => {
  const number = index + 1;
  const named = [
    ['Vodacom', 'V', 1],
    ['MTN', 'MTN', 1],
    ['Telkom', 'T', 1],
    ['Sage', 'S', 1]
  ][index];
  return Object.freeze({
    slot_key: slotKey,
    display_name: named?.[0] || `System ${number}`,
    icon_text: named?.[1] || String(number),
    portal_url: null,
    open_mode: 'separate',
    sort_order: number,
    is_enabled: named?.[2] || 0
  });
}));

class LauncherValidationError extends Error {
  constructor(message, submittedLaunchers) {
    super(message);
    this.name = 'LauncherValidationError';
    this.submittedLaunchers = submittedLaunchers;
  }
}

function slotNumber(key) {
  const match = String(key || '').match(/^slot_(10|[1-9])$/);
  return match ? Number(match[1]) : 0;
}

function has(body, name) {
  return Object.prototype.hasOwnProperty.call(body || {}, name);
}

function submittedValues(body, existingRows = []) {
  const existing = new Map(existingRows.map(row => [row.slot_key, row]));
  return MANAGED_SLOT_KEYS.map(key => {
    const number = slotNumber(key);
    const current = existing.get(key) || DEFAULTS[number - 1];
    const field = suffix => `${suffix}_${key}`;
    return {
      ...current,
      slot_key: key,
      display_name: has(body, field('display_name')) ? String(body[field('display_name')] ?? '') : current.display_name,
      icon_text: has(body, field('icon_text')) ? String(body[field('icon_text')] ?? '') : current.icon_text,
      portal_url: has(body, field('portal_url')) ? String(body[field('portal_url')] ?? '') : (current.portal_url || ''),
      open_mode: has(body, field('open_mode')) ? String(body[field('open_mode')] ?? '') : current.open_mode,
      sort_order: number,
      is_enabled: body?.[field('is_enabled')] === '1' ? 1 : 0
    };
  });
}

function validateSubmittedLaunchers(body, existingRows = []) {
  const submitted = submittedValues(body, existingRows);
  for (const item of submitted) {
    const number = slotNumber(item.slot_key);
    const label = `Slot ${number}`;
    for (const fieldName of ['display_name', 'icon_text', 'portal_url', 'open_mode']) {
      const requestName = `${fieldName}_${item.slot_key}`;
      if (!has(body, requestName)) {
        throw new LauncherValidationError(`${label}: ${fieldName.replaceAll('_', ' ')} field was not submitted.`, submitted);
      }
    }
    const displayName = item.display_name.trim();
    const iconText = item.icon_text.trim();
    const portalUrl = item.portal_url.trim();
    if (item.display_name.length > 100) {
      throw new LauncherValidationError(`${label}: display name must be 100 characters or fewer.`, submitted);
    }
    if (item.icon_text.length > 12) {
      throw new LauncherValidationError(`${label}: icon text must be 12 characters or fewer.`, submitted);
    }
    if (item.portal_url.length > 1000) {
      throw new LauncherValidationError(`${label}: portal URL must be 1000 characters or fewer.`, submitted);
    }
    if (!OPEN_MODES.includes(item.open_mode)) {
      throw new LauncherValidationError(`${label}: choose a valid open mode.`, submitted);
    }
    if (item.is_enabled && !displayName) {
      throw new LauncherValidationError(`${label}: an enabled launcher must have a display name.`, submitted);
    }
    if (portalUrl) {
      try {
        const parsed = new URL(portalUrl);
        if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('invalid');
      } catch {
        throw new LauncherValidationError(`${label}${displayName ? ` (${displayName})` : ''}: portal URL must be a valid https:// address.`, submitted);
      }
    }
    item.display_name = displayName || `System ${number}`;
    item.icon_text = iconText || displayName.slice(0, 1).toUpperCase() || String(number);
    item.portal_url = portalUrl || null;
  }
  return submitted;
}

async function ensureOpenModeColumn(connection) {
  const [[column]] = await connection.execute(`SELECT COUNT(*) total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='os_external_launchers'
      AND COLUMN_NAME='open_mode'`);
  if (!Number(column?.total || 0)) {
    await connection.execute(`ALTER TABLE os_external_launchers
      ADD COLUMN open_mode ENUM('embedded','separate') NOT NULL DEFAULT 'separate'
      AFTER portal_url`);
  }
}

async function ensureManagedSlotRows(connection) {
  for (const item of DEFAULTS) {
    await connection.execute(`INSERT INTO os_external_launchers
      (slot_key,display_name,icon_text,portal_url,open_mode,sort_order,is_enabled)
      VALUES (:slot_key,:display_name,:icon_text,:portal_url,:open_mode,:sort_order,:is_enabled)
      ON DUPLICATE KEY UPDATE slot_key=VALUES(slot_key)`, item);
  }
}

async function ensureTable(connection) {
  await connection.execute(`CREATE TABLE IF NOT EXISTS os_external_launchers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    slot_key VARCHAR(40) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    icon_text VARCHAR(12) NOT NULL,
    portal_url VARCHAR(1000) NULL,
    open_mode ENUM('embedded','separate') NOT NULL DEFAULT 'separate',
    sort_order INT NOT NULL DEFAULT 0,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_os_external_launchers_slot (slot_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await ensureOpenModeColumn(connection);
  await ensureManagedSlotRows(connection);
}

function placeholders() {
  return MANAGED_SLOT_KEYS.map(() => '?').join(',');
}

async function selectManagedSlotRows(connection, forUpdate = false) {
  const [rows] = await connection.query(`SELECT
      id,slot_key,display_name,icon_text,portal_url,open_mode,sort_order,is_enabled,updated_by
    FROM os_external_launchers
    WHERE slot_key IN (${placeholders()})
    ORDER BY sort_order,id${forUpdate ? ' FOR UPDATE' : ''}`, MANAGED_SLOT_KEYS);
  return rows;
}

async function loadLaunchers(connection) {
  await ensureTable(connection);
  return selectManagedSlotRows(connection);
}

function enabledLaunchers(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(item => Number(item.is_enabled) === 1)
    .sort((left, right) => Number(left.sort_order) - Number(right.sort_order));
}

async function saveLaunchers(connection, body, updatedBy) {
  await connection.beginTransaction();
  try {
    await ensureManagedSlotRows(connection);
    const existingRows = await selectManagedSlotRows(connection, true);
    if (existingRows.length !== MANAGED_SLOT_KEYS.length) {
      throw new LauncherValidationError('All ten managed launcher slots could not be loaded. No settings were changed.', submittedValues(body, existingRows));
    }
    const submitted = validateSubmittedLaunchers(body, existingRows);
    for (const item of submitted) {
      await connection.execute(`UPDATE os_external_launchers SET
        display_name=:display_name,icon_text=:icon_text,portal_url=:portal_url,open_mode=:open_mode,
        is_enabled=:is_enabled,sort_order=:sort_order,updated_by=:updated_by
        WHERE slot_key=:slot_key`, {
        ...item,
        updated_by: updatedBy
      });
    }
    await connection.commit();
    return submitted;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

module.exports = {
  MANAGED_SLOT_KEYS,
  DEFAULTS,
  OPEN_MODES,
  LauncherValidationError,
  slotNumber,
  submittedValues,
  validateSubmittedLaunchers,
  ensureManagedSlotRows,
  ensureTable,
  selectManagedSlotRows,
  loadLaunchers,
  enabledLaunchers,
  saveLaunchers
};
