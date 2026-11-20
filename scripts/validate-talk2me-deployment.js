'use strict';
// GitHub-only retirement guard. This validator must never connect to UENT or
// TK2M hosting or attempt to change an operational database.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const failures=[];
const relative=p=>path.join(root,p);
const read=p=>fs.readFileSync(relative(p),'utf8');

// The canonical live TK2M release must keep public health and immutable
// version proofs ahead of any authenticated business routes.
const server=read('server.js');
const sessionPosition=server.indexOf('app.use(session({');
for(const route of ["'/api/health'","'/api/release'"]){
  const pos=server.indexOf(route);
  if(pos<0)failures.push('Missing public '+route+' health/release identity');
  if(sessionPosition>=0 && pos>sessionPosition){
    failures.push(route+' must be registered before session middleware');
  }
}

// The owner has retired old UENT/UNT CRM deployment automation. A future
// merge must not silently restore it, even from the historical main branch.
const retired=[
  'deploy-elitehost-uat.yml',
  'bootstrap-elitehost-uat-agent.yml',
  'bootstrap-ui-uat-v2-agent.yml',
  'verify-elitehost-connection.yml',
  'apply-base-details-foundation-db.yml',
  'validate-release-proof.yml'
];
const workflows=relative('.github/workflows');
for(const name of retired){
  if(fs.existsSync(path.join(workflows,name))){
    failures.push('Retired UENT workflow must remain absent: '+name);
  }
}
let examined=0;
for(const name of fs.readdirSync(workflows).filter(x=>/\.ya?ml$/.test(x))){
  const source=fs.readFileSync(path.join(workflows,name),'utf8');
  examined++;
  // Block any executable Actions workflow pointed at old UENT CRM runtime.
  // Zippy and current TK2M validation have separate identities and remain.
  if(/talk2me\.uent\.co\.za|\/home\/uent\/(?:repositories\/talk2me|talk2me\.uent\.co\.za)|SSH_USER:\s*['"]?uent\b/i.test(source)){
    failures.push('Actions workflow still targets retired UENT CRM: '+name);
  }
}

// Historical UENT control data is retained in HOLD while host-side database
// preservation is verified; this validator does not attempt a migration.
const legacyControl=relative('deploy/uat.json');
if(fs.existsSync(legacyControl)){
  const control=JSON.parse(fs.readFileSync(legacyControl,'utf8'));
  if(control.status!=='HOLD')failures.push('Historical UENT manifest must remain HOLD');
}
if(failures.length){
  console.error('Talk2Me retired-UENT deployment guard FAILED:');
  for(const f of failures)console.error('- '+f);
  process.exitCode=1;
}else{
  console.log('TALK2ME_UENT_WORKFLOW_RETIREMENT_GUARD_PASS checked_workflows='+examined);
  console.log('- Old UENT CRM GitHub deployments, bootstraps and SQL jobs are absent');
  console.log('- Canonical CRM public health and release proofs remain protected');
  console.log('- Historical UENT database is NOT modified by this source check');
}
