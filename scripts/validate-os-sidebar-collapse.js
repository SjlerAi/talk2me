'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { SidebarState } = require('../public/js/os-sidebar-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const key = 'sidebar-test';
const storage = new MemoryStorage();
const states = [];
const sidebar = new SidebarState({ storage, preferenceKey: key, onChange: state => states.push(state) });
assert.strictEqual(sidebar.snapshot().collapsed, false, 'dashboard must be expanded without a saved preference');
assert.strictEqual(storage.getItem(key), null, 'default state must not create a preference');

sidebar.updateWindowCounts({ internal: 1 });
assert.strictEqual(sidebar.snapshot().collapsed, true, 'Messages must auto-collapse the sidebar');
assert.strictEqual(storage.getItem(key), null, 'automatic collapse must not overwrite dashboard preference');
sidebar.toggleManually();
assert.strictEqual(sidebar.snapshot().collapsed, false, 'manual expand must work while a window is open');
sidebar.toggleManually();
assert.strictEqual(sidebar.snapshot().collapsed, true, 'manual collapse must work while a window is open');
sidebar.updateWindowCounts({ internal: 0 });
assert.strictEqual(sidebar.snapshot().collapsed, false, 'closing all windows must restore the prior dashboard preference');

sidebar.toggleManually();
assert.strictEqual(storage.getItem(key), '1', 'dashboard manual collapse must be saved');
sidebar.updateWindowCounts({ internal: 1 });
sidebar.toggleManually();
assert.strictEqual(sidebar.snapshot().collapsed, false, 'a saved-collapsed user may expand for the active window session');
assert.strictEqual(storage.getItem(key), '1', 'window override must not replace the permanent preference');
sidebar.updateWindowCounts({ internal: 0 });
assert.strictEqual(sidebar.snapshot().collapsed, true, 'closing the window must restore saved dashboard collapse');

const expandedStorage = new MemoryStorage({ [key]: '0' });
const windowSidebar = new SidebarState({ storage: expandedStorage, preferenceKey: key });
windowSidebar.updateWindowCounts({ internal: 1 });
assert.strictEqual(windowSidebar.snapshot().collapsed, true, 'Tasks and other internal windows must auto-collapse');
windowSidebar.toggleManually();
assert.strictEqual(windowSidebar.snapshot().collapsed, false);
windowSidebar.updateWindowCounts({ internal: 1, maximized: 1 });
assert.strictEqual(windowSidebar.snapshot().collapsed, true, 'maximized work must retain the compact rail');
windowSidebar.updateWindowCounts({ internal: 1, maximized: 0 });
assert.strictEqual(windowSidebar.snapshot().collapsed, false, 'restoring a window must restore the session override');
windowSidebar.updateWindowCounts({ internal: 0, external: 0 });
windowSidebar.updateWindowCounts({ external: 1 });
assert.strictEqual(windowSidebar.snapshot().collapsed, true, 'Administration and companion windows must auto-collapse');
windowSidebar.updateWindowCounts({ external: 0 });
assert.strictEqual(windowSidebar.snapshot().collapsed, false);

const shell = read('views/os-shell.ejs');
const os = read('public/js/os-v6.js');
const launchers = read('public/js/os-launchers.js');
const css = read('public/css/os-sidebar-collapse.css');
const aside = shell.slice(shell.indexOf('<aside class="t2m-os-sidebar"'), shell.indexOf('</aside>') + 8);
const buttons = aside.replace(/<%[\s\S]*?%>/g, '').match(/<button\b[^>]*>/g) || [];
assert(buttons.length >= 10, 'existing sidebar items must remain present');
for (const button of buttons) {
  assert(/aria-label="[^"]+"/.test(button), `sidebar control is missing an accessible label: ${button}`);
  assert(/title="[^"]+"/.test(button), `sidebar control is missing a collapsed tooltip: ${button}`);
}
['queue','tasks','messages','reports'].forEach(app => assert(shell.includes(`data-os-app="${app}"`), `${app} route must remain`));
['/clients/assignment-centre?view=unassigned','/approvals','/backoffice'].forEach(route => assert(shell.includes(route), `${route} must remain`));
assert(shell.includes('<% if (isManagement) { %>'), 'role-based management navigation must remain guarded');
assert(shell.includes('data-badge="queue"') && shell.includes('data-approval-count'), 'sidebar counters must remain');
assert.strictEqual((os.match(/document\.addEventListener\('click'/g) || []).length, 1, 'sidebar control must reuse the authoritative click listener');
assert(os.indexOf('const existing = this.windows.get(options.id)') < os.indexOf("document.createElement('section')"), 'existing windows must be reused before creation');
assert(os.includes('this.syncSidebar();') && os.includes('maximized:'), 'window open/close/maximize lifecycle must drive sidebar state');
assert(os.includes('const requestedWidth = options.url ? areaWidth - 28'), 'route work windows must use the collapsed workspace width');
assert(os.includes("fullWidth - (compact ? 68 : 220)"), 'window geometry must use the final sidebar width during smooth transitions');
assert(os.includes('windows.fitToArea()'), 'manual expansion must keep existing windows inside the resized workspace');
assert(launchers.includes('setExternalWindowCount') && launchers.includes('syncSidebar();'), 'companion lifecycle must drive sidebar state');
assert(css.includes('--t2m-os-sidebar-rail:68px') && css.includes('minmax(0,1fr)'), 'compact rail and shrink-safe workspace are required');
assert(css.includes('button>b[hidden]'), 'hidden counters must remain hidden while visible badges stay readable');

for (const [width, height] of [[1366,768],[1440,900],[1600,900],[1920,1080]]) {
  const available = width - 68;
  assert(available > 0 && height >= 768, `${width}x${height} must leave usable workspace dimensions`);
  assert(available >= 1298, `${width}x${height} must leave practical work width`);
}
assert(os.includes('Math.max(360, areaWidth - 28)'), 'window sizing must remain bounded by available workspace width');

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
assert(states.length >= 5, 'state changes must be observable without duplicate DOM listeners');
console.log(`OS sidebar collapse validation passed at 1366x768, 1440x900, 1600x900 and 1920x1080 (${templates.length} EJS templates compiled).`);
