const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ACTIVE = "('unread','seen','in_progress')";
let schemaPromise;

const management = user => Boolean(user && ['owner','admin','manager'].includes(String(user.role || '').toLowerCase()));
const same = (a,b) => Number(a) > 0 && Number(a) === Number(b);
const idOf = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value,max=5000) => String(value || '').trim().slice(0,max);
const panel = req => String(req.body?.panel || req.query?.panel || '') === '1' ? '?panel=1' : '';
const redirectTask = (req,res,id) => res.redirect(`${res.locals.basePath}/tasks/${id}${panel(req)}`);

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS staff_task_workflow (
      task_id BIGINT UNSIGNED NOT NULL,
      workflow_state VARCHAR(40) NOT NULL DEFAULT 'active',
      my_priority_date DATE NULL,
      completed_by BIGINT UNSIGNED NULL,
      completed_at DATETIME NULL,
      acknowledged_by BIGINT UNSIGNED NULL,
      acknowledged_at DATETIME NULL,
      returned_by BIGINT UNSIGNED NULL,
      returned_at DATETIME NULL,
      return_reason TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id),
      KEY idx_task_workflow_state (workflow_state,updated_at),
      KEY idx_task_workflow_priority (my_priority_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS staff_task_notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      recipient_staff_id BIGINT UNSIGNED NOT NULL,
      actor_staff_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(50) NOT NULL,
      notification_text VARCHAR(500) NOT NULL,
      action_required TINYINT(1) NOT NULL DEFAULT 0,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_task_notifications_recipient (recipient_staff_id,resolved_at,is_read,created_at),
      KEY idx_task_notifications_task (task_id,recipient_staff_id,action_required,resolved_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function workflow(taskId,state='active') {
  await db.execute(`INSERT INTO staff_task_workflow (task_id,workflow_state)
    VALUES (:taskId,:state) ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)`, { taskId,state });
}

async function notify({ taskId,recipientId,actorId,eventType,message,actionRequired=false }) {
  if (!recipientId || same(recipientId,actorId)) return;
  await db.execute(`INSERT INTO staff_task_notifications
    (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
    VALUES (:taskId,:recipientId,:actorId,:eventType,:message,:required)`, {
    taskId,recipientId,actorId:actorId||null,eventType,message:text(message,500),required:actionRequired?1:0
  });
}

async function resolveActions(taskId,recipientId) {
  await db.execute(`UPDATE staff_task_notifications SET resolved_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
    WHERE task_id=:taskId AND recipient_staff_id=:recipientId AND action_required=1 AND resolved_at IS NULL`, { taskId,recipientId });
}

async function getTask(taskId) {
  const [[row]] = await db.execute(`SELECT t.*,ass.full_name assigned_name,ass.email assigned_email,
    creator.full_name created_by_name,cl.client_name related_client_name,
    fa.customer_name related_fixed_name,fa.account_number related_fixed_account,
    COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state,
    w.my_priority_date,w.completed_by workflow_completed_by,w.completed_at workflow_completed_at,
    w.acknowledged_by,w.acknowledged_at,w.returned_by,w.returned_at,w.return_reason
    FROM staff_tasks t
    JOIN staff_users ass ON ass.id=t.assigned_to
    JOIN staff_users creator ON creator.id=t.created_by
    LEFT JOIN clients cl ON cl.id=t.related_client_id
    LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id
    LEFT JOIN staff_task_workflow w ON w.task_id=t.id
    WHERE t.id=:taskId LIMIT 1`, { taskId });
  return row || null;
}

function stateLabel(task) {
  if (task.status === 'cancelled') return 'Cancelled';
  if (task.workflow_state === 'awaiting_sender_ack') return 'Awaiting sender approval';
  if (task.workflow_state === 'returned') return 'Returned / In progress';
  if (task.workflow_state === 'accepted') return 'Accepted and archived';
  return String(task.status || 'active').replaceAll('_',' ');
}

async function counts(userId,isManager) {
  const active = `(t.status IN ${ACTIVE} OR (t.status='completed' AND w.workflow_state='awaiting_sender_ack'))`;
  const [[row]] = await db.execute(`SELECT
    SUM(CASE WHEN t.assigned_to=:userId AND ${active} THEN 1 ELSE 0 END) active_count,
    SUM(CASE WHEN t.assigned_to=:userId AND ${active} AND ((t.due_at IS NOT NULL AND DATE(t.due_at)<=CURRENT_DATE()) OR DATE(t.created_at)=CURRENT_DATE() OR DATE(w.returned_at)=CURRENT_DATE()) THEN 1 ELSE 0 END) today_count,
    SUM(CASE WHEN t.assigned_to=:userId AND ${active} AND (w.my_priority_date=CURRENT_DATE() OR (t.due_at IS NOT NULL AND DATE(t.due_at)<=CURRENT_DATE()) OR t.priority IN ('urgent','high')) THEN 1 ELSE 0 END) priority_count,
    SUM(CASE WHEN t.assigned_to=:userId AND t.status='in_progress' THEN 1 ELSE 0 END) progress_count,
    SUM(CASE WHEN t.created_by=:userId AND t.status='completed' AND w.workflow_state='awaiting_sender_ack' THEN 1 ELSE 0 END) approval_count,
    SUM(CASE WHEN t.created_by=:userId AND ${active} THEN 1 ELSE 0 END) sent_count,
    SUM(CASE WHEN (t.assigned_to=:userId OR t.created_by=:userId) AND (t.status='cancelled' OR (t.status='completed' AND (w.workflow_state IS NULL OR w.workflow_state='accepted'))) THEN 1 ELSE 0 END) archive_count,
    SUM(CASE WHEN ${active} THEN 1 ELSE 0 END) all_count
    FROM staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id`, { userId });
  const [[notice]] = await db.execute(`SELECT COUNT(*) total FROM staff_task_notifications
    WHERE recipient_staff_id=:userId AND resolved_at IS NULL AND (is_read=0 OR action_required=1)`, { userId });
  return {
    active:Number(row?.active_count||0),today:Number(row?.today_count||0),priority:Number(row?.priority_count||0),
    progress:Number(row?.progress_count||0),approval:Number(row?.approval_count||0),sent:Number(row?.sent_count||0),
    archive:Number(row?.archive_count||0),all:isManager?Number(row?.all_count||0):0,notifications:Number(notice?.total||0)
  };
}

router.get('/api/tasks/notification-summary',requireAuth,async(req,res,next)=>{
  try {
    await ensureSchema(); const userId=Number(req.session.user.id);
    const [[summary]]=await db.execute(`SELECT
      SUM(CASE WHEN is_read=0 AND resolved_at IS NULL THEN 1 ELSE 0 END) unread_count,
      SUM(CASE WHEN action_required=1 AND resolved_at IS NULL THEN 1 ELSE 0 END) action_count,
      SUM(CASE WHEN resolved_at IS NULL AND (is_read=0 OR action_required=1) THEN 1 ELSE 0 END) total_count,
      MAX(id) latest_id FROM staff_task_notifications WHERE recipient_staff_id=:userId`,{userId});
    const [latest]=await db.execute(`SELECT n.id,n.task_id,n.event_type,n.notification_text,n.action_required,n.created_at,t.title,t.type
      FROM staff_task_notifications n JOIN staff_tasks t ON t.id=n.task_id
      WHERE n.recipient_staff_id=:userId AND n.resolved_at IS NULL AND (n.is_read=0 OR n.action_required=1)
      ORDER BY n.created_at DESC,n.id DESC LIMIT 5`,{userId});
    res.json({ok:true,unreadCount:Number(summary?.unread_count||0),actionCount:Number(summary?.action_count||0),
      totalCount:Number(summary?.total_count||0),latestId:Number(summary?.latest_id||0),latest});
  } catch(error){next(error)}
});

router.post('/api/tasks/notifications/:id/read',requireAuth,async(req,res,next)=>{
  try { await ensureSchema(); await db.execute(`UPDATE staff_task_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
    WHERE id=:id AND recipient_staff_id=:userId`,{id:idOf(req.params.id),userId:Number(req.session.user.id)});res.json({ok:true}); }
  catch(error){next(error)}
});

router.post('/tasks/notifications/read-all',requireAuth,async(req,res,next)=>{
  try { await ensureSchema(); await db.execute(`UPDATE staff_task_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
    WHERE recipient_staff_id=:userId AND action_required=0 AND resolved_at IS NULL`,{userId:Number(req.session.user.id)});
    res.redirect(`${res.locals.basePath}/tasks?view=notifications${String(req.body.panel||'')==='1'?'&panel=1':''}`); }
  catch(error){next(error)}
});

router.get('/tasks',requireAuth,async(req,res,next)=>{
  try {
    await ensureSchema();
    const userId=Number(req.session.user.id),isManager=management(req.session.user);
    const allowed=['active','today','priority','progress','approval','sent','notifications','archive','all'];
    let view=allowed.includes(String(req.query.view||''))?String(req.query.view):'active'; if(view==='all'&&!isManager)view='active';
    const q=text(req.query.q,200),type=['task','notification'].includes(String(req.query.type||''))?String(req.query.type):'',
      priority=['normal','high','urgent'].includes(String(req.query.priority||''))?String(req.query.priority):'',
      staffFilter=isManager?idOf(req.query.staff_id):null;
    const tabCounts=await counts(userId,isManager);

    if(view==='notifications'){
      const [notifications]=await db.execute(`SELECT n.*,t.title,t.type,t.priority,t.status,ass.full_name assigned_name,
        creator.full_name created_by_name,COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state
        FROM staff_task_notifications n JOIN staff_tasks t ON t.id=n.task_id
        JOIN staff_users ass ON ass.id=t.assigned_to JOIN staff_users creator ON creator.id=t.created_by
        LEFT JOIN staff_task_workflow w ON w.task_id=t.id
        WHERE n.recipient_staff_id=:userId AND n.resolved_at IS NULL AND (n.is_read=0 OR n.action_required=1)
        ORDER BY n.action_required DESC,n.created_at DESC,n.id DESC LIMIT 250`,{userId});
      return res.render('tasks-work-inbox',{title:'Notifications',tasks:[],notifications,view,management:isManager,counts:tabCounts,staff:[],filters:{q:'',type:'',priority:'',staffFilter:null}});
    }

    const active=`(t.status IN ${ACTIVE} OR (t.status='completed' AND w.workflow_state='awaiting_sender_ack'))`;
    const where=[],params={userId,q:`%${q}%`};
    if(view==='active')where.push(`t.assigned_to=:userId AND ${active}`);
    if(view==='today')where.push(`t.assigned_to=:userId AND ${active} AND ((t.due_at IS NOT NULL AND DATE(t.due_at)<=CURRENT_DATE()) OR DATE(t.created_at)=CURRENT_DATE() OR DATE(w.returned_at)=CURRENT_DATE())`);
    if(view==='priority')where.push(`t.assigned_to=:userId AND ${active} AND (w.my_priority_date=CURRENT_DATE() OR (t.due_at IS NOT NULL AND DATE(t.due_at)<=CURRENT_DATE()) OR t.priority IN ('urgent','high'))`);
    if(view==='progress')where.push(`t.assigned_to=:userId AND t.status='in_progress'`);
    if(view==='approval')where.push(`t.created_by=:userId AND t.status='completed' AND w.workflow_state='awaiting_sender_ack'`);
    if(view==='sent')where.push(`t.created_by=:userId AND ${active}`);
    if(view==='archive')where.push(`(t.assigned_to=:userId OR t.created_by=:userId) AND (t.status='cancelled' OR (t.status='completed' AND (w.workflow_state IS NULL OR w.workflow_state='accepted')))`);
    if(view==='all')where.push(active);
    if(staffFilter){params.staffFilter=staffFilter;where.push('(t.assigned_to=:staffFilter OR t.created_by=:staffFilter)')}
    if(q)where.push('(t.title LIKE :q OR t.message LIKE :q OR ass.full_name LIKE :q OR creator.full_name LIKE :q OR cl.client_name LIKE :q OR fa.customer_name LIKE :q OR fa.account_number LIKE :q)');
    if(type){params.type=type;where.push('t.type=:type')} if(priority){params.priority=priority;where.push('t.priority=:priority')}

    const [tasks]=await db.execute(`SELECT t.*,ass.full_name assigned_name,creator.full_name created_by_name,
      cl.client_name related_client_name,fa.customer_name related_fixed_name,fa.account_number related_fixed_account,
      COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state,
      w.my_priority_date,w.returned_at,w.return_reason,w.acknowledged_at,
      CASE WHEN t.status='completed' AND w.workflow_state='awaiting_sender_ack' THEN 0
        WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 1 WHEN t.due_at IS NOT NULL AND DATE(t.due_at)=CURRENT_DATE() THEN 2
        WHEN w.my_priority_date=CURRENT_DATE() THEN 3 WHEN t.priority='urgent' THEN 4 WHEN t.priority='high' THEN 5 ELSE 6 END sort_rank
      FROM staff_tasks t JOIN staff_users ass ON ass.id=t.assigned_to JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id
      LEFT JOIN staff_task_workflow w ON w.task_id=t.id WHERE ${where.length?where.join(' AND '):'1=0'}
      ORDER BY sort_rank,t.due_at IS NULL,t.due_at ASC,t.created_at DESC LIMIT 1000`,params);
    const [staff]=isManager?await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name'):[[]];
    const titles={active:'All Messages & Tasks',today:'Today',priority:'My Priority',progress:'In Progress',approval:'Awaiting My Approval',sent:'Sent by Me',archive:'Completed Archive',all:'All Staff Active'};
    res.render('tasks-work-inbox',{title:titles[view]||'Tasks & Messages',tasks:tasks.map(t=>({...t,workflow_label:stateLabel(t)})),notifications:[],view,management:isManager,counts:tabCounts,staff,filters:{q,type,priority,staffFilter}});
  } catch(error){next(error)}
});

router.post('/tasks/:id/my-priority',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{await ensureSchema();const task=await getTask(taskId);if(!task)return res.sendStatus(404);const userId=Number(req.session.user.id);
    if(!management(req.session.user)&&!same(task.assigned_to,userId))return res.sendStatus(403);await workflow(taskId);
    const enabled=String(req.body.enabled||'')==='1';await db.execute(`UPDATE staff_task_workflow SET my_priority_date=${enabled?'CURRENT_DATE()':'NULL'} WHERE task_id=:taskId`,{taskId});return redirectTask(req,res,taskId)}catch(error){next(error)}
});

router.post('/tasks/:id/status',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{
    await ensureSchema();const task=await getTask(taskId);if(!task)return res.sendStatus(404);const userId=Number(req.session.user.id),isManager=management(req.session.user);
    if(!isManager&&!same(task.assigned_to,userId))return res.sendStatus(403);const status=String(req.body.status||'');
    const allowed=isManager?['seen','in_progress','completed','cancelled']:['seen','in_progress','completed'];
    if(!allowed.includes(status))return res.status(400).render('error',{title:'Invalid status',message:'Invalid task status.'});
    const completionNote=text(req.body.completion_note);if(status==='completed'&&task.type==='task'&&!completionNote)return res.status(400).render('error',{title:'Completion note required',message:'Explain what was completed before submitting the task.'});
    await workflow(taskId);
    if(status==='completed'){
      const selfAssigned=same(task.created_by,task.assigned_to),note=completionNote||(task.type==='notification'?'Message acknowledged.':'Completed.');
      await db.execute(`UPDATE staff_tasks SET status='completed',seen_at=COALESCE(seen_at,NOW()),started_at=COALESCE(started_at,NOW()),completed_at=NOW(),completion_note=:note WHERE id=:taskId`,{taskId,note});
      await db.execute(`UPDATE staff_task_workflow SET workflow_state=:state,completed_by=:userId,completed_at=NOW(),acknowledged_by=:ackBy,acknowledged_at=:ackAt,returned_by=NULL,returned_at=NULL,return_reason=NULL WHERE task_id=:taskId`,{taskId,userId,state:selfAssigned?'accepted':'awaiting_sender_ack',ackBy:selfAssigned?userId:null,ackAt:selfAssigned?new Date():null});
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`,{taskId,userId,comment:`${task.type==='notification'?'Message acknowledged':'Task completed'} — ${note}`});
      if(!selfAssigned)await notify({taskId,recipientId:Number(task.created_by),actorId:userId,eventType:'completed',actionRequired:true,message:`${task.assigned_name} completed “${task.title}”. Review and accept it or return it for more work.`});
    }else if(status==='cancelled'){
      await db.execute(`UPDATE staff_tasks SET status='cancelled',completed_at=NOW() WHERE id=:taskId`,{taskId});await db.execute(`UPDATE staff_task_workflow SET workflow_state='cancelled' WHERE task_id=:taskId`,{taskId});await resolveActions(taskId,Number(task.created_by));
    }else{
      const changed=task.status!==status||task.workflow_state==='returned';await db.execute(`UPDATE staff_tasks SET status=:status,seen_at=CASE WHEN :status IN ('seen','in_progress') THEN COALESCE(seen_at,NOW()) ELSE seen_at END,started_at=CASE WHEN :status='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,completed_at=NULL,completion_note=NULL WHERE id=:taskId`,{taskId,status});
      await db.execute(`UPDATE staff_task_workflow SET workflow_state=:state WHERE task_id=:taskId`,{taskId,state:status==='in_progress'?'in_progress':'active'});
      if(changed){await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`,{taskId,userId,comment:`Status changed to ${status.replaceAll('_',' ')}`});await notify({taskId,recipientId:Number(task.created_by),actorId:userId,eventType:status,message:`${task.assigned_name} changed “${task.title}” to ${status.replaceAll('_',' ')}.`})}
    }
    return redirectTask(req,res,taskId);
  }catch(error){next(error)}
});

router.post('/tasks/:id/accept',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{await ensureSchema();const task=await getTask(taskId);if(!task)return res.sendStatus(404);const userId=Number(req.session.user.id);
    if(!management(req.session.user)&&!same(task.created_by,userId))return res.sendStatus(403);if(task.status!=='completed'||task.workflow_state!=='awaiting_sender_ack')return redirectTask(req,res,taskId);
    await db.execute(`UPDATE staff_task_workflow SET workflow_state='accepted',acknowledged_by=:userId,acknowledged_at=NOW(),return_reason=NULL WHERE task_id=:taskId`,{taskId,userId});await resolveActions(taskId,Number(task.created_by));
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`,{taskId,userId,comment:`${task.type==='notification'?'Message':'Task'} accepted and archived`});
    await notify({taskId,recipientId:Number(task.assigned_to),actorId:userId,eventType:'accepted',message:`${req.session.user.full_name} accepted “${task.title}”. It is now archived.`});return redirectTask(req,res,taskId)}catch(error){next(error)}
});

router.post('/tasks/:id/return',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{await ensureSchema();const task=await getTask(taskId);if(!task)return res.sendStatus(404);const userId=Number(req.session.user.id);
    if(!management(req.session.user)&&!same(task.created_by,userId))return res.sendStatus(403);const reason=text(req.body.reason,2000);if(!reason)return res.status(400).render('error',{title:'Reason required',message:'Explain what still needs to be completed.'});
    await db.execute(`UPDATE staff_tasks SET status='in_progress',completed_at=NULL,completion_note=NULL WHERE id=:taskId`,{taskId});await workflow(taskId,'returned');
    await db.execute(`UPDATE staff_task_workflow SET workflow_state='returned',returned_by=:userId,returned_at=NOW(),return_reason=:reason,acknowledged_by=NULL,acknowledged_at=NULL WHERE task_id=:taskId`,{taskId,userId,reason});await resolveActions(taskId,Number(task.created_by));
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`,{taskId,userId,comment:`Returned for more work — ${reason}`});
    await notify({taskId,recipientId:Number(task.assigned_to),actorId:userId,eventType:'returned',actionRequired:true,message:`${req.session.user.full_name} returned “${task.title}”: ${reason}`});return redirectTask(req,res,taskId)}catch(error){next(error)}
});

router.post('/tasks/:id/comments',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{await ensureSchema();const task=await getTask(taskId);if(!task)return res.sendStatus(404);const userId=Number(req.session.user.id);
    if(!management(req.session.user)&&!same(task.assigned_to,userId)&&!same(task.created_by,userId))return res.sendStatus(403);const comment=text(req.body.comment);
    if(comment){await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`,{taskId,userId,comment});const recipients=new Set([Number(task.assigned_to),Number(task.created_by)]);recipients.delete(userId);for(const recipientId of recipients)await notify({taskId,recipientId,actorId:userId,eventType:'comment',message:`${req.session.user.full_name} added an update to “${task.title}”: ${comment}`})}
    return redirectTask(req,res,taskId)}catch(error){next(error)}
});

