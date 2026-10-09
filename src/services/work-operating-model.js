'use strict';

const db = require('../config/db');

const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const ACTIVE_TASK = "('unread','seen','in_progress')";
const OPEN_INQUIRY = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
let schemaPromise = null;

const DEFAULT_TARGETS = Object.freeze({
  sales_mobile: [
    ['upgrades','Upgrades','upgrades_updated'],
    ['new_lines','New Lines',null],
    ['transfers','Transfers',null],
    ['insurance','Versekering',null],
    ['siebel_simplified','Siebel simplified',null],
    ['e20','E20',null]
  ],
  sias: [
    ['office','Office',null],
    ['lte','LTE',null],
    ['wireless','Wireless',null],
    ['management','Management',null],
    ['smart_homes','Smart Homes',null]
  ],
  gerhard: [
    ['printers','Printers',null],
    ['telephone_system','Telefoon Sistem',null],
    ['management','Management',null],
    ['business_connections','Business Connections',null],
    ['solar','Solar',null]
  ]
});

function clean(value,max=255){
  return String(value == null ? '' : value).trim().slice(0,max);
}

function normaliseName(value){
  return clean(value,255).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function shortName(value){
  const raw=clean(value,255);
  if(!raw)return '';
  const source=raw.includes('@')?raw.split('@')[0]:raw;
  const words=source.split(/[\s._-]+/).filter(Boolean);
  if(words[0]?.toLowerCase()==='van'&&words[1]?.toLowerCase()==='zyl') return 'Van Zyl';
  return words[0]||raw;
}

function monthKey(value){
  const raw=clean(value,10);
  if(/^\d{4}-\d{2}$/.test(raw)) return raw+'-01';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0,7)+'-01';
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

function rangeSpec(key='month'){
  const value=String(key||'month').toLowerCase();
  if(['today','day'].includes(value)) return {key:'today',label:'Today',from:'CURRENT_DATE()',to:'NOW()'};
  if(['week','this_week','weekly'].includes(value)) return {key:'week',label:'This week',from:'DATE_SUB(CURRENT_DATE(),INTERVAL WEEKDAY(CURRENT_DATE()) DAY)',to:'NOW()'};
  if(['last_month','previous_month'].includes(value)) return {key:'last_month',label:'Last month',from:"DATE_FORMAT(DATE_SUB(CURRENT_DATE(),INTERVAL 1 MONTH),'%Y-%m-01')",to:"DATE_SUB(DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01'),INTERVAL 1 SECOND)"};
  return {key:'month',label:'This month',from:"DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')",to:'NOW()'};
}

async function ensureWorkOperatingSchema(){
  if(!IS_UAT) throw new Error('Work operating model is UAT-only.');
  if(!schemaPromise){
    schemaPromise=(async()=>{
      await db.execute(`CREATE TABLE IF NOT EXISTS staff_target_goals (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        staff_id BIGINT UNSIGNED NOT NULL,
        month_key DATE NOT NULL,
        metric_key VARCHAR(80) NOT NULL,
        metric_label VARCHAR(120) NOT NULL,
        target_value DECIMAL(12,2) NULL,
        manual_actual DECIMAL(12,2) NULL,
        auto_metric_key VARCHAR(80) NULL,
        sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by BIGINT UNSIGNED NULL,
        updated_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY(id),
        UNIQUE KEY uq_staff_target_month_metric (staff_id,month_key,metric_key),
        KEY idx_staff_target_month (month_key,staff_id,is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.execute(`CREATE TABLE IF NOT EXISTS staff_target_weekly (
        goal_id BIGINT UNSIGNED NOT NULL,
        week_no TINYINT UNSIGNED NOT NULL,
        manual_actual DECIMAL(12,2) NULL,
        updated_by BIGINT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY(goal_id,week_no),
        KEY idx_target_weekly_goal (goal_id,week_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().finally(()=>{schemaPromise=null;});
  }
  return schemaPromise;
}

function targetTemplateFor(staff){
  const name=normaliseName(staff?.full_name||`${staff?.first_name||''} ${staff?.surname||''}`);
  const username=normaliseName(staff?.username||'');
  const email=normaliseName(String(staff?.email||'').split('@')[0]);
  const joined=`${name} ${username} ${email}`;
  if(/\b(johnny|annazel|brabant)\b/.test(joined)||/\bvan zyl\b|\bvanzyl\b/.test(joined)) return DEFAULT_TARGETS.sales_mobile;
  if(/\bsias\b/.test(joined)) return DEFAULT_TARGETS.sias;
  if(/\bgerhard\b/.test(joined)) return DEFAULT_TARGETS.gerhard;
  return [];
}

async function seedDefaultTargets(month,actorId=null){
  await ensureWorkOperatingSchema();
  const key=monthKey(month);
  const [staff]=await db.execute(`SELECT id,full_name,first_name,surname,username,email FROM staff_users WHERE is_active=1 ORDER BY id`);
  for(const person of staff){
    const template=targetTemplateFor(person);
    for(let index=0;index<template.length;index+=1){
      const [metricKey,metricLabel,autoMetricKey]=template[index];
      await db.execute(`INSERT IGNORE INTO staff_target_goals
        (staff_id,month_key,metric_key,metric_label,auto_metric_key,sort_order,created_by,updated_by)
        VALUES (:staffId,:monthKey,:metricKey,:metricLabel,:autoMetricKey,:sortOrder,:actorId,:actorId)`,{
        staffId:Number(person.id),monthKey:key,metricKey,metricLabel,autoMetricKey,sortOrder:(index+1)*10,actorId:actorId||null
      });
    }
  }
  return key;
}

async function autoUpgradeActuals(month,staffIds){
  const ids=[...new Set((staffIds||[]).map(Number).filter(Boolean))];
  const result=new Map();
  if(!ids.length)return result;
  const marks=ids.map(()=>'?').join(',');
  const params=[monthKey(month),monthKey(month),...ids];
  const [rows]=await db.query(`SELECT al.staff_id,
      LEAST(5,GREATEST(1,CEIL(DAY(al.created_at)/7))) week_no,
      COUNT(*) total
    FROM audit_log al
    WHERE al.created_at>=?
      AND al.created_at<DATE_ADD(?,INTERVAL 1 MONTH)
      AND al.staff_id IN (${marks})
      AND LOWER(CONCAT(COALESCE(al.action_type,''),' ',COALESCE(al.description,''))) LIKE '%upgrade%'
    GROUP BY al.staff_id,week_no`,params);
  for(const row of rows){
    const staffId=Number(row.staff_id),week=Number(row.week_no),total=Number(row.total||0);
    if(!result.has(staffId))result.set(staffId,{weeks:{1:0,2:0,3:0,4:0,5:0},total:0});
    result.get(staffId).weeks[week]=total;
    result.get(staffId).total+=total;
  }
  return result;
}

async function getTargetCentre({staffId=null,month=null,actorId=null}={}){
  const key=await seedDefaultTargets(month,actorId);
  const params={monthKey:key};
  let staffSql='';
  if(Number(staffId)>0){params.staffId=Number(staffId);staffSql=' AND g.staff_id=:staffId';}
  const [goals]=await db.execute(`SELECT g.id,g.staff_id,g.month_key,g.metric_key,g.metric_label,g.target_value,g.manual_actual,
      g.auto_metric_key,g.sort_order,s.full_name,s.first_name,s.surname,s.username,s.email
    FROM staff_target_goals g JOIN staff_users s ON s.id=g.staff_id
    WHERE g.month_key=:monthKey AND g.is_active=1 ${staffSql}
    ORDER BY s.full_name,g.sort_order,g.metric_label`,params);
  const goalIds=goals.map(row=>Number(row.id));
  const weeklyByGoal=new Map();
  if(goalIds.length){
    const marks=goalIds.map(()=>'?').join(',');
    const [weeks]=await db.query(`SELECT goal_id,week_no,manual_actual FROM staff_target_weekly WHERE goal_id IN (${marks}) ORDER BY week_no`,goalIds);
    for(const row of weeks){
      if(!weeklyByGoal.has(Number(row.goal_id)))weeklyByGoal.set(Number(row.goal_id),{});
      weeklyByGoal.get(Number(row.goal_id))[Number(row.week_no)]=row.manual_actual==null?null:Number(row.manual_actual);
    }
  }
  const auto=await autoUpgradeActuals(key,goals.filter(row=>row.auto_metric_key==='upgrades_updated').map(row=>row.staff_id));
  const staffMap=new Map();
  for(const row of goals){
    const sid=Number(row.staff_id);
    if(!staffMap.has(sid))staffMap.set(sid,{
      staffId:sid,
      staffName:shortName(row.first_name||row.full_name||row.username||row.email),
      fullName:row.full_name||row.email,
      goals:[]
    });
    const manualWeeks=weeklyByGoal.get(Number(row.id))||{};
    const autoData=row.auto_metric_key==='upgrades_updated'?auto.get(sid):null;
    const weeks={};
    let weeklyTotal=0,hasWeekly=false;
    for(let week=1;week<=5;week+=1){
      const value=autoData?Number(autoData.weeks[week]||0):(manualWeeks[week]==null?null:Number(manualWeeks[week]));
      weeks[week]=value;
      if(value!=null){weeklyTotal+=Number(value||0);hasWeekly=true;}
    }
    const actual=autoData?Number(autoData.total||0):(hasWeekly?weeklyTotal:Number(row.manual_actual||0));
    const target=row.target_value==null?null:Number(row.target_value);
    staffMap.get(sid).goals.push({
      id:Number(row.id),metricKey:row.metric_key,label:row.metric_label,target,actual,
      progress:target&&target>0?Math.round((actual/target)*1000)/10:null,
      source:autoData?'automatic':'manual',weeks
    });
  }
  return {monthKey:key,staff:[...staffMap.values()]};
}

async function saveTargetGoal({goalId,actorId,targetValue=null,weeks=[]}={}){
  await ensureWorkOperatingSchema();
  const id=Number(goalId),actor=Number(actorId);
  if(!id||!actor)throw new Error('Target goal and owner are required.');
  const [[goal]]=await db.execute('SELECT id,auto_metric_key FROM staff_target_goals WHERE id=:id AND is_active=1 LIMIT 1',{id});
  if(!goal)throw new Error('Target goal not found.');
  const target=targetValue===''||targetValue==null?null:Number(targetValue);
  if(target!=null&&!Number.isFinite(target))throw new Error('Target must be a number.');
  await db.execute('UPDATE staff_target_goals SET target_value=:target,updated_by=:actor WHERE id=:id',{target,actor,id});
  if(!goal.auto_metric_key){
    const values=Array.isArray(weeks)?weeks:[];
    for(let week=1;week<=5;week+=1){
      const raw=values[week-1];
      const value=raw===''||raw==null?null:Number(raw);
      if(value!=null&&!Number.isFinite(value))throw new Error('Weekly actual must be a number.');
      await db.execute(`INSERT INTO staff_target_weekly (goal_id,week_no,manual_actual,updated_by)
        VALUES (:goalId,:weekNo,:value,:actor)
        ON DUPLICATE KEY UPDATE manual_actual=VALUES(manual_actual),updated_by=VALUES(updated_by),updated_at=NOW()`,{
        goalId:id,weekNo:week,value,actor
      });
    }
  }
  return {ok:true};
}

async function getMyWorkOverview({userId,month=null}={}){
  await ensureWorkOperatingSchema();
  const id=Number(userId);
  if(!id)throw new Error('Staff member is required.');
  const [delegated,summary,customerRows,customerCount,targets]=await Promise.all([
    db.execute(`SELECT t.id,t.title,t.message,t.priority,t.status,t.due_at,t.created_at,t.updated_at,
        t.related_client_id,c.client_name,creator.full_name delegated_by,
        COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state,
        CASE WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 1 ELSE 0 END overdue
      FROM staff_tasks t
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN staff_task_workflow w ON w.task_id=t.id
      LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.assigned_to=:id AND t.created_by<>:id AND t.status IN ${ACTIVE_TASK}
      ORDER BY CASE WHEN t.due_at<NOW() THEN 0 WHEN t.priority='urgent' THEN 1 WHEN t.priority='high' THEN 2 ELSE 3 END,
        t.due_at IS NULL,t.due_at,t.updated_at DESC,t.created_at DESC LIMIT 30`,{id}),
    db.execute(`SELECT
        COUNT(*) active_tasks,
        SUM(CASE WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 1 ELSE 0 END) overdue_tasks,
        SUM(CASE WHEN t.priority='urgent' THEN 1 ELSE 0 END) urgent_tasks,
        SUM(CASE WHEN t.created_by<>:id THEN 1 ELSE 0 END) delegated_tasks
      FROM staff_tasks t WHERE t.assigned_to=:id AND t.status IN ${ACTIVE_TASK}`,{id}),
    db.execute(`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.account_number,c.next_upgrade_date,
        CASE WHEN c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date)<CURRENT_DATE() THEN 1 ELSE 0 END overdue_upgrade,
        EXISTS(SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND i.status IN ${OPEN_INQUIRY}) open_inquiry,
        EXISTS(SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='open' AND f.scheduled_at<NOW()) overdue_followup,
        EXISTS(SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='scheduled' AND cb.scheduled_at<NOW()) overdue_callback
      FROM clients c JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=:id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
        AND (
          (c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date)<CURRENT_DATE())
          OR EXISTS(SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND i.status IN ${OPEN_INQUIRY})
          OR EXISTS(SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='open' AND f.scheduled_at<NOW())
          OR EXISTS(SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='scheduled' AND cb.scheduled_at<NOW())
        )
      ORDER BY c.next_upgrade_date IS NULL,c.next_upgrade_date,c.client_name LIMIT 30`,{id}),
    db.execute(`SELECT COUNT(DISTINCT c.id) total
      FROM clients c JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=:id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
        AND (
          (c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date)<CURRENT_DATE())
          OR EXISTS(SELECT 1 FROM inquiries i WHERE i.client_id=c.id AND i.status IN ${OPEN_INQUIRY})
          OR EXISTS(SELECT 1 FROM customer_followups f WHERE f.client_id=c.id AND f.status='open' AND f.scheduled_at<NOW())
          OR EXISTS(SELECT 1 FROM customer_callbacks cb WHERE cb.client_id=c.id AND cb.status='scheduled' AND cb.scheduled_at<NOW())
        )`,{id}),
    getTargetCentre({staffId:id,month,actorId:id})
  ]);
  const delegatedRows=delegated[0].map(row=>({
    id:Number(row.id),title:row.title,message:row.message,priority:row.priority,status:row.workflow_state||row.status,
    dueAt:row.due_at,createdAt:row.created_at,clientId:row.related_client_id||null,clientName:row.client_name||null,
    delegatedBy:shortName(row.delegated_by),overdue:Boolean(row.overdue)
  }));
  const customers=customerRows[0].map(row=>{
    const reasons=[];
    if(Number(row.overdue_followup))reasons.push('Overdue follow-up');
    if(Number(row.overdue_callback))reasons.push('Overdue callback');
    if(Number(row.open_inquiry))reasons.push('Open inquiry');
    if(Number(row.overdue_upgrade))reasons.push('Overdue upgrade');
    return {id:Number(row.id),name:row.client_name,cell:row.cell_number,account:row.account_number,nextUpgradeDate:row.next_upgrade_date,reasons};
  });
  const countsRow=summary[0][0]||{};
  return {
    delegated:delegatedRows,
    tasks:{
      active:Number(countsRow.active_tasks||0),overdue:Number(countsRow.overdue_tasks||0),
      urgent:Number(countsRow.urgent_tasks||0),delegated:Number(countsRow.delegated_tasks||0)
    },
    customers:{total:Number(customerCount[0][0]?.total||0),items:customers},
    targets:targets.staff[0]||{staffId:id,staffName:'',goals:[]},
    monthKey:targets.monthKey
  };
}

async function getOfficeScorecard({rangeKey='month'}={}){
  await ensureWorkOperatingSchema();
  const range=rangeSpec(rangeKey);
  const between=`BETWEEN ${range.from} AND ${range.to}`;
  const [rows]=await db.execute(`SELECT su.id,
      COALESCE(NULLIF(su.full_name,''),NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''),su.email) staff_name,
      (SELECT COUNT(*) FROM inquiries i
        WHERE COALESCE(i.completed_by,i.assigned_staff_id,i.staff_id)=su.id
          AND i.status IN ('closed','completed','resolved','cancelled')
          AND COALESCE(i.completed_at,i.updated_at) ${between}) queries_handled,
      (SELECT COUNT(*) FROM audit_log al
        WHERE al.staff_id=su.id AND al.created_at ${between}
          AND LOWER(CONCAT(COALESCE(al.action_type,''),' ',COALESCE(al.description,''))) LIKE '%upgrade%') upgrades_updated,
      (SELECT COUNT(*) FROM audit_log al
        WHERE al.staff_id=su.id AND al.created_at ${between}
          AND LOWER(COALESCE(al.entity_type,''))='clients'
          AND (LOWER(COALESCE(al.action_type,'')) LIKE '%create%' OR LOWER(COALESCE(al.description,'')) LIKE '%created%' OR LOWER(COALESCE(al.description,'')) LIKE '%added%')) new_clients_added,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.created_by=su.id AND t.created_at ${between}) tasks_sent,
      (SELECT COUNT(*) FROM staff_task_comments c WHERE c.staff_id=su.id AND c.created_at ${between}) tasks_updated,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.completed_at ${between}) tasks_completed,
      (SELECT COUNT(*) FROM audit_log al
        WHERE al.staff_id=su.id AND al.created_at ${between}
          AND LOWER(CONCAT(COALESCE(al.action_type,''),' ',COALESCE(al.description,''))) LIKE '%claim%') clients_claimed,
      (SELECT COUNT(*) FROM staff_tasks t WHERE t.assigned_to=su.id AND t.status IN ${ACTIVE_TASK}) outstanding_tasks,
      (SELECT COUNT(DISTINCT c.id) FROM clients c JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=su.id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
        WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
          AND c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date)<CURRENT_DATE()) overdue_upgrades
    FROM staff_users su
    WHERE su.is_active=1
    ORDER BY staff_name`);
  return {
    range,
    rows:rows
      .filter(row=>targetTemplateFor({full_name:row.staff_name}).length>0)
      .map(row=>({
        staffId:Number(row.id),staffName:shortName(row.staff_name),
        queriesHandled:Number(row.queries_handled||0),upgradesUpdated:Number(row.upgrades_updated||0),
        newClientsAdded:Number(row.new_clients_added||0),tasksSent:Number(row.tasks_sent||0),
        tasksUpdated:Number(row.tasks_updated||0),tasksCompleted:Number(row.tasks_completed||0),
        clientsClaimed:Number(row.clients_claimed||0),outstandingTasks:Number(row.outstanding_tasks||0),
        overdueUpgrades:Number(row.overdue_upgrades||0)
      }))
  };
}

async function getMonthlyImportSummary({month=null}={}){
  const key=monthKey(month);
  try{
    const [[summary]]=await db.execute(`SELECT COUNT(*) batches,
        COALESCE(SUM(total_rows),0) total_rows,
        COALESCE(SUM(valid_rows),0) valid_rows,
        COALESCE(SUM(duplicate_rows),0) duplicate_rows,
        COALESCE(SUM(exception_rows),0) exception_rows,
        COALESCE(SUM(CASE WHEN LOWER(import_type) LIKE '%upgrade%' THEN valid_rows ELSE 0 END),0) upgrades,
        COALESCE(SUM(CASE WHEN LOWER(import_type) LIKE '%activ%' OR LOWER(import_type) LIKE '%new%' THEN valid_rows ELSE 0 END),0) new_lines
      FROM monthly_import_batches
      WHERE created_at>=:monthKey AND created_at<DATE_ADD(:monthKey,INTERVAL 1 MONTH)`,{monthKey:key});
    const [[matchSummary]]=await db.execute(`SELECT
        SUM(m.classification='exact_match') exact_matches,
        SUM(m.classification='conflict' AND m.review_status='pending' AND COALESCE(a.applied_status,'not_applied')='not_applied') needs_review,
        SUM(a.applied_status='applied' AND a.action_type='create_mobile_record') new_clients_applied,
        SUM(a.applied_status='applied' AND a.action_type='create_mobile_record'
          AND (c.id IS NULL OR NULLIF(TRIM(COALESCE(ca.account_number,c.account_number)), '') IS NULL)) incomplete_clients
      FROM monthly_import_batches b
      JOIN monthly_import_rows r ON r.batch_id=b.id
      LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
      LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
      LEFT JOIN clients c ON c.id=CASE
        WHEN a.target_entity_type='clients' AND a.target_entity_id IS NOT NULL THEN a.target_entity_id
        ELSE m.proposed_client_id END
      LEFT JOIN customer_accounts ca ON ca.id=COALESCE(c.account_id,m.proposed_account_id)
      WHERE b.created_at>=:monthKey AND b.created_at<DATE_ADD(:monthKey,INTERVAL 1 MONTH)`,{monthKey:key});
    const [files]=await db.execute(`SELECT b.id,b.original_filename,b.import_type,b.source_system,b.total_rows,b.valid_rows,b.duplicate_rows,b.exception_rows,b.status,b.created_at,
        COALESCE(s.full_name,s.email,'Unknown') imported_by_name
      FROM monthly_import_batches b
      LEFT JOIN staff_users s ON s.id=b.imported_by
      WHERE b.created_at>=:monthKey AND b.created_at<DATE_ADD(:monthKey,INTERVAL 1 MONTH)
      ORDER BY b.created_at DESC,b.id DESC`,{monthKey:key});
    return {
      available:true,monthKey:key,
      totals:{
        batches:Number(summary?.batches||0),imported:Number(summary?.valid_rows||0),
        rowsRead:Number(summary?.total_rows||0),upgrades:Number(summary?.upgrades||0),newLines:Number(summary?.new_lines||0),
        duplicates:Number(summary?.duplicate_rows||0),exceptions:Number(summary?.exception_rows||0),
        exactMatches:Number(matchSummary?.exact_matches||0),needsReview:Number(matchSummary?.needs_review||0),
        newClientsApplied:Number(matchSummary?.new_clients_applied||0),incompleteClients:Number(matchSummary?.incomplete_clients||0)
      },
      files:files.map(row=>({
        id:Number(row.id),name:row.original_filename,type:row.import_type,source:row.source_system,
        totalRows:Number(row.total_rows||0),validRows:Number(row.valid_rows||0),duplicates:Number(row.duplicate_rows||0),
        exceptions:Number(row.exception_rows||0),status:row.status,createdAt:row.created_at,processedBy:shortName(row.imported_by_name)
      })),
      links:{
        import:'/backoffice/data-import',
        management:'/backoffice/monthly-import-management',
        exceptions:'/backoffice/monthly-import-management?status=conflict'
      }
    };
  }catch(error){
    return {available:false,monthKey:key,error:error.message,totals:{},files:[],links:{import:'/backoffice/data-import',management:'/backoffice/monthly-import-management'}};
  }
}

async function getManagementSnapshot({rangeKey='today',month=null}={}){
  const [scorecard,targets,importSummary,workRows]=await Promise.all([
    getOfficeScorecard({rangeKey}),
    getTargetCentre({month}),
    getMonthlyImportSummary({month}),
    db.execute(`SELECT
        COUNT(*) active_delegated,
        SUM(CASE WHEN t.priority='urgent' THEN 1 ELSE 0 END) urgent_delegated,
        SUM(CASE WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 1 ELSE 0 END) overdue_delegated,
        SUM(CASE WHEN t.priority='high' THEN 1 ELSE 0 END) important_delegated
      FROM staff_tasks t
      WHERE t.created_by<>t.assigned_to AND t.status IN ${ACTIVE_TASK}`)
  ]);
  const work=workRows[0][0]||{};
  return {
    scorecard,targets,importSummary,
    delegatedWork:{
      active:Number(work.active_delegated||0),
      urgent:Number(work.urgent_delegated||0),
      overdue:Number(work.overdue_delegated||0),
      important:Number(work.important_delegated||0)
    }
  };
}

module.exports={
  ensureWorkOperatingSchema,
  shortName,
  monthKey,
  rangeSpec,
  getMyWorkOverview,
  getOfficeScorecard,
  getTargetCentre,
  saveTargetGoal,
  getMonthlyImportSummary,
  getManagementSnapshot
};
