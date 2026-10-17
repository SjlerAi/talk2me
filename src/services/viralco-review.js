'use strict';

// Conflicts are numbered *review items*: their number is independent of MSISDN and Excel row.
const OPTIONS={
  account_name:['verify_account','rename_account','refer_manager'],
  cross_account:['keep_crm','hold','refer_manager'],
  duplicate:['keep_crm','hold','refer_manager'],
  new_number:['create_line','keep_crm','hold','refer_manager'],
  missing_number:['keep_crm','hold','refer_manager'],
  data_change:['use_viralco','keep_crm']
};
const MANAGER_ONLY=new Set(['verify_account','rename_account','create_line']);
const STATUSES={verify_account:'resolved',rename_account:'resolved',create_line:'resolved',
  keep_crm:'resolved',use_viralco:'resolved',hold:'held',refer_manager:'referred'};
const str=x=>String(x||'');
function buildIssues(result,report,account){
  const list=[];
  const add=(key,type,label,info)=>list.push({
    key,type,label,number:list.length+1,choices:OPTIONS[type],...info
  });
  if(result.nameMismatch){
    add('account-name','account_name','Business account identity',{
      phone:null,sourceRow:null,crmName:account.display_name,
      crmAccount:account.account_number,viralcoValue:report.customerName,
      reason:'ViralCo and CRM have different company names. Management must verify the identity before this report can update CRM.'
    });
  }
  for(const row of result.rows){
    if(!['conflict','ambiguous','new'].includes(row.action))continue;
    const type=row.action==='conflict'?'cross_account':row.action==='ambiguous'?'duplicate':'new_number';
    add('line-'+row.sourceRow,type,
      type==='cross_account'?'Mobile number belongs to another account':type==='duplicate'?'Duplicate mobile number':'New mobile number',
      {phone:row.phone,sourceRow:row.sourceRow,clientId:row.clientId||null,
        crmMatches:row.crmMatches||[],viralcoValue:row.packDesc,subscriber:row.subscriberName,
        reason:type==='cross_account'?'The number belongs to a different CRM account. No automatic reassignment is permitted.'
          :type==='duplicate'?'The number matches multiple CRM records. Ownership must be investigated.'
          :'ViralCo lists this number, but no existing CRM record matches.'});
  }
  for(const row of [...(result.missingLines||[])].sort((a,b)=>a.clientId-b.clientId)){
    add('missing-'+row.clientId,'missing_number','CRM mobile missing from this ViralCo report',{
      phone:row.phone,sourceRow:null,clientId:row.clientId,
      crmMatches:[{id:row.clientId,clientName:row.clientName,accountNumber:row.accountNumber}],
      crmValue:row.packageName,reason:'The CRM line is absent from the provider export. Never delete or cancel it automatically.'
    });
  }
  return list;
}
function issueByKey(issues,key){return issues.find(issue=>issue.key===str(key))||null;}
function validateChoice(issue,choice,role,note){
  const selected=str(choice),comment=str(note).trim();
  if(!issue)throw Error('Unknown review item. Reload the preview.');
  if(!OPTIONS[issue.type]?.includes(selected))throw Error('That resolution is not allowed for this issue.');
  if(MANAGER_ONLY.has(selected)&&!['owner','manager','admin'].includes(str(role).toLowerCase()))
    throw Error('Only an owner or manager can approve this decision.');
  if(['hold','refer_manager','verify_account','rename_account','create_line'].includes(selected)&&!comment)
    throw Error('Enter a short explanation before saving this decision.');
  if(comment.length>900)throw Error('Explanation exceeds 900 characters.');
  return {choice:selected,status:STATUSES[selected],note:comment};
}
function assessIssues(issues,decisions){
  let unresolved=0,held=0,referred=0,resolved=0,accountBlocked=false;
  for(const issue of issues){
    const decision=decisions.get(issue.key);
    if(!decision||!OPTIONS[issue.type].includes(decision.choice)){unresolved++;continue;}
    if(issue.type==='account_name'&&!['verify_account','rename_account'].includes(decision.choice))accountBlocked=true;
    if(decision.choice==='hold')held++;
    else if(decision.choice==='refer_manager')referred++;
    else resolved++;
  }
  return {total:issues.length,unresolved,held,referred,resolved,
    ready:unresolved===0&&!accountBlocked,accountBlocked};
}
const ddl=[
  'CREATE TABLE IF NOT EXISTS viralco_review_issues ('+
  'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,account_id BIGINT UNSIGNED NOT NULL,'+
  'preview_id CHAR(36) NOT NULL,version_id BIGINT UNSIGNED NULL,'+
  'issue_key VARCHAR(72) NOT NULL,issue_number INT UNSIGNED NOT NULL,issue_type VARCHAR(30) NOT NULL,'+
  'phone_normalised VARCHAR(20) NULL,source_row INT UNSIGNED NULL,detail_json TEXT NULL,'+
  'choice VARCHAR(32) NOT NULL,status ENUM("resolved","held","referred") NOT NULL,'+
  'note VARCHAR(900) NULL,decided_by BIGINT UNSIGNED NOT NULL,'+
  'decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,'+
  'UNIQUE KEY uq_vc_preview_issue (preview_id,issue_key),'+
  'KEY idx_vc_review_account (account_id,version_id,status),KEY idx_vc_review_actor (decided_by,updated_at)'+
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS viralco_review_audit ('+
  'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,issue_id BIGINT UNSIGNED NOT NULL,'+
  'account_id BIGINT UNSIGNED NOT NULL,preview_id CHAR(36) NOT NULL,issue_key VARCHAR(72) NOT NULL,'+
  'previous_choice VARCHAR(32) NULL,new_choice VARCHAR(32) NOT NULL,note VARCHAR(900) NULL,'+
  'actor_id BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'KEY idx_vc_audit_issue (issue_id,created_at),KEY idx_vc_audit_account (account_id,created_at)'+
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
];
let ready;
async function ensureReviewSchema(db){
  if(ready)return ready;
  ready=(async()=>{for(const statement of ddl)await db.query(statement);})().catch(e=>{ready=null;throw e;});
  return ready;
}
async function loadDecisions(conn,accountId,previewId){
  const [rows]=await conn.execute(
    'SELECT id,issue_key,issue_number,issue_type,choice,status,note,decided_by,updated_at '+
    'FROM viralco_review_issues WHERE account_id=:accountId AND preview_id=:previewId',
    {accountId,previewId});
  return new Map(rows.map(row=>[row.issue_key,row]));
}
async function saveDecision(conn,{accountId,previewId,issue,choice,status,note,actorId}){
  const key=issue.key;
  const [[old]]=await conn.execute(
    'SELECT id,choice FROM viralco_review_issues WHERE account_id=:accountId AND preview_id=:previewId AND issue_key=:key FOR UPDATE',
    {accountId,previewId,key});
  await conn.execute(
    'INSERT INTO viralco_review_issues (account_id,preview_id,issue_key,issue_number,issue_type,'+
    'phone_normalised,source_row,detail_json,choice,status,note,decided_by) VALUES '+
    '(:accountId,:previewId,:key,:number,:type,:phone,:sourceRow,:detail,:choice,:status,:note,:actorId) '+
    'ON DUPLICATE KEY UPDATE choice=VALUES(choice),status=VALUES(status),note=VALUES(note),'+
    'decided_by=VALUES(decided_by),issue_number=VALUES(issue_number),detail_json=VALUES(detail_json)',
    {accountId,previewId,key,number:issue.number,type:issue.type,phone:issue.phone||null,
      sourceRow:issue.sourceRow||null,detail:JSON.stringify(issue).slice(0,12000),
      choice,status,note,actorId});
  const [[current]]=await conn.execute(
    'SELECT id FROM viralco_review_issues WHERE account_id=:accountId AND preview_id=:previewId AND issue_key=:key',
    {accountId,previewId,key});
  await conn.execute(
    'INSERT INTO viralco_review_audit (issue_id,account_id,preview_id,issue_key,previous_choice,new_choice,note,actor_id) '+
    'VALUES (:id,:accountId,:previewId,:key,:old,:choice,:note,:actorId)',
    {id:current.id,accountId,previewId,key,old:old?.choice||null,choice,note,actorId});
}
module.exports={OPTIONS,STATUSES,MANAGER_ONLY,buildIssues,issueByKey,validateChoice,assessIssues,
  ensureReviewSchema,loadDecisions,saveDecision};
