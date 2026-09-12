'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { sendTaskEmail } = require('../services/mailer');

const router = express.Router();

function optionalId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

router.post('/tasks', requireAuth, async (req, res, next) => {
  if (req.body?.type !== 'notification' || req.body?.follow_up_task !== '1') return next();

  try {
    const title = cleanText(req.body.title, 180);
    const message = cleanText(req.body.message, 10000);
    const assignedTo = optionalId(req.body.assigned_to);
    const dueAt = String(req.body.due_at || '').trim() || null;
    const priority = ['normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal';

    if (!title) return res.status(400).render('error', { title: 'Could not send message', message: 'Enter a title for the message.' });
    if (!message) return res.status(400).render('error', { title: 'Could not send message', message: 'Enter the message.' });
    if (!assignedTo) return res.status(400).render('error', { title: 'Could not send message', message: 'Select a staff member.' });
    if (!dueAt) return res.status(400).render('error', { title: 'Could not create follow-up', message: 'Select a follow-up due date and time.' });

    const [[recipient]] = await db.execute(
      'SELECT id,full_name,email FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',
      { id: assignedTo }
    );
    if (!recipient) return res.status(400).render('error', { title: 'Could not send message', message: 'Select an active staff member.' });

    const relatedClientId = optionalId(req.body.related_client_id);
    const relatedInquiryId = optionalId(req.body.related_inquiry_id);
    const relatedFixedAccountId = optionalId(req.body.related_fixed_account_id);
    const relatedFixedServiceId = optionalId(req.body.related_fixed_service_id);
    const createdBy = req.session.user.id;
    const emailRequested = req.body.send_email === '1';

    const conn = await db.getConnection();
    let notificationId;
    let taskId;
    try {
      await conn.beginTransaction();

      const [notification] = await conn.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,related_fixed_account_id,related_fixed_service_id,related_inquiry_id,email_status)
        VALUES ('notification',:title,:message,:priority,:assignedTo,:createdBy,NULL,:relatedClientId,:relatedFixedAccountId,:relatedFixedServiceId,:relatedInquiryId,'not_configured')`, {
        title,
        message,
        priority,
        assignedTo,
        createdBy,
        relatedClientId,
        relatedFixedAccountId,
        relatedFixedServiceId,
        relatedInquiryId
      });
      notificationId = notification.insertId;

      const followUpTitle = `Follow up: ${title}`.slice(0, 180);
      const followUpMessage = `Follow-up for internal message #${notificationId}.\n\n${message}`.slice(0, 10000);
      const [task] = await conn.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,related_fixed_account_id,related_fixed_service_id,related_inquiry_id,email_status)
        VALUES ('task',:title,:message,:priority,:assignedTo,:createdBy,:dueAt,:relatedClientId,:relatedFixedAccountId,:relatedFixedServiceId,:relatedInquiryId,:emailStatus)`, {
        title: followUpTitle,
        message: followUpMessage,
        priority,
        assignedTo,
        createdBy,
        dueAt,
        relatedClientId,
        relatedFixedAccountId,
        relatedFixedServiceId,
        relatedInquiryId,
        emailStatus: emailRequested ? 'pending' : 'not_configured'
      });
      taskId = task.insertId;

      await conn.execute(
        'INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:staffId,:comment)',
        { taskId: notificationId, staffId: createdBy, comment: `Follow-up task #${taskId} created with due date ${dueAt}.` }
      );
      await conn.execute(
        'INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:staffId,:comment)',
        { taskId, staffId: createdBy, comment: `Created from internal message #${notificationId}.` }
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    if (emailRequested) {
      let emailResult;
      try {
        emailResult = await sendTaskEmail({
          to: recipient.email,
          staffName: recipient.full_name,
          task: {
            id: taskId,
            type: 'task',
            title: `Follow up: ${title}`.slice(0, 180),
            message: `Follow-up for internal message #${notificationId}.\n\n${message}`.slice(0, 10000),
            priority,
            due_at: dueAt,
            created_by_name: req.session.user.full_name
          },
          appUrl: process.env.APP_URL || `${req.protocol}://${req.get('host')}${res.locals.basePath}`
        });
      } catch (emailError) {
        emailResult = { sent: false, error: emailError.message || 'Email delivery failed.' };
      }
      await db.execute(`UPDATE staff_tasks
        SET email_status=:status,email_sent_at=:sentAt,email_error=:error
        WHERE id=:id`, {
        id: taskId,
        status: emailResult.sent ? 'sent' : (String(emailResult.error || '').includes('not configured') ? 'not_configured' : 'failed'),
        sentAt: emailResult.sent ? new Date() : null,
        error: emailResult.sent ? null : String(emailResult.error || '').slice(0, 500)
      });
    }

    return res.redirect(`${res.locals.basePath}/tasks/${taskId}?created=1&message_id=${notificationId}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
