const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');

const router = express.Router();
const managerRoles = ['owner', 'admin', 'manager'];

function requireManager(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!managerRoles.includes(req.session.user.role)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'This action is available to managers and owners.' });
  }
  next();
}

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27\d{9}$/.test(digits)) return digits;
  return digits || null;
}

function fixedServicePayload(body) {
  const service_status = ['active','pending','suspended','cancelled','unknown'].includes(body.service_status) ? body.service_status : 'unknown';
  return {
    branch_name:String(body.branch_name||'').trim()||null, order_number:String(body.order_number||'').trim()||null,
    solution_id:String(body.solution_id||'').trim()||null, router_model:String(body.router_model||'').trim()||null,
    mac_address:String(body.mac_address||'').trim()||null, sim_number:String(body.sim_number||'').trim()||null,
    package_name:String(body.package_name||'').trim()||null, activation_date:body.activation_date||null, service_status,
    cancellation_date:service_status==='cancelled'?(body.cancellation_date||null):null,
    installation_address:String(body.installation_address||'').trim()||null,
    technical_notes:String(body.technical_notes||'').trim()||null
  };
}

router.get('/search/all', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q}%`;
    const normalisedPhone = phone(q);
    const [mobile] = await db.execute(`SELECT id, account_number, client_name, cell_number, email, handset, package_name,
        'mobile' record_type
      FROM clients
      WHERE (:phone IS NOT NULL AND cell_number_normalised=:phone)
         OR client_name LIKE :like OR cell_number LIKE :like OR email LIKE :like OR account_number LIKE :like OR id_number LIKE :like
      ORDER BY CASE WHEN :phone IS NOT NULL AND cell_number_normalised=:phone THEN 0 ELSE 1 END, client_name
      LIMIT 12`, { phone: normalisedPhone, like });
    const [fixed] = await db.execute(`SELECT DISTINCT fa.id, fa.account_number, fa.customer_name client_name,
        fa.contact_number cell_number, fa.email, fs.router_model handset, fs.package_name,
        fs.id fixed_service_id, fs.branch_name, fs.solution_id, fs.order_number, 'fixed' record_type
      FROM fixed_accounts fa
      LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
      WHERE (:phone IS NOT NULL AND fa.contact_number_normalised=:phone)
         OR fa.customer_name LIKE :like OR fa.contact_name LIKE :like OR fa.contact_number LIKE :like
         OR fa.email LIKE :like OR fa.account_number LIKE :like OR fs.branch_name LIKE :like
         OR fs.solution_id LIKE :like OR fs.order_number LIKE :like OR fs.sim_number LIKE :like OR fs.mac_address LIKE :like
      ORDER BY fa.customer_name, fs.branch_name
      LIMIT 12`, { phone: normalisedPhone, like });
    const rows = [
      ...mobile.map(x => ({ ...x, url: `${res.locals.basePath}/customers/${x.id}/360` })),
      ...fixed.map(x => ({ ...x, url: `${res.locals.basePath}/fixed/accounts/${x.id}` }))
    ];
    res.json(rows.slice(0, 20));
  } catch (e) { next(e); }
});

router.get('/fixed/accounts', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');
    const params = { like: `%${q}%` };
    const where = [];
    if (q) where.push(`(fa.account_number LIKE :like OR fa.customer_name LIKE :like OR fa.contact_number LIKE :like OR fa.email LIKE :like OR fs.branch_name LIKE :like OR fs.solution_id LIKE :like)`);
    if (status !== 'all') { where.push('fa.account_status=:status'); params.status = status; }
    const [accounts] = await db.execute(`SELECT fa.*, COUNT(DISTINCT fs.id) service_count,
        COUNT(DISTINCT CASE WHEN fs.service_status='active' THEN fs.id END) active_service_count, su.full_name assigned_staff_name,
        COUNT(DISTINCT c.id) mobile_line_count
      FROM fixed_accounts fa
      LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id
      LEFT JOIN staff_users su ON su.id=fa.assigned_staff_id
      LEFT JOIN clients c ON c.account_number=COALESCE(fa.linked_mobile_account_number,fa.account_number)
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY fa.id ORDER BY fa.customer_name`, params);
    res.render('fixed-accounts', { title: 'Fixed Accounts', accounts, filters: { q, status } });
  } catch (e) { next(e); }
});

router.get('/fixed/services', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');
    const params = { like: `%${q}%` };
    const where = [];
    if (q) where.push(`(fa.account_number LIKE :like OR fa.customer_name LIKE :like OR fs.branch_name LIKE :like OR fs.solution_id LIKE :like OR fs.order_number LIKE :like OR fs.sim_number LIKE :like OR fs.mac_address LIKE :like OR fs.package_name LIKE :like)`);
    if (status !== 'all') { where.push('fs.service_status=:status'); params.status = status; }
    const [services] = await db.execute(`SELECT fs.*, fa.account_number, fa.customer_name, su.full_name assigned_staff_name
      FROM fixed_services fs JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id
      LEFT JOIN staff_users su ON su.id=fa.assigned_staff_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY fa.customer_name, fs.branch_name`, params);
    res.render('fixed-services', { title: 'Fixed Services', services, filters: { q, status } });
  } catch (e) { next(e); }
});

router.get('/fixed/services/new', requireAuth, requireManager, async (req,res,next)=>{
  try{
    const accountNumber=String(req.query.account_number||'').trim();if(!accountNumber)return res.status(400).render('error',{title:'Account required',message:'Select a customer account before adding a fixed service.'});
    const [[account]]=await db.execute(`SELECT * FROM customer_accounts WHERE account_number_normalised=UPPER(REPLACE(TRIM(:account),' ',''))`,{account:accountNumber});
    if(!account)return res.status(400).render('error',{title:'Account not found',message:'Run the v3.2.0 account migration or capture the account first.'});
    res.render('fixed-service-edit',{title:'Add Fixed Service',account,service:null,error:null,isRequest:false,isEdit:false,returnClientId:null});
  }catch(e){next(e)}
});

router.get('/fixed/services/request-new', requireAuth, async (req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.redirect(`${res.locals.basePath}/fixed/services/new?account_number=${encodeURIComponent(req.query.account_number||'')}`);
    const accountNumber=String(req.query.account_number||'').trim();const [[account]]=await db.execute(`SELECT * FROM customer_accounts WHERE account_number_normalised=UPPER(REPLACE(TRIM(:account),' ',''))`,{account:accountNumber});if(!account)return res.status(404).render('error',{title:'Account not found',message:'The unique account could not be found.'});
    const [[client]]=await db.execute('SELECT id FROM clients WHERE account_id=:id ORDER BY id LIMIT 1',{id:account.id});
    res.render('fixed-service-edit',{title:'Request Fixed Service',account,service:null,error:null,isRequest:true,isEdit:false,returnClientId:client?.id||null});
  }catch(e){next(e)}
});

router.post('/fixed/services/request', requireAuth, async (req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.status(403).render('error',{title:'Access denied',message:'Use the management Add Fixed Service action.'});
    const b=req.body;const [[account]]=await db.execute('SELECT * FROM customer_accounts WHERE id=:id',{id:Number(b.account_id)});if(!account)return res.sendStatus(404);
    const proposed={account_id:account.id,account_number:account.account_number,...fixedServicePayload(b)};
    const [[client]]=await db.execute('SELECT id FROM clients WHERE account_id=:id ORDER BY id LIMIT 1',{id:account.id});
    const [request]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by) VALUES ('add_fixed_service','customer_accounts',:accountId,:clientId,:accountNumber,:summary,'Staff requested a new fixed service',:json,'manager','pending_manager',:requestedBy)`,{accountId:account.id,clientId:client?.id||null,accountNumber:account.account_number,summary:`Add fixed service to ${account.account_number}`,json:JSON.stringify(proposed),requestedBy:req.session.user.id});
    await audit(req,{actionType:'fixed_service_requested',entityType:'data_change_requests',entityId:request.insertId,description:`Fixed service requested for ${account.account_number}`,after:proposed});
    res.redirect(client?`${res.locals.basePath}/customers/${client.id}/360?change_requested=fixed`:`${res.locals.basePath}/fixed/accounts`);
  }catch(e){next(e)}
});

