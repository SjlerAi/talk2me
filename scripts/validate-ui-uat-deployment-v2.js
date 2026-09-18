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
  '/api/health',
  '/api/release',
  '/agent/login',
  'exact public release proof failed'
]) {
  if (!driver.includes(required)) failures.push(`deploy driver missing locked V2 responsibility: ${required}`);
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
console.log('- exact public SHA and Agent runtime proof remain mandatory');
