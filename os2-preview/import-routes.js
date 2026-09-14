const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');

module.exports = function createImportRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
  const previews = new Map();
  const allowedFields = [
    'client_name','account_number','cell_number','email','city_town','id_number',
    'package_name','handset','previous_upgrade_date','next_upgrade_date',
    'monthly_invoice_amount','cancellation_date','main_contact_name','main_contact_number'
  ];
  const aliases = {
    client_name:['client name','customer name','name','client'], account_number:['account number','account','b number','b-number'],
    cell_number:['cell number','mobile number','phone','telephone','contact number'], email:['email','email address'],
    city_town:['town','city','city town','area'], id_number:['id number','identity number','id'],
    package_name:['package','package name','contract'], handset:['handset','device','phone model'],
    previous_upgrade_date:['previous upgrade date','last upgrade date'], next_upgrade_date:['next upgrade date','upgrade date'],
    monthly_invoice_amount:['monthly invoice amount','monthly amount','invoice amount'], cancellation_date:['cancellation date','renewal date'],
    main_contact_name:['main contact name','contact person'], main_contact_number:['main contact number','primary contact number']
  };

  function ownerOnly(req,res,next){ return req.user?.role === 'owner' ? next() : res.status(403).json({ok:false,error:'OWNER_PERMISSION_REQUIRED'}); }
  function cleanHeader(value){ return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' '); }
  function normalisePhone(value){
    let digits=String(value ?? '').replace(/\D/g,'');
    if(digits.startsWith('27')&&digits.length===11) digits=`0${digits.slice(2)}`;
    else if(digits.length===9) digits=`0${digits}`;
    return digits;
  }
  function normaliseAccount(value){ return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function text(value,max=255){ const v=String(value ?? '').trim(); return v ? v.slice(0,max) : null; }
  function dateValue(value){ if(value===null||value===undefined||value==='') return null; if(typeof value==='number'){ const d=XLSX.SSF.parse_date_code(value); if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; } const d=new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }
  function numberValue(value){ if(value===null||value===undefined||value==='') return null; const n=Number(String(value).replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:null; }
  function autoMap(headers){ const map={}; for(const field of allowedFields){ const found=headers.find(h=>aliases[field].includes(cleanHeader(h))); if(found) map[field]=found; } return map; }
  function mappedRow(row,map){ const out={}; for(const field of allowedFields){ const source=map[field]; if(!source) continue; const raw=row[source]; out[field]=field.includes('date') ? dateValue(raw) : field==='monthly_invoice_amount' ? numberValue(raw) : text(raw, field==='email'?320:255); } out.cell_number_normalised=normalisePhone(out.cell_number); out.account_number_normalised=normaliseAccount(out.account_number); return out; }
  function readWorkbook(buffer){ const workbook=XLSX.read(buffer,{type:'buffer',cellDates:false}); const sheetName=workbook.SheetNames[0]; if(!sheetName) throw new Error('NO_WORKSHEET_FOUND'); const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{defval:''}); return {sheetName,rows}; }
  async function audit(connection,req,action,description,after){ await connection.execute(`INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,after_json,ip_address,user_agent,created_at) VALUES (:staffId,:action,'monthly_import',:entityId,:description,:afterJson,:ip,:agent,NOW())`,{staffId:req.user.id,action,entityId:req.user.id,description,afterJson:JSON.stringify(after||{}),ip:requestIp(req),agent:String(req.headers['user-agent']||'').slice(0,255)}); }

  async function findExisting(executor,d,lock=false){
    const accountKey=d.account_number_normalised||'';
    const phone=normalisePhone(d.cell_number);
    const phoneTail=phone.slice(-9);
    const lockSql=lock?' FOR UPDATE':'';
    const [[existing]]=await executor.execute(`
      SELECT id,client_name,account_number,cell_number,email,city_town,id_number,package_name,handset,
        DATE_FORMAT(previous_upgrade_date,'%Y-%m-%d') previous_upgrade_date,
        DATE_FORMAT(next_upgrade_date,'%Y-%m-%d') next_upgrade_date,
        monthly_invoice_amount,
        DATE_FORMAT(cancellation_date,'%Y-%m-%d') cancellation_date,
        main_contact_name,main_contact_number
      FROM clients
      WHERE is_active=1 AND (
        (:accountKey<>'' AND UPPER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(account_number,'')),'-',''),' ',''),'/',''),'.',''))=:accountKey)
        OR (:phoneTail<>'' AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(cell_number,'')),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),9)=:phoneTail)
        OR (:phone<>'' AND cell_number_normalised=:phone)
      )
      ORDER BY
        CASE WHEN :accountKey<>'' AND UPPER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(account_number,'')),'-',''),' ',''),'/',''),'.',''))=:accountKey THEN 0 ELSE 1 END,
        id
      LIMIT 1${lockSql}`,
      {accountKey,phone,phoneTail}
    );
    return existing||null;
  }

  function comparable(field,value){
    if(value===null||value===undefined||value==='') return '';
    if(field==='cell_number'||field==='main_contact_number') return normalisePhone(value);
    if(field==='account_number') return normaliseAccount(value);
    if(field.includes('date')) return dateValue(value)||'';
    if(field==='monthly_invoice_amount') return Number(value||0).toFixed(2);
    return String(value).trim().toLowerCase();
  }

  router.post('/api/imports/preview', requireAuth, ownerOnly, upload.single('file'), async (req,res) => {
    try {
      if(!req.file) return res.status(400).json({ok:false,error:'SELECT_IMPORT_FILE'});
      if(!/\.(csv|xlsx|xls)$/i.test(req.file.originalname)) return res.status(400).json({ok:false,error:'CSV_OR_EXCEL_REQUIRED'});
      const {sheetName,rows}=readWorkbook(req.file.buffer);
      if(!rows.length) return res.status(400).json({ok:false,error:'IMPORT_FILE_EMPTY'});
      if(rows.length>10000) return res.status(400).json({ok:false,error:'IMPORT_ROW_LIMIT_EXCEEDED'});
      const headers=Object.keys(rows[0]);
      const mapping=autoMap(headers);
      const token=crypto.randomBytes(24).toString('hex');
      previews.set(token,{filename:req.file.originalname,sheetName,rows,headers,mapping,createdBy:req.user.id,createdAt:Date.now()});
      res.json({ok:true,token,filename:req.file.originalname,sheetName,rowCount:rows.length,headers,mapping,sample:rows.slice(0,8),fields:allowedFields});
    } catch(error){ console.error('Import preview failed',error); res.status(500).json({ok:false,error:error.message||'IMPORT_PREVIEW_FAILED'}); }
  });

  router.post('/api/imports/:token/analyse', requireAuth, ownerOnly, async (req,res) => {
    const preview=previews.get(req.params.token);
    if(!preview||preview.createdBy!==req.user.id) return res.status(404).json({ok:false,error:'IMPORT_PREVIEW_EXPIRED'});
    const mapping=req.body.mapping||preview.mapping;
    if(!mapping.client_name || (!mapping.account_number && !mapping.cell_number)) return res.status(400).json({ok:false,error:'MAP_NAME_AND_ACCOUNT_OR_CELL'});
    try {
      const mapped=preview.rows.map((row,index)=>({rowNumber:index+2,data:mappedRow(row,mapping)}));
      const errors=[];
      const seenKeys=new Map();
      const duplicateRows=new Set();
      for(const item of mapped){
        const d=item.data;
        if(!d.client_name){errors.push({row:item.rowNumber,error:'Missing client name'});continue;}
        if(!d.account_number_normalised&&!d.cell_number_normalised){errors.push({row:item.rowNumber,error:'Missing account number and cell number'});continue;}
        const key=`${d.account_number_normalised||''}|${d.cell_number_normalised||''}`;
        if(seenKeys.has(key)) duplicateRows.add(item.rowNumber); else seenKeys.set(key,item.rowNumber);
      }
      const valid=mapped.filter(item=>!errors.some(e=>e.row===item.rowNumber));
      let inserts=0,updates=0,unchanged=0;
      const previewRows=[];
      for(const item of valid){
        const d=item.data;
        if(duplicateRows.has(item.rowNumber)){
          if(previewRows.length<200) previewRows.push({row:item.rowNumber,action:'duplicate',clientId:null,clientName:d.client_name,accountNumber:d.account_number,cellNumber:d.cell_number,warnings:['Duplicate row skipped']});
          continue;
        }
        const existing=await findExisting(pool,d,false);
        let action='insert';
        if(existing){
          const changed=allowedFields.some(field=>d[field]!==undefined&&d[field]!==null&&comparable(field,existing[field])!==comparable(field,d[field]));
          action=changed?'update':'unchanged';
        }
        if(action==='insert')inserts++; else if(action==='update')updates++; else unchanged++;
        if(previewRows.length<200) previewRows.push({row:item.rowNumber,action,clientId:existing?.id||null,clientName:d.client_name,accountNumber:d.account_number,cellNumber:d.cell_number,warnings:[]});
      }
      preview.mapping=mapping;
      preview.analysis={mapped,errors,duplicateRows:[...duplicateRows],summary:{rows:preview.rows.length,inserts,updates,unchanged,duplicates:duplicateRows.size,errors:errors.length},previewRows};
      res.json({ok:true,summary:preview.analysis.summary,rows:previewRows,errors:errors.slice(0,200),mapping});
    } catch(error){ console.error('Import analyse failed',error); res.status(500).json({ok:false,error:error.code||error.message||'IMPORT_ANALYSIS_FAILED'}); }
  });

  router.post('/api/imports/:token/commit', requireAuth, ownerOnly, async (req,res) => {
    const preview=previews.get(req.params.token);
    if(!preview||preview.createdBy!==req.user.id||!preview.analysis) return res.status(404).json({ok:false,error:'ANALYSE_IMPORT_FIRST'});
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction(); let inserted=0,updated=0,skipped=0,unchanged=0;
      const duplicateRows=new Set(preview.analysis.duplicateRows||[]);
      for(const item of preview.analysis.mapped){
        if(preview.analysis.errors.some(e=>e.row===item.rowNumber)||duplicateRows.has(item.rowNumber)){skipped++;continue;}
        const d=item.data;
        const existing=await findExisting(connection,d,true);
        if(existing){
          const changedFields=allowedFields.filter(field=>d[field]!==undefined&&d[field]!==null&&comparable(field,existing[field])!==comparable(field,d[field]));
          if(!changedFields.length){unchanged++;continue;}
          const sets=[]; const params={id:existing.id};
          for(const field of changedFields){sets.push(`\`${field}\`=:${field}`);params[field]=d[field];}
          if(changedFields.includes('cell_number')&&d.cell_number_normalised){sets.push('cell_number_normalised=:cell_number_normalised');params.cell_number_normalised=d.cell_number_normalised;}
          sets.push('updated_at=NOW()');
          await connection.execute(`UPDATE clients SET ${sets.join(',')} WHERE id=:id`,params);
          updated++;
        } else {
          const fields=['client_name','account_number','cell_number','cell_number_normalised','email','city_town','id_number','package_name','handset','previous_upgrade_date','next_upgrade_date','monthly_invoice_amount','cancellation_date','main_contact_name','main_contact_number'];
          const present=fields.filter(f=>d[f]!==undefined);
          const params={}; present.forEach(f=>params[f]=d[f]);
          await connection.execute(`INSERT INTO clients (${present.map(f=>`\`${f}\``).join(',')},is_active,created_at,updated_at) VALUES (${present.map(f=>`:${f}`).join(',')},1,NOW(),NOW())`,params);
          inserted++;
        }
      }
      await audit(connection,req,'monthly_import_committed',`Monthly import committed: ${preview.filename}`,{filename:preview.filename,inserted,updated,unchanged,skipped,duplicates:duplicateRows.size,errors:preview.analysis.errors.length});
      await connection.commit(); previews.delete(req.params.token); res.json({ok:true,inserted,updated,unchanged,skipped,duplicates:duplicateRows.size,errors:preview.analysis.errors.length});
    } catch(error){ await connection.rollback(); console.error('Import commit failed',error); res.status(500).json({ok:false,error:error.code||error.message||'IMPORT_COMMIT_FAILED'}); } finally { connection.release(); }
  });

  setInterval(()=>{const cutoff=Date.now()-60*60*1000;for(const [token,item] of previews){if(item.createdAt<cutoff)previews.delete(token);}},15*60*1000).unref();
  return router;
};