router.post('/fixed/services', requireAuth, requireManager, async (req,res,next)=>{
  try{
    const b=req.body;const accountId=Number(b.account_id);const [[account]]=await db.execute('SELECT * FROM customer_accounts WHERE id=:id',{id:accountId});if(!account)return res.status(400).render('error',{title:'Account not found',message:'The customer account could not be found.'});
    let [[fixedAccount]]=await db.execute('SELECT * FROM fixed_accounts WHERE account_id=:id OR account_number_normalised=:normalised LIMIT 1',{id:account.id,normalised:account.account_number_normalised});
    if(!fixedAccount){const [created]=await db.execute(`INSERT INTO fixed_accounts (account_number,account_number_normalised,account_id,customer_name,linked_mobile_account_number,assigned_staff_id,account_status,source_system) VALUES (:account,:normalised,:accountId,:name,:account,:staffId,'active','Talk2Me CRM')`,{account:account.account_number,normalised:account.account_number_normalised,accountId:account.id,name:account.display_name||account.account_number,staffId:account.assigned_staff_id||null});fixedAccount={id:created.insertId};}
    const payload=fixedServicePayload(b);
    const hash=crypto.createHash('sha256').update(`${account.id}|${payload.solution_id||''}|${payload.order_number||''}|${Date.now()}`).digest('hex');
    await db.execute(`INSERT INTO fixed_services (fixed_account_id,service_title,branch_name,order_number,router_model,mac_address,mac_address_normalised,solution_id,sim_number,package_name,package_name_normalised,activation_date,service_status,cancellation_date,installation_address,technical_notes,source_row_hash,source_system) VALUES (:fixedAccountId,:title,:branch_name,:order_number,:router_model,:mac_address,UPPER(REPLACE(REPLACE(:mac_address,':',''),'-','')),:solution_id,:sim_number,:package_name,UPPER(TRIM(:package_name)),:activation_date,:service_status,:cancellation_date,:installation_address,:technical_notes,:hash,'Talk2Me CRM')`,{fixedAccountId:fixedAccount.id,title:account.display_name||account.account_number,hash,...payload});
    res.redirect(`${res.locals.basePath}/fixed/accounts/${fixedAccount.id}?saved=1`);
  }catch(e){next(e)}
});

