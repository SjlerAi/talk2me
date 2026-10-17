'use strict';
const db = require('../config/db');
const {queryCases} = require('./temporary-cleanup-cases');
const TYPES = Object.freeze([
  'same_account_phone','cross_account_phone','account_alias','staff_conflict','base_unlinked'
]);
const typeSafe = value => TYPES.includes(String(value||'')) ? String(value) : TYPES[0];
const isTerminal = decision => decision === 'approved_grouping' || decision === 'keep_separate';

async function nextPending(type, excludeKey = null) {
  const safeType=typeSafe(type);
  const [rows]=await db.query(
    'SELECT x.case_key FROM ('+queryCases[safeType]+') x '+
    'LEFT JOIN temporary_cleanup_decisions d ON d.case_type=? AND d.case_key=x.case_key '+
    'WHERE d.id IS NULL AND (? IS NULL OR x.case_key<>?) '+
    'ORDER BY x.record_count ASC,x.case_key LIMIT 1',
    [safeType,excludeKey,excludeKey]
  );
  return rows[0] ? String(rows[0].case_key) : null;
}
function nextUrl(base,type,done) {
  const qs=new URLSearchParams({type:typeSafe(type)});
  if(['approved','reviewed','flagged','corrected','consolidated'].includes(done))qs.set('done',done);
  return String(base||'')+'/temporary-cleanup/next?'+qs.toString();
}
async function queueProgress(type) {
  const safeType=typeSafe(type);
  const [[summary]]=await db.query(
    'SELECT COUNT(*) total, SUM(d.id IS NULL) pending, '+
    'SUM(d.decision IN ("approved_grouping","keep_separate")) completed, '+
    'SUM(d.decision IN ("flagged","needs_correction")) followup '+
    'FROM ('+queryCases[safeType]+') x LEFT JOIN temporary_cleanup_decisions d '+
    'ON d.case_type=? AND d.case_key=x.case_key',[safeType]
  );
  return {total:Number(summary.total||0),pending:Number(summary.pending||0),
    completed:Number(summary.completed||0),followup:Number(summary.followup||0)};
}
module.exports={TYPES,typeSafe,isTerminal,nextPending,nextUrl,queueProgress};
