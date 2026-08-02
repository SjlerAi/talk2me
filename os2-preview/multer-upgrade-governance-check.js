'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
function read(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${name}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}
function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${label} missing ${marker}`);
  }
}
function requireOrder(source, markers, label) {
  for (let index = 1; index < markers.length; index += 1) {
    const left = source.indexOf(markers[index - 1]);
    const right = source.indexOf(markers[index]);
    if (left === -1 || right === -1 || left >= right) failures.push(`${label} order invalid at ${markers[index]}`);
  }
}
function routeSegment(source, marker, label) {
  const start = source.indexOf(marker);
  if (start === -1) {
    failures.push(`${label} missing ${marker}`);
    return '';
  }
  const next = source.indexOf('\n  router.', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const pkg = JSON.parse(read('package.json'));
const documents = read('document-routes.js');
const imports = read('import-routes.js');
const administration = read('administration-routes.js');
const runbook = read('MULTER_2_UPGRADE_RUNBOOK.md');

if (pkg.dependencies.multer !== '^1.4.5-lts.1') {
  failures.push('Multer version changed without completing controlled issue #85 upgrade governance');
}

requireMarkers(documents, [
  "const multer = require('multer')",
  'storage:multer.memoryStorage()',
  'fileSize:10*1024*1024',
  'files:1',
  "requirePermission('document.upload')",
  "upload.single('document')",
  "allowedMime.has(req.file.mimetype)",
  "path.resolve(privateRoot, storageName)",
  "absolutePath.startsWith(`${privateRoot}${path.sep}`)",
  'mode:0o700',
  "mode:0o600, flag:'wx'",
  'fs.unlinkSync(absolutePath)'
], 'customer document upload');
requireOrder(routeSegment(documents, "router.post('/api/os2/customers/:id/documents'", 'customer document route'), [
  "requireAuth, requirePermission('document.upload')",
  "upload.single('document')",
  'async (req,res)'
], 'customer document authorization');

requireMarkers(imports, [
  "const multer = require('multer')",
  'storage: multer.memoryStorage()',
  'fileSize: 12 * 1024 * 1024',
  "upload.single('file')",
  "ownerOnly",
  "CSV_OR_EXCEL_REQUIRED",
  'IMPORT_ROW_LIMIT_EXCEEDED',
  'rows.length>10000',
  'createdBy:req.user.id',
  'createdAt:Date.now()'
], 'monthly import upload');
requireOrder(routeSegment(imports, "router.post('/api/imports/preview'", 'monthly import route'), [
  "requireAuth, ownerOnly",
  "upload.single('file')",
  'async (req,res)'
], 'monthly import authorization');

requireMarkers(administration, [
  "const multer = require('multer')",
  'storage: multer.diskStorage',
  'crypto.randomBytes(8)',
  'fileSize: 8 * 1024 * 1024',
  "'image/jpeg','image/png','image/webp','application/pdf'",
  "upload.single('file')",
  'fs.unlinkSync(req.file.path)'
], 'staff document upload');
requireOrder(routeSegment(administration, "router.post('/api/administration/staff/:id/document'", 'staff document route'), [
  'requireAuth, requireManager',
  "upload.single('file')",
  'async (req,res)'
], 'staff document authorization');

requireMarkers(runbook, [
  'Controlled Multer 2 Upgrade Runbook',
  'Status: planned, not executed',
  'Customer documents',
  'Monthly import preview',
  'Staff documents',
  'authorization middleware remains before Multer middleware',
  'no rejected upload remains on disk',
  'production remains untouched until explicit owner approval'
], 'Multer upgrade runbook');

if (failures.length) {
  console.error('MULTER UPGRADE GOVERNANCE CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'multer-upgrade-governance',
  currentReviewedVersion: pkg.dependencies.multer,
  uploadSurfaces: 3,
  customerDocumentUploadGoverned: true,
  monthlyImportUploadGoverned: true,
  staffDocumentUploadGoverned: true,
  authorizationBeforeParsingRequired: true,
  privateDocumentStorageRequired: true,
  rejectedUploadCleanupRequired: true,
  multer2UpgradeExecuted: false,
  dependencyInstallationExecuted: false,
  productionMutationEnabled: false
}, null, 2));