router.get('/fixed/services/:id/edit', requireAuth, async (req,res,next)=>{
  try{
    const [[service]]=await db.execute(`SELECT fs.*,fa.account_number,fa.customer_name,fa.account_id FROM fixed_services fs JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id WHERE fs.id=:id`,{id:Number(req.params.id)});
    if(!service)return res.status(404).render('error',{title:'Service not found',message:'The fixed service could not be found.'});
    const account={id:service.account_id,account_number:service.account_number,display_name:service.customer_name};
    res.render('fixed-service-edit',{title:req.session.user.role==='staff'?'Request Fixed Service Change':'Edit Fixed Service',account,service,error:null,isRequest:req.session.user.role==='staff',isEdit:true,returnClientId:null});
  }catch(e){next(e)}
});

router.post('/fixed/services/:id', requireAuth, requireManager, async (req,res,next)=>{
  try{
    const id=Number(req.params.id);const [[before]]=await db.execute('SELECT * FROM fixed_services WHERE id=:id',{id});
    if(!before)return res.status(404).render('error',{title:'Service not found',message:'The fixed service could not be found.'});
    const payload=fixedServicePayload(req.body);
    await db.execute(`UPDATE fixed_services SET branch_name=:branch_name,order_number=:order_number,solution_id=:solution_id,router_model=:router_model,mac_address=:mac_address,mac_address_normalised=UPPER(REPLACE(REPLACE(:mac_address,':',''),'-','')),sim_number=:sim_number,package_name=:package_name,package_name_normalised=UPPER(TRIM(:package_name)),activation_date=:activation_date,service_status=:service_status,cancellation_date=:cancellation_date,installation_address=:installation_address,technical_notes=:technical_notes,updated_at=NOW() WHERE id=:id`,{id,...payload});
    await audit(req,{actionType:'fixed_service_updated',entityType:'fixed_services',entityId:id,description:`Fixed service ${before.solution_id||before.order_number||id} updated`,before,after:payload});
    res.redirect(`${res.locals.basePath}/fixed/accounts/${before.fixed_account_id}?service_saved=1#service-${id}`);
  }catch(e){next(e)}
});

