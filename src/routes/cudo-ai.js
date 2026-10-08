'use strict';

const express = require('express');
const multer = require('multer');
const { audit } = require('../services/audit');
const { answerCudo, createTasks, getAlerts } = require('../services/cudo-ai');
const { reassignClientWork } = require('../services/cudo-client-assignment');
const {
  storeUploadedFile,
  searchLibraryDocuments,
  attachLibraryDocument,
  listFilesForUser,
  removeDraftFile,
  discardDraftFiles,
  createWorkDispatch
} = require('../services/work-dispatch');

const router = express.Router();
const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:40*1024*1024,files:5}
}).array('files',5);

const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';

function isOwner(user) {
  return Boolean(user && String(user.role || '').toLowerCase() === 'owner');
}

function requireOwner(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok:false, error:'Sign in required.' });
  if (!isOwner(req.session.user)) return res.status(403).json({ ok:false, error:'Cudo is private to the Talk2Me owner.' });
  next();
}

function safeContext(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    route:String(value.route || '').slice(0,500),
    title:String(value.title || '').slice(0,300),
    clientId:Number(value.clientId || 0) || null
  };
}

function logCudoError(scope, error, req) {
  const ref = `CUDO-${Date.now().toString(36).toUpperCase()}`;
  console.error(`[${ref}] ${scope}`, {
    userId:Number(req?.session?.user?.id || 0) || null,
    message:String(error?.message || error || 'Unknown error'),
    stack:error?.stack || null
  });
  return ref;
}

router.get('/api/cudo/health', requireOwner, async (req, res) => {
  if (!IS_UAT) return res.sendStatus(404);
  try {
    const alerts = await getAlerts();
    res.set('Cache-Control','no-store');
    res.json({ status:'ok', environment:'uat', cudo:true, alerts:Number(alerts.count || 0) });
  } catch (error) {
    res.status(503).json({ status:'error', environment:'uat', cudo:false, error:error.message });
  }
});

router.get('/api/cudo/bootstrap', requireOwner, async (req, res, next) => {
  try {
    const alerts = await getAlerts();
    res.set('Cache-Control','no-store');
    res.json({
      ok:true,
      name:'Cudo',
      subtitle:'AI Office Assistant',
      user:{ id:Number(req.session.user.id), name:req.session.user.full_name, role:req.session.user.role },
      alerts,
      suggestions:[
        'Birthdays not followed up this month',
        'Outstanding upgrades for Johnny last 6 months',
        'Who has overdue work today?'
      ],
      openAgentUrl:`${res.locals.basePath || ''}/agent`
    });
  } catch (error) { next(error); }
});

router.get('/api/cudo/alerts', requireOwner, async (req, res, next) => {
  try {
    const alerts = await getAlerts();
    res.set('Cache-Control','no-store');
    res.json({ ok:true, ...alerts });
  } catch (error) { next(error); }
});

router.post('/api/cudo/chat', requireOwner, async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim().slice(0,5000);
    if (!message) return res.status(400).json({ ok:false, error:'Ask Cudo a question.' });

    const attachmentIds = Array.isArray(req.body?.attachmentIds)
      ? req.body.attachmentIds.map(Number).filter(Number.isFinite).slice(0,20)
      : [];
    const result = await answerCudo({
      message,
      state:req.session.cudoState || null,
      context:safeContext(req.body?.context),
      userId:Number(req.session.user.id),
      attachmentIds
    });

    if (result.state !== undefined) req.session.cudoState = result.state;
    if (result.pendingAction) req.session.cudoPendingAction = result.pendingAction;
    else if (result.intent !== 'action') req.session.cudoPendingAction = null;

    await audit(req, {
      actionType:'cudo_query',
      entityType:'cudo',
      entityId:null,
      description:`Cudo management query: ${message.slice(0,180)}`,
      after:{
        intent:result.intent || 'unknown',
        resultCount:Array.isArray(result.rows) ? result.rows.length : 0,
        hasPendingAction:Boolean(result.pendingAction)
      }
    });

    res.set('Cache-Control','no-store');
    res.json({
      ok:true,
      intent:result.intent,
      text:result.text,
      rows:Array.isArray(result.rows) ? result.rows : [],
      grouped:result.grouped || null,
      evidence:result.evidence || null,
      attachments:Array.isArray(result.attachments) ? result.attachments : [],
      actions:Array.isArray(result.actions) ? result.actions : [],
      suggestions:Array.isArray(result.suggestions) ? result.suggestions : []
    });
  } catch (error) {
    const ref = logCudoError('chat_failed',error,req);
    res.status(500).json({
      ok:false,
      error:`I reached the CRM, but one of the data checks failed. Nothing was changed. The technical error was logged as ${ref}.`,
      errorRef:ref
    });
  }
});

