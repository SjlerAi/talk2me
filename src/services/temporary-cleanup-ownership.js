'use strict';

// Keep the verified CRM staff allocation when old line records are archived.
// This module never selects a staff member by name or guesses across conflicts.
class AssignmentConflict extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssignmentConflict';
    this.code = code;
  }
}
function staffPlan(rows, primaryId, accountOwnerId) {
  const active = rows.filter(r => Number(r.is_active) === 1);
  const owners = [...new Set(active.map(r => Number(r.assigned_staff_id)))];
  if (owners.some(id => !Number.isSafeInteger(id) || id < 1) || owners.length > 1)
    throw new AssignmentConflict('staff_conflict','Different or invalid staff allocations exist. Confirm the correct staff member before consolidation.');
  const primary = active.find(r => Number(r.client_id) === Number(primaryId)) || null;
  const accountOwner = Number(accountOwnerId || 0);
  if (accountOwner > 0 && owners.length && owners[0] !== accountOwner)
    throw new AssignmentConflict('account_staff_conflict','The account-level staff owner differs from the line assignment. Confirm the correct owner before consolidation.');
  if (primary) {
    if (Number(primary.assigned_staff_id) !== owners[0])
      throw new AssignmentConflict('staff_conflict','The current line has a different assigned staff member.');
    return {action:'retain',staffId:owners[0],source:null};
  }
  if (!owners.length) return {action:'no_active_assignment',staffId:null,source:null};
  return {
    action:'transfer',
    staffId:owners[0],
    source:active.find(r => Number(r.assigned_staff_id) === owners[0])
  };
}
function assignmentNote(source, explanation) {
  const origin = '#'+String(source.client_id);
  const reason = String(explanation||'').trim().slice(0,220);
  const prior = String(source.notes||'').trim();
  return ('Cleanup allocation preserved from old line '+origin+'. '+reason+(prior?' | '+prior:'')).slice(0,500);
}
async function applyStaffPlan(connection, plan, allRows, primaryId, accountNumber, actorId, reason, archiveIds) {
  const events=[];
  if (archiveIds.length) {
    await connection.query('UPDATE client_assignments SET is_active=0, updated_at=NOW() WHERE client_id IN (?) AND is_active=1',[archiveIds]);
    events.push({operation:'archive_old_allocations',clientIds:archiveIds});
  }
  if (plan.action !== 'transfer') return events;
  const [activeStaff] = await connection.execute(
    'SELECT id FROM staff_users WHERE id=:staffId AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    {staffId:plan.staffId});
  if (activeStaff.length !== 1)
    throw new AssignmentConflict('inactive_staff','The previously allocated staff member is no longer active. Confirm a new staff owner before continuing.');
  const existing = allRows.find(r => Number(r.client_id) === Number(primaryId));
  const notes=assignmentNote(plan.source,reason);
  if (existing) {
    // Unique client_id constraint: reuse an inactive assignment row, retain its previous values in audit JSON.
    if (Number(existing.is_active)) throw new AssignmentConflict('staff_conflict','The current line was assigned by another user. Reload the case.');
    await connection.execute('UPDATE client_assignments SET assigned_staff_id=:staffId, assigned_by=:actorId, account_number=:accountNumber, notes=:notes, is_active=1, assigned_at=NOW(), updated_at=NOW() WHERE id=:id',
      {staffId:plan.staffId,actorId,accountNumber,notes,id:Number(existing.id)});
    events.push({operation:'reactivate_primary_assignment',assignmentId:Number(existing.id),sourceClientId:Number(plan.source.client_id),staffId:plan.staffId});
  } else {
    const [result] = await connection.execute('INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,notes,is_active,assigned_at,updated_at) VALUES (:primaryId,:accountNumber,:staffId,:actorId,:notes,1,NOW(),NOW())',
      {primaryId,accountNumber,staffId:plan.staffId,actorId,notes});
    events.push({operation:'create_primary_assignment',assignmentId:Number(result.insertId),sourceClientId:Number(plan.source.client_id),staffId:plan.staffId});
  }
  return events;
}
module.exports={AssignmentConflict,staffPlan,applyStaffPlan,assignmentNote};
