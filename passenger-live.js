'use strict';
// Separate immutable TK2M production launcher. Secrets remain outside the Git checkout.
const fs=require('node:fs');
const path=require('node:path');
const dotenv=require('dotenv');
process.env.UV_THREADPOOL_SIZE=process.env.UV_THREADPOOL_SIZE||'1';
const runtime=String(process.env.CRM_RUNTIME_ENV_FILE||'').trim();
const approved='/home/talk/crm-migration/production-runtime.env';
if(path.resolve(runtime||'/')!==approved)throw Error('Live CRM requires dedicated private production configuration');
const info=fs.statSync(approved);
if(!info.isFile()||(info.mode&0o077)!==0)throw Error('Insecure production configuration permissions');
const loaded=dotenv.config({path:approved,override:false});
if(loaded.error)throw loaded.error;
if(String(process.env.CRM_LIVE_MODE)!=='true'||String(process.env.CRM_STAGE_MODE)!=='false'||String(process.env.UAT_MODE)!=='true'){
 throw Error('Production launcher requires live mode with the complete office feature set');
}
require('./server');
