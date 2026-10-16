'use strict';
// Zippy authenticates approved users against the LIVE CRM password hash using
// a SELECT-only MySQL account. Passwords and hashes never reach the browser.
const crypto=require('crypto');
const mysql=require('mysql2/promise');
const bcrypt=require('bcryptjs');
const ALLOWED=new Set(['gerda@talk-online.co.za','info@b4s.co.za']);
let pool=null;
function normalizedEmail(value){return String(value||'').trim().toLowerCase();}
function configured(){
 return ['ZIPPY_CRM_AUTH_HOST','ZIPPY_CRM_AUTH_USER','ZIPPY_CRM_AUTH_PASSWORD','ZIPPY_CRM_AUTH_DATABASE']
  .every(key=>Boolean(process.env[key]));
}
function credentials(){
 if(!configured())throw Error('Live CRM sign-in is not configured.');
 // Deliberately different from the UAT CRM-bridge DB. This connection must have
 // SELECT privilege only. Never reuse the live CRM application write user.
 return {
  host:process.env.ZIPPY_CRM_AUTH_HOST,
  port:Number(process.env.ZIPPY_CRM_AUTH_PORT||3306),
  user:process.env.ZIPPY_CRM_AUTH_USER,
  password:process.env.ZIPPY_CRM_AUTH_PASSWORD,
  database:process.env.ZIPPY_CRM_AUTH_DATABASE,
  connectionLimit:2,waitForConnections:true,queueLimit:5,connectTimeout:5000,
  timezone:'Z',dateStrings:true,enableKeepAlive:false
 };
}
function getPool(){if(!pool)pool=mysql.createPool(credentials());return pool;}
async function findApprovedUser(email){
 const key=normalizedEmail(email);
 if(!ALLOWED.has(key)||!configured())return null;
 const [rows]=await getPool().execute(
  'SELECT id,email,first_name,full_name,role,is_active,password_hash FROM staff_users WHERE LOWER(email)=? AND is_active=1 LIMIT 2',
  [key]);
 if(rows.length!==1||String(rows[0].role).toLowerCase()!=='owner'||!rows[0].password_hash)return null;
 const row=rows[0];
 return {id:Number(row.id),email:key,firstName:String(row.first_name||row.full_name||'').trim().split(/\s+/)[0],
  role:String(row.role).toLowerCase(),passwordHash:String(row.password_hash)};
}
function credentialMarker(user){
 const secret=String(process.env.ZIPPY_COOKIE_SECRET||'');
 if(secret.length<48)throw Error('Missing Zippy session signing secret.');
 return crypto.createHmac('sha256',secret).update([user.id,user.email,user.role,user.passwordHash].join(':')).digest('hex');
}
async function verifyLogin(email,password){
 const key=normalizedEmail(email);
 if(!ALLOWED.has(key)||typeof password!=='string'||password.length<1||password.length>256)return null;
 if(!configured())throw Error('Live CRM authentication service is not configured.');
 const user=await findApprovedUser(key);
 if(!user||!await bcrypt.compare(password,user.passwordHash))return null;
 const {passwordHash,...safe}=user;
 return {...safe,credentialMarker:credentialMarker(user)};
}
async function verifySession(email,marker){
 if(!/^[0-9a-f]{64}$/.test(String(marker||'')))return null;
 const user=await findApprovedUser(email);
 if(!user)return null;
 const expected=credentialMarker(user);
 if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(marker,'hex')))return null;
 const {passwordHash,...safe}=user;
 return safe;
}
async function close(){if(pool){await pool.end();pool=null;}}
module.exports={ALLOWED,configured,normalizedEmail,findApprovedUser,verifyLogin,verifySession,credentialMarker,close};