router.post('/fixed/services/:id/request-change', requireAuth, async (req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.redirect(`${res.locals.basePath}/fixed/services/${req.params.id}/edit`);
    const id=Number(req.params.id);const [[service]]=await db.execute(`SELECT fs.*,fa.account_number,fa.account_id FROM fixed_services fs JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id WHERE fs.id=:id`,{id});
    if(!service)return res.status(404).render('error',{title:'Service not found',message:'The fixed service could not be found.'});
    const proposed=fixedServicePayload(req.body);const [[client]]=await db.execute('SELECT id FROM clients WHERE account_id=:id ORDER BY id LIMIT 1',{id:service.account_id});
    const [request]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by) VALUES ('update_fixed_service','fixed_services',:recordId,:clientId,:accountNumber,:summary,'Staff requested a fixed-service update',:json,'manager','pending_manager',:requestedBy)`,{recordId:id,clientId:client?.id||null,accountNumber:service.account_number,summary:`Update fixed service ${service.solution_id||service.order_number||id}`,json:JSON.stringify(proposed),requestedBy:req.session.user.id});
    await audit(req,{actionType:'fixed_service_change_requested',entityType:'data_change_requests',entityId:request.insertId,description:`Fixed-service change requested for ${service.account_number}`,before:service,after:proposed});
    res.redirect(`${res.locals.basePath}/fixed/accounts/${service.fixed_account_id}?change_requested=1#service-${id}`);
  }catch(e){next(e)}
});

router.get('/fixed/accounts/:id/request-mobile-line', requireAuth, async (req,res,next)=>{
  try{
    const id=Number(req.params.id);
    const [[fixedAccount]]=await db.execute(`SELECT fa.*,ca.id canonical_account_id,ca.account_number canonical_account_number FROM fixed_accounts fa LEFT JOIN customer_accounts ca ON ca.id=fa.account_id OR ca.account_number_normalised=fa.account_number_normalised WHERE fa.id=:id LIMIT 1`,{id});
    if(!fixedAccount?.canonical_account_id)return res.status(404).render('error',{title:'Unique account not found',message:'This fixed customer must be linked to its unique account before a mobile line can be added.'});
    if(req.session.user.role!=='staff')return res.redirect(`${res.locals.basePath}/backoffice/clients/new?account_number=${encodeURIComponent(fixedAccount.canonical_account_number)}&client_name=${encodeURIComponent(fixedAccount.customer_name||'')}&email=${encodeURIComponent(fixedAccount.email||'')}`);
    const client={id:null,canonical_account_number:fixedAccount.canonical_account_number,client_name:fixedAccount.customer_name,email:fixedAccount.email||'',account_id:fixedAccount.canonical_account_id};
    res.render('mobile-line-request',{title:'Request Mobile Line',client,error:null,formAction:`${res.locals.basePath}/fixed/accounts/${id}/request-mobile-line`,backUrl:`${res.locals.basePath}/fixed/accounts/${id}`});
  }catch(e){next(e)}
});

