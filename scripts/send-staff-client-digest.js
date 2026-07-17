const {db,APP_URL,reserveLog,finishLog,closeDb}=require('./digest-common');
const {sendStaffClientDigest}=require('../src/services/digest-mailer');
(async()=>{try{
  const [staffRows]=await db.query(`SELECT s.id,s.full_name,s.email,COALESCE(p.client_digest_enabled,1) enabled FROM staff_users s
    LEFT JOIN staff_digest_preferences p ON p.staff_id=s.id WHERE s.is_active=1 AND s.email IS NOT NULL AND s.email<>''`);
  for(const staff of staffRows){if(!staff.enabled)continue;
    const [birthdays]=await db.execute(`SELECT DISTINCT c.id,c.account_number,c.client_name,c.cell_number,c.email,c.birthday,
      (SELECT COUNT(*) FROM clients x WHERE (c.account_number<>'' AND x.account_number=c.account_number) OR (c.id_number<>'' AND x.id_number=c.id_number)) line_count
      FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:id AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
      WHERE c.birthday IS NOT NULL AND DAY(c.birthday)=DAY(CURRENT_DATE()) AND MONTH(c.birthday)=MONTH(CURRENT_DATE()) ORDER BY c.client_name`,{id:staff.id});
    const [upgrades]=await db.execute(`SELECT DISTINCT c.id,c.account_number,c.client_name,c.cell_number,c.email,c.handset,c.package_name,c.upgrade_date,
      (SELECT COUNT(*) FROM clients x WHERE (c.account_number<>'' AND x.account_number=c.account_number) OR (c.id_number<>'' AND x.id_number=c.id_number)) line_count
      FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:id AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
      WHERE DATE(c.upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY) ORDER BY c.upgrade_date,c.client_name`,{id:staff.id});
    if(!birthdays.length&&!upgrades.length)continue;
    const logId=await reserveLog({staffId:staff.id,email:staff.email,type:'staff_clients',slot:'08:00',itemCount:birthdays.length+upgrades.length});if(!logId)continue;
    const result=await sendStaffClientDigest({staff,birthdays,upgrades,appUrl:APP_URL,digestDate:new Date()});await finishLog(logId,result);console.log(`${staff.email}: ${result.sent?'sent':'failed'} (${birthdays.length+upgrades.length} clients)`);
  }
}catch(e){console.error(e);process.exitCode=1;}finally{await closeDb();}})();
