'use strict';

const express=require('express');
const multer=require('multer');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const campaign=require('../services/black-friday-campaign');
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
const management=u=>u&&['owner','manager','admin'].includes(String(u.role||'').toLowerCase());
const positive=v=>Number.isInteger(Number(v))&&Number(v)>0?Number(v):null;
const url=(req,res,message='',kind='info')=>res.locals.basePath+'/black-friday?'+new URLSearchParams({
  ...(String(req.body?.panel||'')==='1'?{panel:'1'}:{}),
  ...(positive(req.body?.bulk_staff_id||req.body?.staff_target)?{staff:String(positive(req.body?.bulk_staff_id||req.body?.staff_target))}:{}),
  ...(String(req.body?.pool||'')==='unassigned'?{pool:'unassigned'}:{}),
  ...(message?{message,kind}:{})
}).toString();
function reject(req,res,msg,code=403){return res.status(code).render('error',{title:'Black Friday',message:msg});}

router.get('/black-friday',requireAuth,async(req,res,next)=>{
  try{
    await campaign.ensureSchema();
    const batch=await campaign.currentBatch();
    const isManager=management(req.session.user);
    // Gerda selects the staff member first. The unassigned pool is a second
    // tab under that selected staff member, never a substitute for choosing one.
    const selectedStaffId=isManager?positive(req.query.staff):Number(req.session.user.id);
    const pool=isManager&&String(req.query.pool)==='unassigned'?'unassigned':'own';
    const staffFilter=isManager?(selectedStaffId?(pool==='unassigned'?'unassigned':String(selectedStaffId)):'__choose_staff__')
      :String(req.session.user.id);
    const options={q:campaign.txt(req.query.q,80),match:campaign.txt(req.query.match,24),
      queue:campaign.txt(req.query.queue,20),page:positive(req.query.page)||1,
      selectedStaffId,pool,staffFilter,staffId:Number(req.session.user.id),
      onlyDispatched:!isManager};
    const page=batch?await campaign.loadPage(batch,options):{
      rows:[],stats:{total:0,matched:0,multi:0,ambiguous:0,unmatched:0},progress:{assigned:0},
      staffCounts:{},queueCounts:{all:0,unassigned:0,ready:0,review:0,dispatched:0},
      count:0,page:1,pages:1,staff:[],options
    };
    return res.render('black-friday-campaign',{
      title:'Black Friday 2026',batch,manager:isManager,data:page,
      flash:campaign.txt(req.query.message,280),kind:campaign.txt(req.query.kind,20)
    });
  }catch(error){next(error);}
});

router.post('/black-friday/import',requireAuth,(req,res,next)=>{
  if(!management(req.session.user))return reject(req,res,'Only a manager or owner can import campaign lists.');
  upload.single('upgrade_file')(req,res,async err=>{
    if(err)return reject(req,res,err.code==='LIMIT_FILE_SIZE'?'The file must be 5MB or smaller.':'Invalid upload.',400);
    if(!req.file)return reject(req,res,'Please choose an Excel file.',400);
    if(!/\.xlsx?$/i.test(req.file.originalname))return reject(req,res,'Upload an .xls or .xlsx workbook.',400);
    try{
      const batch=await campaign.currentBatch();
      if(batch){
        const [[existing]]=await db.execute("SELECT COUNT(*) count FROM bf26_actions a JOIN bf26_contacts c ON c.id=a.contact_id WHERE c.batch_id=?",[batch.id]);
        if(Number(existing.count)>0)return reject(req,res,'This campaign already has dispatched tasks or call notes. A replacement import is blocked to protect follow-up history.',409);
      }
      const result=await campaign.importWorkbook(req.file.buffer,req.file.originalname,Number(req.session.user.id));
      return res.redirect(url(req,res,'Imported '+result.sourceRows+' lines across '+result.phones+' cellphone numbers. Review CRM matching before assigning.', 'success'));
    }catch(error){return reject(req,res,error.message||'Import failed.',400);}
  });
});

