'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const identity = require('../src/services/worker-release-identity');
assert.ok(Object.isFrozen(identity), 'worker identity must be immutable');
assert.ok(identity.workerBootCommit === null || /^[0-9a-f]{40}$/.test(identity.workerBootCommit));
assert.ok(Number.isFinite(Date.parse(identity.workerBootTime)), 'worker startup time should be ISO');
const releaseFile = path.join(root, '.talk2me-release.json');
if (fs.existsSync(releaseFile)) {
  const disk = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
  const sha = String(disk.commit || '').trim().toLowerCase();
  assert.equal(identity.workerBootCommit, /^[0-9a-f]{40}$/.test(sha) ? sha : null);
}

const server = read('server.js');
assert.match(server, /const workerReleaseIdentity = require\('\.\/src\/services\/worker-release-identity'\)/);
assert.match(server, /res\.json\(\{ \.\.\.release, environment: APP_ENVIRONMENT, \.\.\.workerReleaseIdentity \}\)/);
const pollerPath = path.join(root, 'scripts/tk2m-crm-live-agent.sh');
const poller = read('scripts/tk2m-crm-live-agent.sh');
assert.match(poller, /release\.workerBootCommit!==sha/, 'poller must compare actual running boot SHA');
assert.match(poller, /typeof release\.workerBootTime!=='string'/);
assert.match(poller, /crm_worker_pids\(\)/);
assert.match(poller, /pre_deploy_pid="\$\(crm_worker_pids\)"/);
assert.match(poller, /"\$current_pid" == "\$pre_deploy_pid"/);
assert.match(poller, /"\$owner" == talk && "\$actual_cwd" == "\$APP"/);
assert.match(poller, /"\$command" == "lsnode:\$APP\/"/);
assert.match(poller, /kill -TERM "\$current_pid"/);
assert.doesNotMatch(poller, /kill\s+-9|pkill|killall/);
const syntax = spawnSync('bash', ['-n', pollerPath], {encoding:'utf8'});
assert.equal(syntax.status, 0, 'poller shell syntax: '+syntax.stderr);
console.log('TK2M_IMMUTABLE_WORKER_RELEASE_PROOF_PASS');
