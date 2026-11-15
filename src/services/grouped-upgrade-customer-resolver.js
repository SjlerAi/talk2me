'use strict';
// Owner-reviewed creation/linking of customer contacts and distinct contract lines
// from the existing Grouped Upgrade Accounts conflict resolution queue.
const db=require('../config/db');
const {ResolutionBlocked}=require('./grouped-upgrade-resolver');
const reject=(condition,message)=>{if(condition)throw new ResolutionBlocked(message)};
const clean=(v,max=180)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const digits=v=>String(v||'').replace(/\D/g,'');
const normalPhone=v=>{
  let s=digits(v);
  if(s.length===11&&s.startsWith('27'))s='0'+s.slice(2);
  if(s.length===9&&/^[678]/.test(s))s='0'+s;
  return /^0\d{9}$/.test(s)?s:'';
};
const mobile=p=>/^0(?:6\d|7\d|8[1-5])\d{7}$/.test(p);
const toCRM=p=>p?'27'+p.slice(1):null;
const nameKey=s=>clean(s,200).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\b(?:PTY|LTD|LIMITED|PROPRIETARY|CC)\b/g,' ').replace(/\s+/g,' ').trim();
const safeDate=v=>{
  const s=clean(v,10);if(!s)return null;
  reject(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s,
    'Check the date format and enter a real date (YYYY-MM-DD).');
  return s;
};
const serviceChoices=['mobile','voip','fixed','other','unverified'];
async function getGroup(conn,groupId,lock=false){
  const [[g]]=await conn.execute("SELECT g.* FROM ga26_accounts g WHERE g.id=? AND g.batch_id=(SELECT MAX(id) FROM ga26_batches)"+
    (lock?' FOR UPDATE':''),[groupId]);
  reject(!g,'The imported business group cannot be found.');
  return g;
}
async function getSourceLine(conn,lineId,groupId,lock=false){
  if(!lineId)return null;
  const [[l]]=await conn.execute("SELECT * FROM ga26_lines WHERE id=? AND ga_account_id=?"+
    (lock?' FOR UPDATE':''),[lineId,groupId]);
  reject(!l,'The imported telephone line has moved or is no longer in this business account. Refresh the review screen.');
  return l;
}
async function getStaff(){
  const [rows]=await db.query("SELECT id,full_name,role FROM staff_users WHERE is_active=1 AND deleted_at IS NULL AND role IN ('staff','manager','owner') ORDER BY full_name");
  return rows.filter(x=>x.full_name!=='Test');
}
async function findCustomerMatches(group,line,search=''){
  const q=clean(search,100),where=[],params=[],source=clean(group.account_name||'',140);
  const sourcePhone=normalPhone(line?.phone);
  if(sourcePhone){
    where.push("(cell_number_normalised IN (?,?) OR REPLACE(REPLACE(cell_number,' ',''),'-','')=?)");
    params.push(toCRM(sourcePhone),sourcePhone,sourcePhone);
  }
  if(group.crm_account_id){where.push('account_id=?');params.push(Number(group.crm_account_id))}
  const term=q||source;
  const tokens=nameKey(term).split(' ').filter(x=>x.length>=3);
  if(q.length>=2){
    const formatted=normalPhone(q);
    if(formatted){where.push('(cell_number_normalised IN (?,?) OR cell_number LIKE ?)');params.push(toCRM(formatted),formatted,'%'+formatted.slice(-7)+'%')}
    if(q.includes('@')){where.push('LOWER(email)=?');params.push(q.toLowerCase())}
    if(/^\d{13}$/.test(digits(q))){where.push('id_number=?');params.push(digits(q))}
    where.push('(client_name LIKE ? OR company_name LIKE ? OR account_number LIKE ? OR email LIKE ?)');
    for(let i=0;i<4;i++)params.push('%'+q+'%');
  }else if(tokens.length){
    const t=tokens[0].slice(0,35);
    where.push('(client_name LIKE ? OR company_name LIKE ?)');
    params.push(t+'%',t+'%');
  }
  if(!where.length)return [];
  const [rows]=await db.query(
    'SELECT id,account_id,account_number,client_name,company_name,cell_number,cell_number_normalised,email,id_number,'+
    'package_name,is_active,line_status FROM clients WHERE ('+where.join(' OR ')+') ORDER BY is_active DESC,id DESC LIMIT 100',params);
  const sourceName=nameKey(source);
  for(const c of rows){
    c.match_type=sourcePhone&&(normalPhone(c.cell_number_normalised)===sourcePhone||normalPhone(c.cell_number)===sourcePhone)
      ?'Exact telephone match':group.crm_account_id&&Number(c.account_id)===Number(group.crm_account_id)
      ?'Same CRM account':sourceName&&nameKey(c.client_name)===sourceName?'Same business name':
      sourceName&&nameKey(c.company_name)===sourceName?'Same company':'Possible name / detail match';
    c.score=c.match_type==='Exact telephone match'?0:c.match_type==='Same CRM account'?1:
      c.match_type==='Same business name'||c.match_type==='Same company'?2:3;
  }
  rows.sort((a,b)=>a.score-b.score||Number(b.is_active)-Number(a.is_active)||Number(b.id)-Number(a.id));
  return rows.slice(0,22);
}
async function chooseStaff(conn,clientId,accountId,rawId,ownerId){
  if(!rawId)return null;
  const staffId=id(rawId);reject(!staffId,'Choose a valid staff member.');
  const [[staff]]=await conn.execute("SELECT id,full_name FROM staff_users WHERE id=? AND is_active=1 AND deleted_at IS NULL",[staffId]);
  reject(!staff,'The selected consultant is no longer active.');
  if(accountId){
    const [[account]]=await conn.execute('SELECT assigned_staff_id FROM customer_accounts WHERE id=? FOR UPDATE',[accountId]);
    reject(account?.assigned_staff_id&&Number(account.assigned_staff_id)!==staffId,
      'This account already belongs to another consultant. Confirm or correct account ownership before allocating the contact.');
  }
  const [[assigned]]=await conn.execute('SELECT id,assigned_staff_id,is_active FROM client_assignments WHERE client_id=? FOR UPDATE',[clientId]);
  reject(assigned&&assigned.is_active&&Number(assigned.assigned_staff_id)!==staffId,
    'This customer is already assigned to a different consultant. Correct that allocation separately.');
  if(!assigned){
    await conn.execute('INSERT INTO client_assignments(client_id,account_number,assigned_staff_id,assigned_by,is_active) VALUES(?,?,?,?,1)',
      [clientId,accountId?(await conn.execute('SELECT account_number FROM customer_accounts WHERE id=?',[accountId]))[0][0]?.account_number||null:null,
        staffId,ownerId]);
  }else if(!assigned.is_active){
    await conn.execute("UPDATE client_assignments SET assigned_staff_id=?,assigned_by=?,is_active=1,updated_at=NOW() WHERE id=?",
      [staffId,ownerId,assigned.id]);
  }
  return {id:staffId,full_name:staff.full_name};
}
async function logAction(conn,{group,line,mode,before,after,ownerId,ip='',userAgent='',description}){
  await conn.execute('INSERT INTO audit_log(staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)',
    [ownerId,'grouped_customer_'+mode,line?'ga26_lines':'ga26_accounts',line?.id||group.id,
      clean(description,500),JSON.stringify(before||{}),JSON.stringify(after||{}),clean(ip,64),clean(userAgent,255)]);
  if(line){
    await conn.execute("INSERT INTO ga26_line_review_history(line_id,batch_id,account_id,phone,decision,previous_state,new_state,previous_review_required,new_review_required,reviewer_id,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [line.id,line.batch_id,line.ga_account_id,line.phone,mode,line.review_state,after.review_state??line.review_state,
        Number(line.review_required),Number(after.review_required??line.review_required),ownerId,clean(description,1500)]);
  }
}
async function ensureAccount(conn,g){
  if(!g.crm_account_id)return null;
  const [[a]]=await conn.execute('SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=? FOR UPDATE',[g.crm_account_id]);
  reject(!a,'The linked CRM account has been removed. Correct the account association first.');
  reject(g.account_number&&String(g.account_number).replace(/\W/g,'').toUpperCase()!==String(a.account_number).replace(/\W/g,'').toUpperCase(),
    'The imported and CRM account numbers differ. Resolve the account mismatch before linking a customer.');
  return a;
}
async function createFromForm(conn,group,account,sourceLine,phone,contactMobile,values,ownerId){
  const personName=clean(values.client_name,180);
  reject(personName.length<2,'Enter the actual customer or business contact name.');
  const first=clean(values.first_name,100),surname=clean(values.surname,100);
  const company=clean(values.company_name,160);
  const email=clean(values.email,180).toLowerCase();
  reject(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Check the email address.');
  const idNumber=clean(values.id_number,30);
  reject(idNumber&&idNumber.length<5,'Check the ID or business registration number.');
  const contactName=clean(values.main_contact_name,160);
  const altNumber=clean(values.alt_number,30);
  const packageName=clean(values.package_name,180);
  const city=clean(values.city_town,160);
  const notes=clean(values.notes,2000);
  const beforeDate=safeDate(values.previous_upgrade_date),nextDate=safeDate(values.next_upgrade_date);
  const term=Number(values.contract_term_months||24);
  reject(![12,24,36].includes(term),'Select a valid contract length.');
  const customerType=['individual','business','unknown'].includes(values.customer_type)?values.customer_type:'business';
  if(contactMobile){
    const canonical=toCRM(contactMobile);
    const [matches]=await conn.execute('SELECT id,client_name,account_number FROM clients WHERE is_active=1 AND cell_number_normalised IN (?,?) FOR UPDATE',
      [canonical,contactMobile]);
    reject(matches.length,'This cellphone already belongs to CRM customer #'+matches[0]?.id||'unknown'+
      '. Choose the existing customer instead of creating a duplicate.');
  }else{
    // No mobile number means a name-based duplicate is especially easy to create.
    // Existing customer records under the same account must be presented first.
    const [same]=account?
      await conn.execute("SELECT id,cell_number_normalised FROM clients WHERE account_id=? AND UPPER(TRIM(client_name))=UPPER(?) AND is_active=1 LIMIT 15 FOR UPDATE",
        [account.id,personName]):
      await conn.execute("SELECT id,account_id,cell_number_normalised FROM clients WHERE UPPER(TRIM(client_name))=UPPER(?) AND is_active=1 LIMIT 15 FOR UPDATE",
        [personName]);
    const existingNoPhone=same.find(x=>!x.cell_number_normalised);
    reject(Boolean(existingNoPhone),'A customer with this name and no mobile already exists (CRM #'+(existingNoPhone?.id||'?')+'). Select that record rather than creating a duplicate.');
    reject(same.length>0&&String(values.confirm_separate_contact||'')!=='yes',
      'An existing customer has this name. Check the near-match list and tick the separate-contact confirmation if this truly is another contact.');
  }
  const existingEmail=email?await conn.execute('SELECT id FROM clients WHERE is_active=1 AND LOWER(email)=? ORDER BY id LIMIT 2',[email]):[[]];
  if(!contactMobile&&existingEmail[0].length){
    reject(String(values.confirm_separate_contact||'')!=='yes',
      'Another customer has this email. Review the near matches first; tick the separate-contact confirmation only if this is a different customer.');
  }
  const effectivePhone=contactMobile?contactMobile:null;
  const lifecycle=account&&effectivePhone?'client':'prospect';
  const lineStatus=effectivePhone?'unknown':'unknown';
  const [r]=await conn.execute(
    'INSERT INTO clients (account_id,account_number,first_name,surname,company_name,client_name,'+
    'cell_number,cell_number_normalised,alt_number,email,city_town,id_number,customer_type,lifecycle_status,'+
    'lead_source,lead_status,package_name,previous_upgrade_date,contract_term_months,next_upgrade_date,'+
    'line_status,main_contact_name,main_contact_number,notes,created_by_staff_id,is_active) '+
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
    [account?.id||null,account?.account_number||null,first||null,surname||null,company||group.account_name||null,
      personName,effectivePhone||null,toCRM(effectivePhone),altNumber||null,email||null,city||null,idNumber||null,
      customerType,lifecycle,'Grouped conflict resolution','new',packageName||null,beforeDate,term,nextDate,
      lineStatus,contactName||null,phone&&!mobile(phone)?phone:null,notes||null,ownerId]);
  return {id:Number(r.insertId),created:true,description:'Created a new '+(effectivePhone?'customer line':'unverified customer/contact')};
}
async function linkExisting(conn,group,account,sourceLine,phone,contactMobile,values,ownerId){
  const clientId=id(values.existing_client_id);
  reject(!clientId,'Select an existing CRM customer from the near-match list.');
  const [[target]]=await conn.execute('SELECT * FROM clients WHERE id=? FOR UPDATE',[clientId]);
  reject(!target||!target.is_active,'The selected customer is missing or archived.');
  if(account){
    reject(target.account_id&&Number(target.account_id)!==Number(account.id),
      'This customer belongs to a different business account. Correct the account association before linking.');
    if(target.account_number&&String(target.account_number).replace(/\W/g,'').toUpperCase()!==
       String(account.account_number).replace(/\W/g,'').toUpperCase()){
      reject(true,'This customer has a different account number. Resolve the account discrepancy first.');
    }
  }else if(target.account_id){
    reject(group.account_number,'This imported account has an official number that differs from the selected customer. Resolve the account conflict first.');
    reject(String(values.confirm_account_from_client||'')!=='yes',
      'The existing customer has a verified account. Tick the box to confirm that this imported business belongs to that account.');
    const [[selected]]=await conn.execute('SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=? FOR UPDATE',
      [target.account_id]);
    reject(!selected,'The selected customer account no longer exists.');
    // Explicitly confirmed by Owner. Update the GROUP account once, but leave
    // all other contract-line review decisions untouched.
    await conn.execute("UPDATE ga26_accounts SET account_number=?,crm_account_id=?,review_status='existing_crm_account' WHERE id=?",
      [selected.account_number,selected.id,group.id]);
    group.account_number=selected.account_number;
    group.crm_account_id=Number(selected.id);
    group.review_status='existing_crm_account';
    account=selected;
  }
  const canonical=contactMobile?toCRM(contactMobile):null;
  const old=normalPhone(target.cell_number_normalised||target.cell_number);
  if(phone&&mobile(phone)&&old&&old!==phone){
    // Same person, different mobile contract: create a separate CRM line
    // rather than replacing or reusing the old mobile identity.
    reject(!account,'Confirm the business account before creating a second mobile contract line.');
    const [ex]=await conn.execute('SELECT id FROM clients WHERE is_active=1 AND cell_number_normalised IN (?,?) FOR UPDATE',[toCRM(phone),phone]);
    reject(ex.length,'This mobile is already present in another CRM line (#'+ex[0]?.id||'unknown'+'). Select that exact record.');
    const [r]=await conn.execute(
      'INSERT INTO clients(account_id,account_number,first_name,surname,company_name,client_name,cell_number,cell_number_normalised,email,id_number,customer_type,lifecycle_status,lead_source,lead_status,line_status,created_by_staff_id,is_active) '+
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,'client','Grouped conflict resolution - additional mobile line','new','unknown',?,1)",
      [account.id,account.account_number,target.first_name,target.surname,target.company_name,target.client_name,
        phone,toCRM(phone),target.email,target.id_number,target.customer_type,ownerId]);
    return {id:Number(r.insertId),created:true,description:'Added a distinct mobile contract line for CRM customer #'+clientId+' without altering the existing line'};
  }
  if(canonical&&!old){
    const [conflict]=await conn.execute('SELECT id FROM clients WHERE is_active=1 AND cell_number_normalised IN (?,?) AND id<>? FOR UPDATE',
      [canonical,contactMobile,clientId]);
    reject(conflict.length,'That cellphone is already assigned to CRM customer #'+conflict[0]?.id||'unknown'+'.');
    await conn.execute('UPDATE clients SET cell_number=?,cell_number_normalised=?,updated_at=NOW() WHERE id=?',
      [contactMobile,canonical,clientId]);
  }
  if(account&&!target.account_id){
    await conn.execute('UPDATE clients SET account_id=?,account_number=?,updated_at=NOW() WHERE id=?',
      [account.id,account.account_number,clientId]);
  }
  return {id:clientId,created:false,accountId:account?.id||null,
    description:'Linked existing CRM customer #'+clientId};
}
async function verifyAccountNumberEnteredWithCustomer(conn,group,values,actor){
  const typed=clean(values.official_account_number,80);
  if(!typed)return group;
  const code=typed.toUpperCase().replace(/\s+/g,'');
  reject(!/^(?:B|VB|V|I|G)\d{4,15}$/.test(code),
    'Enter the genuine official B, VB, V, I or G account number (letters followed by digits). Do not enter an example number.');
  const normal=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(group.account_number)reject(normal(group.account_number)!==normal(code),
    'This business already has a different B/VB account number. Use the account-conflict selection screen to correct it.');
  if(group.crm_account_id){
    const [[current]]=await conn.execute('SELECT account_number,account_number_normalised FROM customer_accounts WHERE id=? FOR UPDATE',
      [group.crm_account_id]);
    reject(!current||normal(current.account_number_normalised||current.account_number)!==normal(code),
      'The entered account number differs from the current CRM account. Do not overwrite another account.');
    return group;
  }
  const [matches]=await conn.execute(
    'SELECT id,account_number,display_name FROM customer_accounts WHERE account_number_normalised=? OR account_number_normalised=? FOR UPDATE',
    [code,normal(code)]);
  reject(matches.length>1,'Multiple account-number matches found. Resolve that conflict before adding a customer.');
  const linked=matches[0];
  if(linked){
    const existingName=nameKey(linked.display_name);
    const requestedName=nameKey(group.account_name);
    reject(Boolean(existingName&&requestedName&&existingName!==requestedName),
      'Account '+linked.account_number+' already exists as '+clean(linked.display_name,100)+
      '. Check the business name and choose the correct account using the Find Account option above.');
    await applyVerifiedBusinessAccount(conn,{groupId:group.id,action:'select_group_account',
      values:{account_id:linked.id},...actor});
  }else{
    const actualName=clean(group.account_name||values.company_name||values.client_name,180);
    reject(actualName.length<2,'Enter the actual business name before creating a new B/VB account.');
    await applyVerifiedBusinessAccount(conn,{groupId:group.id,action:'create_group_account',
      values:{account_code:code,account_display_name:actualName,
        confirm_separate_account:values.confirm_separate_account},...actor});
  }
  return getGroup(conn,group.id,true);
}
async function applyCustomerResolution(conn,{groupId,lineId=null,action,values={},userId,ip='',userAgent=''}){
  reject(!id(userId),'A signed-in Owner/Manager is required to update customer records.');
  reject(!['create_customer','link_customer'].includes(action),'Choose to create or link a customer.');
  let group=await getGroup(conn,groupId,true);
  const line=await getSourceLine(conn,lineId,group.id,true);
  let acct=await ensureAccount(conn,group);
  reject(line?.crm_client_id,'This line is already linked to a CRM customer. Open that customer instead of creating a duplicate.');
  const rawSourcePhone=line?.phone||clean(values.service_phone,30);
  const p=normalPhone(rawSourcePhone);
  reject(rawSourcePhone&&!p,'Enter a valid 10-digit South African service number, or leave it blank if unknown.');
  const manual=!!(!line&&p);
  if(manual){
    const [[used]]=await conn.execute('SELECT id,ga_account_id FROM ga26_lines WHERE batch_id=? AND phone=? FOR UPDATE',
      [group.batch_id,p]);
    reject(used,'This number already exists in import line #'+(used?.id||'?')+'. Open that line to resolve or link it.');
    const [[linked]]=await conn.execute('SELECT phone FROM customer_account_line_links WHERE phone=? FOR UPDATE',[p]);
    reject(linked,'This service number is already linked to a CRM account. Find its existing customer instead.');
  }
  const service=clean(values.service_type||line?.service_type||'',24).toLowerCase();
  reject(!serviceChoices.includes(service),'Choose Mobile, VoIP, Fixed, Other or Unverified.');
  if(p&&mobile(p))reject(!['mobile','unverified'].includes(service),
    'A mobile number cannot be classified as a fixed or VoIP service.');
  if(p&&!mobile(p))reject(service==='mobile','An 087/051/other non-mobile number cannot be classified as a mobile contract.');
  const rawContact=clean(values.contact_mobile,30);
  let contactMobile=rawContact?normalPhone(rawContact):'';
  reject(rawContact&&(!contactMobile||!mobile(contactMobile)),'Contact cellphone must be a valid South African mobile number.');
  if(p&&mobile(p)){
    reject(contactMobile&&contactMobile!==p,'This imported mobile number must stay on its own contract line. Leave the contact cellphone blank or enter the same number.');
    contactMobile=p;
  }
  const before={group_id:group.id,group_account:group.account_number||null,source_line_id:line?.id||null,
    source_phone:line?.phone||null,original_client_id:line?.crm_client_id||null};
  // The owner can enter a real B/VB account number in THIS customer form.
  // Match by exact official number first; create only when absent. One transaction
  // covers the account and customer, so a rejected customer rolls both back.
  group=await verifyAccountNumberEnteredWithCustomer(conn,group,values,{userId,ip,userAgent});
  acct=await ensureAccount(conn,group);
  const customer=action==='create_customer'
    ?await createFromForm(conn,group,acct,line,p,contactMobile,values,userId)
    :await linkExisting(conn,group,acct,line,p,contactMobile,values,userId);
  // Linking a near-match can also verify a previously missing account when
  // the Owner deliberately confirms the existing customer's official account.
  if(!acct&&group.crm_account_id)acct=await ensureAccount(conn,group);
  const staff=await chooseStaff(conn,customer.id,acct?.id,values.assigned_staff_id||acct?.assigned_staff_id,userId);
  let workingLine=line;
  if(manual){
    const uncertain=!acct||service==='unverified';
    const [ins]=await conn.execute(
      'INSERT INTO ga26_lines(batch_id,ga_account_id,phone,bf_contact_id,crm_client_id,base_line_id,line_status,base_status,review_required,review_state,service_type,notes,reviewed_by,reviewed_at) '+
      'VALUES(?,?,?,NULL,?,NULL,?,?,?, ?, ?, ?, ?,NOW())',
      [group.batch_id,group.id,p,customer.id,'owner_added_number','not_in_mobile_base',uncertain?1:0,
        uncertain?'needs_info':'client_linked',service,'Added by owner from Grouped Conflict Resolution',userId]);
    workingLine={id:Number(ins.insertId),batch_id:group.batch_id,ga_account_id:group.id,phone:p,
      review_state:'pending',review_required:1};
    await conn.execute('UPDATE ga26_accounts SET line_count=(SELECT COUNT(*) FROM ga26_lines WHERE ga_account_id=?) WHERE id=?',
      [group.id,group.id]);
  }
  let nextState=null,reviewFlag=null;
  if(workingLine){
    const accountClear=Boolean(acct)&&!['missing_account_number','conflicting_account_names'].includes(group.review_status);
    const otherConflict=line&&(
      ['duplicate_crm_line_review','existing_line_other_account','conflicting_source_account_names'].includes(line.line_status)||
      line.base_status==='base_account_conflict');
    const serviceClear=p&&mobile(p)?service==='mobile':['voip','fixed','other'].includes(service);
    const resolved=accountClear&&!otherConflict&&serviceClear;
    nextState=resolved?'client_linked':'needs_info';
    reviewFlag=resolved?0:1;
    await conn.execute('UPDATE ga26_lines SET crm_client_id=?,service_type=?,review_state=?,review_required=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',
      [customer.id,service,nextState,reviewFlag,userId,workingLine.id]);
    if(acct&&p){
      const [[existingLink]]=await conn.execute('SELECT * FROM customer_account_line_links WHERE phone=? FOR UPDATE',[p]);
      reject(existingLink&&Number(existingLink.account_id)!==Number(acct.id),
        'This number is already linked to a different CRM account. Resolve that conflict first.');
      reject(existingLink?.client_id&&Number(existingLink.client_id)!==Number(customer.id),
        'This service number already belongs to a different CRM customer. Open that customer and resolve the duplicate first.');
      await conn.execute('INSERT INTO customer_account_line_links(phone,account_id,client_id,service_type,linked_by) VALUES(?,?,?,?,?) '+
        'ON DUPLICATE KEY UPDATE client_id=VALUES(client_id),service_type=VALUES(service_type),linked_by=VALUES(linked_by),linked_at=NOW()',
        [p,acct.id,customer.id,service,userId]);
    }
  }
  await conn.execute('INSERT IGNORE INTO ga26_account_client_links(ga_account_id,client_id,created_by) VALUES(?,?,?)',
    [group.id,customer.id,userId]);
  await logAction(conn,{group,line:workingLine,mode:action==='create_customer'?'customer_created':'customer_linked',
    before,after:{client_id:customer.id,new_record:customer.created,account_id:acct?.id||null,
      phone:p||null,contact_mobile:contactMobile||null,service_type:service,
      staff_id:staff?.id||null,review_state:nextState,review_required:reviewFlag},
    ownerId:userId,ip,userAgent,description:customer.description+
      (staff?' assigned to '+staff.full_name:'')+
      (acct?' under account '+acct.account_number:'; official account verification pending')+
      (p?'; service '+p:'; cellphone not yet supplied')});
  return {clientId:customer.id,lineId:workingLine?.id||null,groupId:group.id,reviewPending:reviewFlag===1,
    message:customer.description+'.'+(staff?' Assigned to '+staff.full_name+'.':'')+
      (acct?' Linked to '+acct.account_number+'.':' Official account is still pending.')+
      (reviewFlag?' Remaining verification stays in the review queue.':'')};
}
async function applyVerifiedBusinessAccount(conn,{groupId,action,values={},userId,ip='',userAgent=''}){
  reject(!id(userId),'Only an authenticated owner or manager can verify account records.');
  reject(!['select_group_account','create_group_account'].includes(action),'Select a supported account correction.');
  const g=await getGroup(conn,groupId,true);
  reject(g.crm_account_id,'This business is already linked to a CRM account. Use the telephone line review to correct a mismatch.');
  const original={account_number:g.account_number,account_name:g.account_name,crm_account_id:g.crm_account_id,review_status:g.review_status};
  let selected;
  if(action==='select_group_account'){
    const accountId=id(values.account_id);
    reject(!accountId,'Choose the correct existing CRM account first.');
    const [[a]]=await conn.execute('SELECT * FROM customer_accounts WHERE id=? FOR UPDATE',[accountId]);
    reject(!a,'That existing account could not be found.');
    selected=a;
  }else{
    const code=clean(values.account_code,80).toUpperCase().replace(/\s/g,'');
    const name=clean(values.account_display_name,180);
    reject(!/^(?:B|VB|V|I|G)[0-9]{4,15}$/.test(code),
      'Enter the genuine official B, VB or I account number from Vodacom.');
    reject(name.length<2,'Enter the correct verified business name.');
    // Near-name accounts can be legitimate multiple B/VB contracts, but
    // never create another without an explicit separate-account confirmation.
    const sourceName=nameKey(name),first=(sourceName.split(' ')[0]||'').slice(0,35);
    if(first.length>=3){
      const [similar]=await conn.execute(
        'SELECT id,account_number,display_name FROM customer_accounts WHERE UPPER(display_name) LIKE ? ORDER BY id LIMIT 80 FOR UPDATE',
        [first+'%']);
      const names=similar.filter(x=>nameKey(x.display_name)===sourceName&&
        String(x.account_number).replace(/[^A-Z0-9]/gi,'').toUpperCase()!==code);
      reject(names.length>0&&String(values.confirm_separate_account||'')!=='yes',
        'This business already exists under '+names.slice(0,3).map(x=>x.account_number).join(', ')+
        '. Choose the existing account above, or tick Separate verified account if this is genuinely another official B/VB account.');
    }
    const [matches]=await conn.execute('SELECT id FROM customer_accounts WHERE account_number_normalised=? FOR UPDATE',[code]);
    reject(matches.length,'This account number already exists. Select the existing CRM account instead of creating a duplicate.');
    const [insert]=await conn.execute("INSERT INTO customer_accounts(account_number,account_number_normalised,display_name,account_status) VALUES(?,?,?,'unknown')",
      [code,code,name]);
    selected={id:Number(insert.insertId),account_number:code,display_name:name};
  }
  reject(g.account_number&&String(g.account_number).replace(/\W/g,'').toUpperCase()!==
    String(selected.account_number).replace(/\W/g,'').toUpperCase(),
    'The imported business already has a different account number. Resolve that conflict first.');
  await conn.execute("UPDATE ga26_accounts SET account_number=?,crm_account_id=?,review_status='existing_crm_account' WHERE id=?",
    [selected.account_number,selected.id,g.id]);
  await conn.execute('INSERT INTO audit_log(staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)',
    [userId,'grouped_customer_account_verified','ga26_accounts',g.id,
      'Owner confirmed official account '+selected.account_number+' for imported business '+clean(g.account_name,120),
      JSON.stringify(original),JSON.stringify({account_number:selected.account_number,crm_account_id:selected.id,
        display_name:selected.display_name,source:action}),clean(ip,64),clean(userAgent,255)]);
  return {message:'Business account linked to '+selected.account_number+'. You can now create or link its customer contacts below.'};
}
module.exports={getGroup,getStaff,findCustomerMatches,applyCustomerResolution,applyVerifiedBusinessAccount,normalPhone,mobile};
