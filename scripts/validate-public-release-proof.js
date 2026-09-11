'use strict';

const assert = require('assert');
const { verify } = require('./verify-public-release');

const sha = '74195a00c8d378b05ab6c731d02fec56933e9099';
const run = '34602138775';
const health = JSON.stringify({ status: 'ok', service: 'talk2me-crm', database: 'connected' });
const release = JSON.stringify({ commit: sha, workflowRunId: run });

assert.deepStrictEqual(
  verify({ healthJson: health, releaseJson: release, expectedCommit: sha, expectedWorkflowRunId: run }),
  { commit: sha, workflowRunId: run }
);
assert.throws(() => verify({ healthJson: health, releaseJson: release, expectedCommit: '0'.repeat(40), expectedWorkflowRunId: run }), /does not match/);
assert.throws(() => verify({ healthJson: health, releaseJson: release, expectedCommit: sha, expectedWorkflowRunId: '1' }), /does not match/);
assert.throws(() => verify({ healthJson: JSON.stringify({ status: 'down' }), releaseJson: release, expectedCommit: sha, expectedWorkflowRunId: run }), /not ok/);
assert.throws(() => verify({ healthJson: 'not-json', releaseJson: release, expectedCommit: sha, expectedWorkflowRunId: run }), /not valid JSON/);

console.log('Exact public release proof validation passed.');
