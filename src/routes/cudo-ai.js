'use strict';

const express = require('express');
const { audit } = require('../services/audit');
const { answerCudo, createTasks, getAlerts } = require('../services/cudo-ai');

const router = express.Router();
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

    const result = await answerCudo({
      message,
      state:req.session.cudoState || null,
      context:safeContext(req.body?.context)
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
      actions:Array.isArray(result.actions) ? result.actions : [],
      suggestions:Array.isArray(result.suggestions) ? result.suggestions : []
    });
  } catch (error) { next(error); }
});

router.post('/api/cudo/action', requireOwner, async (req, res, next) => {
  try {
    const actionName = String(req.body?.action || '').trim();

    if (actionName === 'cancel') {
      req.session.cudoPendingAction = null;
      return res.json({ ok:true, text:'Cancelled. I have not changed anything.' });
    }

    if (actionName !== 'confirm_tasks') {
      return res.status(400).json({ ok:false, error:'Unknown Cudo action.' });
    }

    const pending = req.session.cudoPendingAction;
    if (!pending) return res.status(409).json({ ok:false, error:'There is no pending Cudo task action to confirm.' });

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
  } catch (error) { next(error); }
});

router.post('/api/cudo/reset', requireOwner, (req, res) => {
  req.session.cudoState = null;
  req.session.cudoPendingAction = null;
  res.json({ ok:true });
});

module.exports = router;
