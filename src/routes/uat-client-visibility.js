'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { normaliseFilters,buildWorkConditions } = require('../services/uat-customer-filters');
const { parseAttention,buildAttentionConditions,reasonLabels } = require('../services/uat-customer-attention');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner','manager','admin']);
const PAGE_SIZE = 50;

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').trim().toLowerCase()));
}
function idOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
// Split account and client matches so both indexed columns can be used.
// The earlier single OR inside a correlated EXISTS forced full scans on UAT data.
function assignedToClause(paramName) {
  return `(EXISTS (
    SELECT 1 FROM client_assignments vis
    WHERE vis.is_active=1 AND vis.client_id=c.id AND vis.assigned_staff_id=:${paramName}
  ) OR (c.account_number IS NOT NULL AND c.account_number<>'' AND EXISTS (
    SELECT 1 FROM client_assignments visAccount
    WHERE visAccount.is_active=1 AND visAccount.account_number=c.account_number
      AND visAccount.assigned_staff_id=:${paramName}
  )))`;
}
function unassignedClause() {
  return `(NOT EXISTS (
    SELECT 1 FROM client_assignments vis2
    WHERE vis2.is_active=1 AND vis2.client_id=c.id
  ) AND (c.account_number IS NULL OR c.account_number='' OR NOT EXISTS (
    SELECT 1 FROM client_assignments visAccount2
    WHERE visAccount2.is_active=1 AND visAccount2.account_number=c.account_number
  )))`;
}
function visibilityClause({ management, scope }) {
  if (management && scope === 'all') return '1=1';
  if (scope === 'mine' || scope === 'staff') return assignedToClause('visibilityStaffId');
  return `(${assignedToClause('visibilityStaffId')} OR ${unassignedClause()})`;
}

