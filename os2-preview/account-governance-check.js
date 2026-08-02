'use strict';
const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8');}
const routes=read('account-governance-routes.js');
const migration=read('migrations/20260801_015_account_governance.sql');
const security=read('security-routes.js');
const required=[
 ['account create route',routes.includes("router.post('/api/os2/customers/:id/accounts'")],
 ['account update route',routes.includes("router.patch('/api/os2/accounts/:id'")],
 ['account archive route',routes.includes("router.post('/api/os2/accounts/:id/archive'")],
 ['active service archive guard',routes.includes('ACCOUNT_HAS_ACTIVE_SERVICES')],
 ['duplicate account guard',routes.includes('ACCOUNT_NUMBER_ALREADY_EXISTS')],
 ['primary replacement',routes.includes('is_primary=1')],
 ['history table',migration.includes('os2_account_history')],
 ['archive evidence fields',migration.includes('archive_reason')&&migration.includes('archived_by')],
 ['router mounted',security.includes('createAccountGovernanceRouter')]
];
const failed=required.filter(([,ok])=>!ok);
if(failed.length){for(const [name] of failed)console.error(`ACCOUNT GOVERNANCE CHECK FAILED: ${name}`);process.exit(1);}
console.log(JSON.stringify({ok:true,checks:required.map(([name])=>name)},null,2));