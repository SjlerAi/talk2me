'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { sendAgentInstruction } = require('./office-intelligence-agent');
const { notificationProviderStatus } = require('./management-intelligence');

const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const privateRoot = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();
const uploadDir = path.join(privateRoot || '/tmp', 'work-dispatch', 'files');
const libraryFileDir = path.join(privateRoot || '/tmp', 'library', 'files');
const taskAttachmentDir = path.join(privateRoot || '/tmp', 'tasks', 'attachments');

const allowed = new Map([
  ['.pdf',new Set(['application/pdf','application/octet-stream'])],
  ['.xlsx',new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'])],
  ['.xls',new Set(['application/vnd.ms-excel','application/octet-stream'])],
  ['.csv',new Set(['text/csv','application/csv','application/vnd.ms-excel','text/plain','application/octet-stream'])],
  ['.doc',new Set(['application/msword','application/octet-stream'])],
  ['.docx',new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'])],
  ['.ppt',new Set(['application/vnd.ms-powerpoint','application/octet-stream'])],
  ['.pptx',new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'])],
  ['.txt',new Set(['text/plain','application/octet-stream'])],
  ['.rtf',new Set(['application/rtf','text/rtf','application/octet-stream'])],
  ['.jpg',new Set(['image/jpeg','application/octet-stream'])],
  ['.jpeg',new Set(['image/jpeg','application/octet-stream'])],
  ['.png',new Set(['image/png','application/octet-stream'])],
  ['.webp',new Set(['image/webp','application/octet-stream'])],
  ['.gif',new Set(['image/gif','application/octet-stream'])]
]);

let schemaPromise = null;

const clean = (value,max=5000) => String(value == null ? '' : value).trim().slice(0,max);
const idOf = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function mysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extensionOfName(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function safeOriginalName(value) {
  const base = path.basename(clean(value,255) || 'attachment.bin')
    .replace(/[\\/:*?"<>|\r\n]/g,'_')
    .trim();
  return base || 'attachment.bin';
}

function validateFile({originalName,mimeType,size}) {
  const name = safeOriginalName(originalName);
  const ext = extensionOfName(name);
  const mime = clean(mimeType,140).toLowerCase() || 'application/octet-stream';
  const mimes = allowed.get(ext);
  if (!mimes || !mimes.has(mime)) {
    throw new Error('Unsupported attachment. Use PDF, images, Excel/CSV, Word, PowerPoint, text or RTF.');
  }
  const bytes = Number(size || 0);
  if (!bytes || bytes > 40 * 1024 * 1024) throw new Error('Each attachment must be between 1 byte and 40 MB.');
  return {name,ext,mime,bytes};
}

async function ensureWorkDispatchSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async()=>{
    if (!privateRoot) throw new Error('PRIVATE_UPLOAD_DIR is required for work attachments.');
    if (IS_UAT && privateRoot === '/home/uent/talk2me_private_uploads') {
      throw new Error('Cudo UAT work dispatch requires the isolated UAT private upload directory.');
    }
    fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});

    await db.query(`CREATE TABLE IF NOT EXISTS work_files (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      storage_kind ENUM('uploaded','library') NOT NULL DEFAULT 'uploaded',
      original_name VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NULL,
      mime_type VARCHAR(140) NOT NULL,
      extension VARCHAR(20) NOT NULL,
      file_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      library_document_id BIGINT UNSIGNED NULL,
      library_version_id BIGINT UNSIGNED NULL,
      uploaded_by BIGINT UNSIGNED NOT NULL,
      status ENUM('draft','active','deleted') NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_work_files_owner(status,uploaded_by,created_at),
      KEY idx_work_files_library(library_document_id,library_version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS work_dispatches (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      created_by BIGINT UNSIGNED NOT NULL,
      recipient_staff_id BIGINT UNSIGNED NOT NULL,
      task_id BIGINT UNSIGNED NULL,
      delivery_channel ENUM('internal','email','whatsapp') NOT NULL DEFAULT 'internal',
      subject VARCHAR(180) NOT NULL,
      instruction TEXT NULL,
      priority ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
      due_at DATETIME NULL,
      require_reply TINYINT(1) NOT NULL DEFAULT 0,
      require_completion TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('created','sent','failed','cancelled') NOT NULL DEFAULT 'created',
      external_status VARCHAR(40) NULL,
      external_error VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_work_dispatch_recipient(recipient_staff_id,created_at),
      KEY idx_work_dispatch_creator(created_by,created_at),
      KEY idx_work_dispatch_task(task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS work_dispatch_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dispatch_id BIGINT UNSIGNED NOT NULL,
      source_kind VARCHAR(50) NULL,
      source_id BIGINT UNSIGNED NULL,
      related_client_id BIGINT UNSIGNED NULL,
      title VARCHAR(180) NOT NULL,
      detail VARCHAR(1000) NULL,
      source_due_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_work_dispatch_items(dispatch_id),
      KEY idx_work_dispatch_source(source_kind,source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS staff_task_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      comment_id BIGINT UNSIGNED NULL,
      uploaded_by BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_bytes BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_task_attachments_task (task_id,created_at),
      KEY idx_task_attachments_comment (comment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [attachmentColumns]=await db.execute(`SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff_task_attachments'`);
    const attachmentColumnNames=new Set(attachmentColumns.map(row=>String(row.COLUMN_NAME)));
    if(!attachmentColumnNames.has('work_file_id')){
      await db.query(`ALTER TABLE staff_task_attachments
        ADD COLUMN work_file_id BIGINT UNSIGNED NULL AFTER comment_id`);
    }
    const [attachmentIndexes]=await db.execute(`SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff_task_attachments'`);
    const attachmentIndexNames=new Set(attachmentIndexes.map(row=>String(row.INDEX_NAME)));
    if(!attachmentIndexNames.has('idx_task_attachments_work_file')){
      await db.query(`ALTER TABLE staff_task_attachments
        ADD KEY idx_task_attachments_work_file (work_file_id)`);
    }
  })().catch(error=>{schemaPromise=null;throw error;});
  return schemaPromise;
}

async function storeUploadedFile({buffer,originalName,mimeType,userId}) {
  await ensureWorkDispatchSchema();
  if (!Buffer.isBuffer(buffer)) throw new Error('Attachment data is missing.');
  const meta = validateFile({originalName,mimeType,size:buffer.length});
  const storedFilename = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${meta.ext}`;
  const target = path.join(uploadDir,storedFilename);
  fs.writeFileSync(target,buffer,{mode:0o600});
  try {
    const [result] = await db.execute(`INSERT INTO work_files
      (storage_kind,original_name,stored_filename,mime_type,extension,file_bytes,uploaded_by,status)
      VALUES ('uploaded',:name,:stored,:mime,:extension,:bytes,:userId,'draft')`,{
      name:meta.name,stored:storedFilename,mime:meta.mime,extension:meta.ext,bytes:meta.bytes,userId:Number(userId)
    });
    return {id:Number(result.insertId),name:meta.name,mime:meta.mime,extension:meta.ext,bytes:meta.bytes,source:'upload'};
  } catch (error) {
    try { fs.unlinkSync(target); } catch (_) {}
    throw error;
  }
}

async function searchLibraryDocuments(query='',limit=30) {
  await ensureWorkDispatchSchema();
  const safeLimit = Math.min(Math.max(Number(limit)||30,1),50);
  const q = clean(query,120);
  const params = {};
  let where = "d.status='active' AND d.current_version_id IS NOT NULL";
  if (q) {
    where += ' AND (d.title LIKE :q OR d.description LIKE :q OR d.category LIKE :q OR v.original_name LIKE :q)';
    params.q = `%${q}%`;
  }
  const [rows] = await db.execute(`SELECT d.id,d.title,d.category,d.description,
      v.id version_id,v.original_name,v.stored_filename,v.mime_type,v.extension,v.file_bytes
    FROM library_documents d
    JOIN library_versions v ON v.id=d.current_version_id
    WHERE ${where}
    ORDER BY d.company_favourite DESC,d.updated_at DESC,d.id DESC
    LIMIT ${safeLimit}`,params);
  return rows.map(row=>({
    id:Number(row.id),
    title:row.title,
    category:row.category || 'Other',
    description:row.description || '',
    versionId:Number(row.version_id),
    originalName:row.original_name,
    mime:row.mime_type,
    extension:row.extension,
    bytes:Number(row.file_bytes||0)
  }));
}

async function attachLibraryDocument({documentId,userId}) {
  await ensureWorkDispatchSchema();
  const [[row]] = await db.execute(`SELECT d.id,d.title,d.category,
      v.id version_id,v.original_name,v.stored_filename,v.mime_type,v.extension,v.file_bytes
    FROM library_documents d
    JOIN library_versions v ON v.id=d.current_version_id
    WHERE d.id=:id AND d.status='active' LIMIT 1`,{id:Number(documentId)});
  if (!row) throw new Error('That Library/Deals document is no longer available.');
  const [result] = await db.execute(`INSERT INTO work_files
    (storage_kind,original_name,stored_filename,mime_type,extension,file_bytes,library_document_id,library_version_id,uploaded_by,status)
    VALUES ('library',:name,NULL,:mime,:extension,:bytes,:documentId,:versionId,:userId,'draft')`,{
    name:safeOriginalName(row.original_name || row.title),
    mime:clean(row.mime_type,140)||'application/octet-stream',
    extension:clean(row.extension,20)||extensionOfName(row.original_name),
    bytes:Number(row.file_bytes||0),
    documentId:Number(row.id),versionId:Number(row.version_id),userId:Number(userId)
  });
  return {
    id:Number(result.insertId),
    name:row.original_name || row.title,
    mime:row.mime_type,
    extension:row.extension,
    bytes:Number(row.file_bytes||0),
    source:'library',
    documentId:Number(row.id),
    category:row.category || 'Other'
  };
}

async function listFilesForUser(ids,userId) {
  await ensureWorkDispatchSchema();
  const unique=[...new Set((Array.isArray(ids)?ids:[]).map(idOf).filter(Boolean))].slice(0,20);
  if (!unique.length) return [];
  const marks=unique.map(()=>'?').join(',');
  const [rows]=await db.query(`SELECT id,storage_kind,original_name,mime_type,extension,file_bytes,library_document_id,library_version_id,status
    FROM work_files
    WHERE id IN (${marks}) AND uploaded_by=? AND status IN ('draft','active')
    ORDER BY id`,[...unique,Number(userId)]);
  return rows.map(row=>({
    id:Number(row.id),
    source:row.storage_kind,
    name:row.original_name,
    mime:row.mime_type,
    extension:row.extension,
    bytes:Number(row.file_bytes||0),
    documentId:row.library_document_id?Number(row.library_document_id):null,
    versionId:row.library_version_id?Number(row.library_version_id):null,
    status:row.status
  }));
}

async function removeDraftFile({fileId,userId}) {
  await ensureWorkDispatchSchema();
  const [[row]]=await db.execute(`SELECT f.*
    FROM work_files f
    WHERE f.id=:id AND f.uploaded_by=:userId AND f.status='draft'
      AND NOT EXISTS(SELECT 1 FROM staff_task_attachments a WHERE a.work_file_id=f.id)
    LIMIT 1`,{id:Number(fileId),userId:Number(userId)});
  if (!row) return false;
  if (row.storage_kind==='uploaded' && row.stored_filename) {
    try { fs.unlinkSync(path.join(uploadDir,path.basename(row.stored_filename))); } catch (_) {}
  }
  await db.execute("UPDATE work_files SET status='deleted',updated_at=NOW() WHERE id=:id",{id:Number(fileId)});
  return true;
}

async function discardDraftFiles(userId) {
  await ensureWorkDispatchSchema();
  const [rows]=await db.execute(`SELECT f.id,f.storage_kind,f.stored_filename
    FROM work_files f
    WHERE f.uploaded_by=:userId AND f.status='draft'
      AND NOT EXISTS(SELECT 1 FROM staff_task_attachments a WHERE a.work_file_id=f.id)`,{userId:Number(userId)});
  for(const row of rows){
    if(row.storage_kind==='uploaded'&&row.stored_filename){
      try{fs.unlinkSync(path.join(uploadDir,path.basename(row.stored_filename)));}catch(_){}
    }
  }
  if(rows.length){
    await db.query(`UPDATE work_files SET status='deleted',updated_at=NOW() WHERE id IN (${rows.map(()=>'?').join(',')})`,rows.map(row=>row.id));
  }
  return rows.length;
}

function channelAvailability(channel) {
  const wanted = ['internal','email','whatsapp'].includes(String(channel)) ? String(channel) : 'internal';
  if (wanted==='internal') return {channel:wanted,available:true,configured:true,reason:null};
  const providers=notificationProviderStatus();
  const configured = wanted==='email'
    ? Boolean(providers.externalAllowed&&providers.email)
    : Boolean(providers.externalAllowed&&providers.whatsapp);
  return {
    channel:wanted,
    available:false,
    configured,
    reason:configured
      ? `${wanted==='email'?'Email':'WhatsApp'} is configured, but external Cudo dispatch is not enabled in this UAT build. Use internal Talk2Me delivery.`
      : `${wanted==='email'?'Email':'WhatsApp'} delivery is not configured for Cudo work dispatch. Use internal Talk2Me delivery.`
  };
}

function buildDispatchBody({instruction,items,requireReply,requireCompletion,attachments}) {
  const lines=[];
  if(clean(instruction,2000)) lines.push(clean(instruction,2000));
  if(Array.isArray(items)&&items.length){
    lines.push('', 'Work included:');
    items.slice(0,50).forEach((item,index)=>{
      const title=clean(item.title||'Work item',180);
      const detail=clean(item.detail||'',400);
      lines.push(`${index+1}. ${title}${detail?` — ${detail}`:''}`);
    });
  }
  if(Array.isArray(attachments)&&attachments.length){
    lines.push('',`Attachments: ${attachments.map(file=>file.name).join(', ')}`);
  }
  if(requireReply) lines.push('','Reply/update required in Talk2Me.');
  if(requireCompletion) lines.push('Complete the work and submit a completion note when done.');
  return lines.filter((line,index)=>line!==''||index>0).join('\n').slice(0,5000);
}

async function createSimpleNotification({createdBy,recipientId,title,message,priority,relatedClientId}) {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result]=await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,related_client_id,due_at,email_status)
      VALUES ('notification',:title,:message,:priority,'unread',:recipient,:creator,:clientId,NULL,'not_configured')`,{
      title,message,priority,recipient:recipientId,creator:createdBy,clientId:relatedClientId||null
    });
    const taskId=Number(result.insertId);
    await conn.execute(`INSERT INTO staff_task_workflow (task_id,workflow_state)
      VALUES (:taskId,'active') ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)`,{taskId});
    await conn.execute(`INSERT INTO staff_task_notifications
      (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
      VALUES (:taskId,:recipient,:creator,'work_dispatch',:text,0)`,{
      taskId,recipient:recipientId,creator:createdBy,text:`New work/file dispatch: ${title}`
    });
    await conn.commit();
    return {taskId};
  } catch(error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

async function createWorkDispatch({createdBy,action}) {
  await ensureWorkDispatchSchema();
  if(!action||action.type!=='work_dispatch') throw new Error('Invalid work dispatch action.');
  const recipientId=idOf(action.recipientId);
  if(!recipientId||!createdBy) throw new Error('A recipient is required.');

  const [[staff]]=await db.execute(`SELECT id,full_name,email,is_active FROM staff_users WHERE id=:id LIMIT 1`,{id:recipientId});
  if(!staff||!Number(staff.is_active)) throw new Error('The selected staff member is not active.');

  const channel=channelAvailability(action.channel);
  if(!channel.available) throw new Error(channel.reason);

  const items=Array.isArray(action.items)?action.items.slice(0,50):[];
  const attachments=await listFilesForUser(action.attachmentIds,createdBy);
  if(!items.length&&!attachments.length&&!clean(action.instruction,2000)) throw new Error('Add work, a message or an attachment before sending.');

  const requireReply=Boolean(action.requireReply);
  const requireCompletion=Boolean(action.requireCompletion);
  const dueAt=clean(action.dueAt,30)||null;
  if((requireReply||requireCompletion)&&!dueAt) throw new Error('A deadline is required when a reply or completion is requested.');
  const priority=['normal','high','urgent'].includes(action.priority)?action.priority:'normal';

  const subject=clean(action.subject,180) || (items.length
    ? `Cudo work dispatch · ${items.length} item${items.length===1?'':'s'}`
    : `Cudo file dispatch · ${attachments[0]?.name || 'message'}`).slice(0,180);

  const relatedClients=[...new Set(items.map(x=>idOf(x.clientId)).filter(Boolean))];
  const relatedClientId=relatedClients.length===1?relatedClients[0]:null;
  const message=buildDispatchBody({
    instruction:action.instruction||'Please review the work/files sent from Cudo.',
    items,requireReply,requireCompletion,attachments
  });

  let taskId;
  if(requireReply||requireCompletion){
    const created=await sendAgentInstruction({
      issuedBy:Number(createdBy),
      assignedTo:recipientId,
      title:subject,
      message,
      dueAt,
      priority
    });
    taskId=Number(created.taskId);
    if(relatedClientId){
      await db.execute('UPDATE staff_tasks SET related_client_id=:clientId WHERE id=:taskId',{clientId:relatedClientId,taskId});
    }
  }else{
    const created=await createSimpleNotification({
      createdBy:Number(createdBy),recipientId,title:subject,message,priority,relatedClientId
    });
    taskId=Number(created.taskId);
  }

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [dispatch]=await conn.execute(`INSERT INTO work_dispatches
      (created_by,recipient_staff_id,task_id,delivery_channel,subject,instruction,priority,due_at,require_reply,require_completion,status,external_status)
      VALUES (:createdBy,:recipient,:taskId,:channel,:subject,:instruction,:priority,:dueAt,:reply,:completion,'sent',:externalStatus)`,{
      createdBy:Number(createdBy),recipient:recipientId,taskId,channel:channel.channel,subject,
      instruction:clean(action.instruction,5000)||null,priority,dueAt,
      reply:requireReply?1:0,completion:requireCompletion?1:0,
      externalStatus:channel.channel==='internal'?'internal_delivered':null
    });
    const dispatchId=Number(dispatch.insertId);

    for(const item of items){
      await conn.execute(`INSERT INTO work_dispatch_items
        (dispatch_id,source_kind,source_id,related_client_id,title,detail,source_due_at)
        VALUES (:dispatchId,:sourceKind,:sourceId,:clientId,:title,:detail,:sourceDueAt)`,{
        dispatchId,
        sourceKind:clean(action.sourceKind||item.sourceKind||'item',50)||null,
        sourceId:idOf(item.id),
        clientId:idOf(item.clientId),
        title:clean(item.title||'Work item',180),
        detail:clean(item.detail,1000)||null,
        sourceDueAt:mysqlDateTime(item.dueAt)
      });
    }

    for(const file of attachments){
      await conn.execute(`INSERT INTO staff_task_attachments
        (task_id,comment_id,work_file_id,uploaded_by,original_name,stored_filename,mime_type,file_bytes)
        VALUES (:taskId,NULL,:fileId,:createdBy,:originalName,:storedFilename,:mimeType,:fileBytes)`,{
        taskId,
        fileId:Number(file.id),
        createdBy:Number(createdBy),
        originalName:safeOriginalName(file.name),
        storedFilename:`work-file-${Number(file.id)}`,
        mimeType:clean(file.mime,120)||'application/octet-stream',
        fileBytes:Number(file.bytes||0)
      });
      await conn.execute("UPDATE work_files SET status='active',updated_at=NOW() WHERE id=:id",{id:Number(file.id)});
    }

    await conn.commit();
    return {
      dispatchId,taskId,
      staffName:staff.full_name||staff.email,
      recipientId,
      dueAt,
      channel:channel.channel,
      requireReply,requireCompletion,
      itemCount:items.length,
      attachmentCount:attachments.length,
      attachments
    };
  }catch(error){
    await conn.rollback();
    throw error;
  }finally{conn.release();}
}

async function taskAttachments(taskId) {
  await ensureWorkDispatchSchema();
  const [rows]=await db.execute(`SELECT a.id attachment_id,a.work_file_id,a.original_name attachment_name,
      a.stored_filename legacy_stored_filename,a.mime_type attachment_mime,a.file_bytes attachment_bytes,a.created_at,
      f.storage_kind,f.original_name work_file_name,f.mime_type work_file_mime,f.extension,f.file_bytes work_file_bytes,
      f.library_document_id,f.library_version_id,f.status work_file_status
    FROM staff_task_attachments a
    LEFT JOIN work_files f ON f.id=a.work_file_id
    WHERE a.task_id=:taskId
    ORDER BY a.created_at,a.id`,{taskId:Number(taskId)});
  return rows
    .filter(row=>!row.work_file_id || row.work_file_status==='active')
    .map(row=>({
      id:Number(row.attachment_id),
      workFileId:row.work_file_id?Number(row.work_file_id):null,
      source:row.work_file_id ? row.storage_kind : 'legacy',
      name:row.work_file_name || row.attachment_name,
      mime:row.work_file_mime || row.attachment_mime,
      extension:row.extension || extensionOfName(row.attachment_name),
      bytes:Number(row.work_file_bytes || row.attachment_bytes || 0),
      documentId:row.library_document_id?Number(row.library_document_id):null,
      versionId:row.library_version_id?Number(row.library_version_id):null,
      createdAt:row.created_at
    }));
}

async function getTaskAttachmentDownload({taskId,fileId,user}) {
  await ensureWorkDispatchSchema();
  const manager=Boolean(user&&['owner','admin','manager'].includes(String(user.role||'').toLowerCase()));
  const [[row]]=await db.execute(`SELECT a.id attachment_id,a.work_file_id,a.original_name attachment_name,
      a.stored_filename legacy_stored_filename,a.mime_type attachment_mime,
      f.storage_kind,f.stored_filename work_stored_filename,f.original_name work_original_name,
      f.mime_type work_mime,f.library_version_id,f.status work_file_status,
      t.assigned_to,t.created_by
    FROM staff_task_attachments a
    LEFT JOIN work_files f ON f.id=a.work_file_id
    JOIN staff_tasks t ON t.id=a.task_id
    WHERE a.task_id=:taskId AND a.id=:fileId LIMIT 1`,{taskId:Number(taskId),fileId:Number(fileId)});
  if(!row) return null;
  const userId=Number(user?.id||0);
  if(!manager&&userId!==Number(row.assigned_to)&&userId!==Number(row.created_by)) return null;

  let filePath=null;
  let displayName=row.attachment_name;
  let mime=row.attachment_mime||'application/octet-stream';

  if(row.work_file_id){
    if(row.work_file_status!=='active') return null;
    displayName=row.work_original_name||displayName;
    mime=row.work_mime||mime;
    if(row.storage_kind==='uploaded'){
      filePath=path.join(uploadDir,path.basename(String(row.work_stored_filename||'')));
    }else if(row.storage_kind==='library'){
      const [[version]]=await db.execute('SELECT stored_filename FROM library_versions WHERE id=:id LIMIT 1',{id:Number(row.library_version_id)});
      if(version?.stored_filename) filePath=path.join(libraryFileDir,path.basename(version.stored_filename));
    }
  }else{
    filePath=path.join(taskAttachmentDir,path.basename(String(row.legacy_stored_filename||'')));
  }

  if(!filePath||!fs.existsSync(filePath)) return null;
  return {path:filePath,name:safeOriginalName(displayName),mime};
}

async function recentDispatchStatus({createdBy,days=7,limit=30}) {
  await ensureWorkDispatchSchema();
  const safeDays=Math.min(Math.max(Number(days)||7,1),90);
  const safeLimit=Math.min(Math.max(Number(limit)||30,1),100);
  const [rows]=await db.query(`SELECT d.id,d.subject,d.delivery_channel,d.require_reply,d.require_completion,d.created_at,
      d.due_at,d.recipient_staff_id,s.full_name staff_name,t.id task_id,t.status,t.seen_at,t.completed_at,t.completion_note,
      CASE WHEN t.status IN ('unread','seen','in_progress') AND t.due_at IS NOT NULL AND t.due_at<NOW() THEN 1 ELSE 0 END overdue,
      (SELECT COUNT(*) FROM staff_task_attachments a WHERE a.task_id=t.id) attachment_count
    FROM work_dispatches d
    JOIN staff_users s ON s.id=d.recipient_staff_id
    LEFT JOIN staff_tasks t ON t.id=d.task_id
    WHERE d.created_by=? AND d.created_at>=DATE_SUB(NOW(),INTERVAL ${safeDays} DAY)
    ORDER BY d.created_at DESC,d.id DESC LIMIT ${safeLimit}`,[Number(createdBy)]);
  return rows.map(row=>({
    id:Number(row.id),subject:row.subject,channel:row.delivery_channel,staffName:row.staff_name,
    taskId:row.task_id?Number(row.task_id):null,status:row.status,seenAt:row.seen_at,completedAt:row.completed_at,
    completionNote:row.completion_note,dueAt:row.due_at,overdue:Boolean(Number(row.overdue)),
    attachmentCount:Number(row.attachment_count||0),requireReply:Boolean(Number(row.require_reply)),
    requireCompletion:Boolean(Number(row.require_completion)),createdAt:row.created_at
  }));
}

module.exports={
  ensureWorkDispatchSchema,
  storeUploadedFile,
  searchLibraryDocuments,
  attachLibraryDocument,
  listFilesForUser,
  removeDraftFile,
  discardDraftFiles,
  channelAvailability,
  createWorkDispatch,
  taskAttachments,
  getTaskAttachmentDownload,
  recentDispatchStatus
};