router.post('/black-friday/dispatch',requireAuth,async(req,res,next)=>{
  if(!management(req.session.user))return reject(req,res,'Only a manager or owner can assign campaign follow-ups.');
  const contactId=positive(req.body.contact_id),staffId=positive(req.body.staff_id);
  if(!positive(req.body.staff_target)||positive(req.body.staff_target)!==staffId)
    return reject(req,res,'This is an older client-first form. Refresh Black Friday and choose the staff member first.',409);
  const due=campaign.txt(req.body.due_at,20);
  if(!contactId||!staffId)return reject(req,res,'Choose a customer and a staff member.',400);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)||Number.isNaN(Date.parse(due)))
    return reject(req,res,'Choose a valid follow-up date and time.',400);
  const note=campaign.txt(req.body.note,1200);
  const conn=await db.getConnection();
  try{
    await campaign.ensureSchema();
    const context=await campaign.crmContext();
    const assigned=context.staff.find(s=>Number(s.id)===staffId&&s.is_active);
    if(!assigned)return reject(req,res,'The chosen staff member is not active.',400);
    await conn.beginTransaction();
    const [[row]]=await conn.execute("SELECT c.* FROM bf26_contacts c JOIN bf26_current x ON x.batch_id=c.batch_id AND x.id=1 WHERE c.id=? FOR UPDATE",[contactId]);
    if(!row){await conn.rollback();return reject(req,res,'This is not in the current campaign.',404);}
    const [[existing]]=await conn.execute("SELECT a.task_id FROM bf26_actions a WHERE a.contact_id=? LIMIT 1 FOR UPDATE",[contactId]);
    if(existing&&existing.task_id){await conn.rollback();return reject(req,res,'Already dispatched as task #'+existing.task_id+'. Open the task to follow up; no duplicate was created.',409);}
    const client=context.byId.get(Number(row.matched_client_id))||null;
    const grouped=context.groupedByPhone.get(row.msisdn)||null;
    const owner=campaign.resolveOwner(client,context,row.msisdn);
    if(grouped&&['voip','fixed','other'].includes(String(grouped.service_type))){
      await conn.rollback();
      return reject(req,res,'This telephone number is a non-mobile service and cannot receive a mobile Black Friday upgrade task.',409);
    }
    const needsReview=row.match_status==='ambiguous'||Boolean(grouped?.review_required)||
      (row.match_status==='unmatched'&&!grouped)||Boolean(row.review_flags)||owner.review;
    if(needsReview&&String(req.body.confirm_review||'')!=='1'){await conn.rollback();return reject(req,res,'This record needs review. Tick the review confirmation after checking its account and source lines.',400);}
    if(!owner.review&&Number(owner.staff_id)!==staffId&&String(req.body.confirm_reassign||'')!=='1'){
      await conn.rollback();return reject(req,res,'This client already belongs to '+owner.staff_name+'. Tick the reassignment confirmation to use another staff member.',400);
    }
    const [raw]=await conn.execute("SELECT source_payload FROM bf26_lines WHERE contact_id=? ORDER BY source_excel_row",[contactId]);
    const first=raw.length?JSON.parse(raw[0].source_payload):{};
    const lineText=raw.slice(0,10).map(x=>{let a;try{a=JSON.parse(x.source_payload)}catch(_){return '';}
      return [a.msisdn,a.tariff_description||a.tariff,a.eligible_at||'date not supplied',a.upgrade_label].filter(Boolean).join(' | ');
    }).filter(Boolean).join('\n');
    const text=['Black Friday 2026 - please call this customer and record the result.',
      'Customer: '+(row.source_name||client?.client_name||'Unknown'),
      'Cellphone: '+row.msisdn,'CRM account: '+(client?.account_number||grouped?.account_number||'Not verified'),
      'Account name: '+(grouped?.account_name||client?.client_name||'Not supplied'),
      'CRM owner: '+owner.staff_name,
      'Source upgrade lines:\n'+lineText,'Please verify upgrade eligibility and the approved deal before quoting.',
      'Reply with call outcome, promised actions and next contact date.',note?'Gerda note: '+note:''].filter(Boolean).join('\n');
    const dueAt=due.replace('T',' ')+':00';
    const [insert]=await conn.execute("INSERT INTO staff_tasks (type,title,message,priority,status,assigned_to,created_by,related_client_id,due_at,email_status) VALUES ('task',?,?,?,?,?,?,?,?,?)",
      ['Black Friday follow-up: '+(row.source_name||row.msisdn).slice(0,120),'Call '+row.msisdn+'\n'+text,'high','unread',staffId,Number(req.session.user.id),client?Number(client.id):null,dueAt,'not_configured']);
    await conn.execute("INSERT INTO bf26_actions(contact_id,assigned_staff_id,task_id,call_status,call_note,due_at,updated_by) VALUES(?,?,?,'assigned',?,?,?) ON DUPLICATE KEY UPDATE assigned_staff_id=VALUES(assigned_staff_id),task_id=VALUES(task_id),call_status=VALUES(call_status),call_note=VALUES(call_note),due_at=VALUES(due_at),updated_by=VALUES(updated_by)",
      [contactId,staffId,insert.insertId,note||null,dueAt,Number(req.session.user.id)]);
    await conn.commit();
    return res.redirect(url(req,res,'Follow-up assigned to '+assigned.full_name+' as CRM task #'+insert.insertId+'.','success'));
  }catch(error){try{await conn.rollback()}catch(_){}next(error);}finally{conn.release();}
});

