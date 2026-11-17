'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const agent=fs.readFileSync(path.join(root,'scripts/tk2m-crm-live-agent.sh'),'utf8');
const expect=x=>assert.ok(agent.includes(x), 'Production poller missing '+x);
for(const term of [
  'set -Eeuo pipefail','umask 077','production-poller.lock',
  'deploy/tk2m-crm-live-control.json','refs/heads/deploy/tk2m-crm-control',
  'tk2m-production',"m.production_cutover!==true",
  "m.owner_approved!==true",'m.expected_previous_sha',
  '/home/talk/crm-live/PRODUCTION_ACTIVE','/home/talk/crm-live/ops/deploy-tk2m-live',
  'TK2M_PRODUCTION_DEPLOY_REQUIRES_CONTROL_HOLD',
  'release.environment','health.database',"release.commit!==sha",
  '"$DRIVER" "$branch" "$sha" "$request" dry-run',
  '"$DRIVER" "$branch" "$sha" "$request" run'
])expect(term);
assert.doesNotMatch(agent,/DRIVER=.+tk2m-crm-deploy-stage/);
assert.doesNotMatch(agent,/CONTROL_REF=refs\/heads\/deploy\/ui-uat-control/);
assert.match(agent, /\[\[ "\$action" == hold \]\] && exit 0/);
assert.match(agent, /last-verified-release/);
console.log('TK2M_PRODUCTION_POLLER_CONTRACT_PASS');