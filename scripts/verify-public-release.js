'use strict';

function parseJson(value, name) {
  try { return JSON.parse(String(value || '')); }
  catch { throw new Error(`${name} is not valid JSON.`); }
}

function verify({ healthJson, releaseJson, expectedCommit, expectedWorkflowRunId }) {
  const health = parseJson(healthJson, 'health response');
  const release = parseJson(releaseJson, 'release response');
  const expectedSha = String(expectedCommit || '').trim();
  const expectedRun = String(expectedWorkflowRunId || '').trim();
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error('Expected commit is not a full SHA.');
  if (!/^\d+$/.test(expectedRun)) throw new Error('Expected workflow run ID is invalid.');
  if (health.status !== 'ok') throw new Error(`Health status is ${health.status || 'missing'}, not ok.`);
  if (String(release.commit || '') !== expectedSha) {
    throw new Error(`Release commit ${release.commit || 'missing'} does not match ${expectedSha}.`);
  }
  if (String(release.workflowRunId || '') !== expectedRun) {
    throw new Error(`Release workflow ${release.workflowRunId || 'missing'} does not match ${expectedRun}.`);
  }
  return { commit: expectedSha, workflowRunId: expectedRun };
}

if (require.main === module) {
  try {
    const [healthJson, releaseJson, expectedCommit, expectedWorkflowRunId] = process.argv.slice(2);
    const result = verify({ healthJson, releaseJson, expectedCommit, expectedWorkflowRunId });
    console.log(`Verified exact public release ${result.commit} from workflow ${result.workflowRunId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verify };
