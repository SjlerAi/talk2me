#!/usr/bin/env python3
"""Compare UENT LIVE to isolated TK2M stage, read-only by default.

--record updates ONLY the separately owned tk2m_review_source_deltas table
in staging. It never overwrites customers, imports, tasks or review decisions.
Do not treat this as a production-to-stage synchronization or cutover.
"""
import argparse,datetime,hashlib,json,os,pymysql
from pathlib import Path
from pymysql.cursors import DictCursor
PARSER=argparse.ArgumentParser()
PARSER.add_argument('--record',action='store_true',help='Record observed boolean differences to staging review metadata only')
args=PARSER.parse_args()
root=Path('/home/talk/crm-migration/audits')
env={}
for line in Path('/home/talk/zippy3-private/config.env').read_text().splitlines():
 if '=' in line and not line.startswith('#'):
  k,v=line.split('=',1);env[k.strip()]=v.strip().strip("'").strip('"')
stage=json.loads(Path('/home/talk/crm-migration/staging-db-connection.json').read_text())
assert env.get('CRM_DB_NAME')=='uent_Crm' and stage.get('database')=='talk_crm_stage', 'Refusing unexpected DB credentials'
live_cfg=dict(host=env['CRM_DB_HOST'],port=int(env.get('CRM_DB_PORT') or 3306),user=env['CRM_DB_USER'],
 password=env['CRM_DB_PASSWORD'],database='uent_Crm',cursorclass=DictCursor,connect_timeout=5,read_timeout=20,autocommit=False)
stage_cfg=dict(host=stage['host'],port=int(stage.get('port') or 3306),user=stage['user'],
 password=stage['password'],database='talk_crm_stage',cursorclass=DictCursor,connect_timeout=5,read_timeout=20,autocommit=False)
def extract(db):
 data={}
 with db.cursor() as q:
  q.execute('START TRANSACTION READ ONLY')
  q.execute('SELECT DATABASE() name')
  for table in ('clients','client_assignments'):
   q.execute('SELECT id,is_active FROM '+table)
   data[table]={int(r['id']):int(r['is_active']) for r in q.fetchall()}
 db.rollback()
 return data
live=pymysql.connect(**live_cfg)
staging=pymysql.connect(**stage_cfg)
try:
 source=extract(live);target=extract(staging)
 cases=[]
 for table,entity in [('clients','client'),('client_assignments','assignment')]:
  a=source[table];b=target[table]
  for ident in sorted(set(a)&set(b)):
   if a[ident]!=b[ident]:
    sv='active' if a[ident] else 'inactive'
    tv='active' if b[ident] else 'inactive'
    sig=hashlib.sha256(json.dumps([entity,ident,'is_active',sv,tv],separators=(',',':')).encode()).hexdigest()
    cases.append(dict(entity_type=entity,entity_id=ident,field_key='is_active',
     source_value=sv,stage_value=tv,source_hash=sig))
 counts={table:{'source':len(source[table]),'stage':len(target[table]),
     'missing_from_stage':len(set(source[table])-set(target[table])),
     'stage_only':len(set(target[table])-set(source[table]))} for table in ('clients','client_assignments')}
 if args.record:
  # Only metadata maintained by the Data Review Centre is updated.
  with staging.cursor() as q:
   q.execute('SELECT DATABASE() name')
   assert q.fetchone()['name']=='talk_crm_stage'
   q.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tk2m_review_source_deltas'")
   assert q.fetchone(), 'Review schema not installed'
   staging.begin()
   try:
    q.execute('UPDATE tk2m_review_source_deltas SET is_current=0 WHERE is_current=1')
    for c in cases:
     q.execute('''INSERT INTO tk2m_review_source_deltas
       (entity_type,entity_id,field_key,source_value,stage_value,source_hash,is_current,checked_at)
       VALUES (%(entity_type)s,%(entity_id)s,%(field_key)s,%(source_value)s,%(stage_value)s,%(source_hash)s,1,UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE source_value=VALUES(source_value),stage_value=VALUES(stage_value),
        source_hash=VALUES(source_hash),is_current=1,checked_at=VALUES(checked_at)''',c)
    staging.commit()
   except:staging.rollback();raise
 report={'generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'mode':'record-staging-review-metadata' if args.record else 'preview-only-no-writes',
  'source':'uent_Crm','target':'talk_crm_stage',
  'rows':counts,'status_field_difference_cases':len(cases),
  'status_field_by_entity':{e:sum(c['entity_type']==e for c in cases) for e in ('client','assignment')},
  'not_a_sync':True,'review_decisions_preserved':True,
  'note':'No customer, import, task, or contact data was modified. Do a final source snapshot before any approved Friday sync.'}
 out=root/('tk2m-review-delta-snapshot-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
 with out.open('x') as f:json.dump(report,f,indent=2)
 os.chmod(out,0o600)
 print('SOURCE_STAGE_REVIEW_SNAPSHOT',json.dumps(report))
 print('PRIVATE_AUDIT_FILE',out)
finally:
 live.close();staging.close()