router.post('/black-friday/outcome',requireAuth,async(req,res,next)=>{
  const contactId=positive(req.body.contact_id),status=campaign.txt(req.body.call_status,40),note=campaign.txt(req.body.note,1600);
  const allowed=['assigned','no_answer','callback','interested','quoted','sale','declined','wrong_number','completed'];
  if(!contactId||!allowed.includes(status))return reject(req,res,'Invalid call outcome.',400);
  try{
    await campaign.ensureSchema();
    const [[row]]=await db.execute("SELECT a.id,a.assigned_staff_id,a.call_note FROM bf26_actions a JOIN bf26_contacts c ON c.id=a.contact_id JOIN bf26_current x ON x.batch_id=c.batch_id AND x.id=1 WHERE c.id=?",[contactId]);
    if(!row)return reject(req,res,'This customer has not been assigned yet.',404);
    if(!management(req.session.user)&&Number(row.assigned_staff_id)!==Number(req.session.user.id))return reject(req,res,'Only the assigned staff member or management can update this call.',403);
    await db.execute("UPDATE bf26_actions SET call_status=?,call_note=?,updated_by=? WHERE id=?",
      [status,note,Number(req.session.user.id),row.id]);
    return res.redirect(url(req,res,'Call outcome saved in the Black Friday campaign.','success'));
  }catch(error){next(error);}
});


