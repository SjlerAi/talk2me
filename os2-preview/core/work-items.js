'use strict';

const { appendAudit } = require('./audit');

const ALLOWED_TRANSITIONS = Object.freeze({
  created: new Set(['seen','started','updated','completed','archived']),
  seen: new Set(['started','updated','completed','archived']),
  started: new Set(['updated','completed','archived']),
  updated: new Set(['started','completed','archived']),
  completed: new Set(['accepted','returned','archived']),
  returned: new Set(['updated','started','completed','archived']),
  accepted: new Set(['archived']),
  archived: new Set([])
});

function assertTransition(fromState, toState) {
  if (!ALLOWED_TRANSITIONS[fromState]?.has(toState)) {
    const error = new Error('INVALID_WORK_ITEM_TRANSITION');
    error.details = { fromState, toState };
    throw error;
  }
}

async function transitionWorkItem(connection, options) {
  const [[item]] = await connection.execute(
    'SELECT * FROM os2_work_items WHERE id=:id FOR UPDATE',
    { id: Number(options.workItemId) }
  );
  if (!item) throw new Error('WORK_ITEM_NOT_FOUND');
  assertTransition(item.lifecycle_state, options.toState);

  const completedAt = options.toState === 'completed' ? new Date() : item.completed_at;
  const acceptedAt = options.toState === 'accepted' ? new Date() : item.accepted_at;
  const archivedAt = options.toState === 'archived' ? new Date() : item.archived_at;

  await connection.execute(`
    UPDATE os2_work_items
       SET lifecycle_state=:toState, completed_at=:completedAt, accepted_at=:acceptedAt,
           archived_at=:archivedAt, updated_at=NOW()
     WHERE id=:id`, {
    id: Number(options.workItemId),
    toState: options.toState,
    completedAt,
    acceptedAt,
    archivedAt
  });

  const [history] = await connection.execute(`
    INSERT INTO os2_work_item_history
      (work_item_id, from_state, to_state, note, changed_by, created_at)
    VALUES
      (:workItemId, :fromState, :toState, :note, :changedBy, NOW())`, {
    workItemId: Number(options.workItemId),
    fromState: item.lifecycle_state,
    toState: options.toState,
    note: options.note ? String(options.note).slice(0, 5000) : null,
    changedBy: Number(options.actorStaffId)
  });

  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'work_item_transitioned',
    entityType: 'os2_work_items',
    entityId: item.id,
    masterCustomerId: item.master_customer_id,
    description: `Work item moved from ${item.lifecycle_state} to ${options.toState}`,
    before: { lifecycle_state: item.lifecycle_state },
    after: { lifecycle_state: options.toState, history_id: Number(history.insertId) },
    requestContext: options.requestContext
  });

  return { id: Number(item.id), fromState: item.lifecycle_state, toState: options.toState };
}

module.exports = { ALLOWED_TRANSITIONS, assertTransition, transitionWorkItem };
