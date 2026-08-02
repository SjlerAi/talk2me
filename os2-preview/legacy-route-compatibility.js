'use strict';

const LEGACY_ROUTE_POLICY=Object.freeze({
  'GET /api/customers/search':{status:'mapped',replacement:'GET /api/os2/customers/search'},
  'GET /api/inquiry-options':{status:'retired',replacement:'GET /api/os2/work-items/options'},
  'POST /api/inquiries':{status:'retired',replacement:'POST /api/os2/work-items'},
  'GET /api/auth/me':{status:'preserved'},
  'POST /api/auth/login':{status:'preserved'},
  'POST /api/auth/logout':{status:'preserved'},
  'GET /api/dashboard':{status:'preserved'}
});

module.exports=function legacyRouteCompatibility(req,res,next){
  const key=`${req.method} ${req.path}`;
  const policy=LEGACY_ROUTE_POLICY[key];
  if(!policy)return next();
  if(key==='GET /api/customers/search'){
    req.url=req.url.replace('/api/customers/search','/api/os2/customers/search');
    return next();
  }
  if(policy.status==='retired'){
    res.setHeader('Deprecation','true');
    res.setHeader('Link',`<${policy.replacement.split(' ')[1]}>; rel="successor-version"`);
    return res.status(410).json({ok:false,error:'LEGACY_ROUTE_RETIRED',legacyRoute:key,replacement:policy.replacement});
  }
  return next();
};

module.exports.LEGACY_ROUTE_POLICY=LEGACY_ROUTE_POLICY;
