'use strict';
const assert=require('assert');
const fs=require('fs');
const db=require('../src/config/db');
const {taskWords,phonetic,staffMatches,pickMatch,incompleteInstruction}=require('../src/services/cudo-natural-parser');
const {prepareNaturalCommand,continueNaturalIncomplete,naturalDetailReply}=require('../src/services/cudo-natural-plan');

const stephan={id:100,first_name:'Stephan',full_name:'Stephan Le Roux',username:'stephan',email:'stephan@test.example',contact_number:'0710000001',role:'owner'};
const gerda={id:200,first_name:'Gerda',full_name:'Gerda Smit',username:'gerda',email:'gerda@test.example',contact_number:'0710000002',role:'staff'};
const johnny={id:300,first_name:'Johnny',full_name:'Johnny Olivier',username:'johnny',email:'johnny@test.example',contact_number:'0710000003',role:'staff'};
let users=[stephan,gerda,johnny],queries=0,transactionAttempts=0;
const originalExecute=db.execute;
const originalConnection=db.getConnection;

async function test(){
 try{
  db.execute=async sql=>{
    queries++;
    if(String(sql).includes('FROM staff_users WHERE is_active=1'))return [users];
    if(String(sql).includes('FROM clients WHERE is_active=1'))return [[]];
    if(String(sql).includes('FROM clients WHERE id=:id'))return [[]];
    throw Error('Unexpected CRM query '+String(sql).slice(0,120));
  };
  db.getConnection=async()=>{transactionAttempts++;throw Error('A message must never send during interpretation or preview');};

  const spoken=taskWords('Please ask Stephen to find.');
  assert.deepEqual([spoken.kind,spoken.assignee,spoken.instruction],['instruction','Stephen','find.']);
  assert.equal(phonetic('Stephen'),'stefen');
  assert.equal(phonetic('Stephan'),'stefan');
  assert.equal(pickMatch(staffMatches('Stephen',users)).person.id,stephan.id,'Voice variant Stephen resolves near Stephan');
  assert.equal(pickMatch(staffMatches('Stephen',users)).near,true,'Voice variant needs confirmation');
  assert.equal(incompleteInstruction('find.'),true);
  assert.equal(incompleteInstruction('call'),true);
  assert.equal(incompleteInstruction('phone me'),false);
  assert.equal(incompleteInstruction('find the report'),false);
  assert.equal(incompleteInstruction('find the'),true);
  assert.equal(incompleteInstruction('check the customer'),false);
  assert.equal(naturalDetailReply('the spreadsheet with the upgrades'),true);
  assert.equal(naturalDetailReply('Ask Gerda to phone Stephan'),false,'A new command must not append to a prior one');
  assert.equal(naturalDetailReply('Find me Stephan'),false,'CRM searches must remain separate');

  let result=await prepareNaturalCommand({message:'Please ask Stephen to find.',source:'voice',requesterId:gerda.id});
  assert.equal(result.intent,'natural_instruction_detail','Do not search for a missing object or create a task yet');
  assert.equal(result.text,'What should Stephan find?','Cudo should ask what to find, using the actual CRM first name');
  assert.equal(result.pendingAction.type,'natural_instruction_detail');
  assert.equal(result.pendingAction.requesterId,gerda.id);
  assert.equal(result.pendingAction.chosen.assigneeId,stephan.id);
  assert.equal(result.pendingAction.chosen.assigneeNameNear,true);
  assert(!result.actions.length&&!result.preview,'Incomplete commands cannot offer Send');

  const prepared=await continueNaturalIncomplete(result.pendingAction,
    'the client upgrade spreadsheet',{requesterId:gerda.id});
  assert.equal(prepared.intent,'natural_instruction_preview');
  assert.equal(prepared.preview.assignee.id,stephan.id);
  assert.equal(prepared.preview.assignee.displayName,'Stephan');
  assert.equal(prepared.preview.instruction,'find the client upgrade spreadsheet');
  assert.equal(prepared.preview.confirmName,true,'Voice near-match requires typed staff name');
  assert(prepared.actions.includes('confirm_natural_instruction'),'Complete instruction is ready for explicit confirmation only');
  assert.equal(prepared.pendingAction.type,'natural_instruction');
  assert.equal(prepared.pendingAction.requesterId,gerda.id);
  assert.equal(transactionAttempts,0,'No task or message created during interpretation');

  const wrong=await continueNaturalIncomplete(result.pendingAction,
    'the document',{requesterId:johnny.id});
  assert.equal(wrong.intent,'natural_instruction_error','Follow-up cannot cross authenticated sessions');
  assert(!wrong.actions.length);

  result=await prepareNaturalCommand({message:'Please ask Gerda to find.',
    source:'text',requesterId:stephan.id});
  assert.equal(result.intent,'natural_instruction_detail');
  assert.equal(result.text,'What should Gerda find?');
  let continued=await continueNaturalIncomplete(result.pendingAction,
    'the documents for Friday',{requesterId:stephan.id});
  assert.equal(continued.intent,'natural_instruction_preview');
  assert.equal(continued.preview.assignee.id,gerda.id);
  assert.equal(continued.preview.confirmName,false,'Exact typed name requires only send confirmation');

  result=await prepareNaturalCommand({message:'Please ask Gerda to phone me',
    requesterId:stephan.id});
  assert.equal(result.intent,'natural_instruction_preview');
  assert.equal(result.preview.reference.id,stephan.id,'Existing pronoun resolution must keep working');

  users=[...users,{id:400,first_name:'Steven',full_name:'Steven Smith',
    username:'steven',email:'steven@test.example',contact_number:null,role:'staff'}];
  assert.equal(pickMatch(staffMatches('Stephen',users)).error,'ambiguous',
    'When multiple staff sound like Stephen, do not silently assign');
  result=await prepareNaturalCommand({message:'Ask Stephen to find the ledger',
    requesterId:gerda.id});
  assert.equal(result.intent,'natural_name_check');
  assert(result.choices.length>=2,'Show the two real CRM staff matches');
  assert(!result.actions.length,'Ambiguity cannot send');

  users.push({id:500,first_name:'Stephen',full_name:'Stephen Smith',
    username:'stephen',email:'stephen@test.example',contact_number:null,role:'staff'});
  const exact=pickMatch(staffMatches('Stephen',users));
  assert.equal(exact.person.id,500,'An exact CRM name must win over similar names');
  assert.equal(exact.near,false);
  assert.equal(transactionAttempts,0,'No task was sent during these tests');
  assert(queries>0,'Tests must exercise real CRM lookup paths with mocked query results');

  const route=fs.readFileSync('src/routes/cudo-ai.js','utf8');
  const work=fs.readFileSync('src/routes/uat-work-widgets.js','utf8');
  const cudoUi=fs.readFileSync('public/js/cudo-widget.js','utf8');
  const workUi=fs.readFileSync('public/js/uat-work-widgets.js','utf8');
  assert(route.includes('continueNaturalIncomplete'));
  assert(work.includes('continueNaturalIncomplete'));
  assert(cudoUi.includes('natural_instruction_detail')&&cudoUi.includes('awaitingNaturalName'));
  assert(workUi.includes('natural_instruction_detail'));
  assert(route.includes("actionName==='confirm_natural_instruction'"));
  console.log('CUDO_FUZZY_NAME_AND_INCOMPLETE_COMMAND_VALIDATION=PASS');
 }finally{
  db.execute=originalExecute;db.getConnection=originalConnection;
 }
}
test().catch(e=>{console.error(e);process.exitCode=1;});
