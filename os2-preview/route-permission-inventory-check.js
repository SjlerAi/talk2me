'use strict';

const fs = require('fs');
const path = require('path');
const { ROLE_PERMISSIONS, PROTECTED_PERMISSION_ROLES } = require('./core/permissions');

const root = __dirname;
const explicitRuntimeFiles = new Set(['customer-access-control.js', 'security-controls.js']);
const files = fs.readdirSync(root)
  .filter((name) => name === 'server.js' || name.endsWith('-routes.js') || explicitRuntimeFiles.has(name))
  .sort();

const declared = new Set(Object.values(ROLE_PERMISSIONS).flat().filter((permission) => permission !== '*'));
for (const permission of Object.keys(PROTECTED_PERMISSION_ROLES)) declared.add(permission);

const used = new Map();
const dynamicCalls = [];
const literalPatterns = [
  /requirePermission\(\s*['"]([a-z0-9_.-]+)['"]/g,
  /hasPermission\([^,]+,\s*['"]([a-z0-9_.-]+)['"]/g,
  /requireAnyPermission\(([^)]*)\)/g
];

function record(permission, file) {
  if (!permission) return;
  if (!used.has(permission)) used.set(permission, new Set());
  used.get(permission).add(file);
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function detectDynamicCalls(source, file) {
  for (const match of source.matchAll(/requirePermission\(([^)]*)\)/g)) {
    if (!/^\s*['"][a-z0-9_.-]+['"]/.test(match[1])) {
      dynamicCalls.push(`${file}:${lineNumber(source, match.index)} requirePermission`);
    }
  }
  for (const match of source.matchAll(/hasPermission\(([^)]*)\)/g)) {
    const args = match[1].split(',');
    if (args.length < 2 || !/^\s*['"][a-z0-9_.-]+['"]/.test(args[1])) {
      dynamicCalls.push(`${file}:${lineNumber(source, match.index)} hasPermission`);
    }
  }
  for (const match of source.matchAll(/requireAnyPermission\(([^)]*)\)/g)) {
    const args = match[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (!args.length || args.some((value) => !/^['"][a-z0-9_.-]+['"]$/.test(value))) {
      dynamicCalls.push(`${file}:${lineNumber(source, match.index)} requireAnyPermission`);
    }
  }
}

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  detectDynamicCalls(source, file);
  for (const pattern of literalPatterns.slice(0, 2)) {
    for (const match of source.matchAll(pattern)) record(match[1], file);
  }
  for (const call of source.matchAll(literalPatterns[2])) {
    for (const permission of call[1].matchAll(/['"]([a-z0-9_.-]+)['"]/g)) record(permission[1], file);
  }
}

if (dynamicCalls.length) {
  throw new Error(`Dynamic permission expressions are not allowed in governed runtime files: ${dynamicCalls.join('; ')}`);
}
if (!used.size) throw new Error('Permission inventory discovered no runtime permissions');

const unknown = [...used.keys()].filter((permission) => !declared.has(permission)).sort();
if (unknown.length) {
  throw new Error(`Route permissions missing from central registry: ${unknown.map((permission) => `${permission} [${[...used.get(permission)].join(', ')}]`).join('; ')}`);
}

if (!used.get('approval.create')?.has('customer-access-control.js')) {
  throw new Error('Customer access middleware must enforce the centrally registered approval.create permission');
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
  protectedPermissions: Object.keys(PROTECTED_PERMISSION_ROLES).length,
  dynamicPermissionCalls: dynamicCalls.length
}, null, 2));
