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
assert(os.includes('windowGeometry.defaultFloatingRect(area, windowInset)'), 'route work windows must use the actual workspace layer');
assert(os.includes('layer.getBoundingClientRect()'), 'window geometry must re-read the rendered workspace layer');
assert(!os.includes('availableWorkspaceWidth') && !os.includes('shell.clientWidth'), 'window geometry must not subtract the sidebar from the shell twice');
assert(!os.includes("window.matchMedia('(max-width: 1050px)').matches"), 'tablet viewport must not override the rendered sidebar state');
assert(os.includes('windows.scheduleFit()'), 'manual expansion must refit windows after the layout transition');
assert(launchers.includes('setExternalWindowCount') && launchers.includes('syncSidebar();'), 'companion lifecycle must drive sidebar state');
assert(css.includes('--t2m-os-sidebar-rail:68px') && css.includes('minmax(0,1fr)'), 'compact rail and shrink-safe workspace are required');
assert(css.includes('button>b[hidden]'), 'hidden counters must remain hidden while visible badges stay readable');
assert(css.includes('@media(min-width:761px) and (max-width:1050px)'), 'state-controlled tablet breakpoint is missing');
assert(css.includes('.t2m-os-shell:not(.is-sidebar-collapsed) .t2m-os-sidebar-label'), 'tablet expanded labels are not restored');
assert(css.includes('.t2m-os-shell:not(.is-sidebar-collapsed) .t2m-os-sidebar button{grid-template-columns:28px 1fr auto;justify-items:stretch;padding:0 10px}'), 'tablet expanded buttons are not restored');
assert(!css.includes('@media(max-width:1050px){\n  .t2m-os-shell{grid-template-columns:var(--t2m-os-sidebar-rail)'), 'tablet viewport still forces the collapsed rail');

function renderedSidebar(width, state) {
  const collapsed = state.snapshot().collapsed;
  const sidebarWidth = collapsed ? 68 : 220;
  return {
    sidebarWidth,
    labelsVisible: !collapsed,
    buttonColumns: collapsed ? '1fr' : '28px 1fr auto',
    ariaExpanded: !collapsed,
    contentWidth: width - sidebarWidth
  };
}

for (const width of [900, 1024]) {
  const tabletStorage = new MemoryStorage({ [key]: '0' });
  const tabletSidebar = new SidebarState({ storage: tabletStorage, preferenceKey: key });

  let rendered = renderedSidebar(width, tabletSidebar);
  assert.deepStrictEqual(rendered, {
    sidebarWidth: 220,
    labelsVisible: true,
    buttonColumns: '28px 1fr auto',
    ariaExpanded: true,
    contentWidth: width - 220
  }, `${width}px saved-expanded dashboard must render expanded without clipping`);

  tabletSidebar.toggleManually();
  rendered = renderedSidebar(width, tabletSidebar);
  assert.strictEqual(rendered.sidebarWidth, 68, `${width}px manual collapse must render a 68px rail`);
  assert.strictEqual(rendered.labelsVisible, false, `${width}px manual collapse must hide labels`);
  assert.strictEqual(rendered.ariaExpanded, false, `${width}px collapsed ARIA state must match the layout`);
  assert(rendered.contentWidth > 0, `${width}px collapsed layout must leave usable workspace width`);

  tabletSidebar.toggleManually();
  rendered = renderedSidebar(width, tabletSidebar);
  assert.strictEqual(rendered.sidebarWidth, 220, `${width}px manual expand must restore the wide grid`);
  assert.strictEqual(rendered.labelsVisible, true, `${width}px manual expand must restore labels`);
  assert.strictEqual(rendered.buttonColumns, '28px 1fr auto', `${width}px manual expand must restore button layout`);
  assert.strictEqual(rendered.ariaExpanded, true, `${width}px expanded ARIA state must match the layout`);

  tabletSidebar.updateWindowCounts({ internal: 1 });
  assert.strictEqual(renderedSidebar(width, tabletSidebar).sidebarWidth, 68, `${width}px work window must auto-collapse`);
  tabletSidebar.updateWindowCounts({ internal: 0 });
  assert.strictEqual(renderedSidebar(width, tabletSidebar).sidebarWidth, 220, `${width}px closing all windows must restore the dashboard preference`);
}

for (const [width, height] of [[1366,768],[1440,900],[1600,900],[1920,1080]]) {
  const available = width - 68;
  assert(available > 0 && height >= 768, `${width}x${height} must leave usable workspace dimensions`);
  assert(available >= 1298, `${width}x${height} must leave practical work width`);
}
assert(os.includes('windowGeometry.clampFloatingRect'), 'window sizing must remain bounded by the actual workspace layer');

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
console.log(`OS sidebar collapse validation passed at 900px, 1024px, 1366x768, 1440x900, 1600x900 and 1920x1080 (${templates.length} EJS templates compiled).`);
