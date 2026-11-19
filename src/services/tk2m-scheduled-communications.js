'use strict';
const path=require('node:path');

let schemaPromise;
async function ensureScheduleSchema(db){
 if(!schemaPromise){
  schemaPromise=(async()=>{
   await db.query(`CREATE TABLE IF NOT EXISTS staff_scheduled_communications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sender_staff_id BIGINT UNSIGNED NOT NULL,
    recipient_staff_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    scheduled_for DATETIME NOT NULL,
    status ENUM('pending','sent','cancelled','failed') NOT NULL DEFAULT 'pending',
    task_id BIGINT UNSIGNED NULL,
    sent_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    failed_at DATETIME NULL,
    last_error VARCHAR(250) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_schedule_task (task_id),
    KEY idx_schedule_due (status,scheduled_for,id),
    KEY idx_schedule_sender (sender_staff_id,status,created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
   await db.query(`CREATE TABLE IF NOT EXISTS staff_scheduled_communication_attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    schedule_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_bytes BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY idx_schedule_attachments (schedule_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch(error=>{schemaPromise=null;throw error});
 }
 return schemaPromise;
}
function formatSast(date=new Date()){
 return new Intl.DateTimeFormat('en-CA',{
  timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).reduce((r,p)=>{if(p.type!=='literal')r[p.type]=p.value;return r},{});
}
function parseScheduledFor(value,now=new Date()){
 const raw=String(value||'');
 const m=/^(20\d\d)-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
 if(!m)throw Error('Choose a date and time (South African time).');
 const [year,month,day,hour,minute]=m.slice(1).map(Number);
 if(year<2026||year>2100||month<1||month>12||day<1||day>31||hour>23||minute>59)
  throw Error('Enter a valid date and time.');
 const valid=new Date(Date.UTC(year,month-1,day,hour,minute));
 if(valid.getUTCFullYear()!==year||valid.getUTCMonth()+1!==month||
    valid.getUTCDate()!==day||valid.getUTCHours()!==hour||valid.getUTCMinutes()!==minute)
  throw Error('Enter a valid date and time.');
 // South Africa has no daylight-saving time: UTC+02:00 all year.
 const epoch=Date.UTC(year,month-1,day,hour-2,minute);
 const nowMs=now instanceof Date?now.getTime():new Date(now).getTime();
 if(!Number.isFinite(nowMs))throw Error('Server clock unavailable.');
 if(epoch<nowMs+60000)throw Error('Choose a future time at least one minute from now.');
 if(epoch>nowMs+366*86400000)throw Error('Schedule no more than one year ahead.');
 return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
}
const positiveId=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null};
async function bookCommunication(db,{senderId,recipientId,message,scheduledFor,files=[]}){
 const actor=positiveId(senderId),recipient=positiveId(recipientId);
 const body=String(message||'').trim();
 if(!actor||!recipient||actor===recipient)throw Error('Choose a colleague to receive this communication.');
 if(!body||body.length>4000)throw Error('Enter a message of up to 4,000 characters.');
 const scheduled=parseScheduledFor(scheduledFor);
 await ensureScheduleSchema(db);
 const [[member]]=await db.execute(
  `SELECT id,full_name FROM staff_users
    WHERE id=:recipient AND is_active=1 AND password_hash IS NOT NULL
    AND COALESCE(username,'')<>'chatgpt_crm_test' LIMIT 1`,{recipient});
 if(!member)throw Error('The selected colleague is no longer available.');
 const title=(body.split(/\r?\n/)[0].trim()||body).slice(0,180);
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const [row]=await conn.execute(`INSERT INTO staff_scheduled_communications
    (sender_staff_id,recipient_staff_id,title,message,scheduled_for)
    VALUES (:actor,:recipient,:title,:body,:scheduled)`,
    {actor,recipient,title,body,scheduled});
  const id=Number(row.insertId);
  for(const file of files){
   const name=path.basename(String(file.originalname||'attachment')).slice(0,255);
   const stored=path.basename(String(file.filename||''));
   const mime=String(file.mimetype||'').slice(0,120);
   const bytes=Number(file.size||0);
   if(!stored||!bytes||bytes>15*1024*1024)throw Error('Invalid attachment.');
   await conn.execute(`INSERT INTO staff_scheduled_communication_attachments
     (schedule_id,original_name,stored_filename,mime_type,file_bytes)
     VALUES (:id,:name,:stored,:mime,:bytes)`,{id,name,stored,mime,bytes});
  }
  await conn.commit();
  return {id,scheduledFor:scheduled.replace(' ','T').slice(0,16),recipientName:String(member.full_name||'Colleague'),attachmentCount:files.length};
 }catch(error){await conn.rollback();throw error}
 finally{conn.release()}
}
async function pendingForSender(db,senderId){
 const actor=positiveId(senderId);if(!actor)throw Error('Invalid sender.');
 await ensureScheduleSchema(db);
 const [rows]=await db.execute(`SELECT s.id,s.recipient_staff_id,s.title,s.message,
    DATE_FORMAT(s.scheduled_for,'%Y-%m-%dT%H:%i') scheduled_for,
    s.created_at,r.full_name recipient_name,
    (SELECT COUNT(*) FROM staff_scheduled_communication_attachments a
      WHERE a.schedule_id=s.id) attachment_count
   FROM staff_scheduled_communications s
   JOIN staff_users r ON r.id=s.recipient_staff_id
   WHERE s.sender_staff_id=:actor AND s.status='pending'
   ORDER BY s.scheduled_for ASC,s.id ASC LIMIT 40`,{actor});
 return rows.map(r=>({
  id:Number(r.id),recipientId:Number(r.recipient_staff_id),
  recipientName:String(r.recipient_name||'Colleague'),
  title:String(r.title),scheduledFor:String(r.scheduled_for),
  attachmentCount:Number(r.attachment_count||0)
 }));
}
async function cancelCommunication(db,{senderId,id}){
 const actor=positiveId(senderId),scheduleId=positiveId(id);
 if(!actor||!scheduleId)throw Error('Invalid scheduled communication.');
 await ensureScheduleSchema(db);
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const [[pending]]=await conn.execute(
   `SELECT id FROM staff_scheduled_communications
     WHERE id=:scheduleId AND sender_staff_id=:actor AND status='pending'
     LIMIT 1 FOR UPDATE`,{scheduleId,actor});
  if(!pending){await conn.rollback();return {ok:false,reason:'not_pending'}}
  const [files]=await conn.execute(
   `SELECT stored_filename FROM staff_scheduled_communication_attachments
     WHERE schedule_id=:scheduleId`,{scheduleId});
  await conn.execute(`UPDATE staff_scheduled_communications
    SET status='cancelled',cancelled_at=NOW() WHERE id=:scheduleId`,{scheduleId});
  await conn.execute(`DELETE FROM staff_scheduled_communication_attachments
     WHERE schedule_id=:scheduleId`,{scheduleId});
  await conn.commit();
  return {ok:true,files:files.map(x=>path.basename(String(x.stored_filename)))};
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
}
async function dispatchDue(db,{limit=30}={}){
 await ensureScheduleSchema(db);
 const processed=[];
 for(let i=0;i<Math.min(50,Math.max(1,limit));i++){
  const conn=await db.getConnection();
  let transaction=false;
  try{
   await conn.beginTransaction();transaction=true;
   const [[item]]=await conn.execute(
    `SELECT id,sender_staff_id,recipient_staff_id,title,message,scheduled_for
     FROM staff_scheduled_communications
     WHERE status='pending' AND scheduled_for<=NOW()
     ORDER BY scheduled_for,id LIMIT 1 FOR UPDATE`);
   if(!item){await conn.rollback();transaction=false;break}
   const id=Number(item.id),senderId=Number(item.sender_staff_id),
      recipientId=Number(item.recipient_staff_id);
   const [people]=await conn.execute(`SELECT id,full_name,username,is_active,password_hash
      FROM staff_users WHERE id IN (:senderId,:recipientId)`,{senderId,recipientId});
   const sender=people.find(p=>Number(p.id)===senderId);
   const recipient=people.find(p=>Number(p.id)===recipientId);
   if(!sender||!recipient||Number(sender.is_active)!==1||Number(recipient.is_active)!==1||
      recipient.password_hash==null||String(recipient.username)==='chatgpt_crm_test'){
    const error='Sender or recipient is no longer an active staff member';
    await conn.execute(`UPDATE staff_scheduled_communications
       SET status='failed',failed_at=NOW(),last_error=:error WHERE id=:id`,{id,error});
    await conn.commit();transaction=false;
    processed.push({id,status:'failed',reason:error,senderId,recipientId});
    continue;
   }
   // All four writes and the state transition share one transaction.
   // Crash before commit = no task and still pending; after commit = sent.
   const [newTask]=await conn.execute(`INSERT INTO staff_tasks
     (type,title,message,priority,assigned_to,created_by,due_at,email_status)
     VALUES ('task',:title,:message,'high',:recipientId,:senderId,NULL,'not_configured')`,{
       title:item.title,message:item.message,recipientId,senderId
     });
   const taskId=Number(newTask.insertId);
   await conn.execute(`INSERT INTO staff_task_workflow
     (task_id,workflow_state,my_priority_date) VALUES (:taskId,'active',NULL)`,{taskId});
   const [comment]=await conn.execute(`INSERT INTO staff_task_comments
     (task_id,staff_id,comment) VALUES (:taskId,:senderId,:text)`,{
       taskId,senderId,text:'Scheduled communication delivered (schedule #'+id+')'
     });
   const [files]=await conn.execute(`SELECT original_name,stored_filename,mime_type,file_bytes
     FROM staff_scheduled_communication_attachments WHERE schedule_id=:id`,{id});
   for(const f of files){
    await conn.execute(`INSERT INTO staff_task_attachments
     (task_id,comment_id,uploaded_by,original_name,stored_filename,mime_type,file_bytes)
     VALUES (:taskId,:commentId,:senderId,:originalName,:storedFilename,:mimeType,:fileBytes)`,{
       taskId,commentId:Number(comment.insertId),senderId,
       originalName:f.original_name,storedFilename:f.stored_filename,
       mimeType:f.mime_type,fileBytes:Number(f.file_bytes)
     });
   }
   if(senderId!==recipientId){
    await conn.execute(`INSERT INTO staff_task_notifications
     (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
     VALUES (:taskId,:recipientId,:senderId,'assigned',:text,0)`,{
       taskId,recipientId,senderId,
       text:(String(sender.full_name||'Colleague')+' sent a scheduled communication: “'+item.title+'”.').slice(0,500)
     });
   }
   await conn.execute(`UPDATE staff_scheduled_communications
     SET status='sent',task_id=:taskId,sent_at=NOW(),last_error=NULL
     WHERE id=:id AND status='pending'`,{id,taskId});
   await conn.commit();transaction=false;
   processed.push({id,taskId,status:'sent',senderId,recipientId,attachmentCount:files.length});
  }catch(error){
   if(transaction)await conn.rollback();
   throw error;
  }finally{conn.release()}
 }
 return processed;
}
module.exports={ensureScheduleSchema,parseScheduledFor,formatSast,
 bookCommunication,pendingForSender,cancelCommunication,dispatchDue};
