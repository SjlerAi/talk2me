'use strict';

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  manager: [
    'customer.read','customer.create','customer.update','customer.assign','customer.transfer','customer.archive','customer.merge.review','customer.merge.plan','customer.merge.execution.request',
    'account.read','account.create','account.update','service.read','service.create','service.update',
    'document.read','document.upload','document.archive','restriction.read','restriction.update',
    'work.read','work.create','work.update','work.assign','work.accept','work.return',
    'approval.read','approval.decide','claim.request','claim.approve','report.read','report.export',
    'import.read','import.upload','import.review','import.finalise','staff.read','attendance.read','attendance.correct',
    'audit.read','launcher.read','launcher.update','notification.broadcast','notification.queue.read','digest.generate',
    'security.event.read','security.session.revoke','privacy.read','privacy.manage','privacy.decide','privacy.export','privacy.retention'
  ],
  admin: [
    'customer.read','customer.create','customer.update','customer.merge.review','account.read','account.create','account.update',
    'service.read','service.create','service.update','document.read','document.upload',
    'restriction.read','work.read','work.create','work.update','work.assign',
    'approval.read','claim.request','report.read','import.read','import.upload','staff.read',
    'attendance.read','launcher.read','notification.queue.read','security.event.read','privacy.read','privacy.manage'
  ],
  staff: [
    'customer.read','customer.create','customer.update.assigned','account.read','service.read',
    'document.read.assigned','document.upload.assigned','restriction.read.assigned',
    'work.read.own','work.create','work.update.own','work.complete.own','claim.request',
    'inquiry.create','inquiry.update.assigned','calendar.read.own','calendar.update.own',
    'note.read.own','note.create','note.update.own','attendance.read.own'
  ]
});

function normaliseRole(role) {
  return String(role || '').trim().toLowerCase();
}

function permissionsFor(role, configured = []) {
  const base = ROLE_PERMISSIONS[normaliseRole(role)] || [];
  return new Set([...base, ...(Array.isArray(configured) ? configured : [])]);
}

function hasPermission(user, permission, context = {}) {
  if (!user || !permission) return false;
  const granted = permissionsFor(user.role, user.permissions);
  if (granted.has('*') || granted.has(permission)) return true;

  if (granted.has(`${permission}.own`) && Number(context.ownerStaffId) === Number(user.id)) return true;
  if (granted.has(`${permission}.assigned`) && Number(context.assigneeStaffId) === Number(user.id)) return true;
  if (granted.has(`${permission}.assigned`) && Number(context.customerOwnerStaffId) === Number(user.id)) return true;

  return false;
}

function requirePermission(permission, contextResolver) {
  return async function permissionMiddleware(req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
      const context = contextResolver ? await contextResolver(req) : {};
      if (!hasPermission(req.user, permission, context)) {
        return res.status(403).json({ ok: false, error: 'INSUFFICIENT_PERMISSION' });
      }
      req.permissionContext = context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireAnyPermission(...permissions) {
  return function anyPermissionMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
    if (!permissions.some((permission) => hasPermission(req.user, permission))) {
      return res.status(403).json({ ok: false, error: 'INSUFFICIENT_PERMISSION' });
    }
    return next();
  };
}

module.exports = { ROLE_PERMISSIONS, normaliseRole, permissionsFor, hasPermission, requirePermission, requireAnyPermission };
