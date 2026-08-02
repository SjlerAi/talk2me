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
const regression = read('multer-request-regression-check.js');
const runbook = read('MULTER_2_UPGRADE_RUNBOOK.md');
const versionReview = read('MULTER_2_VERSION_REVIEW.md');
const generationApproval = read('MULTER_2_GENERATION_APPROVAL.md');
const generationApprovalCheck = read('multer-generation-approval-check.js');

const currentReviewedVersion = '^1.4.5-lts.1';
const selectedTargetVersion = '2.2.0';

if (pkg.dependencies.multer !== currentReviewedVersion) {
  failures.push('Multer version changed without completing controlled issue #85 upgrade governance');
}
if (pkg.dependencies.multer === selectedTargetVersion) {
  failures.push('Selected Multer 2 target must not be activated during source-only review');
}

requireMarkers(documents, [
  "const multer = require('multer')",
  'storage:multer.memoryStorage()',
  'fileSize:10*1024*1024',
  'files:1',
  'fields:4',
  'parts:5',
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
  'files: 1',
  'fields: 8',
  'parts: 9',
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

const staffRoute = routeSegment(administration, "router.post('/api/administration/staff/:id/document'", 'staff document route');
requireMarkers(administration, [
  "const multer = require('multer')",
  'fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 })',
  'storage: multer.diskStorage',
  'crypto.randomBytes(8)',
  'fileSize: 8 * 1024 * 1024',
  'files: 1',
  'fields: 4',
  'parts: 5',
  "'image/jpeg','image/png','image/webp','application/pdf'",
  "upload.single('file')",
  'function removeUploadedFile(file)'
], 'staff document upload');
requireMarkers(staffRoute, [
  'removeUploadedFile(req.file);',
  "return res.status(400).json({ok:false,error:'INVALID_DOCUMENT_UPLOAD'})",
  "catch(error){removeUploadedFile(req.file);res.status(500).json({ok:false,error:error.code||'DOCUMENT_UPLOAD_FAILED'})"
], 'staff document cleanup');
requireOrder(staffRoute, [
  'requireAuth, requireManager',
  "upload.single('file')",
  'async (req,res)'
], 'staff document authorization');

requireMarkers(regression, [
  "check: 'multer-request-regression'",
  "server.listen(0, '127.0.0.1'",
  'LIMIT_FILE_SIZE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'UNSUPPORTED_UPLOAD_TYPE',
  'wrongBoundaryRejected: true',
  'truncatedBodyRejected: true',
  'missingBoundaryRejected: true',
  'controlledErrorsRequired: true',
  'privatePathDisclosureDetected: false',
  'stackDisclosureDetected: false',
  'persistentStorageUsed: false',
  'productionMutationEnabled: false'
], 'Multer request regression');

requireMarkers(versionReview, [
  'Multer 2 Version Review',
  'Status: target selected, dependency change not executed',
  'Exact target version: `2.2.0`',
  'Release channel: stable `latest`',
  'Pre-release versions are prohibited',
  '`3.0.0-alpha.2` is explicitly excluded',
  'Current reviewed dependency: `^1.4.5-lts.1`',
  'Selected review target: exact `2.2.0`',
  'Active dependency changed: no',
  'Package lock changed: no',
  'Dependency installation executed: no',
  'Production changed: no',
  'obtain explicit approval to generate dependency evidence',
  'adopt `package.json` and `package-lock.json` only through the controlled two-file adoption process'
], 'Multer 2 version review');

requireMarkers(generationApproval, [
  'Multer 2.2.0 Dependency-Evidence Generation Approval',
  'Status: not approved',
  'Exact candidate dependency: `multer@2.2.0`',
  'Owner generation approval granted: no',
  'Candidate manifest creation authorized: no',
  'Dependency-lock generation authorized: no',
  'Dependency-lock adoption authorized: no',
  'Preview activation authorized: no',
  'Production mutation authorized: no',
  'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION',
  'the exact 40-character source commit SHA',
  'an approval timestamp in canonical UTC',
  'the approving owner identity',
  'dependency adoption remains separately gated'
], 'Multer generation approval');

requireMarkers(generationApprovalCheck, [
  "check: 'multer-generation-approval'",
  "const candidateMulter = '2.2.0'",
  "const approvalPhrase = 'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION'",
  'ownerGenerationApprovalGranted: false',
  'candidateManifestCreationAuthorized: false',
  'dependencyLockGenerationAuthorized: false',
  'dependencyLockAdoptionAuthorized: false',
  'previewActivationAuthorized: false',
  'productionMutationEnabled: false'
], 'Multer generation approval checker');

requireMarkers(runbook, [
  'Controlled Multer 2 Upgrade Runbook',
  'Status: target selected, dependency change not executed',
  'Selected review target: exact Multer 2.2.0',
  'MULTER_2_VERSION_REVIEW.md',
  'MULTER_2_GENERATION_APPROVAL.md',
  'status `not approved`',
  'Multer 3 pre-release versions are excluded',
  'Customer documents',
  'Monthly import preview',
  'Staff documents',
  'Completed isolated request regressions',
  'authorization middleware remains before Multer middleware',
  'exact target `2.2.0`; no range and no pre-release substitution',
  'generation approval, dependency adoption, preview activation and production activation as separate gates',
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
  selectedTargetVersion,
  stableReleaseChannelRequired: true,
  prereleaseCandidatesProhibited: true,
  exactVersionRequiredForAdoption: true,
  explicitGenerationApprovalRequired: true,
  exactGenerationApprovalPhraseRequired: true,
  generationApprovalCurrentlyGranted: false,
  candidateManifestCreationCurrentlyAuthorized: false,
  controlledTwoFileAdoptionRequired: true,
  dependencyAdoptionSeparatelyGated: true,
  previewActivationSeparatelyGated: true,
  productionActivationSeparatelyGated: true,
  activeDependencyChanged: false,
  packageLockChanged: false,
  uploadSurfaces: 3,
  singleFileLimitsRequired: true,
  multipartFieldAndPartLimitsRequired: true,
  authorizationBeforeParsingRequired: true,
  privateDocumentStorageRequired: true,
  privateStaffUploadDirectoryRequired: true,
  validationFailureCleanupRequired: true,
  persistenceFailureCleanupRequired: true,
  isolatedRequestRegressionRequired: true,
  malformedRequestRegressionRequired: true,
  controlledErrorDisclosureRequired: true,
  multer2UpgradeExecuted: false,
  dependencyInstallationExecuted: false,
  productionMutationEnabled: false
}, null, 2));