router.post('/fixed/accounts/:id/request-mobile-line', requireAuth, async (req,res,next)=>{
  try{
    if(req.session.user.role!=='staff')return res.status(403).render('error',{title:'Access denied',message:'Use Add Mobile Line from the management account screen.'});
    const id=Number(req.params.id);
    const [[account]]=await db.execute(`SELECT ca.id account_id,ca.account_number,fa.customer_name,fa.email FROM fixed_accounts fa JOIN customer_accounts ca ON ca.id=fa.account_id OR ca.account_number_normalised=fa.account_number_normalised WHERE fa.id=:id LIMIT 1`,{id});
    if(!account)return res.status(404).render('error',{title:'Unique account not found',message:'This fixed customer is not linked to a unique account.'});
    const cell=String(req.body.cell_number||'').trim();if(!cell)return res.status(400).render('error',{title:'Cellphone required',message:'Enter the mobile line number.'});
    const normalised=phone(cell);const [[duplicate]]=await db.execute('SELECT id FROM clients WHERE cell_number_normalised=:phone AND account_id=:accountId LIMIT 1',{phone:normalised,accountId:account.account_id});
    if(duplicate)return res.status(409).render('error',{title:'Line already exists',message:'This cellphone number is already recorded on the account.'});
    const proposed={account_id:account.account_id,account_number:account.account_number,client_name:String(req.body.client_name||account.customer_name).trim(),cell_number:cell,cell_number_normalised:normalised,email:String(req.body.email||account.email||'').trim().toLowerCase()||null,package_name:String(req.body.package_name||'').trim()||null,handset:String(req.body.handset||'').trim()||null,previous_upgrade_date:req.body.previous_upgrade_date||null,contract_term_months:Number(req.body.contract_term_months)===36?36:24};
    const [request]=await db.execute(`INSERT INTO data_change_requests (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by) VALUES ('add_line','customer_accounts',:accountId,NULL,:accountNumber,:summary,'Staff requested a new mobile line from Fixed Customer 360',:json,'manager','pending_manager',:requestedBy)`,{accountId:account.account_id,accountNumber:account.account_number,summary:`Add mobile line ${cell} to ${account.account_number}`,json:JSON.stringify(proposed),requestedBy:req.session.user.id});
    await audit(req,{actionType:'mobile_line_requested',entityType:'customer_accounts',entityId:account.account_id,description:`Mobile line ${cell} requested for ${account.account_number}`,after:proposed});
    res.redirect(`${res.locals.basePath}/fixed/accounts/${id}?change_requested=mobile`);
  }catch(e){next(e)}
});

