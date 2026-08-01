'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function assert(ok,message){if(!ok)throw new Error(message);}

const server=read('server.js');
const controls=read('security-controls.js');
const routes=read('security-routes.js');
const migration=read('migrations/20260801_008_security_controls.sql');

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
console.log('Security controls validation passed');
