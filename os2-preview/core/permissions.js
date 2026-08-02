'use strict';

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  manager: [
    'customer.read','customer.create','customer.update','customer.assign','customer.transfer','customer.archive','customer.merge.review','customer.merge.plan','customer.merge.execution.request',
    'account.read','account.create','account.update','service.read','service.create','service.update',
    'document.read','document.upload','document.archive','restriction.read','restriction.update',
    'work.read','work.create','work.update','work.assign','work.accept','work.return',
    'approval.read','approval.create','approval.decide','claim.request','claim.approve','assignment.approve','report.read','report.export',
    'import.read','import.upload','import.review','import.finalise','staff.read','attendance.read','attendance.correct',
    'audit.read','launcher.read','launcher.update','notification.broadcast','notification.queue.read','digest.generate',
    'security.event.read','security.session.revoke','privacy.read','privacy.manage','privacy.decide','privacy.export','privacy.retention'
  ],
  admin: [
    'customer.read','customer.create','customer.update','customer.merge.review','account.read','account.create','account.update',
    'service.read','service.create','service.update','document.read','document.upload',
    'restriction.read','work.read','work.create','work.update','work.assign',
    'approval.read','approval.create','claim.request','report.read','import.read','import.upload','staff.read',
    'attendance.read','launcher.read','notification.queue.read','security.event.read','privacy.read','privacy.manage'
  ],
  staff: [
    'customer.read','customer.create','customer.update.assigned','account.read','service.read',
    'document.read.assigned','document.upload.assigned','restriction.read.assigned',
    'work.read.own','work.create','work.update.own','work.complete.own','claim.request','approval.create',
    'inquiry.create','inquiry.update.assigned','calendar.read.own','calendar.update.own',
    'note.read.own','note.create','note.update.own','attendance.read.own'
  ]
});

const PROTECTED_PERMISSION_ROLES = Object.freeze({
  'customer.merge.approve': new Set(['owner']),
  'customer.merge.execution.authorise': new Set(['owner']),
  'customer.merge.execution.consume': new Set(['owner']),
  'staff.delete': new Set(['owner']),
  'security.role.manage': new Set(['owner']),
  'privacy.retention': new Set(['owner','manager'])
});

function normaliseRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normaliseConfiguredPermissions(configured) {
  if (!Array.isArray(configured)) return [];
  return configured.map(value => String(value || '').trim()).filter(Boolean);
}

function roleAllowsProtectedPermission(role, permission) {
  const allowedRoles = PROTECTED_PERMISSION_ROLES[permission];
  return !allowedRoles || allowedRoles.has(normaliseRole(role));
}

function safePermissionsForRole(role, permissions) {
  const normalisedRole = normaliseRole(role);
  return normaliseConfiguredPermissions(permissions)
    .filter(permission => roleAllowsProtectedPermission(normalisedRole, permission));
}

function permissionsFor(role, configured = []) {
  const normalisedRole = normaliseRole(role);
  const safeBase = safePermissionsForRole(normalisedRole, ROLE_PERMISSIONS[normalisedRole] || []);
  const safeConfigured = safePermissionsForRole(normalisedRole, configured);
  return new Set([...safeBase, ...safeConfigured]);
}

function validateRolePermissionCeilings(rolePermissions = ROLE_PERMISSIONS) {
  const violations = [];
  for (const [role, permissions] of Object.entries(rolePermissions || {})) {
    for (const permission of normaliseConfiguredPermissions(permissions)) {
      if (!roleAllowsProtectedPermission(role, permission)) violations.push({ role:normaliseRole(role), permission });
    }
  }
  return violations;
}

function hasPermission(user, permission, context = {}) {
  if (!user || !permission) return false;
  const role = normaliseRole(user.role);
  if (!roleAllowsProtectedPermission(role, permission)) return false;
  const granted = permissionsFor(role, user.permissions);
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

module.exports = {
  ROLE_PERMISSIONS,PROTECTED_PERMISSION_ROLES,normaliseRole,normaliseConfiguredPermissions,
  roleAllowsProtectedPermission,safePermissionsForRole,validateRolePermissionCeilings,
  permissionsFor,hasPermission,requirePermission,requireAnyPermission
};
