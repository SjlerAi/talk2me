const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function createAdministrationRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  const uploadDir = path.join(__dirname, 'runtime', 'admin-uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype))
  });
  const canManage = user => ['owner','manager'].includes(user.role);
  const isOwner = user => user.role === 'owner';

  async function assertTables() {
    const required = ['os2_launcher_links','os2_staff_documents'];
    const [rows] = await pool.execute(`SELECT TABLE_NAME name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN ('os2_launcher_links','os2_staff_documents')`);
    const available = new Set(rows.map(row => row.name));
    const missing = required.filter(name => !available.has(name));
    if (missing.length) {
      const error = new Error('ADMINISTRATION_SCHEMA_MIGRATION_REQUIRED');
      error.code = 'ADMINISTRATION_SCHEMA_MIGRATION_REQUIRED';
      error.missingTables = missing;
      throw error;
    }
  }

  async function audit(req, actionType, entityType, entityId, description, before, after) {
    await pool.execute(`INSERT INTO audit_log
      (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent,created_at)
      VALUES (:staffId,:actionType,:entityType,:entityId,:description,:beforeJson,:afterJson,:ip,:agent,NOW())`, {
      staffId:req.user.id, actionType, entityType, entityId, description,
      beforeJson:before ? JSON.stringify(before) : null, afterJson:after ? JSON.stringify(after) : null,
      ip:requestIp(req), agent:String(req.headers['user-agent'] || '').slice(0,255)
    });
  }
  const requireManager = (req,res,next) => canManage(req.user) ? next() : res.status(403).json({ok:false,error:'INSUFFICIENT_PERMISSION'});
  const requireOwner = (req,res,next) => isOwner(req.user) ? next() : res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'});

  router.get('/api/administration', requireAuth, requireManager, async (req,res) => {
    try {
      await assertTables();
      const [staff] = await pool.execute(`SELECT id,full_name,username,email,role,is_active,last_login_at,created_at
        FROM staff_users ORDER BY is_active DESC,full_name`);
      const [launchers] = await pool.execute('SELECT * FROM os2_launcher_links ORDER BY sort_order,link_name');
      const [[sessions]] = await pool.execute('SELECT COUNT(*) total FROM app_sessions WHERE expires_at>NOW()');
      const [[clients]] = await pool.execute('SELECT COUNT(*) total FROM clients WHERE is_active=1');
      const [auditItems] = await pool.execute(`SELECT a.id, a.action_type, a.entity_type, a.entity_id,
          a.description, a.before_json, a.after_json, a.created_at,
          COALESCE(s.full_name, CONCAT('Staff #', a.staff_id)) staff_name
        FROM audit_log a
        LEFT JOIN staff_users s ON s.id=a.staff_id
        ORDER BY a.id DESC
        LIMIT 100`);
      res.json({
        ok:true,
        canDelete:isOwner(req.user),
        staff,
        launchers,
        audit:auditItems,
        system:{
          version:require('./package.json').version,
          environment:process.env.NODE_ENV||'development',
          database:process.env.DB_NAME||'',
          activeSessions:Number(sessions.total||0),
          activeClients:Number(clients.total||0)
        }
      });
    } catch(error) { console.error('Administration load failed',error.code||error.message); res.status(500).json({ok:false,error:error.code||'ADMINISTRATION_LOAD_FAILED'}); }
  });

  router.post('/api/administration/staff', requireAuth, requireManager, async (req,res) => {
    const fullName=String(req.body.fullName||'').trim().slice(0,160), username=String(req.body.username||'').trim().slice(0,80), email=String(req.body.email||'').trim().toLowerCase().slice(0,190), password=String(req.body.password||'');
    let role=String(req.body.role||'staff').toLowerCase();
    if (!fullName || !username || !email || password.length<8) return res.status(400).json({ok:false,error:'ENTER_VALID_STAFF_DETAILS'});
    if (!['owner','manager','staff'].includes(role)) role='staff';
    if (!isOwner(req.user) && role==='owner') return res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'});
    try {
      const hash=await bcrypt.hash(password,12);
      const [result]=await pool.execute(`INSERT INTO staff_users (full_name,username,email,role,password_hash,is_active,created_at,updated_at)
        VALUES (:fullName,:username,:email,:role,:hash,1,NOW(),NOW())`,{fullName,username,email,role,hash});
      await audit(req,'staff_created','staff_users',result.insertId,`Created staff account for ${fullName}`,null,{fullName,username,email,role});
      res.status(201).json({ok:true,id:Number(result.insertId)});
    } catch(error) { res.status(error.code==='ER_DUP_ENTRY'?409:500).json({ok:false,error:error.code||'STAFF_CREATE_FAILED'}); }
  });

  router.put('/api/administration/staff/:id', requireAuth, requireManager, async (req,res) => {
    const id=Number(req.params.id), fullName=String(req.body.fullName||'').trim().slice(0,160), username=String(req.body.username||'').trim().slice(0,80), email=String(req.body.email||'').trim().toLowerCase().slice(0,190), active=req.body.isActive?1:0;
    let role=String(req.body.role||'staff').toLowerCase();
    if (!Number.isInteger(id)||id<1||!fullName||!username||!email||!['owner','manager','staff'].includes(role)) return res.status(400).json({ok:false,error:'INVALID_STAFF_DETAILS'});
    if (!isOwner(req.user) && role==='owner') return res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'});
    if (id===Number(req.user.id) && !active) return res.status(409).json({ok:false,error:'CANNOT_DEACTIVATE_YOURSELF'});
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[before]]=await connection.execute('SELECT id,full_name,username,email,role,is_active FROM staff_users WHERE id=:id FOR UPDATE',{id});
      if(!before){await connection.rollback();return res.status(404).json({ok:false,error:'STAFF_NOT_FOUND'});}
      if(before.role==='owner'&&!isOwner(req.user)){await connection.rollback();return res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'});}
      await connection.execute(`UPDATE staff_users SET full_name=:fullName,username=:username,email=:email,role=:role,is_active=:active,updated_at=NOW() WHERE id=:id`,{id,fullName,username,email,role,active});
      if(!active) await connection.execute("DELETE FROM app_sessions WHERE session_data LIKE :needle",{needle:`%\"id\":${id}%`});
      await audit(req,'staff_updated','staff_users',id,`Updated staff account ${fullName}`,before,{fullName,username,email,role,is_active:active});
      await connection.commit(); res.json({ok:true});
    } catch(error){await connection.rollback();res.status(error.code==='ER_DUP_ENTRY'?409:500).json({ok:false,error:error.code||'STAFF_UPDATE_FAILED'});} finally{connection.release();}
  });

  router.post('/api/administration/staff/:id/reset-password', requireAuth, requireManager, async (req,res) => {
    const id=Number(req.params.id), password=String(req.body.password||'');
    if(!Number.isInteger(id)||id<1||password.length<8)return res.status(400).json({ok:false,error:'PASSWORD_MUST_BE_8_CHARACTERS'});
    try{
      const [[staff]]=await pool.execute('SELECT id,full_name,role FROM staff_users WHERE id=:id',{id});
      if(!staff)return res.status(404).json({ok:false,error:'STAFF_NOT_FOUND'});
      if(staff.role==='owner'&&!isOwner(req.user))return res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'});
      const hash=await bcrypt.hash(password,12);
      await pool.execute('UPDATE staff_users SET password_hash=:hash,updated_at=NOW() WHERE id=:id',{id,hash});
      await pool.execute("DELETE FROM app_sessions WHERE session_data LIKE :needle",{needle:`%\"id\":${id}%`});
      await audit(req,'staff_password_reset','staff_users',id,`Reset password for ${staff.full_name}`,null,{sessions_revoked:true});
      res.json({ok:true});
    }catch(error){res.status(500).json({ok:false,error:error.code||'PASSWORD_RESET_FAILED'});}
  });

  router.delete('/api/administration/staff/:id', requireAuth, requireOwner, async (req,res) => {
    const id=Number(req.params.id); if(!Number.isInteger(id)||id<1)return res.status(400).json({ok:false,error:'INVALID_STAFF_ID'});
    if(id===Number(req.user.id))return res.status(409).json({ok:false,error:'CANNOT_REMOVE_YOURSELF'});
    try{
      const [[staff]]=await pool.execute('SELECT id,full_name,role FROM staff_users WHERE id=:id',{id});
      if(!staff)return res.status(404).json({ok:false,error:'STAFF_NOT_FOUND'});
      await pool.execute('UPDATE staff_users SET is_active=0,username=CONCAT(username,".removed.",id),email=CONCAT("removed+",id,"@invalid.local"),updated_at=NOW() WHERE id=:id',{id});
      await pool.execute("DELETE FROM app_sessions WHERE session_data LIKE :needle",{needle:`%\"id\":${id}%`});
      await audit(req,'staff_removed','staff_users',id,`Removed staff access for ${staff.full_name}`,staff,{is_active:0});
      res.json({ok:true});
    }catch(error){res.status(500).json({ok:false,error:error.code||'STAFF_REMOVE_FAILED'});}
  });

  router.post('/api/administration/staff/:id/document', requireAuth, requireManager, upload.single('file'), async (req,res) => {
    const staffId=Number(req.params.id), type=String(req.body.type||'photo');
    if(!req.file||!Number.isInteger(staffId)||staffId<1||!['photo','id_document'].includes(type))return res.status(400).json({ok:false,error:'INVALID_DOCUMENT_UPLOAD'});
    try{
      await assertTables();
      const [result]=await pool.execute(`INSERT INTO os2_staff_documents (staff_id,document_type,original_name,stored_name,mime_type,file_size,uploaded_by)
        VALUES (:staffId,:type,:original,:stored,:mime,:size,:uploadedBy)`,{staffId,type,original:req.file.originalname,stored:req.file.filename,mime:req.file.mimetype,size:req.file.size,uploadedBy:req.user.id});
      await audit(req,'staff_document_uploaded','os2_staff_documents',result.insertId,`Uploaded ${type} for staff #${staffId}`,null,{staffId,type,original:req.file.originalname});
      res.status(201).json({ok:true,id:Number(result.insertId)});
    }catch(error){try{fs.unlinkSync(req.file.path);}catch{}res.status(500).json({ok:false,error:error.code||'DOCUMENT_UPLOAD_FAILED'});}
  });

  router.post('/api/administration/launchers', requireAuth, requireOwner, async (req,res) => {
    await assertTables(); const name=String(req.body.name||'').trim().slice(0,80), url=String(req.body.url||'').trim().slice(0,500), icon=String(req.body.icon||'↗').trim().slice(0,8), order=Number(req.body.order||0);
    if(!name||!/^https:\/\//i.test(url))return res.status(400).json({ok:false,error:'ENTER_VALID_HTTPS_LINK'});
    const [result]=await pool.execute('INSERT INTO os2_launcher_links (link_name,link_url,icon_text,sort_order,is_active) VALUES (:name,:url,:icon,:order,1)',{name,url,icon,order});
    await audit(req,'launcher_created','os2_launcher_links',result.insertId,`Created launcher ${name}`,null,{name,url,icon,order}); res.status(201).json({ok:true,id:Number(result.insertId)});
  });

  router.put('/api/administration/launchers/:id', requireAuth, requireOwner, async (req,res) => {
    await assertTables(); const id=Number(req.params.id),name=String(req.body.name||'').trim().slice(0,80),url=String(req.body.url||'').trim().slice(0,500),icon=String(req.body.icon||'↗').trim().slice(0,8),order=Number(req.body.order||0),active=req.body.isActive?1:0;
    if(!Number.isInteger(id)||id<1||!name||!/^https:\/\//i.test(url))return res.status(400).json({ok:false,error:'INVALID_LAUNCHER'});
    const [[before]]=await pool.execute('SELECT * FROM os2_launcher_links WHERE id=:id',{id}); if(!before)return res.status(404).json({ok:false,error:'LAUNCHER_NOT_FOUND'});
    await pool.execute('UPDATE os2_launcher_links SET link_name=:name,link_url=:url,icon_text=:icon,sort_order=:order,is_active=:active WHERE id=:id',{id,name,url,icon,order,active});
    await audit(req,'launcher_updated','os2_launcher_links',id,`Updated launcher ${name}`,before,{name,url,icon,order,is_active:active}); res.json({ok:true});
  });

  router.get('/api/launchers', requireAuth, async (req,res) => { try{await assertTables();const [items]=await pool.execute('SELECT id,link_name,link_url,icon_text FROM os2_launcher_links WHERE is_active=1 ORDER BY sort_order,link_name');res.json({ok:true,items});}catch(error){res.status(500).json({ok:false,error:error.code||'LAUNCHERS_FAILED'});} });
  return router;
};
