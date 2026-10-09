const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(p) {
  const f = path.join(root, p);
  if (!fs.existsSync(f)) {
    failures.push(`missing ${p}`);
    return '';
  }
  return fs.readFileSync(f, 'utf8');
}

function requireText(p, text, reason) {
  const src = read(p);
  if (!src.includes(text)) failures.push(`${p}: ${reason}`);
}

const bible = read('docs/DEPLOYMENT_BIBLE_V2_2026-08-22.md');
if (!bible.includes('V2.0 LOCKED')) failures.push('Deployment Bible V2.0 must remain locked.');
if (!bible.includes('One road forward. If it breaks, fix the road - do not build another road.')) failures.push('Locked final deployment principle missing.');

requireText('docs/DEPLOYMENT_PROFILE_V2.md', 'deploy/ui-uat-control', 'profile must name the dedicated control branch');
requireText('docs/DEPLOYMENT_PROFILE_V2.md', '/home/uent/bin/talk2me-ui-uat-agent', 'profile must name the permanent poller');
requireText('docs/DEPLOYMENT_PROFILE_V2.md', '/home/uent/bin/talk2me-deploy-ui-uat', 'profile must name the installed deploy driver');
requireText('docs/DEPLOYMENT_PROFILE_V2.md', 'Routine deployment must not use GitHub Actions SSH/SCP', 'profile must prohibit routine push deployment');
requireText('docs/DEPLOYMENT_PROFILE_V2.md', '/home/uent/bin/desktop-commander-remote-low', 'profile must require the low-resource remote launcher');
requireText('docs/DEPLOYMENT_PROFILE_V2.md', 'The Elitehost UAT account has a tight per-user PID/thread budget', 'profile must document shared-host thread headroom');

const poller = read('scripts/talk2me-ui-uat-agent.sh');
for (const required of [
  'CONTROL_BRANCH=deploy/ui-uat-control',
  'SOURCE_REPO=/home/uent/repositories/talk2me-ui-uat',
  'DRIVER=/home/uent/bin/talk2me-deploy-ui-uat',
  'if m.get("version") != 1',
  'if a not in ("hold","deploy")',
  'branch.startswith("release/")',
  'rev-parse FETCH_HEAD',
  'LAST_SUCCESS',
  'TALK2ME_UI_UAT_AGENT_RESULT=DEPLOYED'
]) {
  if (!poller.includes(required)) failures.push(`poller missing locked V2 contract: ${required}`);
}

const driver = read('scripts/deploy-ui-uat.sh');
for (const required of [
  'EXPECTED_BRANCH',
  'EXPECTED_SHA',
  'deployment branch must be release/*',
  'BACKUP_DIR=/home/uent/deployment-backups/talk2me-ui-uat',
  '.talk2me-release.json',
  'tmp/restart.txt',
  'restart_runtime',
  'app_process_count',
  'verify_single_app_process',
  'user_thread_count',
  'verify_thread_headroom',
  'TALK2ME_UI_UAT_USER_THREADS',
  'insufficient CloudLinux thread headroom before deploy',
  'CloudLinux thread headroom exhausted after deploy',
  'pre-existing duplicate Talk2Me Passenger processes; refusing to deploy',
  'TALK2ME_UI_UAT_APP_PROCESS_COUNT=1',
  'TALK2ME_UI_UAT_PAGE_PROBE',
  '/api/health',
  '/api/release',
  '/agent/login',
  'exact public release proof failed'
]) {
  if (!driver.includes(required)) failures.push(`deploy driver missing locked V2 responsibility: ${required}`);
}

const restartTouches = (driver.match(/touch "\$APP_DIR\/tmp\/restart\.txt"/g) || []).length;
if (restartTouches !== 1) failures.push('deploy driver must keep exactly one restart-file fallback, not combine it with the CloudLinux selector restart');
if (!driver.includes('if [ -n "$SELECTOR" ]; then') || !driver.includes('else\n    echo "TALK2ME_UI_UAT_RESTART_METHOD=passenger-restart-file"')) {
  failures.push('deploy driver must choose exactly one restart mechanism: CloudLinux selector or restart-file fallback');
}

const installer = read('scripts/install-talk2me-ui-uat-agent.sh');
for (const required of [
  'GLOBAL_GUARD_DIR=/home/uent/.deploy-agent-guard',
  '/bin/flock -n /home/uent/.deploy-agent-guard/global.lock',
  '/bin/timeout -k 15s 10m /home/uent/bin/talk2me-ui-uat-agent',
  'start-desktop-commander-remote-low.sh',
  'desktop-commander-remote-low'
]) {
  if (!installer.includes(required)) failures.push(`UI-UAT poller commissioning missing global deploy guard: ${required}`);
}

const lowRemote = read('scripts/start-desktop-commander-remote-low.sh');
for (const required of [
  'UV_THREADPOOL_SIZE',
  'UV_THREADPOOL_SIZE:-2',
  '--v8-pool-size=1',
  'node_modules/.bin/desktop-commander',
  'exec "$NODE" "$ENTRY" remote'
]) {
  if (!lowRemote.includes(required)) failures.push(`low-resource Desktop Commander launcher missing: ${required}`);
}
if (lowRemote.includes('npm exec') || lowRemote.includes('npx ')) {
  failures.push('low-resource Desktop Commander launcher must not keep a persistent npm/npx parent process');
}

if (fs.existsSync(path.join(root, '.github/workflows/deploy-ui-uat.yml'))) {
  failures.push('Superseded routine GitHub->Elitehost UI-UAT deployment workflow must not exist.');
}

const commissioning = read('.github/workflows/bootstrap-ui-uat-v2-agent.yml');
if (!commissioning.includes('BOOTSTRAP UI UAT V2 AGENT')) failures.push('one-time commissioning must require explicit confirmation');
if (!commissioning.includes('install-talk2me-ui-uat-agent.sh')) failures.push('commissioning must install the reviewed permanent poller');
if (commissioning.includes('scp ')) failures.push('commissioning workflow must not introduce artifact SCP deployment');

if (failures.length) {
  console.error('Talk2Me UI-UAT Deployment Bible V2 validation failed:');
  failures.forEach(f => console.error('- ' + f));
  process.exit(1);
}
console.log('Talk2Me UI-UAT Deployment Bible V2 validation passed.');
console.log('- one control branch, one permanent poller, one installed driver');
console.log('- controlled release/* exact SHA only');
console.log('- no routine GitHub Actions SSH/SCP deployment workflow');
console.log('- exact public SHA, page probes and Agent runtime proof remain mandatory');
console.log('- deployment uses one restart mechanism and must prove exactly one Talk2Me Passenger process');
console.log('- shared-host thread headroom is enforced and remote tooling has a low-resource launcher');
