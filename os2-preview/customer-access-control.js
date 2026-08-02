'use strict';

const legacyRouteCompatibility = require('./legacy-route-compatibility');
const createScopedCustomerSearch = require('./scoped-customer-search');
const { hasPermission } = require('./core/permissions');
const MANAGEMENT_ROLES = new Set(['owner','manager','admin']);
const READ_METHODS = new Set(['GET','HEAD','OPTIONS']);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function pathId(path, pattern) {
  const match = String(path || '').match(pattern);
  return match ? positiveId(match[1]) : null;
}
function uniqueCustomerIds(values) {
  return [...new Set((values || []).map(positiveId).filter(Boolean))];
}
async function lookupCustomerId(pool, sql, id) {
  const [[row]] = await pool.execute(sql,{id});
  return row && row.master_customer_id ? Number(row.master_customer_id) : null;
}
async function lookupCustomerIds(pool, sql, id) {
  const [rows] = await pool.execute(sql,{id});
  return uniqueCustomerIds(rows.flatMap(row => [row.master_customer_id,row.primary_customer_id,row.candidate_customer_id,row.survivor_customer_id,row.source_customer_id]));
}
async function resolveCustomerIdsFromRequest(pool, req) {
  const explicit = uniqueCustomerIds([
    req.body?.masterCustomerId,req.body?.customerId,req.body?.survivorCustomerId,req.body?.sourceCustomerId,
    req.query?.masterCustomerId,req.query?.customerId
  ]);

  const duplicateCaseId = positiveId(req.body?.duplicateCaseId) || pathId(req.path,/\/duplicate-customers\/(\d+)(?:\/|$)/);
  if (duplicateCaseId) {
    const pair = await lookupCustomerIds(pool,'SELECT primary_customer_id,candidate_customer_id FROM os2_customer_duplicate_cases WHERE id=:id LIMIT 1',duplicateCaseId);
    return uniqueCustomerIds([...explicit,...pair]);
  }

  const mergePlanId = pathId(req.path,/\/customer-merge-plans\/(\d+)(?:\/|$)/);
  if (mergePlanId) {
    const pair = await lookupCustomerIds(pool,'SELECT survivor_customer_id,source_customer_id FROM os2_customer_merge_plans WHERE id=:id LIMIT 1',mergePlanId);
    return uniqueCustomerIds([...explicit,...pair]);
  }

  if (explicit.length) return explicit;

  const directPatterns = [
    /\/customers\/(\d+)(?:\/|$)/,
    /\/customer-lifecycle\/(\d+)(?:\/|$)/,
    /\/customer-access\/(\d+)(?:\/|$)/,
    /\/customer-merge-plans\/customer\/(\d+)(?:\/|$)/
  ];
  for (const pattern of directPatterns) {
    const id = pathId(req.path,pattern);
    if (id) return [id];
  }

  const lookups = [
    {pattern:/\/mobile-lines\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_mobile_lines WHERE id=:id LIMIT 1'},
    {pattern:/\/fixed-accounts\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_fixed_accounts WHERE id=:id LIMIT 1'},
    {pattern:/\/fixed-services\/(\d+)(?:\/|$)/,sql:'SELECT fa.master_customer_id FROM os2_fixed_services fs JOIN os2_fixed_accounts fa ON fa.id=fs.fixed_account_id WHERE fs.id=:id LIMIT 1'},
    {pattern:/\/accounts\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_customer_accounts WHERE id=:id LIMIT 1'},
    {pattern:/\/representatives\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_authorised_representatives WHERE id=:id LIMIT 1'},
    {pattern:/\/restrictions\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_customer_restrictions WHERE id=:id LIMIT 1'},
    {pattern:/\/documents\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_customer_documents WHERE id=:id LIMIT 1'},
    {pattern:/\/work-items\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_work_items WHERE id=:id LIMIT 1'},
    {pattern:/\/claims\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_customer_claims WHERE id=:id LIMIT 1'},
    {pattern:/\/approvals\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_approval_requests WHERE id=:id LIMIT 1'},
    {pattern:/\/opportunities\/(\d+)(?:\/|$)/,sql:'SELECT master_customer_id FROM os2_opportunities WHERE id=:id LIMIT 1'}
  ];
  for (const lookup of lookups) {
    const id = pathId(req.path,lookup.pattern);
    if (id) {
      const customerId = await lookupCustomerId(pool,lookup.sql,id);
      return customerId ? [customerId] : [];
    }
  }
  return [];
}
async function resolveCustomerIdFromRequest(pool, req) {
  const ids = await resolveCustomerIdsFromRequest(pool,req);
  return ids[0] || null;
}
async function resolveCustomerAccess(pool, user, masterCustomerId) {
  if (!user || !masterCustomerId) return { allowed:false, reason:'CUSTOMER_ACCESS_CONTEXT_MISSING' };
  const role = String(user.role || '').toLowerCase();
  if (MANAGEMENT_ROLES.has(role)) return { allowed:true, level:'manage', source:'role' };
  const [[owner]] = await pool.execute(`SELECT assigned_staff_id FROM os2_customer_ownership
    WHERE master_customer_id=:customerId AND is_current=1
      AND (access_expires_at IS NULL OR access_expires_at>NOW())
    ORDER BY effective_from DESC,id DESC LIMIT 1`, { customerId:Number(masterCustomerId) });
  if (owner && Number(owner.assigned_staff_id) === Number(user.id)) return { allowed:true, level:'manage', source:'ownership' };
  const [[grant]] = await pool.execute(`SELECT id,access_level FROM os2_customer_access_grants
    WHERE master_customer_id=:customerId AND staff_id=:staffId AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>NOW())
    ORDER BY FIELD(access_level,'manage','write','read') ASC,granted_at DESC LIMIT 1`, {
    customerId:Number(masterCustomerId), staffId:Number(user.id)
  });
  if (grant) return { allowed:true, level:grant.access_level, source:'grant', grantId:Number(grant.id) };
  return { allowed:false, reason:'CUSTOMER_ACCESS_DENIED' };
}
function eventParams(req,customerId,eventType,access,details={}) {
  return {
    staffId:Number(req.user.id),customerId,eventType,source:access?.source||null,level:access?.level||null,
    requestId:req.requestId||null,ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),
    details:JSON.stringify({method:req.method,path:req.path,...details})
  };
}
function recordAccessEvent(pool,req,customerId,eventType,access,details={}) {
  const p=eventParams(req,customerId,eventType,access,details);
  pool.execute(`INSERT INTO os2_customer_access_events(staff_id,master_customer_id,event_type,access_source,access_level,request_id,ip_address,details_json,created_at)
    VALUES(:staffId,:customerId,:eventType,:source,:level,:requestId,:ip,:details,NOW())`,p).catch(()=>{});
}
function createCustomerAccessGuard({ pool }) {
  const scopedSearch = createScopedCustomerSearch({ pool });
  return async function customerAccessGuard(req, res, next) {
    let compatibilityHandled = false;
    legacyRouteCompatibility(req,res,()=>{compatibilityHandled=true;});
    if (!compatibilityHandled || res.headersSent) return;
    if (!req.path.startsWith('/api/os2/') || !req.user) return next();
    if (req.method === 'POST' && req.path === '/api/os2/approvals' && !hasPermission(req.user,'approval.create')) {
      return res.status(403).json({ok:false,error:'INSUFFICIENT_PERMISSION'});
    }
    if (req.path === '/api/os2/customers/search') return scopedSearch(req,res,next);
    if (req.path === '/api/os2/customers/quick-onboard') return next();
    try {
      const customerIds = await resolveCustomerIdsFromRequest(pool, req);
      if (!customerIds.length) return next();
      const accessByCustomer = [];
      for (const customerId of customerIds) {
        const access = await resolveCustomerAccess(pool, req.user, customerId);
        accessByCustomer.push({customerId,...access});
        if (!access.allowed) {
          recordAccessEvent(pool,req,customerId,'access_denied',access,{reason:access.reason,requiredCustomerIds:customerIds});
          return res.status(403).json({ ok:false,error:'CUSTOMER_ACCESS_DENIED' });
        }
        if (!READ_METHODS.has(req.method) && access.level === 'read') {
          recordAccessEvent(pool,req,customerId,'write_denied',access,{requiredCustomerIds:customerIds});
          return res.status(403).json({ ok:false,error:'CUSTOMER_WRITE_ACCESS_REQUIRED' });
        }
      }
      req.customerAccess = { masterCustomerId:customerIds[0], masterCustomerIds:customerIds, customers:accessByCustomer };
      for (const access of accessByCustomer) {
        recordAccessEvent(pool,req,access.customerId,READ_METHODS.has(req.method)?'customer_read':'customer_write',access,{requiredCustomerIds:customerIds});
      }
      return next();
    } catch (error) { return next(error); }
  };
}
module.exports = {
  MANAGEMENT_ROLES, READ_METHODS, positiveId, pathId, uniqueCustomerIds, lookupCustomerId, lookupCustomerIds,
  resolveCustomerIdFromRequest, resolveCustomerIdsFromRequest, resolveCustomerAccess, createCustomerAccessGuard
};
