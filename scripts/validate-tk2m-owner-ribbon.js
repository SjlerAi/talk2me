'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const {hasOwnerLibraryAuthority}=require('../src/services/tk2m-library-roles');
const {enabledLaunchers}=require('../src/services/os-launcher-settings');
const service=read('src/services/os-launcher-settings.js');
const shell=read('views/os-shell.ejs');
const client=read('public/js/os-launchers.js');
const css=read('public/css/calendar-home-uat.css');
const library=read('src/routes/uat-library.js');
const manuals=read('public/js/manuals.js');
const chat=read('src/routes/uat-work-widgets.js');

// Both real Owner identities have identical permissions; no name/id exception.
for(const identity of [
  {id:1,role:'owner',full_name:'Gerda'},
  {id:22,role:'owner',full_name:'Stephan'},
  {id:700,role:'OWNER',full_name:'Any future owner'}
]) assert.equal(hasOwnerLibraryAuthority(identity),true);
for(const identity of [
  null,{id:1,role:'manager',full_name:'Gerda'},
  {id:2,role:'staff',full_name:'Stephan'},
  {id:8,role:'admin',full_name:'Administrator'}
]) assert.equal(hasOwnerLibraryAuthority(identity),false);
assert.match(library,/const canRestoreArchived = hasOwnerLibraryAuthority/);
assert.match(library,/requireAuth,requireLibraryOwner/);
assert.match(library,/if\(hasOwnerLibraryAuthority\(staff\)\)/);
assert.doesNotMatch(library,/Number\(user.id\)===1/);
assert.doesNotMatch(library,/function requireGerda/);
assert.match(library,/canManageManuals:await canEditManuals/);
assert.match(library,/canDelegateManuals:canRestoreArchived/);
assert.match(library,/SELECT s.id,s.full_name,s.role/);
assert.match(manuals,/user.role/);
assert.match(library,/const category='Manuals'/);
assert.match(library,/d.category='Manuals'/);
assert.match(library,/d.category='Deals'/);

// Staff chat is separately scoped by authenticated person and direct target.
// Owner Library rights must not leak into personal message destinations.
assert.match(chat,/function directKey\(a, b\)/);
assert.match(chat,/const userId = Number\(req.session.user.id\)/);
assert.match(chat,/resolveConversation\(userId, req.body.conversation\)/);
assert.match(chat,/sender_staff_id,message_type,body,related_client_id,related_task_id/);

// The ten configurable external slots remain intact and sort normally.
const input=[
  {slot_key:'slot_8',display_name:'New Portal',is_enabled:1,sort_order:8},
  {slot_key:'slot_9',display_name:'VDS',is_enabled:1,sort_order:9},
  {slot_key:'slot_10',display_name:'Future Portal',is_enabled:1,sort_order:10},
  {slot_key:'slot_1',display_name:'Tobi',is_enabled:1,sort_order:1},
  {slot_key:'slot_7',display_name:'iCAP',is_enabled:1,sort_order:7},
  {slot_key:'slot_6',display_name:'DWP',is_enabled:0,sort_order:6}
];
assert.deepEqual(enabledLaunchers(input).map(item=>item.slot_key),
  ['slot_1','slot_7','slot_8','slot_9','slot_10']);
assert.doesNotMatch(service,/operationalManualsSlot/);
assert.match(service,/return selectManagedSlotRows\(connection\)/);
assert.match(shell,/data-os-managed-launcher="manuals"/);
assert.ok(shell.indexOf('launchers.forEach(item=>') < shell.indexOf('data-os-managed-launcher="manuals"'));
assert.ok(client.indexOf('for (const item of enabled)') < client.indexOf('strip.appendChild(manuals)'));
assert.match(client,/key==='manuals' && config.isLive/);
assert.match(client,/data-os-managed-launcher/);
assert.doesNotMatch(client,/key==='slot_8'/);
assert.match(shell,/data-os-launch="customers" title="Customers"/);
assert.ok(shell.includes('data-os-managed-launcher="<%= item.slot_key %>"'));
assert.ok(shell.includes('<strong><%= label %></strong></button>'));
assert.doesNotMatch(shell,/item.slot_key==='slot_8'\?'Manuals'/);
assert.match(client,/button.innerHTML = `<strong>\$\{esc\(shortLabel\)\}<\/strong>`/);
assert.match(client,/Know B/);
assert.match(css,/background:#fff!important/);
assert.match(css,/background:#0072bc!important/);
assert.match(css,/\.t2m-manuals-launcher \.t2m-brand-mark/);
console.log('TK2M_OWNER_ROLE_MANUALS_LAST_COMPACT_RIBBON_PERSONAL_MESSAGES_PASS');
