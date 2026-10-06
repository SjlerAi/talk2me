'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { writeZip, safeZipPath } = require('../services/library-zip');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner','admin','manager']);
const privateRoot = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();
const libraryRoot = path.join(privateRoot, 'library');
const libraryFileDir = path.join(libraryRoot, 'files');
const librarySnapshotDir = path.join(libraryRoot, 'snapshots');
const libraryTempDir = path.join(libraryRoot, 'tmp');
let schemaPromise;

const CATEGORIES = ['Favourites','Images','Pricing','PDFs','Forms','Promotions','Training','Documents','Presentations','Other'];

function management(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').toLowerCase()));
}

function requireManager(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok:false, error:'Sign in required.' });
  if (!management(req.session.user)) return res.status(403).json({ ok:false, error:'Manager or administrator access required.' });
  next();
}

function idOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max=5000) {
  return String(value == null ? '' : value).trim().slice(0,max);
}

function safeCategory(value) {
  const raw = clean(value,80);
  return raw || 'Other';
}

function safeMonth(value) {
  const raw = clean(value,7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0,7);
}

function extensionOf(file) {
  return path.extname(String(file?.originalname || '')).toLowerCase();
}

function previewKind(extension, mime) {
  const ext = String(extension || '').toLowerCase();
  const type = String(mime || '').toLowerCase();
  if (['.jpg','.jpeg','.png','.webp','.gif'].includes(ext) || type.startsWith('image/')) return 'image';
  if (ext === '.pdf' || type === 'application/pdf') return 'pdf';
  if (['.xlsx','.xls','.csv'].includes(ext)) return 'spreadsheet';
  if (['.txt','.rtf'].includes(ext) || type.startsWith('text/')) return 'text';
  if (['.doc','.docx'].includes(ext)) return 'document';
  if (['.ppt','.pptx'].includes(ext)) return 'presentation';
  return 'download';
}

const OFFICE_PROTOCOLS = {
  document: 'ms-word',
  spreadsheet: 'ms-excel',
  presentation: 'ms-powerpoint'
};

function nativeSecret() {
  const secret = String(process.env.SESSION_SECRET || '');
  if (!secret) throw new Error('SESSION_SECRET is required for secure native Office links.');
  return secret;
}

