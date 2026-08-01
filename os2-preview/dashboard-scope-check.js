'use strict';

const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');

function need(text,label){if(!source.includes(text))throw new Error(`Missing ${label}`);}
function forbid(text,label){if(source.includes(text))throw new Error(`Forbidden ${label}`);}

need("app.get('/api/dashboard', requireAuth",'authenticated dashboard route');
need('os2_customer_ownership','staff ownership scoping');
need('os2_customer_access_grants','active access-grant scoping');
need("const managementDashboard = ['owner','manager','admin'].includes",'management dashboard role split');
need('staffId:req.user.id','dashboard staff parameterisation');
need('master_customer_id IN','customer-scoped dashboard metrics');
need('actor_staff_id=:staffId','staff-scoped dashboard activity');
forbid("count('SELECT COUNT(*) total FROM os2_master_customers WHERE archived_at IS NULL')",'unscoped customer dashboard count');
forbid('FROM os2_audit_log ORDER BY created_at DESC LIMIT 10','unscoped dashboard audit feed');

console.log(JSON.stringify({ok:true,check:'dashboard-scope'},null,2));
