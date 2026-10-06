'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parsePeriod, parseDueAt, detectIntent } = require('../src/services/cudo-ai');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const server = read('server.js');
const layout = read('views/layout.ejs');
const shell = read('views/os-shell.ejs');
const route = read('src/routes/cudo-ai.js');
const service = read('src/services/cudo-ai.js');
const widget = read('public/js/cudo-widget.js');
const css = read('public/css/cudo-widget.css');

assert(server.includes("require('./src/routes/cudo-ai')"), 'Cudo route must be mounted');
assert(layout.includes('/public/js/cudo-widget.js'), 'Cudo must load on management layout pages');
assert(shell.includes('/public/js/cudo-widget.js'), 'Cudo must load on OS workspace');
assert(layout.includes('/public/css/cudo-widget.css'), 'Cudo layout CSS missing');
assert(shell.includes('/public/css/cudo-widget.css'), 'Cudo OS CSS missing');
assert(route.includes("router.post('/api/cudo/chat'"), 'Cudo chat API missing');
assert(route.includes("router.post('/api/cudo/action'"), 'Cudo action API missing');
assert(route.includes("router.get('/api/cudo/health', requireOwner"), 'Cudo health API must be owner-protected');
assert(route.includes("String(user.role || '').toLowerCase() === 'owner'"), 'Cudo API must be restricted to owner role');
assert(!route.includes('MANAGEMENT_ROLES'), 'Cudo must not allow manager/admin role shortcuts');
assert(service.includes('sendAgentInstruction'), 'Cudo must use existing monitored task path');
assert(service.includes('agent'), 'Cudo service should remain connected to Gerda task foundation');
assert(widget.includes('t2m-cudo-position'), 'Cudo draggable position persistence missing');
assert(widget.includes('t2m-cudo-size'), 'Cudo resizable avatar persistence missing');
assert(widget.includes('activeContext'), 'Cudo current-screen context missing');
assert(widget.includes('SpeechRecognition'), 'Cudo browser speech recognition missing');
assert(widget.includes("root.querySelector('.cudo-mic')"), 'Cudo microphone control missing');
assert(widget.includes('recognition.start()'), 'Cudo microphone start behavior missing');
assert(widget.includes('recognition.onresult'), 'Cudo speech transcript handling missing');
assert(layout.includes("toLowerCase()==='owner'"), 'Cudo layout must be owner-only');
assert(shell.includes("toLowerCase()==='owner'"), 'Cudo OS shell must be owner-only');
assert(css.includes('resize:both'), 'Cudo panel resize affordance missing');
assert(fs.existsSync(path.join(root,'public/images/cudo-mascot.webp')), 'Cudo mascot asset missing');

const p = parsePeriod('show the last 6 months');
assert.equal(p.label,'the last 6 months');
assert(p.startSql && p.endSql);

const friday = parseDueAt('due Friday 15:00');
assert(friday && / 15:00:00$/.test(friday), 'Friday 15:00 deadline parsing failed');

assert.equal(detectIntent('How many of Johnny clients were followed up this month'), 'client_followup_activity');
assert.equal(detectIntent('Johnny outstanding upgrades this month'), 'upgrades');
assert(service.includes('queryClientFollowupActivity'), 'Client follow-up activity query missing');

console.log('CUDO_AI_VALIDATION=PASS');
