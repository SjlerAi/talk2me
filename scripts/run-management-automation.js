'use strict';

require('dotenv').config();
const db=require('../src/config/db');
const {runAutomation,ensureManagementSchema}=require('../src/services/management-intelligence');

(async()=>{
  const mode=String(process.argv[2]||'').trim();
  if(!mode) throw new Error('Usage: node scripts/run-management-automation.js <attendance-0900|tasks-1600|weekly-reminder-1530|weekly-report-1700|morning-mailbox>');
  try {
    await ensureManagementSchema();
    const result=await runAutomation(mode);
    console.log('MANAGEMENT_AUTOMATION_RESULT='+JSON.stringify(result));
  } finally {
    await db.end();
  }
})().catch(async error=>{
  console.error('MANAGEMENT_AUTOMATION_FAILED:',error && error.stack ? error.stack : error);
  try{await db.end();}catch(_){}
  process.exitCode=1;
});