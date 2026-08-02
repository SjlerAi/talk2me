'use strict';

const express=require('express');
const { requirePermission }=require('./core/permissions');
const { recordSecurityEvent }=require('./security-controls');
const createPrivacyRouter=require('./privacy-routes');
const createRestrictionGovernanceRouter=require('./restriction-governance-routes');
const createAccountGovernanceRouter=require('./account-governance-routes');
const createCustomerLifecycleRouter=require('./customer-lifecycle-routes');
const createDuplicateCustomerRouter=require('./duplicate-customer-routes');
const createCustomerMergePlanRouter=require('./customer-merge-plan-routes');
const createCustomerMergeFreshnessRouter=require('./customer-merge-freshness-routes');
const createMergeExecutionAuthorisationRouter=require('./customer-merge-execution-authorisation-routes');
const createMergeExecutionReadinessRouter=require('./customer-merge-execution-readiness-routes');

function positiveId(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null;}
function management(user){return ['owner','manager'].includes(String(user?.role||'').toLowerCase());}

module.exports=function createSecurityRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/security',requireAuth);
  router.use(createPrivacyRouter({pool,requireAuth}));
  router.use(createRestrictionGovernanceRouter({pool,requireAuth}));
  router.use(createAccountGovernanceRouter({pool,requireAuth}));
  router.use(createCustomerLifecycleRouter({pool,requireAuth}));
  router.use(createDuplicateCustomerRouter({pool,requireAuth}));
  router.use(createCustomerMergePlanRouter({pool,requireAuth}));
  router.use(createCustomerMergeFreshnessRouter({pool,requireAuth}));
  router.use(createMergeExecutionAuthorisationRouter({pool,requireAuth}));
  router.use(createMergeExecutionReadinessRouter({pool,requireAuth}));

  router.get('/api/os2/security/sessions',async(req,res)=>{
    try{
      const ownOnly=!management(req.user);
      const [rows]=await pool.execute(`SELECT session_id,expires_at,created_at,updated_at,last_seen_at,ip_address,user_agent,revoked_at,revoked_reason
        FROM app_sessions WHERE JSON_UNQUOTE(JSON_EXTRACT(session_data,'$.user.id'))=:staffId OR :ownOnly=0
        ORDER BY COALESCE(last_seen_at,updated_at,created_at) DESC LIMIT 250`,{staffId:String(req.user.id),ownOnly:ownOnly?1:0});
      res.json({ok:true,sessions:rows.map(r=>({...r,session_id:String(r.session_id).slice(0,8)+'…',is_current:String(req.sessionToken||'').startsWith(String(r.session_id).slice(0,8))}))});
    }catch(error){console.error('Session list failed',error.code||error.message);res.status(500).json({ok:false,error:'SESSION_LIST_FAILED'});}
  });

  router.post('/api/os2/security/sessions/revoke-others',async(req,res)=>{
    try{
      const [result]=await pool.execute(`UPDATE app_sessions SET revoked_at=NOW(),revoked_reason='revoked_by_user'
        WHERE JSON_UNQUOTE(JSON_EXTRACT(session_data,'$.user.id'))=:staffId AND session_id<>:current AND revoked_at IS NULL`,{staffId:String(req.user.id),current:req.sessionToken});
      await recordSecurityEvent(pool,req,{eventType:'other_sessions_revoked',severity:'warning',details:{count:result.affectedRows}});
      res.json({ok:true,revoked:Number(result.affectedRows||0)});
    }catch(error){res.status(500).json({ok:false,error:'SESSION_REVOKE_FAILED'});}
  });

  router.post('/api/os2/security/staff/:staffId/revoke-sessions',requirePermission('security.session.revoke'),async(req,res)=>{
    const staffId=positiveId(req.params.staffId);if(!staffId)return res.status(400).json({ok:false,error:'INVALID_STAFF_ID'});
    if(Number(staffId)===Number(req.user.id))return res.status(400).json({ok:false,error:'USE_REVOKE_OTHERS_FOR_SELF'});
    try{
      const [result]=await pool.execute(`UPDATE app_sessions SET revoked_at=NOW(),revoked_reason=:reason
        WHERE JSON_UNQUOTE(JSON_EXTRACT(session_data,'$.user.id'))=:staffId AND revoked_at IS NULL`,{staffId:String(staffId),reason:String(req.body.reason||'revoked_by_manager').slice(0,120)});
      await recordSecurityEvent(pool,req,{eventType:'staff_sessions_revoked',severity:'high',details:{targetStaffId:staffId,count:result.affectedRows}});
      res.json({ok:true,revoked:Number(result.affectedRows||0)});
    }catch(error){res.status(500).json({ok:false,error:'STAFF_SESSION_REVOKE_FAILED'});}
  });

  router.get('/api/os2/security/events',requirePermission('security.event.read'),async(req,res)=>{
    try{
      const severity=['info','warning','high','critical'].includes(req.query.severity)?req.query.severity:null;
      const [rows]=await pool.execute(`SELECT e.*,s.full_name staff_name FROM os2_security_events e
        LEFT JOIN staff_users s ON s.id=e.staff_id WHERE (:severity IS NULL OR e.severity=:severity)
        ORDER BY e.created_at DESC LIMIT 500`,{severity});
      res.json({ok:true,events:rows});
    }catch(error){res.status(500).json({ok:false,error:'SECURITY_EVENTS_LOAD_FAILED'});}
  });

  router.get('/api/os2/security/summary',requirePermission('security.event.read'),async(req,res)=>{
    try{
      const [[summary]]=await pool.execute(`SELECT
        SUM(created_at>=NOW()-INTERVAL 24 HOUR) events_24h,
        SUM(severity IN ('high','critical') AND created_at>=NOW()-INTERVAL 24 HOUR) serious_24h,
        SUM(event_type='login_failed' AND created_at>=NOW()-INTERVAL 1 HOUR) failed_logins_1h
        FROM os2_security_events`);
      const [[sessions]]=await pool.execute(`SELECT COUNT(*) active_sessions FROM app_sessions WHERE expires_at>NOW() AND revoked_at IS NULL`);
      res.json({ok:true,summary:{...summary,...sessions}});
    }catch(error){res.status(500).json({ok:false,error:'SECURITY_SUMMARY_FAILED'});}
  });
  return router;
};