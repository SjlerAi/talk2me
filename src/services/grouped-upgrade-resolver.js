'use strict';
// Owner-confirmed conflict resolution for UENT grouped-upgrade imports.
// A transaction must be opened by the caller; this module never commits.
const db=require('../config/db');

class ResolutionBlocked extends Error {
  constructor(message){super(message);this.name='ResolutionBlocked';}
}
const accountKey=value=>String(value||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
const phoneKey=value=>{
  let s=String(value||'').replace(/\D/g,'');
  if(s.startsWith('27')&&s.length===11)s='0'+s.slice(2);
  return s;
};
const mobile=phone=>/^0(?:6\d|7\d|8[1-5])\d{7}$/.test(phoneKey(phone));
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const short=(value,n=180)=>String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,n);
const quotePhone=phone=>[phone,'27'+phone.slice(1),'+'+'27'+phone.slice(1)];
const ACTIVE_STATES=new Set(['pending','needs_info','needs_correction']);
function block(condition,msg){if(condition)throw new ResolutionBlocked(msg);}
async function candidateRows(conn,phone){
  const ns=quotePhone(phoneKey(phone));
  const [clients]=await conn.query('SELECT id,account_id,account_number,client_name,email,cell_number_normalised,cell_number,is_active,lifecycle_status,package_name,previous_upgrade_date,next_upgrade_date FROM clients WHERE cell_number_normalised IN (?,?,?) OR cell_number IN (?,?,?) ORDER BY id FOR UPDATE',[...ns,...ns]);
  const [base]=await conn.query('SELECT id,client_id,account_id,account_code,account_code_core,msisdn_normalised FROM mobile_base_current WHERE msisdn_normalised IN (?,?,?) OR msisdn_original IN (?,?,?) ORDER BY id FOR UPDATE',[...ns,...ns]);
  return {clients,base};
}
async function getCurrentLine(conn,id){
  const [[line]]=await conn.execute("SELECT l.*,g.account_number,g.account_name,g.crm_account_id,g.review_status AS account_review_status,"+
    "g.source_names_json,g.id group_id,g.line_count FROM ga26_lines l JOIN ga26_accounts g ON g.id=l.ga_account_id "+
    "WHERE l.id=? AND l.batch_id=(SELECT MAX(id) FROM ga26_batches) FOR UPDATE",[id]);
  block(!line,'This line no longer exists in the current import.');
  return line;
}
async function account(conn,id){
  const [[a]]=await conn.execute('SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=? FOR UPDATE',[id]);
  block(!a,'Select an existing CRM account. That account could not be found.');
  return a;
}
async function saveAudit(conn,{line,userId,action,oldState,nextState,oldFlag,newFlag,description,before,after,ip='',userAgent=''}){
  const auto='Owner selected '+action+': '+description;
  await conn.execute("INSERT INTO ga26_line_review_history(line_id,batch_id,account_id,phone,decision,previous_state,new_state,previous_review_required,new_review_required,reviewer_id,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [line.id,line.batch_id,line.ga_account_id,line.phone,action,oldState,nextState,oldFlag,newFlag,userId,auto.slice(0,1500)]);
  await conn.execute("INSERT INTO audit_log(staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)",
    [userId,'grouped_upgrade_resolved','ga26_lines',line.id,auto.slice(0,500),JSON.stringify(before),JSON.stringify(after),short(ip,64),short(userAgent,255)]);
}
async function saveLink(conn,{line,accountId,clientId=null,baseId=null,serviceType='mobile',userId}){
  block(!accountId,'A verified account is required before linking this number.');
  const [old]=await conn.execute('SELECT * FROM customer_account_line_links WHERE phone=? FOR UPDATE',[line.phone]);
  // A selection on this screen is an explicit account decision. Rewriting a
  // different account link is audited in the same transaction.
  await conn.execute("INSERT INTO customer_account_line_links(phone,account_id,client_id,base_line_id,service_type,linked_by) VALUES(?,?,?,?,?,?) "+
    "ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),client_id=COALESCE(VALUES(client_id),client_id),base_line_id=COALESCE(VALUES(base_line_id),base_line_id),service_type=VALUES(service_type),linked_by=VALUES(linked_by),linked_at=NOW()",
    [line.phone,accountId,clientId,baseId,serviceType,userId]);
  return old[0]||null;
}
async function resolveName(conn,line,values,actor){
  block(!line.crm_account_id||!line.account_number,'Choose the account number before correcting its business name.');
  block(line.account_review_status!=='conflicting_account_names','This account does not have an unresolved name conflict.');
  const a=await account(conn,Number(line.crm_account_id));
  block(accountKey(a.account_number)!==accountKey(line.account_number),'The account number differs; correct its account link first.');
  const sourceNames=JSON.parse(line.source_names_json||'[]'); // optional fallback below
  const options=[a.display_name,...sourceNames].filter(Boolean).map(s=>short(s));
  const custom=String(values.account_name||'')==='__custom__';
  const selected=short(custom?values.new_account_name:values.account_name,180);
  block(!selected||selected.length<2,'Select the correct business name.');
  block(!custom&&selected!==short(a.display_name)&&!options.includes(selected),
    'Select one of the displayed business names or enter a new name.');
  const [groups]=await conn.execute('SELECT * FROM ga26_accounts WHERE id=? FOR UPDATE',[line.group_id]);
  const [lines]=await conn.execute('SELECT * FROM ga26_lines WHERE ga_account_id=? ORDER BY id FOR UPDATE',[line.group_id]);
  await conn.execute("UPDATE customer_accounts SET display_name=?,updated_at=NOW() WHERE id=?",[selected,a.id]);
  await conn.execute("UPDATE ga26_accounts SET account_name=?,review_status='existing_crm_account' WHERE id=?",[selected,line.group_id]);
  let cleared=0,remaining=0;
  for(const x of lines){
    if(x.line_status!=='conflicting_source_account_names')continue;
    const stillConflict=x.base_status==='base_account_conflict';
    const nextState=stillConflict?'pending':'account_name_resolved';
    const nextStatus=x.crm_client_id?'already_linked':'new_line_existing_account';
    await conn.execute('UPDATE ga26_lines SET line_status=?,review_required=?,review_state=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',
      [nextStatus,stillConflict?1:0,nextState,actor.userId,x.id]);
    if(Number(x.id)!==Number(line.id)){
      await conn.execute("INSERT INTO ga26_line_review_history(line_id,batch_id,account_id,phone,decision,previous_state,new_state,previous_review_required,new_review_required,reviewer_id,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [x.id,line.batch_id,x.ga_account_id,x.phone,'select_account_name',x.review_state,nextState,
          Number(x.review_required),stillConflict?1:0,actor.userId,
          ('Owner selected '+selected+' as the account name for '+a.account_number+
            (stillConflict?'; supplier account conflict still needs review.':'; original account name conflict resolved.')).slice(0,1500)]);
    }
    if(stillConflict)remaining++;else{
      cleared++;
      if(mobile(x.phone)){
        await saveLink(conn,{line:x,accountId:a.id,clientId:x.crm_client_id,baseId:x.base_line_id,serviceType:'mobile',userId:actor.userId});
      }
    }
  }
  await saveAudit(conn,{line,userId:actor.userId,action:'select_account_name',oldState:line.review_state,nextState:remaining?'pending':'account_name_resolved',
    oldFlag:Number(line.review_required),newFlag:remaining?1:0,
    description:'Kept '+selected+' for account '+a.account_number+'; '+cleared+' lines cleared; '+remaining+' still need separate account verification',
    before:{account:a,group:groups[0],lineIds:lines.map(x=>({id:x.id,status:x.line_status,review_required:x.review_required}))},
    after:{account_id:a.id,display_name:selected,cleared,remaining},...actor});
  return {message:'Account name updated. '+cleared+' lines resolved'+(remaining?'; '+remaining+' account conflicts still need review.':'.')};
}
async function resolveAccount(conn,line,values,actor){
  const targetId=positive(values.account_id);
  block(!targetId,'Choose the correct account number first.');
  const target=await account(conn,targetId);
  const {clients,base}=await candidateRows(conn,line.phone);
  block(clients.length>1,'This phone has multiple CRM customer records. Select the correct customer record first.');
  block(base.length>1,'Several supplier lines share this phone. Reconcile those supplier records before changing accounts.');
  const targetNumber=accountKey(target.account_number_normalised||target.account_number);
  block(!targetNumber,'Selected CRM account does not have a valid account number.');
  const [assignments]=clients.length?await conn.query('SELECT id,client_id,assigned_staff_id,is_active,account_number FROM client_assignments WHERE client_id=? FOR UPDATE',[clients[0].id]):[[]];
  const [targetOwners]=await conn.execute('SELECT assigned_staff_id FROM customer_accounts WHERE id=?',[target.id]);
  const ownerIds=new Set([targetOwners[0]?.assigned_staff_id,...assignments.filter(a=>a.is_active).map(x=>x.assigned_staff_id)].map(Number).filter(x=>x>0));
  block(ownerIds.size>1,'Staff ownership differs between this customer and the selected account. Correct staff ownership first; no records were moved.');
  const [priorGroups]=await conn.execute('SELECT id,account_number,account_name FROM ga26_accounts WHERE batch_id=? AND account_number=? ORDER BY id LIMIT 1 FOR UPDATE',
    [line.batch_id,target.account_number]);
  let newGroup=priorGroups[0];
  if(!newGroup){
    const key='confirmed:'+targetNumber;
    const [created]=await conn.execute('INSERT INTO ga26_accounts(batch_id,source_key,account_number,account_name,source_names_json,source_row_numbers,crm_account_id,review_status,line_count) VALUES(?,?,?,?,?,?,?,?,0)',
      [line.batch_id,key,target.account_number,target.display_name||target.account_number,JSON.stringify([target.display_name||target.account_number]),'[]',target.id,'existing_crm_account']);
    newGroup={id:Number(created.insertId),account_number:target.account_number};
  }
  const before={line,clients,base,assignments,selected_account:target};
  for(const cl of clients){
    await conn.execute('UPDATE clients SET account_id=?,account_number=?,updated_at=NOW() WHERE id=?',[target.id,target.account_number,cl.id]);
  }
  for(const row of assignments)await conn.execute('UPDATE client_assignments SET account_number=?,updated_at=NOW() WHERE id=?',[target.account_number,row.id]);
  for(const x of base)await conn.execute('UPDATE mobile_base_current SET account_id=?,updated_at=NOW() WHERE id=?',[target.id,x.id]);
  const differentGroup=Number(line.group_id)!==Number(newGroup.id);
  if(differentGroup){
    await conn.execute('UPDATE ga26_lines SET ga_account_id=? WHERE id=?',[newGroup.id,line.id]);
    await conn.execute("UPDATE ga26_accounts SET line_count=GREATEST(line_count-1,0),review_status=CASE WHEN NOT EXISTS(SELECT 1 FROM ga26_lines WHERE ga_account_id=?) THEN 'empty_resolved' ELSE review_status END WHERE id=?",[line.group_id,line.group_id]);
    await conn.execute('UPDATE ga26_accounts SET line_count=line_count+1 WHERE id=?',[newGroup.id]);
  }
  const needService=!mobile(line.phone);
  const nextState=needService?'pending':'account_corrected';
  await conn.execute("UPDATE ga26_lines SET crm_client_id=?,base_line_id=?,base_status=?,line_status=?,review_state=?,review_required=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?",
    [clients[0]?.id||null,base[0]?.id||null,base.length?'account_override_verified':'not_in_mobile_base',
      clients.length?'already_linked':'new_line_existing_account',nextState,needService?1:0,actor.userId,line.id]);
  if(!needService)await saveLink(conn,{line,accountId:target.id,clientId:clients[0]?.id||null,baseId:base[0]?.id||null,serviceType:'mobile',userId:actor.userId});
  await saveAudit(conn,{line,userId:actor.userId,action:'select_correct_account',oldState:line.review_state,nextState,oldFlag:Number(line.review_required),
    newFlag:needService?1:0,
    description:'Linked '+line.phone+' to account '+target.account_number+'; kept '+clients.length+' CRM client rows and '+base.length+' supplier rows, with no deletion',
    before,after:{account_id:target.id,account_number:target.account_number,group_id:newGroup.id,moved:!differentGroup?0:1,clientIds:clients.map(x=>x.id),baseIds:base.map(x=>x.id)},...actor});
  return {message:'Account '+target.account_number+' updated for '+line.phone+(needService?'. Now classify its service type.':'.')};
}
async function classifyService(conn,line,values,actor){
  const type=short(values.service_type,24).toLowerCase();
  block(!['voip','fixed','other'].includes(type),'Choose VoIP, fixed line or another service.');
  // A missing official account must NOT force the owner to invent a B/VB number.
  const noOfficialAccount=!line.account_number&&!line.crm_account_id;
  block(!noOfficialAccount&&!line.crm_account_id,'The account link is incomplete. Choose the correct account or leave its number unverified.');
  const a=noOfficialAccount?null:await account(conn,line.crm_account_id);
  if(a)block(accountKey(a.account_number)!==accountKey(line.account_number),
    'The source and CRM accounts differ. Choose the correct account first.');
  const {clients,base}=await candidateRows(conn,line.phone);
  block(clients.length>1,'This number has duplicate customer records. Select the correct customer first.');
  block(base.length>1,'Multiple supplier matches require account verification.');
  if(a){
    block(clients.some(x=>x.account_id&&Number(x.account_id)!==Number(a.id))||
      base.some(x=>x.account_id&&Number(x.account_id)!==Number(a.id)),
      'A linked client or supplier line belongs to another account. Correct its account first.');
  }else{
    block(clients.length>0||base.length>0,
      'This number is already linked to a CRM customer or supplier record. Select its correct account before classifying it.');
  }
  const before={line,clients,base};
  if(a)await saveLink(conn,{line,accountId:a.id,clientId:clients[0]?.id||null,baseId:base[0]?.id||null,serviceType:type,userId:actor.userId});
  const nextState=a?'other_service_confirmed':'needs_info';
  const nextFlag=a?0:1;
  await conn.execute('UPDATE ga26_lines SET service_type=?,review_state=?,review_required=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',
    [type,nextState,nextFlag,actor.userId,line.id]);
  await saveAudit(conn,{line,userId:actor.userId,action:'confirm_service_type',oldState:line.review_state,nextState,
    oldFlag:Number(line.review_required),newFlag:nextFlag,
    description:'Classified '+line.phone+' as '+type+
      (a?' under verified account '+a.account_number:'; business account number remains unverified')+
      '; excluded from automatic mobile upgrade calls',
    before,after:{account_id:a?.id||null,phone:line.phone,service_type:type,
      classification:'confirmed',account_number_missing:!a},...actor});
  return {message:line.phone+' saved as '+type.toUpperCase()+
    (a?' under '+a.account_number+'.':' under the imported business name. The official account number is still pending.')};
}
async function consolidateDuplicate(conn,line,values,actor){
  block(!mobile(line.phone),'Only matching mobile-number customer records can be consolidated here.');
  const chosenId=positive(values.client_id);
  block(!chosenId,'Select the correct customer record to keep.');
  const {clients,base}=await candidateRows(conn,line.phone);
  block(clients.length<2||clients.length>30,'This mobile does not have two or more complete CRM customer records.');
  const chosen=clients.find(x=>Number(x.id)===chosenId);
  block(!chosen,'The selected CRM client no longer belongs to this telephone number.');
  const validAccount=Number(line.crm_account_id||0);
  block(!validAccount,'The business account must be linked to a verified CRM account first.');
  block(clients.some(x=>Number(x.account_id)!==validAccount || accountKey(x.account_number)!==accountKey(line.account_number)),
    'The duplicate customer records have different account links. Correct their accounts before consolidating.');
  block(base.length>1||base.some(x=>x.account_id&&Number(x.account_id)!==validAccount),
    'Supplier account links conflict. Correct these before consolidating.');
  const idList=clients.map(x=>Number(x.id)),obsolete=idList.filter(id=>id!==chosenId);
  const marks=idList.map(()=>'?').join(',');
  const [assignments]=await conn.query('SELECT * FROM client_assignments WHERE client_id IN ('+marks+') ORDER BY id FOR UPDATE',idList);
  const assignmentsActive=assignments.filter(x=>x.is_active);
  const staffIds=new Set(assignmentsActive.map(x=>Number(x.assigned_staff_id)));
  const [[theAccount]]=await conn.execute('SELECT id,assigned_staff_id FROM customer_accounts WHERE id=? FOR UPDATE',[validAccount]);
  if(theAccount.assigned_staff_id)staffIds.add(Number(theAccount.assigned_staff_id));
  block(staffIds.size>1,'These duplicates have conflicting staff ownership. Resolve the staff assignment before consolidating.');
  const before={line,clients,assignments,base};
  const archivedAssignment=assignments.filter(x=>obsolete.includes(Number(x.client_id))&&x.is_active);
  const masterHasAssignment=assignments.some(x=>Number(x.client_id)===chosenId&&x.is_active);
  if(!masterHasAssignment && archivedAssignment.length){
    await conn.execute('UPDATE client_assignments SET client_id=?,account_number=?,updated_at=NOW() WHERE id=?',
      [chosenId,line.account_number,archivedAssignment[0].id]);
  }
  if(obsolete.length){
    const otherMarks=obsolete.map(()=>'?').join(',');
    await conn.query("UPDATE client_assignments SET is_active=0,updated_at=NOW() WHERE client_id IN ("+otherMarks+")",obsolete);
    // Preserve all customer history by moving references, not deleting rows.
    for(const [table,column] of [
      ['staff_tasks','related_client_id'],['staff_chat_messages','related_client_id'],['staff_notes','related_client_id'],
      ['customer_followups','client_id'],['customer_callbacks','client_id'],['inquiries','client_id'],
      ['mobile_events','client_id'],['birthday_corrections','client_id'],['data_change_requests','client_id'],
      ['calendar_personal_items','client_id'],['viralco_import_previews','client_id'],
      ['work_dispatch_items','related_client_id']
    ]){
      await conn.query('UPDATE '+table+' SET '+column+'=? WHERE '+column+' IN ('+otherMarks+')',[chosenId,...obsolete]);
    }
    await conn.query("UPDATE clients SET is_active=0,lifecycle_status='inactive',updated_at=NOW() WHERE id IN ("+otherMarks+")",obsolete);
    await conn.query('UPDATE mobile_base_current SET client_id=?,updated_at=NOW() WHERE client_id IN ('+otherMarks+')',[chosenId,...obsolete]);
    await conn.query('UPDATE bf26_contacts SET matched_client_id=? WHERE matched_client_id IN ('+otherMarks+')',[chosenId,...obsolete]);
    await conn.query('UPDATE ga26_lines SET crm_client_id=? WHERE crm_client_id IN ('+otherMarks+')',[chosenId,...obsolete]);
  }
  if(!chosen.is_active)await conn.execute("UPDATE clients SET is_active=1,lifecycle_status='client',updated_at=NOW() WHERE id=?",[chosenId]);
  const chosenName=clients.find(x=>Number(x.id)===Number(values.name_client_id));
  const chosenEmail=clients.find(x=>Number(x.id)===Number(values.email_client_id));
  if(values.name_client_id){
    block(!chosenName||!short(chosenName.client_name),'Select a valid customer name to keep.');
    await conn.execute('UPDATE clients SET client_name=?,updated_at=NOW() WHERE id=?',[short(chosenName.client_name,255),chosenId]);
  }
  if(values.email_client_id){
    block(!chosenEmail||!short(chosenEmail.email),'Select a valid email address to keep.');
    await conn.execute('UPDATE clients SET email=?,updated_at=NOW() WHERE id=?',[short(chosenEmail.email,255),chosenId]);
  }
  for(const b of base)if(!b.client_id||obsolete.includes(Number(b.client_id))){
    await conn.execute('UPDATE mobile_base_current SET client_id=?,updated_at=NOW() WHERE id=?',[chosenId,b.id]);
  }
  await conn.execute("UPDATE ga26_lines SET crm_client_id=?,base_line_id=?,line_status='already_linked',review_state='duplicate_resolved',review_required=0,reviewed_by=?,reviewed_at=NOW() WHERE id=?",
    [chosenId,base[0]?.id||null,actor.userId,line.id]);
  await saveLink(conn,{line,accountId:validAccount,clientId:chosenId,baseId:base[0]?.id||null,serviceType:'mobile',userId:actor.userId});
  await saveAudit(conn,{line,userId:actor.userId,action:'choose_primary_customer',oldState:line.review_state,nextState:'duplicate_resolved',
    oldFlag:Number(line.review_required),newFlag:0,
    description:'Kept client #'+chosenId+' active; archived duplicate client #'+obsolete.join(',')+' and moved linked tasks/history under the same phone and account',
    before,after:{chosen_client_id:chosenId,archived_client_ids:obsolete,account_id:validAccount,
      name_selected_from_client_id:chosenName?.id||chosenId,email_selected_from_client_id:chosenEmail?.id||chosenId,
      preserved_original_customer_history:true},...actor});
  return {message:'Kept customer #'+chosenId+'. '+obsolete.length+' duplicate record(s) archived, with tasks and history linked to the selected customer.'};
}
async function approveMobile(conn,line,actor){
  const {clients,base}=await candidateRows(conn,line.phone);
  block(!mobile(line.phone),'This is not a standard mobile prefix. Classify the service instead.');
  block(!line.crm_account_id,'Select the correct account first.');
  block(clients.length>1||base.length>1,'This phone has duplicate records. Resolve the duplicates first.');
  const a=await account(conn,line.crm_account_id);
  block(accountKey(a.account_number)!==accountKey(line.account_number),'The source and CRM accounts differ.');
  block(clients.some(x=>x.account_id&&Number(x.account_id)!==a.id)||base.some(x=>x.account_id&&Number(x.account_id)!==a.id),
    'Existing customer or supplier data is linked to another account. Select the correct account first.');
  block(line.account_review_status==='conflicting_account_names','Choose the correct account name first.');
  block(line.base_status==='base_account_conflict','Supplier account differs. Choose the correct account first.');
  await saveLink(conn,{line,accountId:a.id,clientId:clients[0]?.id||null,baseId:base[0]?.id||null,serviceType:'mobile',userId:actor.userId});
  await conn.execute("UPDATE ga26_lines SET crm_client_id=?,base_line_id=?,service_type='mobile',review_state='mobile_approved',review_required=0,reviewed_by=?,reviewed_at=NOW() WHERE id=?",
    [clients[0]?.id||null,base[0]?.id||null,actor.userId,line.id]);
  await saveAudit(conn,{line,userId:actor.userId,action:'approve_mobile_line',oldState:line.review_state,nextState:'mobile_approved',
    oldFlag:Number(line.review_required),newFlag:0,description:'Verified '+line.phone+' under CRM account '+a.account_number,
    before:{line,clients,base},after:{account_id:a.id,service_type:'mobile',client_id:clients[0]?.id||null,base_id:base[0]?.id||null},...actor});
  return {message:'Verified mobile '+line.phone+' is linked to '+a.account_number+'.'};
}
async function reopen(conn,line,actor){
  await conn.execute("UPDATE ga26_lines SET review_state='pending',review_required=1,reviewed_by=?,reviewed_at=NOW() WHERE id=?",[actor.userId,line.id]);
  await saveAudit(conn,{line,userId:actor.userId,action:'reopen_conflict',oldState:line.review_state,nextState:'pending',
    oldFlag:Number(line.review_required),newFlag:1,description:'Reopened '+line.phone+' for further verification',
    before:{line},after:{review_state:'pending',review_required:1},...actor});
  return {message:'Line reopened for review. Previous changes and audit history remain intact.'};
}
async function createOfficialAccount(conn,line,values,actor){
  block(line.account_number && line.account_review_status!=='missing_account_number',
    'This line already has an account number. Select a correct existing account instead.');
  const code=short(values.account_code,80).replace(/\s+/g,'').toUpperCase();
  const displayName=short(values.account_display_name,180);
  block(!/^[A-Z]{1,3}[0-9]{4,15}(?:-[0-9]{1,3})?$/.test(code),
    'Enter the official account number exactly as supplied by Vodacom.');
  block(displayName.length<3,'Enter the official account name.');
  const [existing]=await conn.execute('SELECT id FROM customer_accounts WHERE account_number_normalised=? FOR UPDATE',[code]);
  block(existing.length,'This account already exists. Search for it above and select that account instead.');
  const [r]=await conn.execute("INSERT INTO customer_accounts(account_number,account_number_normalised,display_name,account_status) VALUES(?,?,?,'unknown')",
    [code,code,displayName]);
  // Continue through the guarded correction transaction without inventing a number.
  const choice={...values,account_id:Number(r.insertId)};
  if(String(values.apply_group||'')==='yes')return updateMissingAccountGroup(conn,line,'select_account',choice,actor);
  return selectAccountAndClassify(conn,line,choice,actor);
}
async function selectAccountAndClassify(conn,line,values,actor){
  const result=await resolveAccount(conn,line,values,actor);
  // Service type can have been confirmed earlier, while the official account was missing.
  const type=short(values.service_type||line.service_type,24).toLowerCase();
  if(!mobile(line.phone)&&['voip','fixed','other'].includes(type)){
    const updated=await getCurrentLine(conn,line.id);
    const classified=await classifyService(conn,updated,{service_type:type},actor);
    return {message:result.message+' '+classified.message};
  }
  return result;
}
async function updateMissingAccountGroup(conn,line,action,values,actor){
  block(line.account_number||line.crm_account_id||line.account_review_status!=='missing_account_number',
    'This grouped action is only for business records without an official account number.');
  const [members]=await conn.execute('SELECT id,phone,review_required,review_state,line_status FROM ga26_lines WHERE ga_account_id=? AND batch_id=? ORDER BY id FOR UPDATE',
    [line.group_id,line.batch_id]);
  block(!members.length||members.length>20,'Review this business group individually.');
  block(members.some(item=>mobile(item.phone)||Number(item.review_required)!==1||
    !ACTIVE_STATES.has(item.review_state)||item.line_status!=='missing_account_number'),
    'Some lines in this group are already linked or have different conflicts. Update those lines individually.');
  const results=[];
  for(const item of members){
    const current=await getCurrentLine(conn,item.id);
    if(action==='service_type')results.push(await classifyService(conn,current,values,actor));
    else if(action==='select_account')results.push(await selectAccountAndClassify(conn,current,values,actor));
  }
  const type=short(values.service_type||line.service_type,24).toLowerCase();
  const classified=['voip','fixed','other'].includes(type);
  if(action==='service_type')return {
    message:members.length+' numbers classified as '+type.toUpperCase()+'. The official account number is still pending; no number was invented.'
  };
  return {message:members.length+' telephone numbers linked to the selected real CRM account.'+
    (classified?' Service types have also been saved.':' Select the correct service type for any remaining non-mobile numbers.')};
}
async function applyResolution(conn,{lineId,action,values={},userId,ip='',userAgent=''}) {
  block(!positive(userId),'Only an authenticated owner can update these records.');
  const line=await getCurrentLine(conn,lineId);
  const actor={userId,ip,userAgent};
  if(action==='reopen')return reopen(conn,line,actor);
  block(Number(line.review_required)!==1||!ACTIVE_STATES.has(line.review_state),
    'This conflict was already resolved. Reopen it if another correction is required.');
  if(action==='select_name'){
    // current source names are fetched from ga26_accounts (not the line table)
    const [[source]]=await conn.execute('SELECT source_names_json FROM ga26_accounts WHERE id=? FOR UPDATE',[line.group_id]);
    line.source_names_json=source?.source_names_json||'[]';
    return resolveName(conn,line,values,actor);
  }
  if(action==='select_account')return String(values.apply_group||'')==='yes'
    ?updateMissingAccountGroup(conn,line,action,values,actor):selectAccountAndClassify(conn,line,values,actor);
  if(action==='create_account')return createOfficialAccount(conn,line,values,actor);
  if(action==='choose_primary')return consolidateDuplicate(conn,line,values,actor);
  if(action==='service_type')return String(values.apply_group||'')==='yes'
    ?updateMissingAccountGroup(conn,line,action,values,actor):classifyService(conn,line,values,actor);
  if(action==='approve_mobile')return approveMobile(conn,line,actor);
  throw new ResolutionBlocked('Please choose a supported correction.');
}
function businessNameKey(value){
  return short(value,180).toUpperCase().replace(/[^A-Z0-9]+/g,' ')
    .replace(/\b(?:PTY|LTD|LIMITED|PROPRIETARY|CC)\b/g,' ').replace(/\s+/g,' ').trim();
}
async function accountSuggestions(line,matched,search=''){
  const picks=new Set([Number(line.crm_account_id),...matched.clients.map(x=>Number(x.account_id)),...matched.base.map(x=>Number(x.account_id))].filter(x=>x>0));
  const query=short(search,70);
  let suggestions=[];
  if(picks.size){
    const [r]=await db.query('SELECT id,account_number,display_name,assigned_staff_id FROM customer_accounts WHERE id IN ('+[...picks].map(()=>'?').join(',')+')',[...picks]);
    suggestions=r;
  }
  // Name-based suggestions matter when the spreadsheet has no B/VB account number.
  // A suggestion is never applied without the owner's explicit selection.
  if(!query && !line.crm_account_id && line.account_name){
    const sourceName=businessNameKey(line.account_name),first=sourceName.split(' ')[0];
    if(first.length>=3 && sourceName.length>=6){
      const [named]=await db.query('SELECT id,account_number,display_name,assigned_staff_id FROM customer_accounts WHERE UPPER(display_name) LIKE ? ORDER BY id LIMIT 60',[first+'%']);
      for(const a of named){
        if(businessNameKey(a.display_name)===sourceName &&
          !suggestions.some(x=>Number(x.id)===Number(a.id)))
          suggestions.push({...a,matchingSourceName:true});
      }
    }
  }
  if(query.length>=2){
    const [more]=await db.query('SELECT id,account_number,display_name,assigned_staff_id FROM customer_accounts WHERE account_number LIKE ? OR display_name LIKE ? ORDER BY account_number LIMIT 30',['%'+query+'%','%'+query+'%']);
    for(const a of more)if(!suggestions.some(x=>Number(x.id)===Number(a.id)))suggestions.push(a);
  }
  return suggestions.slice(0,38);
}
module.exports={ResolutionBlocked,applyResolution,accountSuggestions,normalMobile:mobile};
