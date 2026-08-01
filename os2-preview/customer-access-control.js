'use strict';

const MANAGEMENT_ROLES = new Set(['owner','manager','admin']);
const READ_METHODS = new Set(['GET','HEAD','OPTIONS']);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function customerIdFromRequest(req) {
  const direct = positiveId(req.params?.id || req.params?.customerId || req.params?.masterCustomerId);
  if (direct && /\/customers\//.test(req.path)) return direct;
  return positiveId(req.body?.masterCustomerId || req.query?.masterCustomerId);
}

async function resolveCustomerAccess(pool, user, masterCustomerId) {
  if (!user || !masterCustomerId) return { allowed:false, reason:'CUSTOMER_ACCESS_CONTEXT_MISSING' };
  const role = String(user.role || '').toLowerCase();
  if (MANAGEMENT_ROLES.has(role)) return { allowed:true, level:'manage', source:'role' };

  const [[owner]] = await pool.execute(`SELECT assigned_staff_id FROM os2_customer_ownership
    WHERE master_customer_id=:customerId AND is_current=1
      AND (access_expires_at IS NULL OR access_expires_at>NOW())
    ORDER BY effective_from DESC,id DESC LIMIT 1`, { customerId:Number(masterCustomerId) });
  if (owner && Number(owner.assigned_staff_id) === Number(user.id)) {
    return { allowed:true, level:'manage', source:'ownership' };
  }

  const [[grant]] = await pool.execute(`SELECT id,access_level FROM os2_customer_access_grants
    WHERE master_customer_id=:customerId AND staff_id=:staffId AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>NOW())
    ORDER BY FIELD(access_level,'manage','write','read') ASC,granted_at DESC LIMIT 1`, {
    customerId:Number(masterCustomerId), staffId:Number(user.id)
  });
  if (grant) return { allowed:true, level:grant.access_level, source:'grant', grantId:Number(grant.id) };
  return { allowed:false, reason:'CUSTOMER_ACCESS_DENIED' };
}

function createCustomerAccessGuard({ pool }) {
  return async function customerAccessGuard(req, res, next) {
    if (!req.path.startsWith('/api/os2/') || !req.user) return next();
    if (req.path === '/api/os2/customers/search' || req.path === '/api/os2/customers/quick-onboard') return next();
    const customerId = customerIdFromRequest(req);
    if (!customerId) return next();
    try {
      const access = await resolveCustomerAccess(pool, req.user, customerId);
      if (!access.allowed) return res.status(403).json({ ok:false,error:'CUSTOMER_ACCESS_DENIED' });
      if (!READ_METHODS.has(req.method) && access.level === 'read') {
        return res.status(403).json({ ok:false,error:'CUSTOMER_WRITE_ACCESS_REQUIRED' });
      }
      req.customerAccess = { masterCustomerId:customerId, ...access };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { MANAGEMENT_ROLES, READ_METHODS, positiveId, customerIdFromRequest, resolveCustomerAccess, createCustomerAccessGuard };