router.get('/backoffice/clients',requireAuth,async(req,res,next)=>{
  if (!IS_UAT) return next();
  try {
    const userId=Number(req.session.user.id);
    const management=isManagement(req.session.user);
    const filters=normaliseFilters(req.query);
    const attention=parseAttention(req.query);
    const q=filters.q;
    const view=['all','prospects','incomplete','unassigned','archived'].includes(String(req.query.view||''))
      ? String(req.query.view) : 'all';

    const [staff]=await db.query('SELECT id,full_name,email,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
    let scope='all';
    let selectedStaffId=null;
    if (management) {
      const requested=String(req.query.scope||'all').trim().toLowerCase();
      if (requested==='mine') {
        scope='mine'; selectedStaffId=userId;
      } else if (requested==='staff') {
        const requestedStaffId=idOf(req.query.staff_id);
        if (requestedStaffId && staff.some(person=>Number(person.id)===requestedStaffId)) {
          scope='staff';selectedStaffId=requestedStaffId;
        }
      }
    } else {
      scope=String(req.query.scope||'').trim().toLowerCase()==='mine'?'mine':'all';
      selectedStaffId=userId;
    }
    const visibility=visibilityClause({management,scope});
    const params={visibilityStaffId:selectedStaffId||userId};
    const where=[visibility];
    if (q) {
      params.like='%'+q+'%';
      where.push('(c.client_name LIKE :like OR c.cell_number LIKE :like OR c.email LIKE :like OR c.account_number LIKE :like OR c.id_number LIKE :like)');
    }
    if (view==='prospects') where.push("c.lifecycle_status='prospect' AND c.is_active=1");
    if (view==='incomplete') where.push("c.lifecycle_status='prospect' AND c.is_active=1 AND (c.email IS NULL OR c.email='' OR c.city_town IS NULL OR c.city_town='' OR c.id_number IS NULL OR c.id_number='')");
    if (view==='unassigned') where.push('c.is_active=1 AND '+unassignedClause());
    if (view==='archived') where.push("(c.lifecycle_status='archived' OR c.is_active=0)");
    if (view==='all') where.push('c.is_active=1');

    const work=buildWorkConditions(filters,{management,scope,staffId:selectedStaffId||userId});
    Object.assign(params,work.params);
    where.push(...work.clauses);
    const attentionSql=buildAttentionConditions(attention,{
      management,scope,staffId:selectedStaffId||userId,unassignedClause
    });
    Object.assign(params,attentionSql.params);
    where.push(...attentionSql.clauses);
    if (filters.error) where.push('1=0'); // Fail visibly closed for an invalid date/month.
    const sqlWhere='WHERE '+where.join(' AND ');
    const [[matching]] = await db.execute('SELECT COUNT(*) total FROM clients c '+sqlWhere,params);
    const total=Number(matching?.total||0);
    const pageCount=Math.max(1,Math.ceil(total/PAGE_SIZE));
    const page=Math.min(pageCount,filters.requestedPage);
    params.limit=PAGE_SIZE;
    params.offset=(page-1)*PAGE_SIZE;

    const [clients]=await db.execute(`SELECT
      c.id,c.account_number,c.client_name,c.cell_number,c.email,c.lifecycle_status,c.lead_status,c.created_at,
      COALESCE(c.city_town,NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.raw_import_json, '$.city_town'))), ''),'') AS city_town,
      c.handset,c.upgrade_date,c.previous_upgrade_date,c.next_upgrade_date,c.line_status,c.birthday,
      (SELECT a.assigned_staff_id FROM client_assignments a
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_id,
      (SELECT su.full_name FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_name,
      (SELECT i.query_text FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_inquiry,
      (SELECT i.action_taken FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_action
      ${attentionSql.projection?', '+attentionSql.projection:''}
      FROM clients c ${work.join} ${sqlWhere} ORDER BY ${attention.focus==='needs_attention'&&filters.sort==='recent'?attentionSql.sort:work.sort} LIMIT :limit OFFSET :offset`,params);
    if(attention.focus!=='all')clients.forEach(client=>{client.attentionReasons=reasonLabels(client,attention);});

    // The tab badges describe the selected visibility scope; the separate match count
    // describes the actual combined filters and uses the exact same WHERE as the page.
    const [[counts]] = await db.execute(`SELECT
      SUM(c.is_active=1) active_count,
      SUM(c.is_active=1 AND c.lifecycle_status='prospect') prospect_count,
      SUM(c.is_active=1 AND c.lifecycle_status='prospect' AND (c.email IS NULL OR c.email='' OR c.city_town IS NULL OR c.city_town='' OR c.id_number IS NULL OR c.id_number='')) incomplete_count,
      SUM(c.is_active=0 OR c.lifecycle_status='archived') archived_count
      FROM clients c WHERE ${visibility}`,{visibilityStaffId:selectedStaffId||userId});
    const [[unassigned]] = await db.execute(`SELECT COUNT(*) total FROM clients c
      WHERE c.is_active=1 AND ${visibility} AND ${unassignedClause()}`,{visibilityStaffId:selectedStaffId||userId});

    const queryStringFor=(overrides={})=>{
      const p=new URLSearchParams();
      p.set('view',view);p.set('scope',scope);
      if(scope==='staff'&&selectedStaffId)p.set('staff_id',String(selectedStaffId));
      if(q)p.set('q',q);
      if(filters.month)p.set('upgrade_month',filters.month);
      if(filters.date!=='any')p.set('date',filters.date);
      if(filters.date==='custom') {if(filters.from)p.set('from',filters.from);if(filters.to)p.set('to',filters.to);}
      if(filters.work!=='all')p.set('work',filters.work);
      if(filters.status!=='all')p.set('status',filters.status);
      if(filters.sort!=='recent')p.set('sort',filters.sort);
      if(attention.focus!=='all'){
        p.set('focus',attention.focus);
        if(attention.focus==='birthdays')p.set('birthday',attention.birthday);
        if(attention.focus==='contact')p.set('contact',attention.contact);
        if(attention.focus==='unallocated')p.set('unallocated',attention.unallocated);
      }
      for(const [key,value] of Object.entries(overrides)) {
        if(value===null||value===undefined||value==='')p.delete(key);
        else p.set(key,String(value));
      }
      return p.toString();
    };
    return res.render('clients-admin',{
      title:'Client Administration', q,view,clients,staff:management?staff:[],
      saved:req.query.saved,counts:{...(counts||{}),unassigned_count:unassigned?.total||0},
      staffVisibilityScope:scope,staffVisibilitySelectedId:selectedStaffId,
      staffVisibilityManagement: management,
      filters,attention,total,page,pageCount,pageSize:PAGE_SIZE,
      firstRecord:total?(page-1)*PAGE_SIZE+1:0,lastRecord:Math.min(total,page*PAGE_SIZE),
      queryStringFor
    });
  }catch(error){next(error);}
});

module.exports=router;
