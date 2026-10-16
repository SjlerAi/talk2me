'use strict';
const assert=require('assert');
const fs=require('fs');
const db=require('../src/config/db');
const {taskWords,referencedName,pronounKind}=require('../src/services/cudo-natural-parser');
const {prepareNaturalCommand,continueNaturalPronoun,naturalNameReply}=require('../src/services/cudo-natural-plan');

const owner={id:10,first_name:'Stephan',full_name:'Stephan Le Roux',username:'stephan',email:'owner@example.test',contact_number:'0710000001',role:'owner'};
const gerda={id:20,first_name:'Gerda',full_name:'Gerda Smit',username:'gerda',email:'gerda@example.test',contact_number:'0710000002',role:'staff'};
const johnny={id:30,first_name:'Johnny',full_name:'Johnny Olivier',username:'johnny',email:'johnny@example.test',contact_number:'0710000003',role:'staff'};
const original=db.execute;
let clientQueries=0;

async function run(){
  try{
    db.execute=async function(query){
      if(query.includes('FROM staff_users WHERE is_active=1'))return [[owner,gerda,johnny]];
      if(query.includes('FROM clients WHERE is_active=1')){clientQueries++;return [[]];}
      if(query.includes('FROM clients WHERE id=:id'))return [[]];
      throw new Error('Unexpected read query: '+String(query).slice(0,120));
    };

    assert.equal(taskWords('Please ask her to phone me').assignee,'her');
    assert.equal(taskWords('please ask gerda to phone me').instruction,'phone me');
    assert.equal(pronounKind('me'),'self');
    assert.equal(pronounKind('my'),'self'); // Afrikaans object pronoun
    assert.equal(pronounKind('her'),'unresolved');
    assert.equal(pronounKind('haar'),'unresolved');
    assert.equal(referencedName('phone me'),'me');
    assert.equal(referencedName('phone her'),'her');
    assert.equal(referencedName('bel haar'),'haar');
    assert.equal(referencedName('my te bel'),'my');
    assert.equal(referencedName('call the customer'),null);

    let r=await prepareNaturalCommand({message:'Please ask her to phone me',requesterId:owner.id,source:'voice'});
    assert.equal(r.intent,'natural_pronoun_clarification');
    assert.equal(r.text,'Who should I ask to phone you?');
    assert.equal(r.pendingAction.role,'assignee');
    assert.equal(r.pendingAction.requesterId,owner.id);
    assert(!r.preview&&!r.actions.length,'An unresolved pronoun must never offer send');
    assert.equal(clientQueries,0,'Never search for a CRM client called her or me');

    const continued=await continueNaturalPronoun(r.pendingAction,'Gerda',{requesterId:owner.id});
    assert.equal(continued.intent,'natural_instruction_preview');
    assert.equal(continued.preview.assignee.id,gerda.id);
    assert.equal(continued.preview.reference.id,owner.id,'Me must be the owner in the session');
    assert.equal(continued.preview.reference.name,owner.full_name);
    assert.equal(continued.preview.instruction,'phone me');
    assert.equal(continued.preview.confirmName,true,'Voice still requires typed staff confirmation');
    assert.equal(continued.pendingAction.requesterId,owner.id);
    assert(continued.actions.includes('confirm_natural_instruction'));
    assert.equal(clientQueries,0,'Follow-up must not query literal pronouns');

    r=await prepareNaturalCommand({message:'please ask gerda to phone me',requesterId:owner.id,source:'text'});
    assert.equal(r.intent,'natural_instruction_preview');
    assert.equal(r.preview.assignee.id,gerda.id);
    assert.equal(r.preview.reference.id,owner.id);
    assert.equal(r.preview.reference.phone,owner.contact_number);
    assert.equal(r.preview.confirmName,false);
    assert.equal(clientQueries,0,'Direct me is resolved by session ID, not client text');

    r=await prepareNaturalCommand({message:'Vra Gerda om my te bel',requesterId:owner.id,source:'voice'});
    assert.equal(r.intent,'natural_instruction_preview');
    assert.equal(r.preview.reference.id,owner.id);
    r=await prepareNaturalCommand({message:'Vra haar om my te bel',requesterId:owner.id});
    assert.equal(r.intent,'natural_pronoun_clarification');
    assert.equal(r.pendingAction.role,'assignee');

    r=await prepareNaturalCommand({message:'Ask Gerda to call my client',requesterId:owner.id});
    assert.equal(r.intent,'natural_pronoun_clarification','Possessive my client must not resolve as logged-in user');
    assert.equal(r.pendingAction.role,'reference');
        r=await prepareNaturalCommand({message:'Ask Gerda to phone her',requesterId:owner.id});
    assert.equal(r.intent,'natural_pronoun_clarification');
    assert.equal(r.pendingAction.role,'reference');
    assert(!r.actions.length,'Unresolved referenced person cannot be sent');
    const ref=await continueNaturalPronoun(r.pendingAction,'Stephan',{requesterId:owner.id});
    assert.equal(ref.intent,'natural_instruction_preview');
    assert.equal(ref.preview.reference.id,owner.id);
    assert.equal(ref.preview.assignee.id,gerda.id);

    const badSession=await continueNaturalPronoun(r.pendingAction,'Stephan',{requesterId:gerda.id});
    assert.equal(badSession.intent,'natural_instruction_error');
    assert(!badSession.actions.length);

    const unknownSelf=await prepareNaturalCommand({message:'Ask Gerda to phone me',requesterId:999});
    assert.equal(unknownSelf.intent,'natural_instruction_error','Unknown session user cannot be guessed');
    assert(!unknownSelf.pendingAction);

    assert.equal(naturalNameReply('Gerda'),true);
    assert.equal(naturalNameReply('Gerda Smit'),true);
    assert.equal(naturalNameReply('Ask Johnny to call Stephan'),false);
    assert.equal(naturalNameReply('Send a message'),false);

    const route=fs.readFileSync('src/routes/cudo-ai.js','utf8');
    const work=fs.readFileSync('src/routes/uat-work-widgets.js','utf8');
    const send=fs.readFileSync('src/services/cudo-natural-send.js','utf8');
    assert(route.includes('continueNaturalPronoun')&&route.includes('requesterId:userId'));
    assert(work.includes('continueNaturalPronoun')&&work.includes('requesterId:userId'));
    assert(send.includes('draft.requesterId')&&send.includes('!==issuer'));
    assert(route.includes("actionName==='confirm_natural_instruction'"));
    console.log('CUDO_CONTEXTUAL_PRONOUNS_VALIDATION=PASS');
  }finally{db.execute=original;}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