router.get('/tasks/:id',requireAuth,async(req,res,next)=>{
  const taskId=idOf(req.params.id);if(!taskId)return next();
  try{
    await ensureSchema();let task=await getTask(taskId);if(!task)return res.status(404).render('error',{title:'Not found',message:'Task or message could not be found.'});
    const userId=Number(req.session.user.id),isManager=management(req.session.user),assignee=same(task.assigned_to,userId),creator=same(task.created_by,userId);
    if(!isManager&&!assignee&&!creator)return res.status(403).render('error',{title:'Access denied',message:'This item was not sent by you or assigned to you.'});
    if(assignee&&task.status==='unread'){await workflow(taskId);await db.execute(`UPDATE staff_tasks SET status='seen',seen_at=COALESCE(seen_at,NOW()) WHERE id=:taskId`,{taskId});await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,'Opened / seen')`,{taskId,userId});await notify({taskId,recipientId:Number(task.created_by),actorId:userId,eventType:'seen',message:`${task.assigned_name} opened “${task.title}”.`});task=await getTask(taskId)}
    await db.execute(`UPDATE staff_task_notifications SET is_read=1,read_at=COALESCE(read_at,NOW()) WHERE task_id=:taskId AND recipient_staff_id=:userId AND action_required=0`,{taskId,userId});
    const [comments]=await db.execute(`SELECT c.*,s.full_name FROM staff_task_comments c JOIN staff_users s ON s.id=c.staff_id WHERE c.task_id=:taskId ORDER BY c.created_at DESC`,{taskId});
    const waitingApproval=task.status==='completed'&&task.workflow_state==='awaiting_sender_ack',archived=task.status==='cancelled'||(task.status==='completed'&&task.workflow_state==='accepted');
    const canUpdate=(isManager||assignee)&&!waitingApproval&&!archived,canApprove=(isManager||creator)&&waitingApproval;
    const priorityToday=task.my_priority_date&&new Date(task.my_priority_date).toLocaleDateString('en-CA')===new Date().toLocaleDateString('en-CA');
    res.render('task-work-detail',{title:`${task.type==='notification'?'Message':'Task'} #${taskId}`,task:{...task,workflow_label:stateLabel(task)},comments,management:isManager,isAssignee:assignee,isCreator:creator,waitingApproval,archived,canUpdate,canApprove,priorityToday});
  }catch(error){next(error)}
});

module.exports=router;
