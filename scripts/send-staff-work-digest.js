const {db,APP_URL,reserveLog,finishLog,closeDb}=require('./digest-common');
const {sendStaffWorkDigest}=require('../src/services/digest-mailer');
(async()=>{try{
  const [staffRows]=await db.query(`SELECT s.id,s.full_name,s.email,COALESCE(p.work_digest_enabled,1) enabled,COALESCE(p.send_all_clear,1) send_all_clear
    FROM staff_users s LEFT JOIN staff_digest_preferences p ON p.staff_id=s.id
    WHERE s.is_active=1 AND s.email IS NOT NULL AND s.email<>''`);
  for(const staff of staffRows){ if(!staff.enabled) continue;
    const [tasks]=await db.execute(`SELECT t.id,t.title,t.message,t.priority,t.due_at,cl.client_name,cl.cell_number,(t.due_at<CURRENT_DATE()) is_overdue
      FROM staff_tasks t LEFT JOIN clients cl ON cl.id=t.related_client_id
      WHERE t.assigned_to=:id AND t.status IN ('unread','seen','in_progress') AND t.due_at IS NOT NULL AND DATE(t.due_at)<=CURRENT_DATE()
      ORDER BY t.due_at ASC`,{id:staff.id});
    const [cases]=await db.execute(`SELECT i.id,i.client_name,i.cell_number,i.query_text,i.result_found,i.action_taken,i.priority,i.follow_up_at,(i.follow_up_at<CURRENT_DATE()) is_overdue
      FROM inquiries i WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:id AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')
      AND i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)<=CURRENT_DATE() ORDER BY i.follow_up_at ASC`,{id:staff.id});
    if(!staff.send_all_clear && !tasks.length && !cases.length) continue;
    const logId=await reserveLog({staffId:staff.id,email:staff.email,type:'staff_work',slot:'06:00',itemCount:tasks.length+cases.length}); if(!logId) continue;
    const result=await sendStaffWorkDigest({staff,tasks,cases,appUrl:APP_URL,digestDate:new Date()}); await finishLog(logId,result);
    console.log(`${staff.email}: ${result.sent?'sent':'failed'} (${tasks.length+cases.length} items)`);
  }
}catch(e){console.error(e);process.exitCode=1;}finally{await closeDb();}})();
