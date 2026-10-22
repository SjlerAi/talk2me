'use strict';
// Per-owner persistent conversation; messages never enter the Talk2Me database.
const {query}=require('./db');
const ROLES=new Set(['user','assistant']);
async function append(owner,role,text,kind='chat'){
 if(!ROLES.has(role)||!owner)return false;
 const body=String(text||'').trim().slice(0,3500);
 if(!body)return false;
 await query('INSERT INTO zippy_conversation(owner_key,role,body,kind) VALUES(?,?,?,?)',
  [owner,role,body,String(kind||'chat').slice(0,32)]);
 return true;
}
async function recent(owner,limit=50){
 const [rows]=await query('SELECT id,role,body,kind,created_at FROM zippy_conversation WHERE owner_key=? ORDER BY id DESC LIMIT ?',
  [owner,Math.max(1,Math.min(80,Number(limit)||50))]);
 return rows.reverse().map(r=>({id:Number(r.id),role:r.role,text:r.body,kind:r.kind,createdAt:r.created_at}));
}
module.exports={append,recent};
