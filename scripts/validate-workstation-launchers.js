'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  MANAGED_SLOT_KEYS,
  DEFAULTS,
  LauncherValidationError,
  enabledLaunchers,
  ensureManagedSlotRows,
  saveLaunchers,
  validateSubmittedLaunchers
} = require('../src/services/os-launcher-settings');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'src', 'routes', 'os-launcher-settings.js'), 'utf8');
const viewPath = path.join(root, 'views', 'os-launcher-settings.ejs');
const viewSource = fs.readFileSync(viewPath, 'utf8');
const shellSource = fs.readFileSync(path.join(root, 'views', 'os-shell.ejs'), 'utf8');
const launcherSource = fs.readFileSync(path.join(root, 'public', 'js', 'os-launchers.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'public', 'js', 'os-launcher-settings.js'), 'utf8');
const stripSource = fs.readFileSync(path.join(root, 'public', 'js', 'os-launcher-strip.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'public', 'css', 'os-launcher-settings.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function row(slotNumber, overrides = {}) {
  return {
    id: slotNumber,
    slot_key: `slot_${slotNumber}`,
    display_name: `Existing ${slotNumber}`,
    icon_text: `E${slotNumber}`,
    portal_url: `https://existing-${slotNumber}.example.test`,
    open_mode: 'separate',
    sort_order: slotNumber,
    is_enabled: slotNumber <= 5 ? 1 : 0,
    updated_by: 7,
    ...overrides
  };
}

function submission() {
  const body = { panel: '1' };
  for (let number = 1; number <= 10; number += 1) {
    const key = `slot_${number}`;
    body[`display_name_${key}`] = `Saved ${number}`;
    body[`icon_text_${key}`] = `S${number}`;
    body[`portal_url_${key}`] = `https://saved-${number}.example.test/portal`;
    body[`open_mode_${key}`] = number % 2 ? 'separate' : 'embedded';
    body[`is_enabled_${key}`] = [1, 6, 10].includes(number) ? '1' : undefined;
    if (body[`is_enabled_${key}`] === undefined) delete body[`is_enabled_${key}`];
  }
  return body;
}

function fakeConnection(initialRows = []) {
  const state = {
    rows: initialRows.map(item => ({ ...item })),
    commits: 0,
    rollbacks: 0,
    updates: []
  };
  let snapshot;
  return {
    state,
    async beginTransaction() {
      snapshot = structuredClone(state.rows);
    },
    async execute(sql, params = {}) {
      if (sql.includes('INSERT INTO os_external_launchers')) {
        if (!state.rows.some(item => item.slot_key === params.slot_key)) {
          state.rows.push({ id: state.rows.length + 1, updated_by: null, ...params });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE os_external_launchers SET')) {
        const existing = state.rows.find(item => item.slot_key === params.slot_key);
        Object.assign(existing, params);
        state.updates.push({ ...params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async query(sql) {
      if (!sql.includes('FROM os_external_launchers')) throw new Error(`Unexpected query: ${sql}`);
      return [state.rows
        .filter(item => MANAGED_SLOT_KEYS.includes(item.slot_key))
        .sort((left, right) => left.sort_order - right.sort_order)
        .map(item => ({ ...item }))];
    },
    async commit() {
      state.commits += 1;
      snapshot = null;
    },
    async rollback() {
      state.rollbacks += 1;
      if (snapshot) {
        state.rows = snapshot;
        state.updates = [];
        snapshot = null;
      }
    }
  };
}

async function main() {
  assert.strictEqual(MANAGED_SLOT_KEYS.length, 10);
  assert.deepStrictEqual(MANAGED_SLOT_KEYS, [
    'slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5',
    'slot_6', 'slot_7', 'slot_8', 'slot_9', 'slot_10'
  ]);
  assert.deepStrictEqual(DEFAULTS.map(item => item.sort_order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const missingRows = fakeConnection([]);
  await ensureManagedSlotRows(missingRows);
  assert.strictEqual(missingRows.state.rows.length, 10, 'All ten managed rows must be created when missing.');

  const preserved = row(1, {
    display_name: 'Customers Portal',
    icon_text: 'CP',
    portal_url: 'https://customer.example.test',
    open_mode: 'embedded',
    is_enabled: 1,
    sort_order: 41
  });
  const existingRows = fakeConnection([preserved]);
  await ensureManagedSlotRows(existingRows);
  assert.deepStrictEqual(
    existingRows.state.rows.find(item => item.slot_key === 'slot_1'),
    preserved,
    'Default insertion must never overwrite an existing configured value.'
  );
  assert.strictEqual(existingRows.state.rows.length, 10);

  const body = submission();
  const parsed = validateSubmittedLaunchers(body, Array.from({ length: 10 }, (_, index) => row(index + 1)));
  assert.strictEqual(parsed.length, 10, 'All ten submitted slots must reach validation.');
  assert.strictEqual(Object.keys(body).length, 44, 'The complete form remains far below Express’s default 1000-parameter limit.');

  const savedConnection = fakeConnection(Array.from({ length: 10 }, (_, index) => row(index + 1)));
  await saveLaunchers(savedConnection, body, 99);
  assert.strictEqual(savedConnection.state.commits, 1);
  assert.strictEqual(savedConnection.state.rollbacks, 0);
  assert.strictEqual(savedConnection.state.updates.length, 10, 'Every managed row must update in one transaction.');
  for (const number of [6, 10]) {
    const saved = savedConnection.state.rows.find(item => item.slot_key === `slot_${number}`);
    assert.strictEqual(saved.display_name, `Saved ${number}`);
    assert.strictEqual(saved.icon_text, `S${number}`);
    assert.strictEqual(saved.portal_url, `https://saved-${number}.example.test/portal`);
    assert.strictEqual(saved.open_mode, 'embedded');
    assert.strictEqual(saved.is_enabled, 1);
    assert.strictEqual(saved.sort_order, number);
    assert.strictEqual(saved.updated_by, 99);
  }
  assert.deepStrictEqual(
    savedConnection.state.rows.sort((left, right) => left.sort_order - right.sort_order).map(item => item.sort_order),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'Managed sort order must remain 1 through 10.'
  );

  const apiRows = enabledLaunchers(savedConnection.state.rows);
  assert(apiRows.some(item => item.slot_key === 'slot_6'), 'Enabled slot 6 must appear in the API result.');
  assert(apiRows.some(item => item.slot_key === 'slot_10'), 'Enabled slot 10 must appear in the API result.');
  assert(!apiRows.some(item => item.slot_key === 'slot_5'), 'Disabled slots must remain hidden from the API.');
  assert.deepStrictEqual(apiRows.map(item => item.sort_order), [1, 6, 10]);

  const invalidBody = submission();
  invalidBody.portal_url_slot_7 = 'http://insecure.example.test';
  const rollbackConnection = fakeConnection(Array.from({ length: 10 }, (_, index) => row(index + 1)));
  const beforeRollback = structuredClone(rollbackConnection.state.rows);
  await assert.rejects(
    saveLaunchers(rollbackConnection, invalidBody, 99),
    error => error instanceof LauncherValidationError && /Slot 7.*valid https:\/\//.test(error.message)
  );
  assert.strictEqual(rollbackConnection.state.rollbacks, 1);
  assert.deepStrictEqual(rollbackConnection.state.rows, beforeRollback, 'One invalid URL must roll back all ten updates.');

  let validationError;
  try {
    validateSubmittedLaunchers(invalidBody, beforeRollback);
  } catch (error) {
    validationError = error;
  }
  const errorHtml = ejs.render(viewSource, {
    basePath: '/talk2me',
    appVersion: 'test',
    panelMode: true,
    launchers: validationError.submittedLaunchers,
    saved: false,
    error: validationError.message
  }, { filename: viewPath });
  assert(errorHtml.includes('value="http://insecure.example.test"'), 'Submitted values must remain visible after validation failure.');
  assert(errorHtml.includes('Slot 7'), 'The exact invalid slot must be identified inline.');
  assert(errorHtml.includes('action="/talk2me/backoffice/os-launchers?panel=1"'));
  assert(errorHtml.includes('name="panel" value="1"'));

  assert(routeSource.includes('await saveLaunchers(connection, req.body, req.session.user.id)'));
  assert(routeSource.includes("saved=1${String(req.query.panel || req.body.panel || '') === '1' ? '&panel=1' : ''}"));
  assert(routeSource.includes('submittedValues(req.body, persisted)'));
  assert(routeSource.includes('enabledLaunchers(await loadLaunchers(db))'));
  assert(serverSource.includes('express.urlencoded({ extended: true })'));
  assert(shellSource.includes('launchers.forEach(item=>'));
  assert(!shellSource.includes('launchers.slice('));
  assert(launcherSource.includes('for (const item of enabled)'));
  assert(launcherSource.includes('strip.appendChild(button)'));
  assert(launcherSource.includes('window.Talk2MeOS.refreshManagedLaunchers'));
  assert(launcherSource.includes("type === 'talk2me:launcher-settings-saved'"));
  assert(settingsSource.includes("postMessage({ type: 'talk2me:launcher-settings-saved' }"));
  assert(stripSource.includes('new MutationObserver(update)'));
  assert(cssSource.includes('overflow-x: hidden'));
  assert(cssSource.includes('max-width: 100%'));

  console.log('Workstation launcher validation passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
