'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const geometry = require('../public/js/os-window-geometry');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const shell = read('views/os-shell.ejs');
const client = read('public/js/os-v6.js');
const css = read('public/css/os-window-geometry.css');

const mainClose = shell.indexOf('</main>');
const layerIndex = shell.indexOf('<div class="t2m-os-window-layer" id="os-window-layer"');
const taskbarIndex = shell.indexOf('<footer class="t2m-os-taskbar" id="os-taskbar"');
assert(mainClose >= 0 && layerIndex > mainClose, 'floating window layer must be outside the workspace main');
assert(taskbarIndex > layerIndex, 'floating window layer must be a shell sibling immediately before the taskbar');
assert(!shell.slice(shell.indexOf('<main'), mainClose).includes('id="os-window-layer"'), 'workspace content must not contain the floating window layer');

assert(css.includes('.t2m-os-window-layer{position:fixed;z-index:12000;inset:0 0 46px;'), 'shell overlay must be fixed to the usable browser viewport');
assert(css.includes('overflow:hidden;pointer-events:none}'), 'overlay must constrain windows without intercepting exposed shell controls');
assert(css.includes('.t2m-os-window{pointer-events:auto}'), 'windows inside the click-through overlay must remain interactive');

assert(client.includes('layer.appendChild(node)'), 'new windows must render in the shell-level overlay');
assert(client.includes('layer.getBoundingClientRect()'), 'the fixed overlay rectangle must be the authoritative geometry source');
assert(!client.includes('shell.clientWidth') && !client.includes('availableWorkspaceWidth'), 'shell grid widths must not drive floating-window geometry');
assert(!client.includes("shell.addEventListener('transitionend'") && !client.includes("event.propertyName === 'grid-template-columns'"), 'sidebar transitions must not trigger overlay refits');
assert.strictEqual((client.match(/window\.addEventListener\('resize'/g) || []).length, 1, 'exactly one browser resize listener is required');

for (const [width, height] of [[943, 768], [1366, 768], [1440, 900], [1600, 900], [1920, 1080]]) {
  const layer = { width, height: height - 46 };
  const floating = geometry.defaultFloatingRect(layer);
  assert(Math.abs(floating.width - (layer.width * 0.95)) < 0.001, `${width}x${height} floating width must be 95% of the overlay`);
  assert(Math.abs(floating.height - (layer.height * 0.95)) < 0.001, `${width}x${height} floating height must be 95% of the overlay`);
  assert.strictEqual(floating.left, (layer.width - floating.width) / 2, `${width}x${height} floating window must be horizontally centered`);
  assert.strictEqual(floating.top, (layer.height - floating.height) / 2, `${width}x${height} floating window must be vertically centered`);
  assert(floating.left >= geometry.DEFAULT_INSET && floating.top >= geometry.DEFAULT_INSET, `${width}x${height} floating window must expose the shell around its edges`);
  assert.deepStrictEqual(geometry.maximizedRect(layer), { left: 0, top: 0, width: layer.width, height: layer.height }, `${width}x${height} maximize must fill only the usable overlay`);
}

assert(client.indexOf('const existing = this.windows.get(options.id)') < client.indexOf("document.createElement('section')"), 'opening an existing app must not create a duplicate window');
assert(client.includes("record.minimized = true; record.node.classList.add('is-minimized')"), 'minimize must hide the existing node without destroying it');
assert(client.includes('this.fitRecord(record);') && client.includes('this.focus(id);'), 'restore must refit and focus the same record');
assert(client.includes("const taskbar = event.target.closest('[data-taskbar-window]')"), 'taskbar restore must target the existing window record');
assert(client.includes('record.node.remove(); this.windows.delete(id)'), 'close must destroy the window node and record');
assert(client.includes('record.restore = windowGeometry.clampFloatingRect'), 'maximize must retain a valid floating restore rectangle');
assert(client.includes('frame.src = panelUrl(record.options.url)'), 'route iframe creation and same-origin panel behavior must remain intact');

console.log('OS shell-level overlay validation passed at 943x768, 1366x768, 1440x900, 1600x900 and 1920x1080.');
