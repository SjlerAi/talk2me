const rolePermissions = {
  staff: new Set(['customer.view','customer.create_request','inquiry.create','inquiry.update_own','task.view_own','task.update_own','message.send','report.view_own']),
  // Managers have owner-level operational access. Destructive routes still use
  // requireRole('owner') explicitly and can never be reached by a manager.
  manager: new Set(['*']),
  owner: new Set(['*'])
};

function hasPermission(user, permission) {
  if (!user) return false;
  const permissions = rolePermissions[user.role] || new Set();
  return permissions.has('*') || permissions.has(permission);
}

function requirePermission(permission) {
  return (req,res,next) => {
    if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
    if (!hasPermission(req.session.user,permission)) return res.status(403).render('error',{title:'Access denied',message:'Your role does not allow this action. You can submit a change for approval where available.'});
    next();
  };
}

function requireRole(...roles) {
  return (req,res,next) => {
    if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
    if (!roles.includes(req.session.user.role)) return res.status(403).render('error',{title:'Access denied',message:'This area is not available for your role.'});
    next();
  };
}

module.exports={rolePermissions,hasPermission,requirePermission,requireRole};
