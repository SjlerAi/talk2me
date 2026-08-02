'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { withTransaction } = require('./core/transactions');
const { appendAudit } = require('./core/audit');
const { requirePermission } = require('./core/permissions');

const allowedTypes = new Set(['id','proof_of_address','bank_statement','company_registration','authority_letter','purchase_order','signed_instruction','other']);
const allowedMime = new Set(['application/pdf','image/jpeg','image/png','image/webp']);

function safeName(value) {
  return String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
}
function requestContext(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0,64),
    userAgent: String(req.headers['user-agent'] || '').slice(0,255)
  };
}

module.exports = function createDocumentRouter({ pool, requireAuth }) {
  const router = express.Router();
  const privateRoot = path.resolve(process.env.OS2_PRIVATE_DOCUMENT_ROOT || path.join(__dirname, '..', 'private-data', 'os2-documents'));
  fs.mkdirSync(privateRoot, { recursive:true, mode:0o700 });
  const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:10*1024*1024, files:1 } });

  router.post('/api/os2/customers/:id/documents', requireAuth, requirePermission('document.upload'), upload.single('document'), async (req,res) => {
    const masterCustomerId = Number(req.params.id);
    const documentType = allowedTypes.has(req.body.documentType) ? req.body.documentType : 'other';
    if (!Number.isInteger(masterCustomerId) || masterCustomerId < 1) return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    if (!req.file) return res.status(400).json({ok:false,error:'DOCUMENT_REQUIRED'});
    if (!allowedMime.has(req.file.mimetype)) return res.status(415).json({ok:false,error:'UNSUPPORTED_DOCUMENT_TYPE'});
    const digest = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const storageName = `${masterCustomerId}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}-${safeName(req.file.originalname)}`;
    const absolutePath = path.resolve(privateRoot, storageName);
    if (!absolutePath.startsWith(`${privateRoot}${path.sep}`)) return res.status(400).json({ok:false,error:'INVALID_STORAGE_PATH'});
    fs.mkdirSync(path.dirname(absolutePath), { recursive:true, mode:0o700 });
    try {
      fs.writeFileSync(absolutePath, req.file.buffer, { mode:0o600, flag:'wx' });
      const documentId = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id FROM os2_master_customers WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id:masterCustomerId});
        if (!customer) throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
        const [insert] = await connection.execute(`INSERT INTO os2_customer_documents (master_customer_id,document_type,original_filename,storage_key,mime_type,file_size,sha256_hash,verification_status,created_by,created_at,updated_at) VALUES (:masterCustomerId,:documentType,:originalFilename,:storageKey,:mimeType,:fileSize,:sha256,'unverified',:actor,NOW(),NOW())`,{
          masterCustomerId,documentType,originalFilename:safeName(req.file.originalname),storageKey:storageName,mimeType:req.file.mimetype,fileSize:req.file.size,sha256:digest,actor:Number(req.user.id)
        });
        const id = Number(insert.insertId);
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'document_uploaded',entityType:'os2_customer_documents',entityId:id,masterCustomerId,description:`Uploaded ${documentType} document`,after:{filename:req.file.originalname,mime_type:req.file.mimetype,file_size:req.file.size,sha256:digest},requestContext:requestContext(req)});
        return id;
      });
      res.status(201).json({ok:true,documentId});
    } catch(error) {
      try { if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath); } catch (_) {}
      console.error('Document upload failed',error.code||error.message);
      res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'DOCUMENT_UPLOAD_FAILED'});
    }
  });

  router.get('/api/os2/documents/:id/download', requireAuth, requirePermission('document.read'), async (req,res) => {
    try {
      const [[doc]] = await pool.execute('SELECT * FROM os2_customer_documents WHERE id=:id AND archived_at IS NULL',{id:Number(req.params.id)});
      if (!doc) return res.status(404).json({ok:false,error:'DOCUMENT_NOT_FOUND'});
      const absolutePath = path.resolve(privateRoot,doc.storage_key);
      if (!absolutePath.startsWith(`${privateRoot}${path.sep}`) || !fs.existsSync(absolutePath)) return res.status(404).json({ok:false,error:'DOCUMENT_FILE_NOT_FOUND'});
      await pool.execute(`INSERT INTO os2_customer_document_access_log (document_id,staff_id,access_type,ip_address,user_agent,created_at) VALUES (:documentId,:staffId,'download',:ip,:userAgent,NOW())`,{documentId:doc.id,staffId:Number(req.user.id),ip:requestContext(req).ip,userAgent:requestContext(req).userAgent});
      res.setHeader('Content-Type',doc.mime_type||'application/octet-stream');
      res.setHeader('Content-Disposition',`attachment; filename="${safeName(doc.original_filename)}"`);
      res.setHeader('X-Content-Type-Options','nosniff');
      fs.createReadStream(absolutePath).pipe(res);
    } catch(error) {
      console.error('Document download failed',error.code||error.message);
      if (!res.headersSent) res.status(500).json({ok:false,error:'DOCUMENT_DOWNLOAD_FAILED'});
    }
  });

  router.post('/api/os2/documents/:id/archive', requireAuth, requirePermission('document.archive'), async (req,res) => {
    try {
      const archived = await withTransaction(pool, async connection => {
        const [[doc]] = await connection.execute('SELECT * FROM os2_customer_documents WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id:Number(req.params.id)});
        if (!doc) throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{statusCode:404});
        await connection.execute('UPDATE os2_customer_documents SET archived_at=NOW(),archived_by=:actor,updated_at=NOW() WHERE id=:id',{id:doc.id,actor:Number(req.user.id)});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'document_archived',entityType:'os2_customer_documents',entityId:doc.id,masterCustomerId:doc.master_customer_id,description:'Archived protected customer document',before:{archived_at:null},after:{archived:true},requestContext:requestContext(req)});
        return true;
      });
      res.json({ok:true,archived});
    } catch(error) {
      res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'DOCUMENT_ARCHIVE_FAILED'});
    }
  });

  return router;
};
