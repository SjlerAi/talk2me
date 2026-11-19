'use strict';
// cPanel cron: 00:00 at the beginning of the 7th, Africa/Johannesburg.
const fs=require('node:fs');
const dotenv=require('dotenv');
const env=dotenv.parse(fs.readFileSync('/home/talk/crm-migration/production-runtime.env'));
for(const [key,value] of Object.entries({
 CRM_LIVE_MODE:'true',
 APP_URL:'https://crm.tk2m.co.za',
 DB_NAME:'talk_crm_stage',
 DB_USER:'talk_crmstg'
})){
 if(env[key]!==value)throw new Error('Library archive refused: incorrect '+key);
}
Object.assign(process.env,env,{TZ:'Africa/Johannesburg'});
const db=require('../src/config/db');
const {archiveLibrary}=require('../src/services/tk2m-library-monthly-archive');
(async()=>{
 try{
   const result=await archiveLibrary(db,{catchUp:process.argv.includes('--catch-up')});
   console.log('[library-monthly-archive]',JSON.stringify(result));
 }finally{
   await db.end();
 }
})().catch(error=>{console.error('[library-monthly-archive-failed]',error.message);process.exitCode=1});
