'use strict';
const fs=require('fs');
function read(file){return fs.readFileSync(require('path').join(__dirname,file),'utf8');}
function assert(value,message){if(!value)throw new Error(message);}
const core=read('core/restrictions.js');
const routes=read('restriction-governance-routes.js');
const security=read('security-routes.js');
const migration=read('migrations/20260801_013_restriction_governance.sql');
assert(core.includes('RESTRICTION_TYPES'),'restriction whitelist missing');
assert(core.includes('INVALID_RESTRICTION_VALUE'),'restriction value validation missing');
assert(core.includes('revokeRestriction'),'restriction revocation missing');
assert(routes.includes("'/api/os2/restriction-governance/restrictions/:id/revoke'"),'revoke endpoint missing');
assert(routes.includes('restriction.read')&&routes.includes('restriction.update'),'restriction permissions missing');
assert(security.includes('createRestrictionGovernanceRouter'),'restriction router not mounted');
assert(migration.includes('os2_restriction_history')&&migration.includes('revoked_at'),'restriction history schema missing');
assert(!core.includes('CREATE TABLE'),'runtime schema creation detected');
console.log('Restriction governance architecture check passed');
