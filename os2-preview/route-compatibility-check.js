'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const server=read('server.js');
const integrated=read('integrated-routes.js');
const compatibility=read('legacy-route-compatibility.js');
const accessControl=read('customer-access-control.js');
const register=read('ROUTE_COMPATIBILITY_REGISTER.md');

for(const route of ["app.get('/health'","app.get('/login'","app.post('/api/auth/login'","app.post('/api/auth/logout'","app.get('/api/auth/me'","app.get('/api/dashboard'","app.get('/api/admin/session-check'","app.get('/'"]){
  requireText(server,route,`preserved route ${route}`);
}
requireText(server,'app.use(createCustomerAccessGuard({ pool }))','customer access guard mount');
requireText(integrated,"router.get('/api/os2/customers/search'",'integrated customer search replacement');
requireText(compatibility,"GET /api/customers/search",'legacy customer search policy');
requireText(compatibility,"POST /api/inquiries",'legacy inquiry write retirement');
requireText(compatibility,"LEGACY_ROUTE_RETIRED",'explicit retirement response');
requireText(compatibility,"successor-version",'replacement link header');
requireText(accessControl,"require('./legacy-route-compatibility')",'compatibility import');
requireText(accessControl,'legacyRouteCompatibility(req,res','compatibility invocation');
requireText(accessControl,"req.path === '/api/os2/customers/search'",'mapped route governed search handling');
requireText(register,'must not be reintroduced','legacy write prohibition');

console.log(JSON.stringify({ok:true,check:'route-compatibility-governance',preservedRoutes:8,mappedRoutes:1,retiredLegacyWrites:2,mounted:true},null,2));