function makeNativeToken(versionId) {
  const payload = Buffer.from(JSON.stringify({
    v: Number(versionId),
    e: Date.now() + (15 * 60 * 1000),
    n: crypto.randomBytes(10).toString('hex')
  }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', nativeSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyNativeToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', nativeSecret()).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const versionId = idOf(decoded.v);
    const expiresAt = Number(decoded.e || 0);
    if (!versionId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
    return versionId;
  } catch (_) {
    return null;
  }
}

function nativeFileName(row) {
  const original = path.basename(String(row.original_name || '')).replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
  const extension = String(row.extension || '').toLowerCase();
  if (original && (!extension || original.toLowerCase().endsWith(extension))) return original;
  const fallback = clean(row.title || 'document', 120).replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'document';
  return `${fallback}${extension}`;
}

function nativeLaunchFor(req, basePath, row) {
  const kind = previewKind(row.extension, row.mime_type);
  const protocol = OFFICE_PROTOCOLS[kind];
  const versionId = idOf(row.version_id || row.current_version_id || row.id);
  if (!protocol || !versionId) return null;
  const token = makeNativeToken(versionId);
  const root = `https://${req.get('host')}`;
  const filename = encodeURIComponent(nativeFileName(row));
  const fileUrl = `${root}${basePath || ''}/api/uat/library/native/${encodeURIComponent(token)}/${filename}`;
  return `${protocol}:ofv|u|${fileUrl}`;
}

async function ensureSchema() {
  if (!IS_UAT) throw new Error('Talk2Me Library UAT route is disabled outside UAT.');
  if (!privateRoot || privateRoot === '/home/uent/talk2me_private_uploads') {
    throw new Error('Talk2Me Library UAT requires the isolated private upload directory.');
  }
  if (!schemaPromise) {
    schemaPromise = (async()=>{
      fs.mkdirSync(libraryFileDir,{recursive:true,mode:0o700});
      fs.mkdirSync(librarySnapshotDir,{recursive:true,mode:0o700});
      fs.mkdirSync(libraryTempDir,{recursive:true,mode:0o700});

      await db.query(`CREATE TABLE IF NOT EXISTS library_documents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(180) NOT NULL,
        description TEXT NULL,
        category VARCHAR(80) NOT NULL DEFAULT 'Other',
        access_level VARCHAR(30) NOT NULL DEFAULT 'all',
        company_favourite TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        current_version_id BIGINT UNSIGNED NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        updated_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_library_documents_status (status,category,updated_at),
        KEY idx_library_documents_access (access_level,status),
        KEY idx_library_documents_current (current_version_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await db.query(`CREATE TABLE IF NOT EXISTS library_versions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        document_id BIGINT UNSIGNED NOT NULL,
        version_number INT UNSIGNED NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(140) NOT NULL,
        extension VARCHAR(20) NOT NULL,
        file_bytes BIGINT UNSIGNED NOT NULL,
        uploaded_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_library_version (document_id,version_number),
        KEY idx_library_versions_document (document_id,created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await db.query(`CREATE TABLE IF NOT EXISTS library_favourites (
        staff_id BIGINT UNSIGNED NOT NULL,
        document_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (staff_id,document_id),
        KEY idx_library_favourites_document (document_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await db.query(`CREATE TABLE IF NOT EXISTS library_snapshots (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        snapshot_month CHAR(7) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        file_bytes BIGINT UNSIGNED NOT NULL,
        document_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_library_snapshots_month (snapshot_month,created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error=>{schemaPromise=null;throw error;});
  }
  return schemaPromise;
}

const allowed = new Map([
  ['.pdf',new Set(['application/pdf','application/octet-stream'])],
  ['.xlsx',new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'])],
  ['.xls',new Set(['application/vnd.ms-excel','application/octet-stream'])],
  ['.csv',new Set(['text/csv','application/csv','application/vnd.ms-excel','text/plain','application/octet-stream'])],
  ['.doc',new Set(['application/msword','application/octet-stream'])],
  ['.docx',new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'])],
  ['.ppt',new Set(['application/vnd.ms-powerpoint','application/octet-stream'])],
  ['.pptx',new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'])],
  ['.txt',new Set(['text/plain','application/octet-stream'])],
  ['.rtf',new Set(['application/rtf','text/rtf','application/octet-stream'])],
  ['.jpg',new Set(['image/jpeg','application/octet-stream'])],
  ['.jpeg',new Set(['image/jpeg','application/octet-stream'])],
  ['.png',new Set(['image/png','application/octet-stream'])],
  ['.webp',new Set(['image/webp','application/octet-stream'])],
  ['.gif',new Set(['image/gif','application/octet-stream'])]
]);

const storage = multer.diskStorage({
  destination(req,file,callback) {
    try { fs.mkdirSync(libraryFileDir,{recursive:true,mode:0o700}); callback(null,libraryFileDir); }
    catch(error){ callback(error); }
  },
  filename(req,file,callback) {
    const ext = extensionOf(file);
    callback(null,`${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});

const uploadOne = multer({
  storage,
  limits:{fileSize:40*1024*1024,files:1},
  fileFilter(req,file,callback){
    const ext=extensionOf(file);
    const mimes=allowed.get(ext);
    const mime=String(file.mimetype||'').toLowerCase();
    const ok=Boolean(mimes && mimes.has(mime));
    callback(ok?null:new Error('Unsupported file. Use PDF, images, Excel/CSV, Word, PowerPoint, text or RTF.'),ok);
  }
}).single('file');

const uploadBatch = multer({
  storage,
  limits:{fileSize:40*1024*1024,files:10},
  fileFilter(req,file,callback){
    const ext=extensionOf(file);
    const mimes=allowed.get(ext);
    const mime=String(file.mimetype||'').toLowerCase();
    const ok=Boolean(mimes && mimes.has(mime));
    callback(ok?null:new Error('Unsupported file. Use PDF, images, Excel/CSV, Word, PowerPoint, text or RTF.'),ok);
  }
}).array('files',10);

function cleanupFiles(files) {
  for (const file of Array.isArray(files) ? files : []) {
    if (file?.path) fs.unlink(file.path,()=>{});
  }
}

function uploadBatchMiddleware(req,res,next) {
  uploadBatch(req,res,error=>{
    if(!error) return next();
    cleanupFiles(req.files);
    res.status(400).json({ok:false,error:error.message||'The files could not be uploaded.'});
  });
}

function uploadMiddleware(req,res,next) {
  uploadOne(req,res,error=>{
    if(!error) return next();
    if(req.file?.path) fs.unlink(req.file.path,()=>{});
    res.status(400).json({ok:false,error:error.message||'The file could not be uploaded.'});
  });
}

function removeUploaded(req) {
  if(req.file?.path) fs.unlink(req.file.path,()=>{});
}

function documentAccessSql(user) {
  return management(user) ? '1=1' : "d.access_level='all'";
}

async function getDocument(documentId,user,{includeArchived=false}={}) {
  const statusSql = includeArchived && management(user) ? '1=1' : "d.status='active'";
  const [[row]] = await db.execute(`SELECT d.*,v.version_number,v.original_name,v.stored_filename,v.mime_type,v.extension,v.file_bytes,v.created_at version_created_at,
    uploader.full_name uploaded_by_name
    FROM library_documents d
    LEFT JOIN library_versions v ON v.id=d.current_version_id
    LEFT JOIN staff_users uploader ON uploader.id=v.uploaded_by
    WHERE d.id=:id AND ${documentAccessSql(user)} AND ${statusSql} LIMIT 1`,{id:documentId});
  return row||null;
}

async function visibleDocuments(user,{status='active'}={}) {
  const statusSql=status==='all'&&management(user)?'1=1':"d.status='active'";
  const [rows]=await db.execute(`SELECT d.id,d.title,d.description,d.category,d.access_level,d.company_favourite,d.status,d.updated_at,
    v.id version_id,v.version_number,v.original_name,v.mime_type,v.extension,v.file_bytes,v.created_at version_created_at,
    uploader.full_name uploaded_by_name
    FROM library_documents d
    LEFT JOIN library_versions v ON v.id=d.current_version_id
    LEFT JOIN staff_users uploader ON uploader.id=v.uploaded_by
    WHERE ${documentAccessSql(user)} AND ${statusSql}
    ORDER BY d.company_favourite DESC,d.updated_at DESC,d.id DESC`);
  return rows;
}

function mapDocument(row,favourites=new Set(),nativeLaunch=null) {
  return {
    id:Number(row.id),
    title:row.title,
    description:row.description||'',
    category:row.category||'Other',
    accessLevel:row.access_level,
    companyFavourite:Boolean(row.company_favourite),
    favourite:favourites.has(Number(row.id)),
    status:row.status,
    updatedAt:row.updated_at,
    versionId:row.version_id?Number(row.version_id):null,
    versionNumber:Number(row.version_number||0),
    originalName:row.original_name||'',
    mime:row.mime_type||'',
    extension:row.extension||'',
    bytes:Number(row.file_bytes||0),
    versionCreatedAt:row.version_created_at||null,
    uploadedByName:row.uploaded_by_name||'',
    previewKind:previewKind(row.extension,row.mime_type),
    nativeLaunch
  };
}

async function favouriteSet(userId) {
  const [rows]=await db.execute('SELECT document_id FROM library_favourites WHERE staff_id=:userId',{userId});
  return new Set(rows.map(row=>Number(row.document_id)));
}

function filePathFor(row) {
  const name=path.basename(String(row.stored_filename||''));
  return name?path.join(libraryFileDir,name):null;
}

function fileExists(row) {
  const target=filePathFor(row);
  return Boolean(target&&fs.existsSync(target));
}

function normaliseIndexRows(rows) {
  return rows.map(row=>({
    'Document ID':Number(row.id),
    'Title':row.title,
    'Category':row.category,
    'Description':row.description||'',
    'Access':row.access_level,
    'Company Favourite':row.company_favourite?'Yes':'No',
    'Status':row.status,
    'Version':Number(row.version_number||0),
    'Original File':row.original_name||'',
    'File Type':row.extension||row.mime_type||'',
    'File Size Bytes':Number(row.file_bytes||0),
    'Uploaded By':row.uploaded_by_name||'',
    'Version Date':row.version_created_at||'',
    'Last Updated':row.updated_at||''
  }));
}

function buildIndexWorkbook(rows) {
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.json_to_sheet(normaliseIndexRows(rows));
  XLSX.utils.book_append_sheet(workbook,sheet,'Library Index');
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
}

function safeFolder(value) {
  const cleanName=safeZipPath(value||'Other').replace(/\//g,'_');
  return cleanName||'Other';
}

async function createLibraryZip(outputPath,user,{month=null}={}) {
  const rows=await visibleDocuments(user,{status:'active'});
  const entries=[];
  for(const row of rows) {
    if(!fileExists(row)) continue;
    const folder=safeFolder(row.category||'Other');
    const title=safeFolder(row.title||'Document');
    const original=path.basename(String(row.original_name||('document'+(row.extension||''))));
    entries.push({
      name:`${folder}/${title}/${original}`,
      path:filePathFor(row),
      mtime:row.version_created_at?new Date(row.version_created_at):new Date()
    });
  }
  entries.unshift({name:'Library-Index.xlsx',data:buildIndexWorkbook(rows),mtime:new Date()});
  const info=[
    'Talk2Me Library Export',
    `Created: ${new Date().toISOString()}`,
    `Snapshot month: ${month||'Current'}`,
    `Documents: ${rows.length}`,
    'The original files are included in their normal formats.'
  ].join('\r\n');
  entries.unshift({name:'README.txt',data:Buffer.from(info,'utf8'),mtime:new Date()});
  writeZip(entries,outputPath);
  return {rows,count:rows.length};
}

router.get('/uat/library',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    res.render('uat-library',{
      layout:false,
      title:'Talk2Me Library',
      basePath:res.locals.basePath||'',
      appVersion:res.locals.appVersion||'',
      currentUser:req.session.user
    });
  }catch(error){next(error);}
});

router.get('/api/uat/library/health',async(req,res)=>{
  if(!IS_UAT) return res.sendStatus(404);
  try{
    await ensureSchema();
    const [tables]=await db.execute(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('library_documents','library_versions','library_favourites','library_snapshots')`);
    const names=new Set(tables.map(row=>row.TABLE_NAME));
    const storage=privateRoot==='/home/uent/talk2me_uat_private_uploads' &&
      fs.existsSync(libraryFileDir) && fs.existsSync(librarySnapshotDir);
    const healthy=names.size===4&&storage;
    res.status(healthy?200:503).json({
      status:healthy?'ok':'error',
      environment:'uat',
      library:true,
      tables:names.size,
      storage,
      storageRoot:storage?'isolated-private':'invalid'
    });
  }catch(error){
    res.status(503).json({status:'error',environment:'uat',library:false,storage:false,error:error.message});
  }
});

router.get('/api/uat/library/bootstrap',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    const userId=Number(req.session.user.id);
    const canManage=management(req.session.user);
    const requestedStatus=clean(req.query.status,20);
    const rows=await visibleDocuments(req.session.user,{status:requestedStatus==='all'&&canManage?'all':'active'});
    const favourites=await favouriteSet(userId);
    const documents=rows.map(row=>mapDocument(row,favourites,nativeLaunchFor(req,res.locals.basePath,row)));
    const categories=[...new Set(documents.map(item=>item.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    res.json({
      ok:true,
      canManage,
      user:{id:userId,name:req.session.user.full_name,role:req.session.user.role},
      categories,
      suggestedCategories:CATEGORIES,
      documents
    });
  }catch(error){next(error);}
});

router.get('/api/uat/library/documents/:id',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    const document=await getDocument(id,req.session.user,{includeArchived:true});
    if(!document) return res.sendStatus(404);
    const [versions]=await db.execute(`SELECT v.id,v.version_number,v.original_name,v.mime_type,v.extension,v.file_bytes,v.created_at,s.full_name uploaded_by_name
      FROM library_versions v LEFT JOIN staff_users s ON s.id=v.uploaded_by
      WHERE v.document_id=:id ORDER BY v.version_number DESC`,{id});
    const favs=await favouriteSet(Number(req.session.user.id));
    res.json({
      ok:true,
      document:mapDocument({...document,version_id:document.current_version_id},favs,nativeLaunchFor(req,res.locals.basePath,{...document,version_id:document.current_version_id})),
      versions:management(req.session.user)?versions.map(v=>({
        id:Number(v.id),versionNumber:Number(v.version_number),originalName:v.original_name,mime:v.mime_type,
        extension:v.extension,bytes:Number(v.file_bytes||0),createdAt:v.created_at,uploadedByName:v.uploaded_by_name||''
      })):[]
    });
  }catch(error){next(error);}
});

router.post('/api/uat/library/documents/batch',requireAuth,requireManager,uploadBatchMiddleware,async(req,res,next)=>{
  let persisted=false;
  const connection=await db.getConnection();
  try{
    await ensureSchema();
    const files=Array.isArray(req.files)?req.files:[];
    if(!files.length)return res.status(400).json({ok:false,error:'Choose at least one file.'});
    if(files.length>10){cleanupFiles(files);return res.status(400).json({ok:false,error:'Upload a maximum of 10 files at once.'});}
    const userId=Number(req.session.user.id);
    const category=safeCategory(req.body.category);
    const description=clean(req.body.description,5000);
    const accessLevel=clean(req.body.access_level,30)==='management'?'management':'all';
    const favourite=String(req.body.company_favourite||'')==='1'?1:0;
    const created=[];
    await connection.beginTransaction();
    for(const file of files){
      const ext=extensionOf(file);
      const basename=path.basename(String(file.originalname||'document'),ext);
      const title=clean(basename.replace(/[_-]+/g,' ').replace(/\s+/g,' '),180)||'Document';
      const [docResult]=await connection.execute(`INSERT INTO library_documents
        (title,description,category,access_level,company_favourite,status,created_by,updated_by)
        VALUES (:title,:description,:category,:accessLevel,:favourite,'active',:userId,:userId)`,
        {title,description,category,accessLevel,favourite,userId});
      const [versionResult]=await connection.execute(`INSERT INTO library_versions
        (document_id,version_number,original_name,stored_filename,mime_type,extension,file_bytes,uploaded_by)
        VALUES (:documentId,1,:originalName,:storedFilename,:mime,:extension,:bytes,:userId)`,{
          documentId:docResult.insertId,
          originalName:clean(path.basename(file.originalname),255),
          storedFilename:path.basename(file.filename),
          mime:clean(file.mimetype,140),
          extension:ext,
          bytes:Number(file.size||0),
          userId
        });
      await connection.execute('UPDATE library_documents SET current_version_id=:versionId WHERE id=:documentId',{
        versionId:versionResult.insertId,documentId:docResult.insertId
      });
      created.push({id:Number(docResult.insertId),title,versionId:Number(versionResult.insertId)});
    }
    await connection.commit();
    persisted=true;
    res.json({ok:true,count:created.length,documents:created});
  }catch(error){
    try{await connection.rollback();}catch(_){}
    if(!persisted) cleanupFiles(req.files);
    next(error);
  }finally{
    try{connection.release();}catch(_){}
  }
});

router.post('/api/uat/library/documents',requireAuth,requireManager,uploadMiddleware,async(req,res,next)=>{
  let persisted=false;
  const connection=await db.getConnection();
  try{
    await ensureSchema();
    if(!req.file)return res.status(400).json({ok:false,error:'Choose a file.'});
    const title=clean(req.body.title,180);
    if(!title){removeUploaded(req);return res.status(400).json({ok:false,error:'Enter a document title.'});}
    const userId=Number(req.session.user.id);
    const category=safeCategory(req.body.category);
    const description=clean(req.body.description,5000);
    const accessLevel=clean(req.body.access_level,30)==='management'?'management':'all';
    const favourite=String(req.body.company_favourite||'')==='1'?1:0;
    const ext=extensionOf(req.file);
    await connection.beginTransaction();
    const [docResult]=await connection.execute(`INSERT INTO library_documents
      (title,description,category,access_level,company_favourite,status,created_by,updated_by)
      VALUES (:title,:description,:category,:accessLevel,:favourite,'active',:userId,:userId)`,
      {title,description,category,accessLevel,favourite,userId});
    const [versionResult]=await connection.execute(`INSERT INTO library_versions
      (document_id,version_number,original_name,stored_filename,mime_type,extension,file_bytes,uploaded_by)
      VALUES (:documentId,1,:originalName,:storedFilename,:mime,:extension,:bytes,:userId)`,{
        documentId:docResult.insertId,
        originalName:clean(path.basename(req.file.originalname),255),
        storedFilename:path.basename(req.file.filename),
        mime:clean(req.file.mimetype,140),
        extension:ext,
        bytes:Number(req.file.size||0),
        userId
      });
    await connection.execute('UPDATE library_documents SET current_version_id=:versionId WHERE id=:documentId',{
      versionId:versionResult.insertId,documentId:docResult.insertId
    });
    await connection.commit();
    persisted=true;
    res.json({ok:true,id:Number(docResult.insertId),versionId:Number(versionResult.insertId)});
  }catch(error){
    try{await connection.rollback();}catch(_){}
    if(!persisted) removeUploaded(req);
    next(error);
  }finally{
    try{connection.release();}catch(_){}
  }
});

router.post('/api/uat/library/documents/:id/version',requireAuth,requireManager,uploadMiddleware,async(req,res,next)=>{
  let persisted=false;
  const connection=await db.getConnection();
  try{
    await ensureSchema();
    const documentId=idOf(req.params.id);
    if(!documentId||!req.file){removeUploaded(req);return res.status(400).json({ok:false,error:'Document and file are required.'});}
    const [[doc]]=await connection.execute('SELECT id,status FROM library_documents WHERE id=:id LIMIT 1',{id:documentId});
    if(!doc){removeUploaded(req);return res.sendStatus(404);}
    const [[maxVersion]]=await connection.execute('SELECT COALESCE(MAX(version_number),0) max_version FROM library_versions WHERE document_id=:id',{id:documentId});
    const versionNumber=Number(maxVersion?.max_version||0)+1;
    const userId=Number(req.session.user.id);
    const ext=extensionOf(req.file);
    await connection.beginTransaction();
    const [versionResult]=await connection.execute(`INSERT INTO library_versions
      (document_id,version_number,original_name,stored_filename,mime_type,extension,file_bytes,uploaded_by)
      VALUES (:documentId,:versionNumber,:originalName,:storedFilename,:mime,:extension,:bytes,:userId)`,{
        documentId,versionNumber,
        originalName:clean(path.basename(req.file.originalname),255),
        storedFilename:path.basename(req.file.filename),
        mime:clean(req.file.mimetype,140),
        extension:ext,
        bytes:Number(req.file.size||0),
        userId
      });
    await connection.execute(`UPDATE library_documents
      SET current_version_id=:versionId,updated_by=:userId,status='active',updated_at=NOW()
      WHERE id=:documentId`,{versionId:versionResult.insertId,userId,documentId});
    await connection.commit();
    persisted=true;
    res.json({ok:true,id:documentId,versionId:Number(versionResult.insertId),versionNumber});
  }catch(error){
    try{await connection.rollback();}catch(_){}
    if(!persisted) removeUploaded(req);
    next(error);
  }finally{
    try{connection.release();}catch(_){}
  }
});

router.post('/api/uat/library/documents/:id/meta',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    if(!id) return res.sendStatus(404);
    const title=clean(req.body.title,180);
    if(!title) return res.status(400).json({ok:false,error:'Title is required.'});
    const category=safeCategory(req.body.category);
    const description=clean(req.body.description,5000);
    const accessLevel=clean(req.body.access_level,30)==='management'?'management':'all';
    const favourite=String(req.body.company_favourite||'')==='1'?1:0;
    const userId=Number(req.session.user.id);
    const [result]=await db.execute(`UPDATE library_documents
      SET title=:title,description=:description,category=:category,access_level=:accessLevel,
        company_favourite=:favourite,updated_by=:userId,updated_at=NOW()
      WHERE id=:id`,{title,description,category,accessLevel,favourite,userId,id});
    if(!result.affectedRows) return res.sendStatus(404);
    res.json({ok:true});
  }catch(error){next(error);}
});

router.post('/api/uat/library/documents/:id/archive',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    if(!id) return res.sendStatus(404);
    const status=clean(req.body.status,20)==='active'?'active':'archived';
    const [result]=await db.execute('UPDATE library_documents SET status=:status,updated_by=:userId,updated_at=NOW() WHERE id=:id',{
      status,userId:Number(req.session.user.id),id
    });
    if(!result.affectedRows) return res.sendStatus(404);
    res.json({ok:true,status});
  }catch(error){next(error);}
});

router.delete('/api/uat/library/documents/:id',requireAuth,requireManager,async(req,res,next)=>{
  const connection=await db.getConnection();
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    if(!id) return res.sendStatus(404);

    await connection.beginTransaction();
    const [[document]]=await connection.execute(
      'SELECT id,title FROM library_documents WHERE id=:id LIMIT 1 FOR UPDATE',
      {id}
    );
    if(!document){
      await connection.rollback();
      return res.sendStatus(404);
    }

    const [versions]=await connection.execute(
      'SELECT stored_filename FROM library_versions WHERE document_id=:id',
      {id}
    );
    await connection.execute('DELETE FROM library_favourites WHERE document_id=:id',{id});
    await connection.execute('DELETE FROM library_versions WHERE document_id=:id',{id});
    await connection.execute('DELETE FROM library_documents WHERE id=:id',{id});
    await connection.commit();

    for(const version of versions){
      const filename=path.basename(String(version.stored_filename||''));
      if(!filename)continue;
      const target=path.join(libraryFileDir,filename);
      fs.unlink(target,()=>{});
    }

    res.json({ok:true,id,title:document.title,deletedVersions:versions.length});
  }catch(error){
    try{await connection.rollback();}catch(_){}
    next(error);
  }finally{
    try{connection.release();}catch(_){}
  }
});

router.post('/api/uat/library/documents/:id/favourite',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    const documentId=idOf(req.params.id);
    if(!documentId) return res.sendStatus(404);
    const document=await getDocument(documentId,req.session.user);
    if(!document) return res.sendStatus(404);
    const staffId=Number(req.session.user.id);
    const [[existing]]=await db.execute('SELECT document_id FROM library_favourites WHERE staff_id=:staffId AND document_id=:documentId LIMIT 1',{staffId,documentId});
    if(existing) {
      await db.execute('DELETE FROM library_favourites WHERE staff_id=:staffId AND document_id=:documentId',{staffId,documentId});
      return res.json({ok:true,favourite:false});
    }
    await db.execute('INSERT INTO library_favourites (staff_id,document_id) VALUES (:staffId,:documentId)',{staffId,documentId});
    res.json({ok:true,favourite:true});
  }catch(error){next(error);}
});

router.get('/api/uat/library/native/:token/:filename',async(req,res,next)=>{
  try{
    await ensureSchema();
    const versionId=verifyNativeToken(req.params.token);
    if(!versionId)return res.status(403).type('text/plain').send('This secure Library link has expired. Return to Talk2Me and open the document again.');
    const [[row]]=await db.execute(`SELECT v.*,d.status
      FROM library_versions v JOIN library_documents d ON d.id=v.document_id
      WHERE v.id=:versionId LIMIT 1`,{versionId});
    if(!row||row.status!=='active')return res.sendStatus(404);
    const kind=previewKind(row.extension,row.mime_type);
    if(!OFFICE_PROTOCOLS[kind])return res.status(400).type('text/plain').send('This file type does not use a desktop Office application.');
    const expectedName=nativeFileName(row);
    if(String(req.params.filename||'')!==expectedName)return res.sendStatus(404);
    const target=filePathFor(row);
    if(!target||!fs.existsSync(target))return res.sendStatus(404);
    const display=path.basename(String(row.original_name||'document')).replace(/["\r\n]/g,'_');
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Disposition',`inline; filename="${display}"`);
    res.type(row.mime_type||'application/octet-stream');
    res.sendFile(target);
  }catch(error){next(error);}
});

router.get('/api/uat/library/files/:versionId',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    const versionId=idOf(req.params.versionId);
    if(!versionId) return res.sendStatus(404);
    const [[row]]=await db.execute(`SELECT v.*,d.status,d.access_level,d.id document_id
      FROM library_versions v JOIN library_documents d ON d.id=v.document_id
      WHERE v.id=:versionId LIMIT 1`,{versionId});
    if(!row) return res.sendStatus(404);
    if(row.status!=='active'&&!management(req.session.user)) return res.sendStatus(404);
    if(row.access_level!=='all'&&!management(req.session.user)) return res.sendStatus(403);
    const target=filePathFor(row);
    if(!target||!fs.existsSync(target)) return res.sendStatus(404);
    const display=path.basename(String(row.original_name||'download')).replace(/["\r\n]/g,'_');
    const download=String(req.query.download||'')==='1';
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Disposition',`${download?'attachment':'inline'}; filename="${display}"`);
    res.type(row.mime_type||'application/octet-stream');
    res.sendFile(target);
  }catch(error){next(error);}
});

router.get('/api/uat/library/documents/:id/preview',requireAuth,async(req,res,next)=>{
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    const document=await getDocument(id,req.session.user,{includeArchived:true});
    if(!document) return res.sendStatus(404);
    const kind=previewKind(document.extension,document.mime_type);
    if(kind!=='spreadsheet') return res.status(400).json({ok:false,error:'Spreadsheet preview is only available for Excel and CSV files.'});
    const target=filePathFor(document);
    if(!target||!fs.existsSync(target)) return res.sendStatus(404);
    const workbook=XLSX.readFile(target,{cellDates:false,cellText:true});
    const requested=clean(req.query.sheet,100);
    const sheetName=workbook.SheetNames.includes(requested)?requested:workbook.SheetNames[0];
    const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
    const rows=matrix.slice(0,200).map(row=>row.slice(0,40));
    res.json({ok:true,sheets:workbook.SheetNames,sheet:sheetName,rows,truncated:matrix.length>200});
  }catch(error){next(error);}
});

router.get('/api/uat/library/export/current',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`talk2me-library-current-${stamp}.zip`;
    const target=path.join(libraryTempDir,filename);
    await createLibraryZip(target,req.session.user);
    res.download(target,filename,error=>{
      fs.unlink(target,()=>{});
      if(error&&!res.headersSent) next(error);
    });
  }catch(error){next(error);}
});

router.get('/api/uat/library/snapshots',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const [rows]=await db.execute(`SELECT s.id,s.snapshot_month,s.stored_filename,s.file_bytes,s.document_count,s.created_at,u.full_name created_by_name
      FROM library_snapshots s LEFT JOIN staff_users u ON u.id=s.created_by
      ORDER BY s.created_at DESC LIMIT 36`);
    res.json({ok:true,snapshots:rows.map(row=>({
      id:Number(row.id),month:row.snapshot_month,filename:row.stored_filename,bytes:Number(row.file_bytes||0),
      documentCount:Number(row.document_count||0),createdAt:row.created_at,createdByName:row.created_by_name||''
    }))});
  }catch(error){next(error);}
});

