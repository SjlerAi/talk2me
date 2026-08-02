'use strict';

const fs=require('fs');
const path=require('path');
const { spawnSync }=require('child_process');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function assert(ok,message){if(!ok)throw new Error(message);}
function runJsonCheck(file,label){
  const result=spawnSync(process.execPath,[file],{
    cwd:__dirname,
    encoding:'utf8',
    timeout:30000,
    maxBuffer:256*1024,
    shell:false,
    env:Object.freeze({PATH:process.env.PATH||'',NODE_ENV:'test'})
  });
  assert(!result.error,`${label} execution failed: ${result.error&&result.error.message}`);
  assert(result.status===0,`${label} failed: ${String(result.stderr||result.stdout).trim()}`);
  return JSON.parse(String(result.stdout||'{}'));
}

const server=read('server.js');
const controls=read('security-controls.js');
const routes=read('security-routes.js');
const migration=read('migrations/20260801_008_security_controls.sql');
const multerGovernance=read('multer-upgrade-governance-check.js');
const multerRegression=read('multer-request-regression-check.js');
const multerRunbook=read('MULTER_2_UPGRADE_RUNBOOK.md');
const multerVersionReview=read('MULTER_2_VERSION_REVIEW.md');
const multerGenerationApproval=read('MULTER_2_GENERATION_APPROVAL.md');
const multerGenerationApprovalCheck=read('multer-generation-approval-check.js');
const multerCandidatePlan=read('MULTER_2_CANDIDATE_MANIFEST_PLAN.md');
const multerCandidatePlanCheck=read('multer-candidate-manifest-plan-check.js');

