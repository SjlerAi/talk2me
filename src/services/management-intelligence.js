'use strict';

const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rangeSql } = require('./office-intelligence');
const { ensureAttendanceSchema } = require('./attendance');
const { parseImportedMessage } = require('./imported-email');
const { createTransporter, smtpConfigured, outboundEmailEnabled, talk2meSender, escapeHtml } = require('./mailer');
const { communicationStatus } = require('./staff-communications');

const ACTIVE_TASK = "('unread','seen','in_progress')";
const OPEN_INQUIRY = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const privateRoot = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();
const mailboxDir = path.join(privateRoot || '/tmp', 'management', 'mailbox');
const libraryFileDir = path.join(privateRoot || '/tmp', 'library', 'files');
let schemaReady = false;
let schemaPromise = null;

const clean = (value,max=5000) => String(value == null ? '' : value).trim().slice(0,max);
const lower = value => clean(value,5000).toLowerCase();
const safeFilename = value => path.basename(clean(value,255) || 'attachment.bin').replace(/[^a-zA-Z0-9._ -]+/g,'_').replace(/\s+/g,' ').trim() || 'attachment.bin';

function between(rangeKey='this_week') {
  const range = rangeSql(rangeKey);
  return {range,sql:`BETWEEN ${range.fromExpr} AND ${range.toExpr}`};
}