router.post('/api/cudo/action', requireOwner, async (req, res, next) => {
  try {
    const actionName = String(req.body?.action || '').trim();

    if (actionName === 'cancel') {
      req.session.cudoPendingAction = null;
      req.session.cudoState = {
        ...(req.session.cudoState || {}),
        actionDraft:null,
        assignmentDraft:null,
        dispatchDraft:null
      };
      return res.json({ ok:true, text:'Cancelled. I have not changed anything.' });
    }

    const pending = req.session.cudoPendingAction;
    if (!pending) return res.status(409).json({ ok:false, error:'There is no pending Cudo action to confirm.' });

    if (actionName === 'confirm_reassignment') {
      if (pending.type !== 'reassign_client_work') {
        return res.status(409).json({ ok:false, error:'The pending action is not a customer assignment.' });
      }
      const result = await reassignClientWork({
        actorId:Number(req.session.user.id),
        dueAt:pending.dueAt,
        priority:pending.priority,
        groups:pending.groups,
        ipAddress:req.ip,
        userAgent:req.headers['user-agent']
      });
      req.session.cudoPendingAction = null;
      req.session.cudoState = {
        ...(req.session.cudoState || {}),
        assignmentDraft:null
      };

      await audit(req, {
        actionType:'cudo_client_assignment_confirmed',
        entityType:'client_assignments',
        entityId:null,
        description:`Cudo assigned ${result.selectedItems} customer work item(s) across ${result.accountGroups} account group(s).`,
        after:{
          selectedItems:result.selectedItems,
          accountGroups:result.accountGroups,
          monitoredTasks:result.monitoredTasks,
          linkedLines:result.linkedLines,
          alreadyAssigned:result.alreadyAssigned,
          dueAt:result.dueAt
        }
      });

      return res.json({
        ok:true,
        text:`Done. I assigned ${result.selectedItems} customer item${result.selectedItems===1?'':'s'} across ${result.accountGroups} customer account${result.accountGroups===1?'':'s'} and created/confirmed ${result.monitoredTasks} monitored task${result.monitoredTasks===1?'':'s'}. The normal Cudo deadline follow-up is active for ${String(result.dueAt).slice(0,16).replace(' ',' at ')}.`,
        assignment:result
      });
    }

    if (actionName === 'confirm_dispatch') {
      if (pending.type !== 'work_dispatch') return res.status(409).json({ok:false,error:'The pending action is not a work dispatch.'});
      const result = await createWorkDispatch({
        createdBy:Number(req.session.user.id),
        action:pending
      });
      req.session.cudoPendingAction = null;
      req.session.cudoState = {
        ...(req.session.cudoState || {}),
        dispatchDraft:null
      };

      await audit(req,{
        actionType:'cudo_work_dispatch_sent',
        entityType:'work_dispatches',
        entityId:result.dispatchId,
        description:`Cudo sent a work dispatch to ${result.staffName} with ${result.itemCount} work item(s) and ${result.attachmentCount} attachment(s).`,
        after:{
          dispatchId:result.dispatchId,
          taskId:result.taskId,
          recipientId:result.recipientId,
          staffName:result.staffName,
          recipientEmail:result.recipientEmail || null,
          recipientMobile:result.recipientMobile || null,
          senderKey:result.senderKey || null,
          senderAddress:result.senderAddress || null,
          dueAt:result.dueAt,
          channel:result.channel,
          externalStatus:result.externalResult?.status || (result.channel==='internal'?'internal_delivered':null),
          requireReply:result.requireReply,
          requireCompletion:result.requireCompletion,
          itemCount:result.itemCount,
          attachmentCount:result.attachmentCount
        }
      });

      const channelLabel=result.channel==='internal'
        ? 'Talk2Me'
        : result.channel==='email'
          ? `email from ${result.senderAddress || result.senderKey || 'Talk2Me'}`
          : 'WhatsApp';
      const externalNote=result.channel==='internal'
        ? 'The recipient will see it in Talk2Me.'
        : result.externalResult?.sent
          ? `External ${result.channel} delivery was accepted.`
          : `The Talk2Me task was created, but external ${result.channel} delivery failed: ${result.externalResult?.error || 'unknown provider error'}`;

      return res.json({
        ok:true,
        text:`Sent to ${result.staffName} via ${channelLabel}. ${result.itemCount ? `${result.itemCount} work item${result.itemCount===1?'':'s'} included. ` : ''}${result.attachmentCount ? `${result.attachmentCount} attachment${result.attachmentCount===1?'':'s'} linked. ` : ''}${result.dueAt ? `Deadline: ${String(result.dueAt).slice(0,16).replace(' ',' at ')}. ` : ''}${externalNote} ${result.requireReply||result.requireCompletion ? 'Cudo/Gerda will monitor the normal Talk2Me task until it is completed.' : ''}`.trim(),
        dispatch:result
      });
    }

    if (actionName !== 'confirm_tasks') {
      return res.status(400).json({ ok:false, error:'Unknown Cudo action.' });
    }

    const result = await createTasks({
      userId:Number(req.session.user.id),
      action:pending
    });
    req.session.cudoPendingAction = null;

    await audit(req, {
      actionType:'cudo_tasks_created',
      entityType:'staff_tasks',
      entityId:null,
      description:`Cudo created ${result.created.length} monitored task(s) for ${result.staffName}.`,
      after:{
        assignedTo:Number(pending.assignedTo),
        staffName:result.staffName,
        dueAt:result.dueAt,
        sourceKind:pending.sourceKind || null,
        createdTaskIds:result.created.map(item => item.taskId),
        skippedTaskIds:result.skipped.map(item => item.taskId)
      }
    });

    res.json({
      ok:true,
      text:`Done. I created ${result.created.length} monitored task${result.created.length===1?'':'s'} for ${result.staffName} due ${String(result.dueAt).slice(0,16).replace(' ',' at ')}.${result.skipped.length ? ` I skipped ${result.skipped.length} duplicate${result.skipped.length===1?'':'s'}.` : ''}`,
      created:result.created,
      skipped:result.skipped
    });
  } catch (error) {
    const ref = logCudoError('action_failed',error,req);
    res.status(500).json({
      ok:false,
      error:`I could not complete that CRM action. Nothing further was changed. The technical error was logged as ${ref}.`,
      errorRef:ref
    });
  }
});

