'use strict';

const express = require('express');
const multer = require('multer');
const { audit } = require('../services/audit');
const { requireAuth } = require('../middleware/auth');
const {
  ensureManagementSchema,
  buildManagementOverview,
  answerManagementQuestion,
  importMailboxFile,
  saveMailboxAttachmentsToDeals,
  notifyDealsheetAvailable,
  shareMailboxItemWithStaff,
  staffPerformance,
  weeklyStatsStatus,
  submitWeeklyStats
} = require('../services/management-intelligence');

const router = express.Router();
const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:6*1024*1024,files:1} }).single('email_file');

function management(user) {
  return Boolean(user && ['owner','manager','admin'].includes(String(user.role||'').toLowerCase()));
}
function requireManagement(req,res,next) {
  if(!req.session?.user) return res.redirect(`${res.locals.basePath}/login`);
  if(!management(req.session.user)) return res.status(403).render('error',{title:'Forbidden',message:'Management access required.'});
  next();
}
function rangeKey(req) {
  const raw=String(req.query.range||req.body?.range||'this_week');
  return ['today','this_week','last_7_days','last_14_days','month_to_date'].includes(raw)?raw:'this_week';
}

router.get('/management',requireManagement,async(req,res,next)=>{
  try {
    const overview=await buildManagementOverview(rangeKey(req));
    res.render('management-intelligence',{
      title:'Gerda Management Intelligence',
      overview,
      answer:null,
      commandText:'',
      currentUser:req.session.user
    });
  } catch(error){next(error);}
});

router.post('/management/check',requireManagement,async(req,res,next)=>{
  try {
    const commandText=String(req.body.command||'').trim();
    const [overview,answer]=await Promise.all([
      buildManagementOverview(rangeKey(req)),
      answerManagementQuestion(commandText)
    ]);
    res.render('management-intelligence',{
      title:'Gerda Management Intelligence',
      overview,
      answer,
      commandText,
      currentUser:req.session.user
    });
  } catch(error){next(error);}
});

router.get('/api/management/overview',requireManagement,async(req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    res.json({ok:true,...await buildManagementOverview(rangeKey(req))});
  } catch(error){next(error);}
});

router.post('/api/management/ask',requireManagement,async(req,res,next)=>{
  try {
    const message=String(req.body?.message||'').trim();
    if(!message) return res.status(400).json({ok:false,error:'Ask Gerda a management question.'});
    const result=await answerManagementQuestion(message,{staffId:Number(req.body?.staffId||0)||null});
    await audit(req,{
      actionType:'management_intelligence_query',
      entityType:'management_intelligence',
      entityId:null,
      description:`Gerda management query: ${message.slice(0,180)}`,
      after:{intent:result.intent||'unknown',resultCount:Array.isArray(result.rows)?result.rows.length:0}
    });
    res.set('Cache-Control','no-store');
    res.json({ok:true,...result});
  } catch(error){next(error);}
});

router.post('/management/mailbox/import',requireManagement,(req,res,next)=>{
  upload(req,res,async error=>{
    if(error) return res.status(400).render('error',{title:'Import failed',message:error.message});
    try {
      const result=await importMailboxFile({file:req.file,userId:req.session.user.id});
      await audit(req,{
        actionType:'management_mailbox_imported',
        entityType:'management_mailbox_items',
        entityId:result.itemId,
        description:`Management mailbox item imported${result.isDealsheet?' and detected as dealsheet':''}.`,
        after:result
      });
      res.redirect(`${res.locals.basePath}/management?range=${rangeKey(req)}#mailbox`);
    } catch(err){next(err);}
  });
});

router.post('/management/mailbox/:id/save-deals',requireManagement,async(req,res,next)=>{
  try {
    const result=await saveMailboxAttachmentsToDeals({itemId:Number(req.params.id),userId:req.session.user.id});
    await audit(req,{
      actionType:'management_dealsheet_saved',
      entityType:'management_mailbox_items',
      entityId:Number(req.params.id),
      description:`Gerda saved ${result.saved} mailbox attachment(s) into Deals.`,
      after:{saved:result.saved}
    });
    res.redirect(`${res.locals.basePath}/management#mailbox`);
  } catch(error){next(error);}
});

router.post('/management/mailbox/:id/share',requireManagement,async(req,res,next)=>{
  try {
    const staffId=Number(req.body.staff_id||0);
    if(!staffId) throw new Error('Select a staff member.');
    const result=await shareMailboxItemWithStaff({itemId:Number(req.params.id),staffId});
    await audit(req,{
      actionType:'management_mailbox_shared',
      entityType:'management_mailbox_items',
      entityId:Number(req.params.id),
      description:`Gerda shared mailbox item with ${result.staffName}.`,
      after:result
    });
    res.redirect(`${res.locals.basePath}/management#mailbox`);
  } catch(error){next(error);}
});

router.post('/management/mailbox/:id/notify-staff',requireManagement,async(req,res,next)=>{
  try {
    const result=await notifyDealsheetAvailable({itemId:Number(req.params.id)});
    await audit(req,{
      actionType:'management_dealsheet_staff_notified',
      entityType:'management_mailbox_items',
      entityId:Number(req.params.id),
      description:`Gerda queued dealsheet notification for ${result.staffCount} staff.`,
      after:result
    });
    res.redirect(`${res.locals.basePath}/management#mailbox`);
  } catch(error){next(error);}
});

router.get('/weekly-stats',requireAuth,async(req,res,next)=>{
  try {
    const [performance,status]=await Promise.all([staffPerformance('this_week'),weeklyStatsStatus()]);
    const stats=performance.rows.find(row=>Number(row.id)===Number(req.session.user.id))||null;
    const submitted=status.find(row=>Number(row.id)===Number(req.session.user.id))||null;
    res.render('weekly-stats',{
      title:'My Weekly Stats',
      stats,
      submitted,
      range:performance.range,
      currentUser:req.session.user
    });
  } catch(error){next(error);}
});

router.post('/weekly-stats/submit',requireAuth,async(req,res,next)=>{
  try {
    const result=await submitWeeklyStats({
      staffId:req.session.user.id,
      submittedBy:req.session.user.id,
      note:req.body.note
    });
    await audit(req,{
      actionType:'weekly_stats_self_submitted',
      entityType:'staff_users',
      entityId:req.session.user.id,
      description:`${result.staff_name} submitted weekly Talk2Me statistics.`,
      after:result
    });
    res.redirect(`${res.locals.basePath}/weekly-stats?submitted=1`);
  } catch(error){next(error);}
});

router.post('/management/weekly-stats/submit',requireManagement,async(req,res,next)=>{
  try {
    const staffId=Number(req.body.staff_id||req.session.user.id);
    const result=await submitWeeklyStats({staffId,submittedBy:req.session.user.id,note:req.body.note});
    await audit(req,{
      actionType:'management_weekly_stats_submitted',
      entityType:'staff_users',
      entityId:staffId,
      description:`Weekly management statistics submitted for ${result.staff_name}.`,
      after:result
    });
    res.redirect(`${res.locals.basePath}/management#weekly-stats`);
  } catch(error){next(error);}
});

module.exports=router;