router.post('/api/uat/library/snapshots',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const month=safeMonth(req.body.month);
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`talk2me-library-${month}-${stamp}.zip`;
    const target=path.join(librarySnapshotDir,filename);
    const created=await createLibraryZip(target,req.session.user,{month});
    const stat=fs.statSync(target);
    const [result]=await db.execute(`INSERT INTO library_snapshots
      (snapshot_month,stored_filename,file_bytes,document_count,created_by)
      VALUES (:month,:filename,:bytes,:count,:userId)`,{
        month,filename,bytes:Number(stat.size||0),count:created.count,userId:Number(req.session.user.id)
      });
    res.json({ok:true,id:Number(result.insertId),month,filename,documentCount:created.count,
      downloadUrl:`${res.locals.basePath}/api/uat/library/snapshots/${result.insertId}`});
  }catch(error){next(error);}
});

router.get('/api/uat/library/snapshots/:id',requireAuth,requireManager,async(req,res,next)=>{
  try{
    await ensureSchema();
    const id=idOf(req.params.id);
    const [[snapshot]]=await db.execute('SELECT * FROM library_snapshots WHERE id=:id LIMIT 1',{id});
    if(!snapshot) return res.sendStatus(404);
    const filename=path.basename(String(snapshot.stored_filename||''));
    const target=filename?path.join(librarySnapshotDir,filename):null;
    if(!target||!fs.existsSync(target)) return res.sendStatus(404);
    res.download(target,filename);
  }catch(error){next(error);}
});

module.exports=router;
module.exports.ensureSchema=ensureSchema;