router.get('/fixed/accounts/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[account]] = await db.execute(`SELECT fa.*, su.full_name assigned_staff_name
      FROM fixed_accounts fa LEFT JOIN staff_users su ON su.id=fa.assigned_staff_id WHERE fa.id=:id`, { id });
    if (!account) return res.status(404).render('error', { title: 'Fixed account not found', message: 'The fixed account could not be found.' });
    const [services] = await db.execute('SELECT * FROM fixed_services WHERE fixed_account_id=:id ORDER BY branch_name, activation_date', { id });
    const [mobileLines] = await db.execute(`SELECT id,client_name,account_number,cell_number,handset,package_name,next_upgrade_date,line_status
      FROM clients WHERE account_number=COALESCE(:linked,:account) ORDER BY client_name,cell_number`, { linked: account.linked_mobile_account_number, account: account.account_number });
    const [inquiries] = await db.execute(`SELECT i.*, ic.category_name, COALESCE(su.full_name,'Unassigned') staff_name
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users su ON su.id=COALESCE(i.assigned_staff_id,i.staff_id)
      WHERE i.fixed_account_id=:id ORDER BY i.created_at DESC LIMIT 50`, { id });
    const [tasks] = await db.execute(`SELECT t.*, COALESCE(su.full_name,'Unassigned') assigned_name
      FROM staff_tasks t LEFT JOIN staff_users su ON su.id=t.assigned_to
      WHERE t.related_fixed_account_id=:id ORDER BY t.created_at DESC LIMIT 50`, { id });
    res.render('fixed-account-360', { title: account.customer_name, account, services, mobileLines, inquiries, tasks, serviceSaved:req.query.service_saved, changeRequested:req.query.change_requested });
  } catch (e) { next(e); }
});

router.get('/fixed/accounts/:id/json', requireAuth, async (req, res, next) => {
  try {
    const [[account]] = await db.execute(`SELECT id,account_number,customer_name,contact_name,contact_number,email FROM fixed_accounts WHERE id=:id`, { id: Number(req.params.id) });
    if (!account) return res.status(404).json({ error: 'Fixed account not found' });
    const [services] = await db.execute(`SELECT id,branch_name,solution_id,order_number,router_model,package_name,service_status FROM fixed_services WHERE fixed_account_id=:id ORDER BY branch_name`, { id: account.id });
    res.json({ account, services });
  } catch (e) { next(e); }
});

router.get('/fixed/accounts/:id/edit', requireAuth, requireManager, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[account]] = await db.execute('SELECT * FROM fixed_accounts WHERE id=:id', { id });
    const [staff] = await db.query('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
    const [mobileAccounts] = await db.query(`SELECT account_number, MAX(client_name) client_name, COUNT(*) line_count FROM clients WHERE account_number IS NOT NULL AND account_number<>'' GROUP BY account_number ORDER BY client_name LIMIT 5000`);
    if (!account) return res.status(404).render('error', { title: 'Not found', message: 'Fixed account not found.' });
    res.render('fixed-account-edit', { title: 'Edit Fixed Account', account, staff, mobileAccounts });
  } catch (e) { next(e); }
});

router.post('/fixed/accounts/:id', requireAuth, requireManager, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body;
    await db.execute(`UPDATE fixed_accounts SET customer_name=:customer_name,contact_name=:contact_name,
      contact_number=:contact_number,contact_number_normalised=:contact_number_normalised,email=:email,
      authorised_contact_name=:authorised_contact_name,authorised_contact_number=:authorised_contact_number,
      authority_status=:authority_status,linked_mobile_account_number=:linked_mobile_account_number,
      assigned_staff_id=:assigned_staff_id,account_status=:account_status,notes=:notes WHERE id=:id`, {
      id, customer_name: String(b.customer_name || '').trim(), contact_name: String(b.contact_name || '').trim() || null,
      contact_number: String(b.contact_number || '').trim() || null, contact_number_normalised: phone(b.contact_number),
      email: String(b.email || '').trim().toLowerCase() || null,
      authorised_contact_name: String(b.authorised_contact_name || '').trim() || null,
      authorised_contact_number: String(b.authorised_contact_number || '').trim() || null,
      authority_status: ['unknown','confirmed','not_authorised'].includes(b.authority_status) ? b.authority_status : 'unknown',
      linked_mobile_account_number: String(b.linked_mobile_account_number || '').trim() || null,
      assigned_staff_id: b.assigned_staff_id ? Number(b.assigned_staff_id) : null,
      account_status: ['active','inactive','cancelled','unknown'].includes(b.account_status) ? b.account_status : 'unknown',
      notes: String(b.notes || '').trim() || null
    });
    res.redirect(`${res.locals.basePath}/fixed/accounts/${id}?saved=1`);
  } catch (e) { next(e); }
});

router.get('/fixed-centre', requireAuth, requireManager, async (req, res, next) => {
  try {
    const [[stats]] = await db.query(`SELECT COUNT(*) total_services, SUM(service_status='active') active_services,
      SUM(activation_date IS NULL) missing_activation, SUM(sim_number IS NULL OR sim_number='') missing_sim,
      COUNT(DISTINCT fixed_account_id) total_accounts FROM fixed_services`);
    const [byPackage] = await db.query(`SELECT package_name,COUNT(*) total FROM fixed_services GROUP BY package_name ORDER BY total DESC,package_name`);
    const [byAccount] = await db.query(`SELECT fa.id,fa.customer_name,fa.account_number,COUNT(fs.id) total,SUM(fs.service_status='active') active
      FROM fixed_accounts fa LEFT JOIN fixed_services fs ON fs.fixed_account_id=fa.id GROUP BY fa.id ORDER BY total DESC,fa.customer_name`);
    res.render('fixed-centre', { title: 'Fixed Services Centre', stats, byPackage, byAccount });
  } catch (e) { next(e); }
});

router.get('/fixed-centre.csv', requireAuth, requireManager, async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT fa.customer_name,fa.account_number,fs.branch_name,fs.order_number,fs.solution_id,fs.sim_number,fs.router_model,fs.mac_address,fs.package_name,fs.activation_date,fs.service_status
      FROM fixed_services fs JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id ORDER BY fa.customer_name,fs.branch_name`);
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Customer','Account','Branch','Order','Solution ID','SIM','Router','MAC','Package','Activation Date','Status'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="talk2me-fixed-services.csv"');
    res.send(`\ufeff${[headers.map(esc).join(','), ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n')}`);
  } catch (e) { next(e); }
});

module.exports = router;