async function ensureManagementSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise=(async()=>{
    await ensureAttendanceSchema();
    if (privateRoot) {
      fs.mkdirSync(mailboxDir,{recursive:true,mode:0o700});
      fs.mkdirSync(libraryFileDir,{recursive:true,mode:0o700});
    }
    await db.query(`CREATE TABLE IF NOT EXISTS management_intelligence_config (
      id TINYINT UNSIGNED NOT NULL,
      timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Johannesburg',
      attendance_reminder_enabled TINYINT(1) NOT NULL DEFAULT 1,
      attendance_reminder_time TIME NOT NULL DEFAULT '09:00:00',
      unfinished_task_reminder_enabled TINYINT(1) NOT NULL DEFAULT 1,
      unfinished_task_reminder_time TIME NOT NULL DEFAULT '16:00:00',
      weekly_stats_reminder_enabled TINYINT(1) NOT NULL DEFAULT 1,
      weekly_stats_reminder_day TINYINT UNSIGNED NOT NULL DEFAULT 3,
      weekly_stats_reminder_time TIME NOT NULL DEFAULT '15:30:00',
      weekly_owner_report_enabled TINYINT(1) NOT NULL DEFAULT 1,
      weekly_owner_report_time TIME NOT NULL DEFAULT '17:00:00',
      morning_mailbox_summary_enabled TINYINT(1) NOT NULL DEFAULT 1,
      morning_mailbox_summary_time TIME NOT NULL DEFAULT '07:00:00',
      updated_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.query("INSERT INTO management_intelligence_config (id,timezone) VALUES (1,'Africa/Johannesburg') ON DUPLICATE KEY UPDATE id=VALUES(id)");

    await db.query(`CREATE TABLE IF NOT EXISTS management_notification_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_key VARCHAR(180) NOT NULL,
      event_type VARCHAR(60) NOT NULL,
      recipient_staff_id BIGINT UNSIGNED NULL,
      recipient_email VARCHAR(255) NULL,
      channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
      subject VARCHAR(255) NOT NULL,
      body_text TEXT NULL,
      status ENUM('pending','queued','sent','skipped','failed') NOT NULL DEFAULT 'pending',
      provider_message_id VARCHAR(255) NULL,
      error_message VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME NULL,
      PRIMARY KEY(id),
      UNIQUE KEY uq_management_event(event_key,recipient_staff_id,channel),
      KEY idx_management_event_status(status,created_at),
      KEY idx_management_event_staff(recipient_staff_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS management_mailbox_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_provider VARCHAR(40) NOT NULL DEFAULT 'manual',
      external_id VARCHAR(255) NULL,
      original_from VARCHAR(500) NULL,
      subject VARCHAR(500) NULL,
      body_text MEDIUMTEXT NULL,
      received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      imported_by BIGINT UNSIGNED NULL,
      is_dealsheet TINYINT(1) NOT NULL DEFAULT 0,
      dealsheet_name VARCHAR(255) NULL,
      status ENUM('new','reviewed','saved_to_deals','forwarded','ignored') NOT NULL DEFAULT 'new',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uq_management_mailbox_external(source_provider,external_id),
      KEY idx_management_mailbox_received(received_at,status),
      KEY idx_management_mailbox_dealsheet(is_dealsheet,status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS management_mailbox_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      mailbox_item_id BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(140) NULL,
      file_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      saved_library_document_id BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      KEY idx_management_mailbox_attachment_item(mailbox_item_id),
      KEY idx_management_mailbox_attachment_library(saved_library_document_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS management_weekly_stats (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      week_start DATE NOT NULL,
      staff_id BIGINT UNSIGNED NOT NULL,
      submitted_at DATETIME NULL,
      submitted_by BIGINT UNSIGNED NULL,
      note VARCHAR(1000) NULL,
      snapshot_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id),
      UNIQUE KEY uq_management_weekly_stats(week_start,staff_id),
      KEY idx_management_weekly_staff(staff_id,week_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    schemaReady=true;
  })().finally(()=>{schemaPromise=null;});
  return schemaPromise;
}

async function staffPerformance(rangeKey='this_week') {
  await ensureManagementSchema();
  const {range,sql}=between(rangeKey);
  const [rows]=await db.execute(`SELECT
    su.id,COALESCE(NULLIF(su.full_name,''),NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''),su.email) staff_name,su.email,su.contact_number,su.role,
    COUNT(DISTINCT CASE WHEN ca.is_active=1 THEN c.id END) clients_total,
    COUNT(DISTINCT CASE WHEN ca.is_active=1 AND COALESCE(c.email,'')<>'' AND COALESCE(c.id_number,'')<>'' THEN c.id END) clients_complete,
    COUNT(DISTINCT CASE WHEN ca.is_active=1 AND COALESCE(c.email,'')='' THEN c.id END) clients_missing_email,
    COUNT(DISTINCT CASE WHEN ca.is_active=1 AND COALESCE(c.id_number,'')='' THEN c.id END) clients_missing_id,
    (SELECT COUNT(*) FROM clients nc WHERE nc.created_by_staff_id=su.id AND nc.created_at ${sql}) clients_added,
    (SELECT COUNT(*) FROM audit_log al WHERE al.staff_id=su.id AND al.entity_type='clients'
      AND al.action_type IN ('customer_details_updated','prospect_converted_to_client') AND al.created_at ${sql}) clients_updated,
    (SELECT COUNT(*) FROM staff_tasks t WHERE t.created_by=su.id AND t.created_at ${sql}) tasks_given,
    (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.created_at ${sql}) tasks_received,
    (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.completed_at ${sql}) tasks_completed
    FROM staff_users su
    LEFT JOIN client_assignments ca ON ca.assigned_staff_id=su.id AND ca.is_active=1
    LEFT JOIN clients c ON c.id=ca.client_id AND c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
    WHERE su.is_active=1
    GROUP BY su.id,staff_name,su.email,su.role
    ORDER BY staff_name`);
  const numberFields=['clients_total','clients_complete','clients_missing_email','clients_missing_id','clients_added','clients_updated','tasks_given','tasks_received','tasks_completed'];
  return {range,rows:rows.map(row=>{for(const key of numberFields) row[key]=Number(row[key]||0);return row;})};
}

async function queryIntelligence(rangeKey='this_week') {
  await ensureManagementSchema();
  const {range,sql}=between(rangeKey);
  const [top]=await db.execute(`SELECT LEFT(TRIM(COALESCE(NULLIF(query_text,''),'Unspecified query')),220) query_name,
    COUNT(*) query_count,
    SUM(TIMESTAMPDIFF(MINUTE,created_at,COALESCE(completed_at,updated_at,NOW()))) total_minutes,
    AVG(TIMESTAMPDIFF(MINUTE,created_at,COALESCE(completed_at,updated_at,NOW()))) avg_minutes,
    SUM(CASE WHEN status IN ${OPEN_INQUIRY} THEN 1 ELSE 0 END) open_count
    FROM inquiries WHERE created_at ${sql}
    GROUP BY query_name ORDER BY total_minutes DESC,query_count DESC LIMIT 12`);
  const [stalled]=await db.execute(`SELECT i.id,
    COALESCE(NULLIF(i.client_name,''),NULLIF(i.cell_number,''),'Inquiry') client_name,i.query_text,i.status,
    TIMESTAMPDIFF(HOUR,COALESCE(i.updated_at,i.created_at),NOW()) hours_without_progress,
    COALESCE(NULLIF(s.full_name,''),s.email,'Unassigned') staff_name
    FROM inquiries i LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
    WHERE i.status IN ${OPEN_INQUIRY} AND COALESCE(i.updated_at,i.created_at)<DATE_SUB(NOW(),INTERVAL 24 HOUR)
    ORDER BY hours_without_progress DESC,i.created_at ASC LIMIT 30`);
  return {
    range,
    top:top.map(row=>({...row,query_count:Number(row.query_count||0),total_minutes:Number(row.total_minutes||0),avg_minutes:Math.round(Number(row.avg_minutes||0)),open_count:Number(row.open_count||0)})),
    stalled:stalled.map(row=>({...row,hours_without_progress:Number(row.hours_without_progress||0)}))
  };
}

async function commercialIntelligence() {
  await ensureManagementSchema();
  const [packages]=await db.query(`SELECT COALESCE(NULLIF(TRIM(package_name),''),'Unknown') package_name,COUNT(*) client_lines
    FROM clients WHERE is_active=1 AND COALESCE(line_status,'active')<>'cancelled'
    GROUP BY COALESCE(NULLIF(TRIM(package_name),''),'Unknown') ORDER BY client_lines DESC LIMIT 15`);
  const [towns]=await db.query(`SELECT
    COALESCE(NULLIF(NULLIF(LOWER(TRIM(city_town)),'null'),''),'Unknown') city_town_key,
    CASE
      WHEN NULLIF(NULLIF(LOWER(TRIM(city_town)),'null'),'') IS NULL THEN 'Unknown'
      ELSE MAX(TRIM(city_town))
    END city_town,
    COUNT(*) clients,
    SUM(CASE WHEN next_upgrade_date IS NOT NULL AND DATE(next_upgrade_date)<=CURRENT_DATE() THEN 1 ELSE 0 END) due_upgrades,
    SUM(CASE WHEN COALESCE(email,'')='' OR COALESCE(id_number,'')='' THEN 1 ELSE 0 END) incomplete_records
    FROM clients WHERE is_active=1 AND COALESCE(line_status,'active')<>'cancelled'
    GROUP BY COALESCE(NULLIF(NULLIF(LOWER(TRIM(city_town)),'null'),''),'Unknown')
    ORDER BY clients DESC LIMIT 20`);
  const packageRows=packages.map(row=>({...row,client_lines:Number(row.client_lines||0)}));
  const townRows=towns.map(row=>({...row,clients:Number(row.clients||0),due_upgrades:Number(row.due_upgrades||0),incomplete_records:Number(row.incomplete_records||0)}));
  const focus=townRows
    .filter(row=>String(row.city_town||'').toLowerCase()!=='unknown')
    .map(row=>({...row,focus_score:row.due_upgrades*3+row.incomplete_records}))
    .sort((a,b)=>b.focus_score-a.focus_score||b.clients-a.clients)
    .slice(0,10);
  return {packages:packageRows,towns:townRows,focus};
}

function mailboxProviderStatus() {
  const provider=clean(process.env.MANAGEMENT_MAILBOX_PROVIDER||'',40).toLowerCase();
  const connected=Boolean(provider==='imap'&&process.env.MANAGEMENT_IMAP_HOST&&process.env.MANAGEMENT_IMAP_USER&&process.env.MANAGEMENT_IMAP_PASSWORD);
  return {
    provider:provider||'manual-import',
    connected,
    automaticReading:connected,
    manualImport:true,
    note:connected?'Automatic mailbox credentials are configured.':'Automatic mailbox credentials are not configured in this environment. .eml import is available for testing.'
  };
}

function notificationProviderStatus() {
  const status=communicationStatus();
  return {
    email:Boolean(status.email.readyProfiles.length),
    emailProfiles:status.email.profiles,
    whatsapp:Boolean(status.whatsapp.ready),
    whatsappProvider:status.whatsapp.provider,
    externalAllowed:Boolean(status.externalEnabled)
  };
}

async function automationStatus() {
  await ensureManagementSchema();
  const [[config]]=await db.query('SELECT * FROM management_intelligence_config WHERE id=1');
  return {config,providers:notificationProviderStatus(),mailbox:mailboxProviderStatus()};
}

async function recentMailbox({days=2,limit=40}={}) {
  await ensureManagementSchema();
  const safeDays=Math.max(1,Math.min(30,Number(days||2)));
  const safeLimit=Math.max(1,Math.min(100,Number(limit||40)));
  const [rows]=await db.query(`SELECT m.*,
    (SELECT COUNT(*) FROM management_mailbox_attachments a WHERE a.mailbox_item_id=m.id) attachment_count,
    (SELECT COUNT(*) FROM management_mailbox_attachments a WHERE a.mailbox_item_id=m.id AND a.saved_library_document_id IS NOT NULL) saved_attachment_count
    FROM management_mailbox_items m WHERE m.received_at>=DATE_SUB(NOW(),INTERVAL ${safeDays} DAY)
    ORDER BY m.received_at DESC,m.id DESC LIMIT ${safeLimit}`);
  return rows.map(row=>({...row,attachment_count:Number(row.attachment_count||0),saved_attachment_count:Number(row.saved_attachment_count||0)}));
}

function detectDealsheet(imported) {
  const haystack=lower([imported?.subject,imported?.originalFrom,imported?.text].filter(Boolean).join(' '));
  return /\b(vodacom|chatz)\b/.test(haystack)&&(/\bdeal\s*sheet\b|\bdealsheet\b|\bdeal\b/.test(haystack));
}
function dealsheetName(imported) { return clean(imported?.subject||imported?.attachments?.[0]?.filename||'New dealsheet',255); }

async function importMailboxFile({file,userId=null}) {
  await ensureManagementSchema();
  if(!file?.buffer) throw new Error('Choose an .eml or HTML email file.');
  const imported=parseImportedMessage(file);
  const hash=crypto.createHash('sha1').update(file.buffer).digest('hex');
  const externalId=`manual:${hash}`;
  let itemId;
  try {
    const [result]=await db.execute(`INSERT INTO management_mailbox_items
      (source_provider,external_id,original_from,subject,body_text,received_at,imported_by,is_dealsheet,dealsheet_name,status)
      VALUES ('manual',:externalId,:from,:subject,:body,NOW(),:userId,:isDealsheet,:name,'new')`,{
      externalId,from:clean(imported.originalFrom,500)||null,subject:clean(imported.subject,500)||null,
      body:clean(imported.text,200000)||null,userId:Number(userId||0)||null,
      isDealsheet:detectDealsheet(imported)?1:0,name:detectDealsheet(imported)?dealsheetName(imported):null
    });
    itemId=Number(result.insertId);
  } catch(error) {
    if(error?.code!=='ER_DUP_ENTRY') throw error;
    const [[existing]]=await db.execute("SELECT id FROM management_mailbox_items WHERE source_provider='manual' AND external_id=:externalId LIMIT 1",{externalId});
    itemId=Number(existing?.id||0);
  }
  if(!itemId) throw new Error('The mailbox item could not be stored.');
  const [[countRow]]=await db.execute('SELECT COUNT(*) total FROM management_mailbox_attachments WHERE mailbox_item_id=:id',{id:itemId});
  if(!Number(countRow?.total||0)) {
    for(const att of imported.attachments||[]) {
      const originalName=safeFilename(att.filename);
      const ext=path.extname(originalName);
      const stored=`${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
      const buffer=Buffer.from(att.content,'base64');
      fs.writeFileSync(path.join(mailboxDir,stored),buffer,{mode:0o600});
      await db.execute(`INSERT INTO management_mailbox_attachments
        (mailbox_item_id,original_name,stored_filename,mime_type,file_bytes)
        VALUES (:itemId,:originalName,:stored,:mime,:bytes)`,{
        itemId,originalName,stored,mime:clean(att.contentType,140)||null,bytes:buffer.length
      });
    }
  }
  return {itemId,isDealsheet:detectDealsheet(imported),dealsheetName:detectDealsheet(imported)?dealsheetName(imported):null,attachmentCount:(imported.attachments||[]).length};
}

async function ensureLibrarySchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS library_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,title VARCHAR(180) NOT NULL,description TEXT NULL,category VARCHAR(80) NOT NULL DEFAULT 'Other',
    access_level VARCHAR(30) NOT NULL DEFAULT 'all',company_favourite TINYINT(1) NOT NULL DEFAULT 0,status VARCHAR(30) NOT NULL DEFAULT 'active',
    current_version_id BIGINT UNSIGNED NULL,created_by BIGINT UNSIGNED NOT NULL,updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id),KEY idx_library_documents_status(status,category,updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS library_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,document_id BIGINT UNSIGNED NOT NULL,version_number INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,stored_filename VARCHAR(255) NOT NULL,mime_type VARCHAR(140) NOT NULL,extension VARCHAR(20) NOT NULL,
    file_bytes BIGINT UNSIGNED NOT NULL,uploaded_by BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),UNIQUE KEY uq_library_version(document_id,version_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function saveMailboxAttachmentsToDeals({itemId,userId}) {
  await ensureManagementSchema(); await ensureLibrarySchema();
  const [[item]]=await db.execute('SELECT * FROM management_mailbox_items WHERE id=:id LIMIT 1',{id:Number(itemId)});
  if(!item) throw new Error('Mailbox item not found.');
  const [attachments]=await db.execute('SELECT * FROM management_mailbox_attachments WHERE mailbox_item_id=:id ORDER BY id',{id:Number(itemId)});
  let saved=0;
  for(const att of attachments) {
    if(att.saved_library_document_id) continue;
    const source=path.join(mailboxDir,path.basename(att.stored_filename));
    if(!fs.existsSync(source)) continue;
    const ext=path.extname(att.original_name).toLowerCase();
    const stored=`${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.copyFileSync(source,path.join(libraryFileDir,stored));
    const [doc]=await db.execute(`INSERT INTO library_documents
      (title,description,category,access_level,company_favourite,status,created_by,updated_by)
      VALUES (:title,:description,'Deals','all',1,'active',:userId,:userId)`,{
      title:clean(item.dealsheet_name||item.subject||path.parse(att.original_name).name,180)||'Dealsheet',
      description:`Saved by Gerda mailbox workflow from ${clean(item.original_from,220)||'email'}`,userId:Number(userId)
    });
    const [version]=await db.execute(`INSERT INTO library_versions
      (document_id,version_number,original_name,stored_filename,mime_type,extension,file_bytes,uploaded_by)
      VALUES (:documentId,1,:originalName,:stored,:mime,:extension,:bytes,:userId)`,{
      documentId:doc.insertId,originalName:att.original_name,stored,mime:clean(att.mime_type,140)||'application/octet-stream',
      extension:ext,bytes:Number(att.file_bytes||0),userId:Number(userId)
    });
    await db.execute('UPDATE library_documents SET current_version_id=:versionId WHERE id=:id',{versionId:version.insertId,id:doc.insertId});
    await db.execute('UPDATE management_mailbox_attachments SET saved_library_document_id=:docId WHERE id=:id',{docId:doc.insertId,id:att.id});
    saved++;
  }
  await db.execute("UPDATE management_mailbox_items SET status='saved_to_deals',updated_at=NOW() WHERE id=:id",{id:Number(itemId)});
  return {saved,item};
}

async function reserveNotification({eventKey,eventType,staffId,email,channel,subject,body}) {
  try {
    const [result]=await db.execute(`INSERT INTO management_notification_events
      (event_key,event_type,recipient_staff_id,recipient_email,channel,subject,body_text,status)
      VALUES (:eventKey,:eventType,:staffId,:email,:channel,:subject,:body,'pending')`,{
      eventKey:clean(eventKey,180),eventType:clean(eventType,60),staffId:Number(staffId||0)||null,
      email:clean(email,255)||null,channel:clean(channel,30),subject:clean(subject,255),body:clean(body,10000)||null
    });
    return Number(result.insertId);
  } catch(error) { if(error?.code==='ER_DUP_ENTRY') return null; throw error; }
}
async function genericEmail({to,subject,body}) {
  const p=notificationProviderStatus();
  if(!p.externalAllowed) return {sent:false,error:'External management notifications are disabled.'};
  if(!outboundEmailEnabled()||!smtpConfigured()) return {sent:false,error:'SMTP is not configured.'};
  try {
    const info=await createTransporter().sendMail({from:talk2meSender(),to,subject,text:body,html:`<h2>${escapeHtml(subject)}</h2><p style="white-space:pre-wrap">${escapeHtml(body)}</p>`});
    return {sent:true,messageId:info.messageId||null};
  } catch(error){return {sent:false,error:error.message};}
}
async function notifyStaff({eventKey,eventType,staff,subject,body}) {
  for(const channel of ['in_app','email']) {
    const id=await reserveNotification({eventKey,eventType,staffId:staff.id,email:staff.email,channel,subject,body});
    if(!id) continue;
    if(channel==='in_app') {
      await db.execute("UPDATE management_notification_events SET status='sent',sent_at=NOW() WHERE id=:id",{id});
    } else {
      const result=await genericEmail({to:staff.email,subject,body});
      await db.execute(`UPDATE management_notification_events SET status=:status,provider_message_id=:messageId,error_message=:error,
        sent_at=CASE WHEN :sent=1 THEN NOW() ELSE sent_at END WHERE id=:id`,{
        status:result.sent?'sent':'queued',messageId:result.messageId||null,error:result.sent?null:clean(result.error,500),sent:result.sent?1:0,id
      });
    }
  }
}
async function notifyDealsheetAvailable({itemId}) {
  await ensureManagementSchema();
  const [[item]]=await db.execute('SELECT * FROM management_mailbox_items WHERE id=:id LIMIT 1',{id:Number(itemId)});
  if(!item) throw new Error('Mailbox item not found.');
  const [staff]=await db.query('SELECT id,full_name,email FROM staff_users WHERE is_active=1 ORDER BY full_name');
  const name=item.dealsheet_name||item.subject||'New dealsheet';
  for(const person of staff) await notifyStaff({
    eventKey:`dealsheet:${item.id}`,eventType:'dealsheet_available',staff:person,
    subject:`New dealsheet available: ${name}`,body:`The new dealsheet "${name}" is now available in Talk2Me Deals.`
  });
  await db.execute("UPDATE management_mailbox_items SET status='forwarded',updated_at=NOW() WHERE id=:id",{id:Number(itemId)});
  return {staffCount:staff.length,name};
}

async function shareMailboxItemWithStaff({itemId,staffId}) {
  await ensureManagementSchema();
  const [[item]]=await db.execute('SELECT * FROM management_mailbox_items WHERE id=:id LIMIT 1',{id:Number(itemId)});
  if(!item) throw new Error('Mailbox item not found.');
  const [[staff]]=await db.execute('SELECT id,full_name,email,role FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',{id:Number(staffId)});
  if(!staff) throw new Error('Active staff member not found.');
  const [[attachments]]=await db.execute(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN saved_library_document_id IS NOT NULL THEN 1 ELSE 0 END) saved
    FROM management_mailbox_attachments WHERE mailbox_item_id=:id`,{id:Number(itemId)});
  const subject=`Gerda shared: ${item.subject||item.dealsheet_name||'Email item'}`;
  const details=[
    `From: ${item.original_from||'Unknown sender'}`,
    item.is_dealsheet ? `Dealsheet: ${item.dealsheet_name||item.subject||'Yes'}` : null,
    Number(attachments?.total||0) ? `Attachments: ${Number(attachments.total||0)}${Number(attachments.saved||0)?` (${Number(attachments.saved||0)} saved in CRM Deals)`:''}` : null,
    '',
    clean(item.body_text,3500)||'(No readable email body)'
  ].filter(value=>value!==null).join('\n');
  await notifyStaff({
    eventKey:`mailbox-share:${Number(itemId)}:${Number(staffId)}`,
    eventType:'mailbox_item_shared',
    staff,
    subject,
    body:details
  });
  await db.execute("UPDATE management_mailbox_items SET status='forwarded',updated_at=NOW() WHERE id=:id",{id:Number(itemId)});
  return {itemId:Number(itemId),staffId:Number(staffId),staffName:staff.full_name||staff.email,subject};
}

async function weeklyStatsStatus() {
  await ensureManagementSchema();
  const [rows]=await db.query(`SELECT su.id,COALESCE(NULLIF(su.full_name,''),su.email) staff_name,ws.submitted_at,ws.note
    FROM staff_users su LEFT JOIN management_weekly_stats ws
      ON ws.staff_id=su.id AND ws.week_start=DATE_SUB(CURRENT_DATE(),INTERVAL WEEKDAY(CURRENT_DATE()) DAY)
    WHERE su.is_active=1 ORDER BY su.full_name`);
  return rows;
}
async function submitWeeklyStats({staffId,submittedBy,note}) {
  const perf=await staffPerformance('this_week');
  const row=perf.rows.find(x=>Number(x.id)===Number(staffId));
  if(!row) throw new Error('Active staff member not found.');
  await db.execute(`INSERT INTO management_weekly_stats (week_start,staff_id,submitted_at,submitted_by,note,snapshot_json)
    VALUES (DATE_SUB(CURRENT_DATE(),INTERVAL WEEKDAY(CURRENT_DATE()) DAY),:staffId,NOW(),:submittedBy,:note,:snapshot)
    ON DUPLICATE KEY UPDATE submitted_at=NOW(),submitted_by=VALUES(submitted_by),note=VALUES(note),snapshot_json=VALUES(snapshot_json),updated_at=NOW()`,{
    staffId:Number(staffId),submittedBy:Number(submittedBy||staffId),note:clean(note,1000)||null,snapshot:JSON.stringify(row)
  });
  return row;
}

async function runAutomation(mode) {
  await ensureManagementSchema();
  const today=new Date().toISOString().slice(0,10);
  const [staff]=await db.query('SELECT id,full_name,email,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
  if(mode==='attendance-0900') {
    const [missing]=await db.query(`SELECT su.id,su.full_name,su.email,su.role FROM staff_users su
      WHERE su.is_active=1 AND WEEKDAY(CURRENT_DATE()) BETWEEN 0 AND 4
      AND NOT EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.staff_id=su.id AND a.work_date=CURRENT_DATE())
      AND NOT EXISTS(SELECT 1 FROM staff_leave_records l WHERE l.staff_id=su.id AND l.status='approved' AND CURRENT_DATE() BETWEEN l.start_date AND l.end_date)`);
    for(const person of missing) await notifyStaff({eventKey:`attendance-0900:${today}`,eventType:'attendance_missing',staff:person,
      subject:'Talk2Me attendance reminder',body:'You have not clocked in to Talk2Me by 09:00 today. Please log in or contact management if you are not working today.'});
    return {mode,count:missing.length};
  }
  if(mode==='tasks-1600') {
    let notified=0;
    for(const person of staff) {
      const [[summary]]=await db.execute(`SELECT COUNT(*) open_count FROM staff_tasks WHERE assigned_to=:id AND status IN ${ACTIVE_TASK}
        AND (due_at IS NULL OR DATE(due_at)<=CURRENT_DATE())`,{id:person.id});
      const count=Number(summary?.open_count||0); if(!count) continue; notified++;
      await notifyStaff({eventKey:`tasks-1600:${today}`,eventType:'unfinished_tasks',staff:person,
        subject:`Talk2Me: ${count} task${count===1?'':'s'} still open`,body:`You still have ${count} task${count===1?'':'s'} for today that are not completed. Please review them before close of business.`});
    }
    return {mode,count:notified};
  }
  if(mode==='weekly-reminder-1530') {
    const status=await weeklyStatsStatus(); const missing=status.filter(x=>!x.submitted_at);
    for(const row of missing) { const person=staff.find(x=>Number(x.id)===Number(row.id)); if(person) await notifyStaff({
      eventKey:`weekly-stats:${today}`,eventType:'weekly_stats_reminder',staff:person,
      subject:'Update your Talk2Me weekly stats',body:`Please review and submit your weekly statistics in Talk2Me before 17:00 today. Open: ${String(process.env.APP_URL||'').replace(/\/$/,'')}/weekly-stats`
    });}
    return {mode,count:missing.length};
  }
  if(mode==='weekly-report-1700') {
    const status=await weeklyStatsStatus(); const perf=await staffPerformance('this_week'); const owners=staff.filter(x=>['owner','manager'].includes(String(x.role||'').toLowerCase()));
    const submitted=status.filter(x=>x.submitted_at).length;
    const body=[`Weekly stats submitted: ${submitted}/${status.length}`,'',...perf.rows.map(x=>`${x.staff_name}: clients ${x.clients_total}, complete ${x.clients_complete}, tasks received ${x.tasks_received}, completed ${x.tasks_completed}`)].join('\n');
    for(const owner of owners) await notifyStaff({eventKey:`weekly-report:${today}`,eventType:'weekly_owner_report',staff:owner,subject:'Talk2Me weekly staff statistics',body});
    return {mode,count:owners.length,submitted,total:status.length};
  }
  if(mode==='morning-mailbox') {
    const [items]=await db.query(`SELECT id,subject,original_from,is_dealsheet FROM management_mailbox_items WHERE DATE(received_at)=DATE_SUB(CURRENT_DATE(),INTERVAL 1 DAY) ORDER BY received_at DESC`);
    const owners=staff.filter(x=>['owner','manager'].includes(String(x.role||'').toLowerCase()));
    const body=items.length?items.map((x,i)=>`${i+1}. ${x.subject||'(no subject)'} — ${x.original_from||'unknown sender'}${x.is_dealsheet?' [DEALSHEET]':''}`).join('\n'):'No mailbox items were imported for yesterday.';
    for(const owner of owners) await notifyStaff({eventKey:`mailbox-summary:${today}`,eventType:'mailbox_summary',staff:owner,subject:'Talk2Me previous-day mailbox summary',body});
    return {mode,count:items.length,owners:owners.length};
  }
  throw new Error('Unknown management automation mode.');
}

async function buildManagementOverview(rangeKey='this_week') {
  const [performance,queries,commercial,automations,mailbox,weekly]=await Promise.all([
    staffPerformance(rangeKey),queryIntelligence(rangeKey),commercialIntelligence(),automationStatus(),recentMailbox({days:2,limit:30}),weeklyStatsStatus()
  ]);
  const totals=performance.rows.reduce((a,x)=>({
    clients:a.clients+x.clients_total,complete:a.complete+x.clients_complete,missingEmail:a.missingEmail+x.clients_missing_email,
    missingId:a.missingId+x.clients_missing_id,tasksReceived:a.tasksReceived+x.tasks_received,tasksCompleted:a.tasksCompleted+x.tasks_completed
  }),{clients:0,complete:0,missingEmail:0,missingId:0,tasksReceived:0,tasksCompleted:0});
  return {range:performance.range,totals,staff:performance.rows,queries,commercial,automations,mailbox,weekly};
}

async function answerManagementQuestion(message,{staffId=null}={}) {
  const q=lower(message);
  const overview=await buildManagementOverview(/today/.test(q)?'today':/month/.test(q)?'month_to_date':'this_week');
  const staff=staffId?overview.staff.find(x=>Number(x.id)===Number(staffId)):null;
  if(/\b(?:how many|number of).*\bclients?\b|\bclients?\s+(?:does|has|have)\b|\bcomplete\s+clients?\b|missing\s+(?:email|e-mail|id|identity)/.test(q)) {
    const rows=staff?[staff]:overview.staff;
    const text=staff?`${staff.staff_name} has ${staff.clients_total} allocated active clients. ${staff.clients_complete} have both email and ID number; ${staff.clients_missing_email} are missing email and ${staff.clients_missing_id} are missing ID number.`:
      `Across active staff allocations there are ${overview.totals.clients} client assignments represented. ${overview.totals.complete} records have both email and ID; ${overview.totals.missingEmail} are missing email and ${overview.totals.missingId} are missing ID number.`;
    return {intent:'management_staff_stats',text,rows:rows.slice(0,20).map(x=>({id:x.id,title:x.staff_name,detail:`${x.clients_total} clients · ${x.clients_complete} complete`,meta:`${x.clients_missing_email} missing email · ${x.clients_missing_id} missing ID`})),evidence:{summary:'Checked staff_users, client_assignments and clients.',sources:['staff_users','client_assignments','clients']}};
  }
  if(/\bclients?\b.*\b(?:updated|added|new)\b|\b(?:updated|added)\b.*\bclients?\b|\btasks?\b.*\b(?:given|received|completed|done)\b/.test(q)) {
    const rows=staff?[staff]:overview.staff;
    return {intent:'management_staff_activity',text:staff?`${staff.staff_name} added ${staff.clients_added} clients and updated ${staff.clients_updated} client records in ${overview.range.label}. They gave ${staff.tasks_given} tasks, received ${staff.tasks_received}, and completed ${staff.tasks_completed}.`:`I checked staff client updates and task activity for ${overview.range.label}.`,rows:rows.slice(0,20).map(x=>({id:x.id,title:x.staff_name,detail:`Clients +${x.clients_added} · updated ${x.clients_updated}`,meta:`Tasks given ${x.tasks_given} · received ${x.tasks_received} · completed ${x.tasks_completed}`})),evidence:{summary:'Checked clients, audit_log and staff_tasks.',sources:['clients','audit_log','staff_tasks']}};
  }
  if(/\bqueries?\b.*(?:time|longest|most)|(?:most|longest).*\bqueries?\b/.test(q)) {
    const top=overview.queries.top;
    return {intent:'management_query_time',text:top.length?`The query type consuming the most recorded elapsed time in ${overview.range.label} is “${top[0].query_name}” at about ${Math.round(top[0].total_minutes/60)} hours across ${top[0].query_count} records.`:'No query records were available for this period.',rows:top.map((x,i)=>({id:i+1,title:x.query_name,detail:`${x.query_count} queries · ${x.open_count} open`,meta:`~${Math.round(x.total_minutes/60)} total hours`})),evidence:{summary:'Calculated elapsed inquiry time from CRM timestamps.',sources:['inquiries']}};
  }
  if(/\bqueries?\b.*(?:no progress|stuck|stalled|nothing happening)|(?:stuck|stalled).*\bqueries?\b/.test(q)) {
    const rows=overview.queries.stalled;
    return {intent:'management_stalled_queries',text:rows.length?`${rows.length} open queries have had no recorded update for at least 24 hours.`:'I found no open queries without a recorded update for 24 hours or more.',rows:rows.slice(0,20).map(x=>({id:x.id,title:x.client_name,detail:x.query_text||x.status,meta:`${x.staff_name} · ${x.hours_without_progress}h without progress`})),evidence:{summary:'Checked open inquiries and last update time.',sources:['inquiries','staff_users']}};
  }
  if(/\bpackage\b/.test(q)&&/\b(?:most|top|written|sold|popular)\b/.test(q)) {
    const top=overview.commercial.packages[0];
    return {intent:'management_packages',text:top?`The most common active package in the CRM is “${top.package_name}” with ${top.client_lines} active client lines.`:'No package data is available.',rows:overview.commercial.packages.map((x,i)=>({id:i+1,title:x.package_name,detail:`${x.client_lines} active client lines`,meta:''})),evidence:{summary:'Counted active clients by package_name.',sources:['clients']}};
  }
  if(/\b(?:town|towns|area|areas|where).*\bclients?\b|\bwhere\s+are\s+our\s+clients?\b/.test(q)) {
    const unknown=overview.commercial.towns.find(x=>String(x.city_town||'').toLowerCase()==='unknown');
    const recorded=overview.commercial.towns.filter(x=>String(x.city_town||'').toLowerCase()!=='unknown');
    const top=recorded[0];
    const missing=Number(unknown?.clients||0);
    const text=top
      ? `${missing ? `${missing} active clients do not have a usable town recorded. ` : ''}Among clients with a recorded town, ${top.city_town} has the largest concentration with ${top.clients} clients.`
      : missing
        ? `${missing} active clients do not have a usable town recorded, so I cannot rank actual towns yet.`
        : 'No town/area data is available.';
    return {intent:'management_towns',text,rows:overview.commercial.towns.map((x,i)=>({id:i+1,title:x.city_town,detail:`${x.clients} clients`,meta:`${x.due_upgrades} due upgrades · ${x.incomplete_records} incomplete`})),evidence:{summary:'Grouped active clients by city_town and separated missing/unknown town data from actual towns.',sources:['clients']}};
  }
  if(/\b(?:focus|opportunity|opportunities|where should we focus)\b/.test(q)) {
    const rows=overview.commercial.focus;
    return {intent:'management_focus',text:rows.length?`The strongest current CRM focus signal is ${rows[0].city_town}, based on due upgrades and incomplete records.`:'I do not have enough data to rank focus areas.',rows:rows.map((x,i)=>({id:i+1,title:x.city_town,detail:`${x.clients} clients · ${x.due_upgrades} due upgrades`,meta:`${x.incomplete_records} incomplete records`})),evidence:{summary:'Operational focus score uses due upgrades and incomplete client records; it is not a market-size forecast.',sources:['clients']}};
  }
  if(/\b(?:mailbox|email summary|emails? yesterday|dealsheet|deal sheet)\b/.test(q)) {
    const deals=overview.mailbox.filter(x=>Number(x.is_dealsheet));
    return {intent:'management_mailbox',text:`${overview.mailbox.length} recent mailbox items are in Gerda's queue; ${deals.length} are flagged as Chatz/Vodacom dealsheets. ${overview.automations.mailbox.note}`,rows:overview.mailbox.slice(0,20).map(x=>({id:x.id,title:x.subject||'(no subject)',detail:x.original_from||'Unknown sender',meta:x.is_dealsheet?'Dealsheet':x.status})),evidence:{summary:'Checked management mailbox queue and provider status.',sources:['management_mailbox_items','management_mailbox_attachments']}};
  }
  return {intent:'management_overview',text:`Gerda management intelligence is connected. I checked staff client quality, task activity, query workload, package/town data, mailbox queue and automation status for ${overview.range.label}.`,rows:[
    {id:1,title:'Client records',detail:`${overview.totals.clients} allocated · ${overview.totals.complete} complete`,meta:`${overview.totals.missingEmail} missing email · ${overview.totals.missingId} missing ID`},
    {id:2,title:'Tasks',detail:`${overview.totals.tasksCompleted}/${overview.totals.tasksReceived} completed`,meta:'Across active staff'},
    {id:3,title:'Stalled queries',detail:`${overview.queries.stalled.length} with no update for 24h+`,meta:'Open inquiries'},
    {id:4,title:'Mailbox',detail:`${overview.mailbox.length} recent items`,meta:overview.automations.mailbox.connected?'Connected':'Manual import mode'}
  ],evidence:{summary:'Checked the shared Gerda management intelligence layer.',sources:['staff_users','clients','client_assignments','staff_tasks','inquiries','audit_log','management_mailbox_items']}};
}

module.exports={ensureManagementSchema,staffPerformance,queryIntelligence,commercialIntelligence,automationStatus,recentMailbox,importMailboxFile,saveMailboxAttachmentsToDeals,notifyDealsheetAvailable,shareMailboxItemWithStaff,weeklyStatsStatus,submitWeeklyStats,runAutomation,buildManagementOverview,answerManagementQuestion,mailboxProviderStatus,notificationProviderStatus};