assert(server.includes("require('./security-controls')"),'Security controls not imported');
assert(server.includes("require('./security-routes')"),'Security router not imported');
assert((server.match(/createSecurityRouter\(/g)||[]).length===1,'Security router must be mounted once');
assert(server.includes('rateLimit({ windowMs: 15 * 60_000, max: 12'),'Login rate limit missing');
assert(server.includes('LOGIN_TEMPORARILY_BLOCKED'),'Login lockout control missing');
assert(server.includes('revoked_at IS NULL'),'Revoked session enforcement missing');
assert(controls.includes('Content-Security-Policy'),'CSP header missing');
assert(controls.includes('CROSS_ORIGIN_REQUEST_BLOCKED'),'Same-origin mutation protection missing');
assert(controls.includes('[REDACTED]'),'Security-event redaction missing');
assert(routes.includes('/api/os2/security/sessions/revoke-others'),'Self-service session revocation missing');
assert(routes.includes("requirePermission('security.session.revoke')"),'Managed session revocation permission missing');
assert(routes.includes("requirePermission('security.event.read')"),'Security event permission missing');
assert(migration.includes('os2_security_events'),'Security event table missing');
assert(migration.includes('os2_login_attempts'),'Login attempt table missing');
assert(!routes.match(/CREATE\s+TABLE/i),'Runtime table creation is prohibited');
assert(multerGovernance.includes("check: 'multer-upgrade-governance'"),'Multer governance evidence contract missing');
assert(multerGovernance.includes("const selectedTargetVersion = '2.2.0'"),'Exact Multer 2 review target missing');
assert(multerGovernance.includes('uploadSurfaces: 3'),'Multer upload inventory count missing');
assert(multerRegression.includes("check: 'multer-request-regression'"),'Multer request regression evidence contract missing');
assert(multerRegression.includes("server.listen(0, '127.0.0.1'"),'Multer regression must bind only to an ephemeral loopback port');
assert(multerRunbook.includes('Status: target selected, dependency change not executed'),'Multer dependency change must remain explicitly unexecuted');
assert(multerRunbook.includes('Selected review target: exact Multer 2.2.0'),'Multer runbook target missing');
assert(multerVersionReview.includes('Exact target version: `2.2.0`'),'Multer version review target missing');
assert(multerVersionReview.includes('Pre-release versions are prohibited'),'Multer prerelease prohibition missing');
assert(multerGenerationApproval.includes('Status: not approved'),'Multer generation approval must remain fail-closed');
assert(multerGenerationApproval.includes('APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION'),'Exact Multer generation approval phrase missing');
assert(multerGenerationApprovalCheck.includes("check: 'multer-generation-approval'"),'Multer generation approval evidence contract missing');
assert(multerCandidatePlan.includes('Status: planned, not authorized, not applied'),'Multer candidate manifest plan must remain unapplied');
assert(multerCandidatePlan.includes('to `"multer": "2.2.0"`'),'Exact Multer candidate transformation missing');
assert(multerCandidatePlanCheck.includes("check: 'multer-candidate-manifest-plan'"),'Multer candidate manifest plan evidence contract missing');

const evidence=runJsonCheck('multer-upgrade-governance-check.js','Multer governance');
assert(evidence.ok===true&&evidence.check==='multer-upgrade-governance','Multer governance evidence invalid');
assert(evidence.currentReviewedVersion==='^1.4.5-lts.1','Current reviewed Multer version evidence invalid');
assert(evidence.selectedTargetVersion==='2.2.0','Selected Multer 2 target evidence invalid');
assert(evidence.stableReleaseChannelRequired===true,'Stable Multer release channel evidence missing');
assert(evidence.prereleaseCandidatesProhibited===true,'Multer prerelease prohibition evidence missing');
assert(evidence.exactVersionRequiredForAdoption===true,'Exact Multer adoption version evidence missing');
assert(evidence.explicitGenerationApprovalRequired===true,'Multer generation approval evidence missing');
assert(evidence.controlledTwoFileAdoptionRequired===true,'Controlled Multer two-file adoption evidence missing');
assert(evidence.activeDependencyChanged===false,'Multer dependency changed during source-only review');
assert(evidence.packageLockChanged===false,'Multer package lock changed during source-only review');
assert(evidence.uploadSurfaces===3,'Multer upload inventory evidence invalid');
assert(evidence.singleFileLimitsRequired===true,'Multer single-file limits evidence missing');
assert(evidence.multipartFieldAndPartLimitsRequired===true,'Multer multipart metadata limits evidence missing');
assert(evidence.authorizationBeforeParsingRequired===true,'Multer authorization ordering evidence missing');
assert(evidence.privateDocumentStorageRequired===true,'Private customer document storage evidence missing');
assert(evidence.privateStaffUploadDirectoryRequired===true,'Private staff upload directory evidence missing');
assert(evidence.validationFailureCleanupRequired===true,'Rejected upload cleanup evidence missing');
assert(evidence.persistenceFailureCleanupRequired===true,'Persistence failure cleanup evidence missing');
assert(evidence.malformedRequestRegressionRequired===true,'Malformed upload regression governance missing');
assert(evidence.controlledErrorDisclosureRequired===true,'Controlled upload error disclosure governance missing');
assert(evidence.multer2UpgradeExecuted===false,'Multer 2 upgrade must not execute during source validation');
assert(evidence.productionMutationEnabled===false,'Multer governance must prohibit production mutation');

const approval=runJsonCheck('multer-generation-approval-check.js','Multer generation approval');
assert(approval.ok===true&&approval.check==='multer-generation-approval','Multer generation approval evidence invalid');
assert(approval.currentMulter==='^1.4.5-lts.1','Multer generation approval current version invalid');
assert(approval.selectedCandidate==='2.2.0','Multer generation approval candidate invalid');
assert(approval.exactApprovalPhraseRequired===true,'Exact Multer generation approval phrase evidence missing');
assert(approval.ownerGenerationApprovalGranted===false,'Multer generation unexpectedly approved');
assert(approval.candidateManifestCreationAuthorized===false,'Candidate manifest unexpectedly authorized');
assert(approval.dependencyLockGenerationAuthorized===false,'Dependency lock generation unexpectedly authorized');
assert(approval.dependencyLockAdoptionAuthorized===false,'Dependency lock adoption unexpectedly authorized');
assert(approval.previewActivationAuthorized===false,'Preview activation unexpectedly authorized');
assert(approval.productionMutationEnabled===false,'Multer generation approval must prohibit production mutation');

const candidatePlan=runJsonCheck('multer-candidate-manifest-plan-check.js','Multer candidate manifest plan');
assert(candidatePlan.ok===true&&candidatePlan.check==='multer-candidate-manifest-plan','Multer candidate manifest plan evidence invalid');
assert(candidatePlan.currentDependency==='^1.4.5-lts.1','Multer candidate plan current dependency invalid');
assert(candidatePlan.selectedCandidate==='2.2.0','Multer candidate plan selected version invalid');
assert(candidatePlan.exactSingleDependencyChangeRequired===true,'Exact one-dependency candidate change evidence missing');
assert(candidatePlan.scriptsContinuityRequired===true,'Candidate scripts continuity evidence missing');
assert(candidatePlan.nonMulterDependencyContinuityRequired===true,'Candidate non-Multer dependency continuity evidence missing');
assert(candidatePlan.lifecycleScriptsProhibited===true,'Candidate lifecycle-script prohibition evidence missing');
assert(candidatePlan.privateCandidateWorkspaceRequired===true,'Private candidate workspace evidence missing');
assert(candidatePlan.committedManifestMutationAuthorized===false,'Committed manifest mutation unexpectedly authorized');
assert(candidatePlan.committedLockMutationAuthorized===false,'Committed lock mutation unexpectedly authorized');
assert(candidatePlan.dependencyInstallationAuthorized===false,'Candidate dependency installation unexpectedly authorized');
assert(candidatePlan.previewActivationAuthorized===false,'Candidate preview activation unexpectedly authorized');
assert(candidatePlan.productionMutationEnabled===false,'Candidate plan must prohibit production mutation');

const regression=runJsonCheck('multer-request-regression-check.js','Multer request regression');
assert(regression.ok===true&&regression.check==='multer-request-regression','Multer request regression evidence invalid');
assert(regression.isolatedLoopbackOnly===true,'Multer request regression must remain loopback-only');
assert(regression.externalNetworkUsed===false,'Multer request regression must not use external networking');
assert(regression.databaseConfigured===false,'Multer request regression must not configure a database');
assert(regression.persistentStorageUsed===false,'Multer request regression must not publish files');
assert(regression.responseBytesBounded===true,'Multer regression response bound missing');
assert(regression.requestTimeoutBounded===true,'Multer regression request timeout missing');
assert(regression.controlledErrorsRequired===true,'Multer controlled-error evidence missing');
assert(regression.privatePathDisclosureDetected===false,'Multer regression exposed a private path');
assert(regression.stackDisclosureDetected===false,'Multer regression exposed a stack trace');
assert(regression.cases&&regression.cases.validSingleFile===true,'Valid single-file regression missing');
assert(regression.cases&&regression.cases.belowFileSizeLimitAccepted===true,'Below-limit file regression missing');
assert(regression.cases&&regression.cases.strictFileSizeLimitRejected===true,'Strict file-size limit regression missing');
assert(regression.cases&&regression.cases.missingFileVisibleToRoute===true,'Missing-file regression missing');
assert(regression.cases&&regression.cases.emptyMultipartVisibleToRoute===true,'Empty multipart regression missing');
assert(regression.cases&&regression.cases.multipleFilesRejected===true,'Multiple-file regression missing');
assert(regression.cases&&regression.cases.wrongFieldRejected===true,'Wrong-field regression missing');
assert(regression.cases&&regression.cases.excessiveFieldsRejected===true,'Field-count regression missing');
assert(regression.cases&&regression.cases.duplicateFieldsVisibleToRoute===true,'Duplicate-field regression missing');
assert(regression.cases&&regression.cases.excessivePartsRejected===true,'Part-count regression missing');
assert(regression.cases&&regression.cases.unsupportedMimeRejected===true,'Unsupported-MIME regression missing');
assert(regression.cases&&regression.cases.wrongBoundaryRejected===true,'Wrong-boundary regression missing');
assert(regression.cases&&regression.cases.truncatedBodyRejected===true,'Truncated-body regression missing');
assert(regression.cases&&regression.cases.missingBoundaryRejected===true,'Missing-boundary regression missing');
assert(regression.productionMutationEnabled===false,'Multer regression must prohibit production mutation');
console.log('Security controls validation passed');
