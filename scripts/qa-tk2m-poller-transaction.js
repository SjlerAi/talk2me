'use strict';
// Executes the actual candidate poller with isolated filesystem and fake host
// adapters. No network, production paths, real processes or real DB are used.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'tk2m-crm-live-agent.sh'),'utf8');
const old='a'.repeat(40), next='b'.repeat(40), control='c'.repeat(40);
const oldBranch='release/tk2m-previous-qa', branch='release/tk2m-candidate-qa';
const oldReq='tk2m-previous-qa-0001', req='tk2m-candidate-qa-0002';
const oldReceipt=oldReq+' '+old+' '+oldBranch;
const newReceipt=req+' '+next+' '+branch;
const fixtureProgram=[
"#!/usr/bin/env node",
"const fs=require('node:fs'),path=require('node:path');",
"const file=process.env.QA_STATE, root=process.env.QA_ROOT;",
"const s=JSON.parse(fs.readFileSync(file,'utf8'));",
"const cmd=path.basename(process.argv[1]), a=process.argv.slice(2);",
"const save=()=>fs.writeFileSync(file,JSON.stringify(s));",
"const receipt=t=>fs.writeFileSync(root+'/crm-live/ops/last-verified-release',t+'\\n');",
"const output=t=>console.log(t);",
"const refuse=()=>{save();process.exit(1)};",
"if(cmd==='git'){if(a[0]!=='-C'||!a[1].startsWith(root+'/'))refuse();",
" if(a[2]==='ls-remote'&&a[1]===root+'/control') output(s.control+'\\trefs/heads/deploy/tk2m-crm-control');",
" else if(a[2]==='rev-parse'&&a[3]==='HEAD') output(a[1]===root+'/control'?s.control:s.current); else refuse();",
"}else if(cmd==='curl'){const url=a.at(-1);if(url==='https://tk2m-fixture.invalid/api/release'){s.trace.push('release:'+s.worker);save();output(JSON.stringify({commit:s.current,workerBootCommit:s.worker,workerBootTime:s.boot,sourceBranch:s.sourceBranch,environment:'production',productionCutover:true,stagingOnly:false}));}",
" else if(url==='https://tk2m-fixture.invalid/api/health'){s.trace.push('health:'+s.healthy);save();output(JSON.stringify({environment:'production',status:s.healthy?'ok':'error',database:s.healthy?'connected':'disconnected'}));}else refuse();",
"}else if(cmd==='ps'||cmd==='sleep'){/* no real worker or wait */",
"}else if(cmd==='cloudlinux-selector'){if(a.join(' ')!=='restart --json --interpreter nodejs --user talk --app-root '+root+'/app')refuse();s.trace.push('scoped-restart');if(s.scenario==='restart-refused')refuse();if(s.scenario==='restart-success'){s.worker=s.current;s.boot=s.newBoot;s.healthy=true;}save();",
"}else if(cmd==='deploy-tk2m-live'){const mode=a[3];if(a[0]!==s.branch||a[1]!==s.next||a[2]!==s.req||a.length!==4)refuse();s.trace.push(mode);save();",
" if(mode==='contract-v2'){if(s.scenario==='legacy-driver')refuse();output('TK2M_DRIVER_V2_ACTIVATION_JOURNAL_AND_RECEIPT');}",
" else if(mode==='status'){output('TK2M_DRIVER_V2_'+s.status);}",
" else if(mode==='dry-run'){if(s.scenario==='preflight-failure'||s.status!=='NEW')refuse();}",
" else if(mode==='run'){if(s.status!=='NEW')refuse();s.status='ACTIVATED';s.current=s.next;s.sourceBranch=s.branch;s.dependencies='new';",
"  if(!['stale-worker','restart-success','restart-refused','rollback-failure'].includes(s.scenario)){s.worker=s.next;s.boot=s.scenario==='stale-boot-time'?s.oldBoot:s.newBoot;}else s.worker=s.old;",
"  if(s.scenario==='early-receipt')receipt(s.newReceipt);save();if(s.scenario==='activation-failure')refuse();}",
" else if(mode==='rollback'){if(s.scenario==='rollback-failure'){s.status='INCIDENT';refuse();}s.current=s.old;s.worker=s.old;s.sourceBranch=s.oldBranch;s.dependencies='old';s.boot=s.oldBoot;s.healthy=true;receipt(s.oldReceipt);s.status='ROLLED_BACK';save();}",
" else if(mode==='finalize'){if(s.status!=='ACTIVATED'||s.worker!==s.next||s.boot<=s.oldBoot||!s.healthy||fs.readFileSync(root+'/crm-live/ops/last-verified-release','utf8').trim()!==s.oldReceipt)refuse();",
"  if(s.scenario==='finalize-failure'){s.status='INCIDENT';refuse();}receipt(s.newReceipt);s.status='COMMITTED';save();}else refuse();",
"}else refuse();"
].join('\n')+'\n';
function exercise(scenario,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tk2m-poller-qa-'));
 try{
  const ops=root+'/crm-live/ops', bin=root+'/bin', state=root+'/state.json';
  for(const dir of [ops,bin,root+'/app/.git',root+'/control/.git',root+'/control/deploy'])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(root+'/crm-live/PRODUCTION_ACTIVE','synthetic QA\n');
  const manifest={schema:1,action:options.hold?'hold':'deploy',environment:'tk2m-production',request_id:req,release_branch:branch,release_sha:next,expected_previous_sha:options.wrongBaseline?'d'.repeat(40):old,production_cutover:true,owner_approved:!options.unapproved};
  fs.writeFileSync(root+'/control/deploy/tk2m-crm-live-control.json',JSON.stringify(manifest));
  const initial={scenario,old,next,control,oldBranch,branch,req,oldReceipt,newReceipt,current:old,worker:old,sourceBranch:oldBranch,oldBoot:'2026-11-27T06:00:00.000Z',newBoot:'2026-11-27T06:01:00.000Z',boot:'2026-11-27T06:00:00.000Z',healthy:!options.unhealthy,dependencies:'old',status:'NEW',trace:[]};
  fs.writeFileSync(state,JSON.stringify(initial));
  fs.writeFileSync(ops+'/last-verified-release',(options.drift?oldReq+' '+'d'.repeat(40)+' '+oldBranch:oldReceipt)+'\n',{mode:0o600});
  for(const name of ['git','curl','ps','sleep','cloudlinux-selector'])fs.writeFileSync(bin+'/'+name,fixtureProgram,{mode:0o700});
  fs.writeFileSync(ops+'/deploy-tk2m-live',fixtureProgram,{mode:0o700});
  // Rebase only fixed paths in a temporary copy. Any attempted process signal
  // intentionally fails the test. All host-dependent operations are adapters.
  let script=source.replace('export PATH="/opt/alt/alt-nodejs20/root/usr/bin:/usr/local/bin:/usr/bin:/bin:$PATH"','export PATH="'+bin+':/usr/local/bin:/usr/bin:/bin"')
    .replaceAll('/home/talk/crm-live',root+'/crm-live')
    .replaceAll('/home/talk/repositories/talk2me-crm-stage',root+'/app')
    .replaceAll('/home/talk/tk2m-crm-deploy-control',root+'/control')
    .replaceAll('/usr/sbin/cloudlinux-selector',bin+'/cloudlinux-selector')
    .replaceAll('https://crm.tk2m.co.za/','https://tk2m-fixture.invalid/')
    .replace('kill -TERM "$current_pid"','exit 97 # real process operation forbidden in QA');
  assert.ok(script.includes('export PATH="'+bin+':'));
  assert.doesNotMatch(script,/\/home\/talk|\/usr\/sbin\/cloudlinux-selector|https:\/\/crm\.tk2m\.co\.za|kill -TERM/);
  const scriptPath=root+'/poller.sh';
  fs.writeFileSync(scriptPath,script,{mode:0o700});
  const run=()=>{const r=spawnSync('bash',[scriptPath],{encoding:'utf8',timeout:20000,env:{PATH:bin+':'+process.env.PATH,HOME:root,QA_ROOT:root,QA_STATE:state}});assert.ifError(r.error);return{status:r.status,output:r.stdout+r.stderr,state:JSON.parse(fs.readFileSync(state,'utf8')),receipt:fs.readFileSync(ops+'/last-verified-release','utf8').trim()};};
  const result=run();
  if(options.replay)result.replay=run();
  return result;
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const success=r=>{assert.equal(r.status,0,r.output);assert.equal(r.state.status,'COMMITTED');assert.equal(r.state.current,next);assert.equal(r.state.worker,next);assert.equal(r.receipt,newReceipt);assert.match(r.output,/TK2M_PRODUCTION_DEPLOY_PROVEN/);const t=r.state.trace;assert.ok(t.indexOf('release:'+next)>t.indexOf('run'));assert.ok(t.indexOf('finalize')>t.indexOf('release:'+next));};
const failed=r=>{assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/TK2M_PRODUCTION_DEPLOY_PROVEN/);};
const noActivation=r=>{failed(r);assert.equal(r.state.current,old);assert.ok(!r.state.trace.includes('run'));assert.ok(!r.state.trace.includes('finalize'));};
const recovered=r=>{failed(r);assert.equal(r.state.status,'ROLLED_BACK');assert.equal(r.state.current,old);assert.equal(r.state.worker,old);assert.equal(r.state.dependencies,'old');assert.equal(r.receipt,oldReceipt);assert.match(r.output,/previous release restored and hosted proof PASS/);};
let r=exercise('success',{replay:true});success(r);assert.equal(r.replay.status,0,r.replay.output);assert.equal(r.replay.state.trace.filter(x=>x==='run').length,1);assert.equal(r.replay.state.trace.filter(x=>x==='finalize').length,1);
r=exercise('restart-success');success(r);assert.ok(r.state.trace.includes('scoped-restart'));
r=exercise('success',{hold:true});assert.equal(r.status,0);assert.deepEqual(r.state.trace,[]);assert.equal(r.receipt,oldReceipt);
for(const c of ['legacy-driver','preflight-failure'])noActivation(exercise(c));
for(const o of [{unapproved:true},{wrongBaseline:true},{drift:true},{unhealthy:true}])noActivation(exercise('success',o));
for(const c of ['activation-failure','stale-worker','restart-refused','early-receipt','stale-boot-time']){
 r=exercise(c,{replay:true});recovered(r);failed(r.replay);assert.equal(r.replay.state.trace.filter(x=>x==='run').length,1);assert.equal(r.replay.state.trace.filter(x=>x==='rollback').length,1);
}
r=exercise('rollback-failure',{replay:true});failed(r);assert.equal(r.state.status,'INCIDENT');assert.equal(r.receipt,oldReceipt);failed(r.replay);assert.equal(r.replay.state.trace.filter(x=>x==='run').length,1);
r=exercise('finalize-failure',{replay:true});failed(r);assert.equal(r.state.status,'INCIDENT');assert.equal(r.receipt,oldReceipt);failed(r.replay);assert.equal(r.replay.state.trace.filter(x=>x==='finalize').length,1);
console.log('TK2M_POLLER_V2_ISOLATED_TRANSACTION_PASS (mock driver; not installed host acceptance)');
