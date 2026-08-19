const { claimClient } = require('./client-claim');

const MAX_BULK_CLAIMS = 1000;

function normaliseClientIds(values) {
  const input = Array.isArray(values) ? values : (values === undefined || values === null ? [] : [values]);
  const ids = [];
  const seen = new Set();

  for (const value of input) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length > MAX_BULK_CLAIMS) {
    const error = new Error(`Select no more than ${MAX_BULK_CLAIMS} accounts at a time.`);
    error.statusCode = 400;
    throw error;
  }

  return ids;
}

async function bulkClaimClients(values, context, options = {}) {
  const clientIds = normaliseClientIds(values);
  if (!clientIds.length) {
    const error = new Error('Select at least one unassigned account to claim.');
    error.statusCode = 400;
    throw error;
  }

  const claim = options.claimClient || claimClient;
  const database = options.database;
  const summary = {
    selected: clientIds.length,
    claimed: 0,
    alreadyMine: 0,
    conflicts: 0,
    failed: 0
  };

  // Keep each account in the existing claim service's own transaction. This
  // isolates a raced ownership conflict or bad record without rolling back the
  // other accounts selected by the staff member.
  for (const clientId of clientIds) {
    try {
      const result = await claim(clientId, context, database);
      if (result?.status === 'conflict') summary.conflicts += 1;
      else if (result?.idempotent) summary.alreadyMine += 1;
      else summary.claimed += 1;
    } catch (_) {
      summary.failed += 1;
    }
  }

  return summary;
}

module.exports = {
  MAX_BULK_CLAIMS,
  normaliseClientIds,
  bulkClaimClients
};
