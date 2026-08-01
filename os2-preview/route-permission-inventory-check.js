'use strict';

const fs = require('fs');
const path = require('path');
const { ROLE_PERMISSIONS, PROTECTED_PERMISSION_ROLES } = require('./core/permissions');

const root = __dirname;
const files = fs.readdirSync(root)
  .filter((name) => name === 'server.js' || name.endsWith('-routes.js'))
  .sort();

const declared = new Set(Object.values(ROLE_PERMISSIONS).flat().filter((permission) => permission !== '*'));
for (const permission of Object.keys(PROTECTED_PERMISSION_ROLES)) declared.add(permission);

const used = new Map();
const patterns = [
  /requirePermission\(\s*['"]([a-z0-9_.-]+)['"]/g,
  /hasPermission\([^,]+,\s*['"]([a-z0-9_.-]+)['"]/g,
  /requireAnyPermission\(([^)]*)\)/g
];

function record(permission, file) {
  if (!permission) return;
  if (!used.has(permission)) used.set(permission, new Set());
  used.get(permission).add(file);
}

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const pattern of patterns.slice(0, 2)) {
    for (const match of source.matchAll(pattern)) record(match[1], file);
  }
  for (const call of source.matchAll(patterns[2])) {
    for (const permission of call[1].matchAll(/['"]([a-z0-9_.-]+)['"]/g)) record(permission[1], file);
  }
}

const unknown = [...used.keys()].filter((permission) => !declared.has(permission)).sort();
if (unknown.length) {
  throw new Error(`Route permissions missing from central registry: ${unknown.map((permission) => `${permission} [${[...used.get(permission)].join(', ')}]`).join('; ')}`);
}

const protectedRequired = [
  'customer.merge.approve',
  'customer.merge.execution.authorise',
  'customer.merge.execution.consume',
  'staff.delete',
  'security.role.manage',
  'privacy.retention'
];
for (const permission of protectedRequired) {
  if (!PROTECTED_PERMISSION_ROLES[permission]) throw new Error(`Missing protected permission ceiling: ${permission}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'route-permission-inventory',
  scannedFiles: files.length,
  usedPermissions: used.size,
  protectedPermissions: Object.keys(PROTECTED_PERMISSION_ROLES).length
}, null, 2));
