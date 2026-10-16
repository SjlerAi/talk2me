'use strict';
const fs=require('fs');const path=require('path');
let pool;
function ownerKey(){const email=String(process.env.ZIPPY_OWNER_EMAIL||'').trim().toLowerCase();if(!email.includes('@'))throw Error('ZIPPY_OWNER_EMAIL is required');return email;}
function getPool(){if(pool)return pool;const mysql=require('mysql2/promise');const req=['ZIPPY_DB_HOST','ZIPPY_DB_NAME','ZIPPY_DB_USER','ZIPPY_DB_PASSWORD'];for(const name of req)if(!process.env[name])throw Error(name+' must be set');pool=mysql.createPool({host:process.env.ZIPPY_DB_HOST,port:Number(process.env.ZIPPY_DB_PORT||3306),user:process.env.ZIPPY_DB_USER,password:process.env.ZIPPY_DB_PASSWORD,database:process.env.ZIPPY_DB_NAME,waitForConnections:true,connectionLimit:3,queueLimit:12,timezone:'Z',dateStrings:true,multipleStatements:false,ssl:process.env.ZIPPY_DB_SSL==='1'?{rejectUnauthorized:true}:undefined});return pool;}
async function query(sql,params=[]){return getPool().execute(sql,params);}
async function bootstrap(){const schema=fs.readFileSync(path.join(__dirname,'../sql/schema.sql'),'utf8');const statements=schema.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);for(const stmt of statements)await getPool().query(stmt);}
async function close(){if(pool){await pool.end();pool=null;}}
function utcSql(date){const d=new Date(date);if(!Number.isFinite(d.getTime()))throw Error('Invalid date');return d.toISOString().slice(0,23).replace('T',' ');}
function toIso(value){if(!value)return null;const d=new Date(String(value).replace(' ','T')+'Z');return Number.isFinite(d.getTime())?d.toISOString():null;}
module.exports={query,getPool,bootstrap,close,ownerKey,utcSql,toIso};