router.post('/api/cudo/attachments', requireOwner, (req,res,next)=>{
  upload(req,res,async error=>{
    if(error) return res.status(400).json({ok:false,error:error.message||'The attachment could not be uploaded.'});
    try{
      const files=[];
      for(const file of req.files||[]){
        files.push(await storeUploadedFile({
          buffer:file.buffer,
          originalName:file.originalname,
          mimeType:file.mimetype,
          userId:Number(req.session.user.id)
        }));
      }
      res.json({ok:true,files});
    }catch(err){next(err);}
  });
});

router.delete('/api/cudo/attachments/:id', requireOwner, async(req,res,next)=>{
  try{
    const removed=await removeDraftFile({fileId:Number(req.params.id),userId:Number(req.session.user.id)});
    res.json({ok:true,removed});
  }catch(error){next(error);}
});

router.get('/api/cudo/files/library', requireOwner, async(req,res,next)=>{
  try{
    const documents=await searchLibraryDocuments(req.query.q||'',30);
    res.set('Cache-Control','no-store');
    res.json({ok:true,documents});
  }catch(error){next(error);}
});

router.post('/api/cudo/files/library/:id/attach', requireOwner, async(req,res,next)=>{
  try{
    const file=await attachLibraryDocument({documentId:Number(req.params.id),userId:Number(req.session.user.id)});
    res.json({ok:true,file});
  }catch(error){next(error);}
});

router.post('/api/cudo/attachments/resolve', requireOwner, async(req,res,next)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids:[];
    const files=await listFilesForUser(ids,Number(req.session.user.id));
    res.json({ok:true,files});
  }catch(error){next(error);}
});

router.post('/api/cudo/reset', requireOwner, async (req, res) => {
  await discardDraftFiles(Number(req.session.user.id)).catch(()=>{});
  req.session.cudoState = null;
  req.session.cudoPendingAction = null;
  res.json({ ok:true });
});

module.exports = router;
