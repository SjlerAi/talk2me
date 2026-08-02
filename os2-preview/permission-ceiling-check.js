'use strict';

const {
  ROLE_PERMISSIONS,permissionsFor,hasPermission,roleAllowsProtectedPermission,
  PROTECTED_PERMISSION_ROLES,safePermissionsForRole,validateRolePermissionCeilings
}=require('./core/permissions');

function assert(condition,message){if(!condition)throw new Error(message);}

assert(PROTECTED_PERMISSION_ROLES['customer.merge.approve'],'Missing protected merge approval ceiling');
assert(PROTECTED_PERMISSION_ROLES['customer.merge.execution.authorise'],'Missing protected merge authorisation ceiling');
assert(roleAllowsProtectedPermission('owner','customer.merge.approve'),'Owner must retain merge approval');
assert(!roleAllowsProtectedPermission('manager','customer.merge.approve'),'Manager must not receive merge approval');
assert(!roleAllowsProtectedPermission('admin','customer.merge.execution.authorise'),'Admin must not receive merge execution authorisation');
assert(!roleAllowsProtectedPermission('staff','security.role.manage'),'Staff must not receive role management');
assert(hasPermission({id:1,role:'owner',permissions:[]},'customer.merge.execution.authorise'),'Owner wildcard must satisfy protected authorisation');
assert(!hasPermission({id:2,role:'manager',permissions:['customer.merge.execution.authorise']},'customer.merge.execution.authorise'),'Configured permission must not bypass role ceiling');
assert(!hasPermission({id:3,role:'admin',permissions:['customer.merge.approve']},'customer.merge.approve'),'Admin configured permission must not bypass owner-only merge approval');
assert(!permissionsFor('staff',['staff.delete']).has('staff.delete'),'Protected permission must be filtered from configured staff permissions');
assert(permissionsFor('manager',['report.export']).has('report.export'),'Non-protected configured permissions must remain available');
assert(validateRolePermissionCeilings(ROLE_PERMISSIONS).length===0,'Base role permission map violates a protected ceiling');
assert(!safePermissionsForRole('staff',['customer.read','staff.delete']).includes('staff.delete'),'Base filtering helper must remove protected staff permission');
assert(safePermissionsForRole('staff',['customer.read','staff.delete']).includes('customer.read'),'Base filtering helper must retain allowed staff permission');
const simulatedRoleMap={...ROLE_PERMISSIONS,staff:[...ROLE_PERMISSIONS.staff,'security.role.manage']};
const simulatedViolations=validateRolePermissionCeilings(simulatedRoleMap);
assert(simulatedViolations.some(item=>item.role==='staff'&&item.permission==='security.role.manage'),'Invariant must detect a protected permission added to a lower base role');

console.log(JSON.stringify({
  ok:true,
  check:'permission-ceilings',
  protectedPermissions:Object.keys(PROTECTED_PERMISSION_ROLES).length,
  baseRoleViolations:validateRolePermissionCeilings(ROLE_PERMISSIONS).length
},null,2));
