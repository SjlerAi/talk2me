const {db,APP_URL,reserveLog,finishLog,closeDb}=require('./digest-common');
const {sendOwnerDailyBrief}=require('../src/services/digest-mailer');
(async()=>{try{
  const [owners]=await db.query(`SELECT s.id,s.full_name,s.email,COALESCE(p.owner_digest_enabled,1) enabled FROM staff_users s
    LEFT JOIN staff_digest_preferences p ON p.staff_id=s.id WHERE s.is_active=1 AND s.role IN ('owner','manager') AND s.email IS NOT NULL AND s.email<>''`);
  const [birthdays]=await db.query(`SELECT id,client_name,cell_number,email,birthday FROM clients WHERE birthday IS NOT NULL AND DAY(birthday)=DAY(CURRENT_DATE()) AND MONTH(birthday)=MONTH(CURRENT_DATE()) ORDER BY client_name`);
  const [upgrades]=await db.query(`SELECT id,account_number,client_name,cell_number,email,handset,package_name,upgrade_date FROM clients WHERE DATE(upgrade_date)=CURRENT_DATE() ORDER BY client_name`);
  const [[operational]]=await db.query(`SELECT
    (SELECT COUNT(*) FROM staff_tasks WHERE status IN ('unread','seen','in_progress') AND due_at IS NOT NULL AND due_at<CURRENT_DATE()) overdue,
    (SELECT COUNT(*) FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')) open_cases`);
  const [claims]=await db.query(`SELECT r.id,r.account_number,r.summary,r.created_at,s.full_name requested_by_name FROM data_change_requests r JOIN staff_users s ON s.id=r.requested_by WHERE r.request_type='claim_account' AND r.status IN ('pending_manager','pending_owner') ORDER BY r.created_at`);
  for(const owner of owners){if(!owner.enabled)continue;const count=birthdays.length+upgrades.length+claims.length+Number(operational.overdue||0)+Number(operational.open_cases||0);
    const logId=await reserveLog({staffId:owner.id,email:owner.email,type:'owner_daily',slot:'06:05',itemCount:count});if(!logId)continue;
    const result=await sendOwnerDailyBrief({owner,birthdays,upgrades,claims,operational,appUrl:APP_URL,digestDate:new Date()});await finishLog(logId,result);console.log(`${owner.email}: ${result.sent?'sent':'failed'}`);
  }
}catch(e){console.error(e);process.exitCode=1;}finally{await closeDb();}})();
