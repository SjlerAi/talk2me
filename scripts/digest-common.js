require('dotenv').config();
const db=require('../src/config/db');

const APP_URL=String(process.env.APP_URL || 'https://talk2me.uent.co.za').replace(/\/$/,'');
const SLOT_DATE_SQL='CURRENT_DATE()';

function effectiveSlot(slot) {
  if (String(process.env.DIGEST_FORCE_SEND || '') !== '1') return slot;
  const stamp = new Date().toISOString().slice(11,19).replace(/:/g,'');
  return `${slot}-T${stamp}`.slice(0,20);
}

async function reserveLog({staffId,email,type,slot,itemCount}) {
  const scheduledSlot=effectiveSlot(slot);
  try {
    const [r]=await db.execute(`INSERT INTO daily_email_log (staff_id,recipient_email,email_type,digest_date,scheduled_slot,item_count,status)
      VALUES (:staffId,:email,:type,CURRENT_DATE(),:slot,:itemCount,'pending')`,{staffId:staffId||null,email,type,slot:scheduledSlot,itemCount});
    return r.insertId;
  } catch(e) { if(e.code==='ER_DUP_ENTRY') return null; throw e; }
}
async function finishLog(id,result) {
  if(!id) return;
  await db.execute(`UPDATE daily_email_log SET status=:status,message_id=:messageId,error_message=:error,sent_at=:sentAt WHERE id=:id`,{
    id,status:result.sent?'sent':'failed',messageId:result.messageId||null,error:result.sent?null:String(result.error||'Unknown email error').slice(0,500),sentAt:result.sent?new Date():null
  });
}
async function closeDb(){ if(typeof db.end==='function') await db.end(); }
module.exports={db,APP_URL,reserveLog,finishLog,closeDb,SLOT_DATE_SQL};
