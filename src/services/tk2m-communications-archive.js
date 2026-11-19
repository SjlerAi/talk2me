'use strict';
// The user's old inbox items are archived PER RECIPIENT without deleting or
// marking original chat messages, notification tasks or workflow events read.
// This uses the existing staff_attention_acknowledgments table; no migration.
const LIVE=String(process.env.CRM_LIVE_MODE||'').toLowerCase()==='true';
const zero=()=>({chatId:0,notificationTaskId:0,workflowId:0});
async function getArchiveCutoffs(db,staffId){
 const staff=Number(staffId);
 if(!LIVE||!Number.isSafeInteger(staff)||staff<1)return zero();
 const [[row]]=await db.execute(`
   SELECT
     COALESCE(MAX(CASE WHEN source_kind='arc_chat' THEN source_id END),0) chatId,
     COALESCE(MAX(CASE WHEN source_kind='arc_task' THEN source_id END),0) notificationTaskId,
     COALESCE(MAX(CASE WHEN source_kind='arc_update' THEN source_id END),0) workflowId
   FROM staff_attention_acknowledgments
   WHERE staff_id=:staffId
     AND source_kind IN ('arc_chat','arc_task','arc_update')`,{staffId:staff});
 return {
   chatId:Math.max(0,Number(row?.chatId||0)),
   notificationTaskId:Math.max(0,Number(row?.notificationTaskId||0)),
   workflowId:Math.max(0,Number(row?.workflowId||0))
 };
}
module.exports={getArchiveCutoffs};
