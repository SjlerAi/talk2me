'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const geometry = require('../public/js/os-window-geometry');
const { SidebarState } = require('../public/js/os-sidebar-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const client = read('public/js/os-v6.js');
const css = `${read('public/css/os-v6.css')}\n${read('public/css/os-window-geometry.css')}`;
const shell = read('views/os-shell.ejs');
const legacyClaims = read('src/services/legacy-client-claim-decision.js');

function assertInside(rect, area, inset, message) {
  const tolerance = 0.001;
  assert(rect.left + tolerance >= inset, `${message}: left edge escaped the layer inset`);
  assert(rect.top + tolerance >= inset, `${message}: top edge escaped the layer inset`);
  assert(rect.left + rect.width <= area.width - inset + tolerance, `${message}: right edge escaped the layer`);
  assert(rect.top + rect.height <= area.height - inset + tolerance, `${message}: bottom edge escaped the layer`);
}

const viewports = [[943, 768], [1366, 768], [1440, 900], [1600, 900], [1920, 1080]];
for (const [viewportWidth, viewportHeight] of viewports) {
  const layer = { width: viewportWidth - 68, height: viewportHeight - 198 };
  const floating = geometry.defaultFloatingRect(layer);
  assertInside(floating, layer, geometry.DEFAULT_INSET, `${viewportWidth}x${viewportHeight} default window`);
  assert(floating.width / layer.width >= 0.94 && floating.width < layer.width, `${viewportWidth}x${viewportHeight} window must be large but floating`);
  assert(floating.height / layer.height >= 0.94 && floating.height < layer.height, `${viewportWidth}x${viewportHeight} window must expose dashboard edges`);
  assert.strictEqual(floating.left, geometry.DEFAULT_INSET);
  assert.strictEqual(floating.top, geometry.DEFAULT_INSET);

  const maximized = geometry.maximizedRect(layer);
  assert.deepStrictEqual(maximized, { left: 0, top: 0, width: layer.width, height: layer.height }, `${viewportWidth}x${viewportHeight} maximize must fill the layer`);

  const expandedLayer = { width: viewportWidth - 220, height: layer.height };
  const expandedDefault = geometry.defaultFloatingRect(expandedLayer);
  assertInside(expandedDefault, expandedLayer, geometry.DEFAULT_INSET, `${viewportWidth}x${viewportHeight} expanded-sidebar refit`);

  const resizedLayer = { width: Math.max(400, layer.width - 180), height: Math.max(300, layer.height - 100) };
  const adjusted = geometry.clampFloatingRect({ left: 200, top: 120, width: floating.width, height: floating.height }, resizedLayer);
  assertInside(adjusted, resizedLayer, geometry.DEFAULT_INSET, `${viewportWidth}x${viewportHeight} browser-resize refit`);

  const restored = geometry.clampFloatingRect(floating, layer);
  assert.deepStrictEqual(restored, floating, `${viewportWidth}x${viewportHeight} valid floating restore rectangle must be preserved`);
}

const storage = {
  value: '0',
  getItem() { return this.value; },
  setItem(_key, value) { this.value = String(value); }
};
const sidebar = new SidebarState({ storage, preferenceKey: 'geometry-test' });
sidebar.updateWindowCounts({ internal: 1 });
assert.strictEqual(sidebar.snapshot().collapsed, true, 'opening Messages must retain issue #95 auto-collapse');
sidebar.updateWindowCounts({ internal: 0 });
assert.strictEqual(sidebar.snapshot().collapsed, false, 'closing all windows must restore the dashboard preference');

assert(client.includes('layer.getBoundingClientRect()'), 'window layer must be the authoritative geometry source');
assert(!client.includes('availableWorkspaceWidth'), 'full-shell sidebar subtraction must be removed');
assert(!client.includes('shell.clientWidth'), 'window sizing must not use the full shell width');
assert(client.includes('windowGeometry.defaultFloatingRect(area, windowInset)'), 'route windows must use the inset floating rectangle');
assert(client.includes('largeRouteWindow: Boolean(options.url)'), 'route windows must be identified for large floating refits');
assert(client.includes('windowGeometry.maximizedRect(area)'), 'maximize must use actual layer dimensions');
assert(client.includes('record.restore = windowGeometry.clampFloatingRect'), 'restore geometry must be preserved and clamped');
assert(client.includes("button.setAttribute('aria-label', 'Restore')"), 'maximize must expose a visible restore control');
assert(client.includes('record.minimized = true; record.node.classList.add(\'is-minimized\')'), 'minimize must keep the existing window instance alive');
assert(client.includes('this.fitRecord(record);') && client.includes('this.focus(id);'), 'restore must refit and focus the same instance');
assert(client.indexOf('const existing = this.windows.get(options.id)') < client.indexOf("document.createElement('section')"), 'launcher reopen must reuse an existing window');
assert(client.includes("const taskbar = event.target.closest('[data-taskbar-window]')"), 'taskbar restore path must remain wired');
assert.strictEqual((client.match(/window\.addEventListener\('resize'/g) || []).length, 1, 'exactly one bounded viewport resize listener is required');
assert(client.includes('if (this.fitFrame) return;') && client.includes('window.requestAnimationFrame'), 'resize refits must be animation-frame bounded');
assert(client.includes("event.propertyName === 'grid-template-columns'"), 'sidebar transition completion must trigger a layer re-read');
assert(client.includes('this.drag(record);') && client.includes('this.resize(record);'), 'drag and resize must remain installed');
assert.strictEqual((client.match(/document\.addEventListener\('click'/g) || []).length, 1, 'authoritative click listener must not be duplicated');

assert(css.includes('.t2m-os-body{overflow:hidden'), 'outer page overflow must remain disabled');
assert(css.includes('.t2m-os-window-layer{min-height:0;max-height:100%;overflow:hidden}'), 'window layer must contain its windows');
assert(css.includes('.t2m-os-window-controls{flex:0 0 auto}'), 'title controls must remain fully visible');
assert(css.includes('.t2m-os-window-title{min-width:0;overflow:hidden}'), 'long titles must truncate instead of displacing controls');
assert(css.includes('.t2m-os-window-body iframe{display:block;width:100%;max-width:100%;height:100%;border:0}'), 'route iframe must stay inside the window body');
assert(css.includes('.t2m-os-window-body{min-width:0;max-width:100%;overflow:auto}'), 'route content must scroll internally');
assert(css.includes('.t2m-os-window.is-minimized{display:none}'), 'minimize must hide rather than destroy the window');

assert(shell.includes('id="os-window-layer"'), 'authoritative window layer must remain present');
assert(shell.includes('aria-label="Open windows"') && shell.includes('id="os-taskbar-items"'), 'Open Windows taskbar must remain present');
['messages', 'tasks', 'reports'].forEach(app => assert(shell.includes(`data-os-app="${app}"`), `${app} launcher must remain unchanged`));
['/approvals', '/clients/assignment-centre?view=unassigned', '/backoffice'].forEach(route => assert(shell.includes(route), `${route} must remain unchanged`));
assert(shell.includes('data-badge="messages"') && shell.includes('data-approval-count'), 'notification counters must remain unchanged');
assert(legacyClaims.includes('legacy_client_claim_approved') && legacyClaims.includes('legacy_client_claim_satisfied'), 'legacy claim decision actions must remain intact');

const templates = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith('.ejs')) templates.push(target);
  }
}
collect(path.join(root, 'views'));
for (const file of templates) ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });

console.log(`OS workspace geometry validation passed at ${viewports.map(([width, height]) => `${width}x${height}`).join(', ')} (${templates.length} EJS templates compiled).`);
