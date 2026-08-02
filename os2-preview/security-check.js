'use strict';

const fs=require('fs');
const path=require('path');
const { spawnSync }=require('child_process');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function assert(ok,message){if(!ok)throw new Error(message);}

const server=read('server.js');
const controls=read('security-controls.js');
const routes=read('security-routes.js');
const migration=read('migrations/20260801_008_security_controls.sql');
const multerGovernance=read('multer-upgrade-governance-check.js');
const multerRunbook=read('MULTER_2_UPGRADE_RUNBOOK.md');

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
assert(multerGovernance.includes('uploadSurfaces: 3'),'Multer upload inventory count missing');
assert(multerRunbook.includes('Status: planned, not executed'),'Multer upgrade must remain explicitly unexecuted');
const result=spawnSync(process.execPath,['multer-upgrade-governance-check.js'],{cwd:__dirname,encoding:'utf8',timeout:30000,shell:false,env:Object.freeze({PATH:process.env.PATH||'',NODE_ENV:'test'})});
assert(!result.error,`Multer governance execution failed: ${result.error&&result.error.message}`);
assert(result.status===0,`Multer governance failed: ${String(result.stderr||result.stdout).trim()}`);
const evidence=JSON.parse(String(result.stdout||'{}'));
assert(evidence.ok===true&&evidence.check==='multer-upgrade-governance','Multer governance evidence invalid');
assert(evidence.multer2UpgradeExecuted===false,'Multer 2 upgrade must not execute during source validation');
assert(evidence.productionMutationEnabled===false,'Multer governance must prohibit production mutation');
console.log('Security controls validation passed');