router.post('/black-friday/dispatch-bulk',requireAuth,async(req,res,next)=>{
  if(!management(req.session.user))return reject(req,res,'Only managers and owners can allocate calling lists.');
  const ids=[...new Set((Array.isArray(req.body.contacts)?req.body.contacts:[req.body.contacts]).map(positive).filter(Boolean))];
  if(!ids.length||ids.length>100)return reject(req,res,'Select between 1 and 100 eligible customers from the visible staff list.',400);
  const mode=campaign.txt(req.body.mode,20),selectedStaff=positive(req.body.bulk_staff_id);
  if(!['owner','staff'].includes(mode)||!selectedStaff)
    return reject(req,res,'Choose the staff member first. Every selected follow-up must be sent to that staff member.',400);
  if(mode==='staff'&&String(req.body.confirm_review||'')!=='1')return reject(req,res,'Confirm that Gerda reviewed the selected records before assigning to a named staff member.',400);
  const due=campaign.txt(req.body.due_at,20),note=campaign.txt(req.body.note,750);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)||Number.isNaN(Date.parse(due)))return reject(req,res,'Set a valid follow-up deadline.',400);
  const dueAt=due.replace('T',' ')+':00';
  try{
    await campaign.ensureSchema();
    const context=await campaign.crmContext(),active=context.staff.filter(s=>s.is_active),staffMap=new Map(active.map(s=>[Number(s.id),s]));
    if(!staffMap.has(selectedStaff))return reject(req,res,'Choose an active staff member.',400);
    const batch=await campaign.currentBatch();if(!batch)return reject(req,res,'Import the campaign first.',409);
    const reasons={},countReason=r=>{reasons[r]=(reasons[r]||0)+1},conn=await db.getConnection();
    let assigned=0;
    try{
      for(const id of ids){
        try{
          await conn.beginTransaction();
          const [[row]]=await conn.execute("SELECT * FROM bf26_contacts WHERE id=? AND batch_id=? FOR UPDATE",[id,batch.id]);
          if(!row){countReason('not in current campaign');await conn.rollback();continue;}
          const [[prior]]=await conn.execute("SELECT task_id FROM bf26_actions WHERE contact_id=? FOR UPDATE",[id]);
          if(prior?.task_id){countReason('already assigned');await conn.rollback();continue;}
          const crm=context.byId.get(Number(row.matched_client_id))||null;
          const owner=campaign.resolveOwner(crm,context,row.msisdn);
          const grouped=context.groupedByPhone.get(row.msisdn)||null;
          if(grouped&&['voip','fixed','other'].includes(String(grouped.service_type))){countReason('not a mobile upgrade service');await conn.rollback();continue;}
          const reviewed=(row.match_status==='matched'||row.match_status==='multiple_lines')||
            Boolean(grouped&&!Number(grouped.review_required)&&!owner.review);
          if(String(row.source_upgrade_label||'').trim().toLowerCase()!=='due'){
            countReason('not marked Due in source');await conn.rollback();continue;
          }
          if(row.review_flags||Number(grouped?.review_required)===1){
            countReason('source account or contract lines need review');await conn.rollback();continue;
          }
          if(mode==='owner'&&(!reviewed||owner.review||Number(owner.staff_id)!==selectedStaff)){
            countReason('not owned by chosen staff member');await conn.rollback();continue;
          }
          if(mode==='staff'&&(!owner.review||owner.reason==='Multiple CRM staff assignments'||
            (row.match_status!=='unmatched'&&owner.reason!=='No current staff owner'))){
            countReason('owned or disputed CRM customer needs manual resolution');await conn.rollback();continue;
          }
          const recipient=selectedStaff;
          if(crm){
            // Only block duplicate work on this mobile line, not an unrelated
            // contract on the same large business account.
            const lineIds=[Number(crm.id)],marks='?';
            const [openTasks]=await conn.query("SELECT COUNT(*) n FROM staff_tasks WHERE type='task' AND status IN ('unread','seen','in_progress') AND related_client_id IN ("+marks+")",lineIds);
            const [openFollowups]=await conn.query("SELECT COUNT(*) n FROM customer_followups WHERE status='open' AND client_id IN ("+marks+")",lineIds);
            const [openCallbacks]=await conn.query("SELECT COUNT(*) n FROM customer_callbacks WHERE status='scheduled' AND client_id IN ("+marks+")",lineIds);
            const [openInquiries]=await conn.query("SELECT COUNT(*) n FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND client_id IN ("+marks+")",lineIds);
            if([openTasks,openFollowups,openCallbacks,openInquiries].some(r=>Number(r[0].n)>0)){
              countReason('existing CRM work to review');await conn.rollback();continue;
            }
          }
          const [src]=await conn.execute("SELECT source_payload FROM bf26_lines WHERE contact_id=? ORDER BY source_excel_row",[id]);
          const summaries=src.slice(0,10).map(r=>{
            try{const a=JSON.parse(r.source_payload);return [a.msisdn,a.tariff_description||a.tariff,a.eligible_at||'unknown eligibility',a.upgrade_label].filter(Boolean).join(' | ')}
            catch(_){return ''}
          }).filter(Boolean);
          const message=[
            'Black Friday 2026. Contact this customer and report the outcome.',
            'Phone: '+row.msisdn,
            'Name: '+(row.source_name||crm?.client_name||'Not supplied'),
            'CRM owner: '+owner.staff_name,
            'CRM account: '+(crm?.account_number||grouped?.account_number||'NOT YET VERIFIED'),
            'Account name: '+(grouped?.account_name||'Not supplied'),
            'Upgrade spreadsheet lines:\n'+summaries.join('\n'),
            'Check eligibility, customer identity, deal conditions and current stock before quoting.',
            note?'Gerda: '+note:''
          ].filter(Boolean).join('\n');
          const [task]=await conn.execute("INSERT INTO staff_tasks(type,title,message,priority,status,assigned_to,created_by,related_client_id,due_at,email_status) VALUES('task',?,?,?,?,?,?,?,?,?)",
            ['Black Friday follow-up: '+(row.source_name||row.msisdn).slice(0,120),message,'high','unread',recipient,Number(req.session.user.id),crm?Number(crm.id):null,dueAt,'not_configured']);
          await conn.execute("INSERT INTO bf26_actions(contact_id,assigned_staff_id,task_id,call_status,call_note,due_at,updated_by) VALUES(?,?,?,'assigned',?,?,?) ON DUPLICATE KEY UPDATE assigned_staff_id=VALUES(assigned_staff_id),task_id=VALUES(task_id),call_status=VALUES(call_status),call_note=VALUES(call_note),due_at=VALUES(due_at),updated_by=VALUES(updated_by)",
            [id,recipient,task.insertId,note||null,dueAt,Number(req.session.user.id)]);
          await conn.commit();assigned++;
        }catch(error){try{await conn.rollback()}catch(_){ }throw error;}
      }
    }finally{conn.release();}
    const skipped=ids.length-assigned;
    return res.redirect(url(req,res,'Created '+assigned+' CRM follow-up tasks; '+skipped+' skipped.'+(skipped?' Reasons: '+Object.entries(reasons).map(([k,v])=>k+' ('+v+')').join(', '):''),assigned?'success':'info'));
  }catch(error){next(error);}
});

module.exports=router;
