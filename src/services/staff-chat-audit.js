'use strict';
const db=require('../config/db');
let schemaPromise=null;
async function ensureSchema(){
 if(!schemaPromise)schemaPromise=(async()=>{
  await db.execute('CREATE TABLE IF NOT EXISTS staff_chat_read_receipts ('+
    'message_id BIGINT UNSIGNED NOT NULL,staff_id BIGINT UNSIGNED NOT NULL,'+
    'conversation_key VARCHAR(80) NOT NULL,read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'PRIMARY KEY (message_id,staff_id),KEY idx_staff_chat_receipt_staff_date (staff_id,read_at),'+
    'KEY idx_staff_chat_receipt_conversation (conversation_key,staff_id,read_at)) '+
    'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  await db.execute('CREATE TABLE IF NOT EXISTS staff_chat_reply_links ('+
    'reply_message_id BIGINT UNSIGNED NOT NULL,incoming_message_id BIGINT UNSIGNED NOT NULL,'+
    'replying_staff_id BIGINT UNSIGNED NOT NULL,linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'PRIMARY KEY (reply_message_id),KEY idx_staff_chat_reply_incoming (incoming_message_id,replying_staff_id),'+
    'KEY idx_staff_chat_reply_staff_date (replying_staff_id,linked_at)) '+
    'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
async function saveMessageReads(conn,staffId,key,rows){
 const staff=validId(staffId);
 if(!staff||!Array.isArray(rows)||!rows.length)return 0;
 const inbound=[...new Set(rows.filter(row=>
  Number(row.sender_staff_id||row.senderId)!==staff)
  .map(row=>validId(row.id)).filter(Boolean))].slice(0,120);
 if(!inbound.length)return 0;
 const placeholders=inbound.map(()=>'(?,?,?)').join(',');
 const params=inbound.flatMap(id=>[id,staff,key]);
 const [result]=await conn.query(
  'INSERT IGNORE INTO staff_chat_read_receipts (message_id,staff_id,conversation_key) VALUES '+placeholders,params);
 return Number(result.affectedRows||0);
}
async function lastIncomingAwaitingReply(conn,staffId,key){
 const staff=validId(staffId);
 if(!staff||!/^direct:\d+:\d+$/.test(key))return null;
 const [rows]=await conn.execute(
  'SELECT id,sender_staff_id FROM staff_chat_messages WHERE conversation_key=? ORDER BY id DESC LIMIT 1',[key]);
 const last=rows[0];
 return last&&Number(last.sender_staff_id)!==staff?validId(last.id):null;
}
async function saveMessageReply(conn,replyId,incomingId,staffId){
 const reply=validId(replyId),incoming=validId(incomingId),staff=validId(staffId);
 if(!reply||!incoming||!staff)return false;
 const [r]=await conn.execute(
  'INSERT IGNORE INTO staff_chat_reply_links (reply_message_id,incoming_message_id,replying_staff_id) VALUES (?,?,?)',
  [reply,incoming,staff]);
 return Number(r.affectedRows||0)>0;
}
module.exports={ensureSchema,saveMessageReads,lastIncomingAwaitingReply,saveMessageReply};
