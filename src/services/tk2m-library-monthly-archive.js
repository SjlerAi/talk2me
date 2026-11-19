'use strict';

// Archive published Library items on the 7th at 00:00, SAST, never deleting
// files, versions or favourites. The monthly run is transactionally idempotent.
function localClock(now=new Date()) {
  const date=now instanceof Date?now:new Date(now);
  if(Number.isNaN(date.getTime()))throw new Error('Invalid clock');
  const tokens=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const p={};
  for(const t of tokens)if(t.type!=='literal')p[t.type]=t.value;
  return {year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,
    archiveMonth:p.year+'-'+p.month,
    cutoff:p.year+'-'+p.month+'-07 00:00:00'};
}
let readyPromise;
async function ensureArchiveSchema(db){
  if(!readyPromise){
    readyPromise=(async()=>{
      await db.query(`CREATE TABLE IF NOT EXISTS library_monthly_archive_runs (
        archive_month CHAR(7) NOT NULL,
        cutoff_at DATETIME NOT NULL,
        archived_count INT UNSIGNED NOT NULL DEFAULT 0,
        completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (archive_month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.query(`CREATE TABLE IF NOT EXISTS library_monthly_archive_items (
        archive_month CHAR(7) NOT NULL,
        document_id BIGINT UNSIGNED NOT NULL,
        archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (archive_month,document_id),
        KEY idx_archive_item_document (document_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error=>{readyPromise=null;throw error});
  }
  await readyPromise;
}
async function archiveLibrary(db,{now=new Date(),catchUp=false}={}){
  const clock=localClock(now);
  // The recurring cron only acts in the minute beginning at midnight
  // on the 7th. Explicit catchUp is used once to clear older October stock.
  const isMidnight=clock.day==='07'&&clock.hour==='00'&&clock.minute==='00';
  const due=catchUp?Number(clock.day)>=7:isMidnight;
  if(!due)return {ok:true,due:false,month:clock.archiveMonth,archived:0};
  await ensureArchiveSchema(db);
  const conn=await db.getConnection();
  let tx=false;
  try{
    await conn.beginTransaction();tx=true;
    const [insert]=await conn.execute(`INSERT IGNORE INTO library_monthly_archive_runs
      (archive_month,cutoff_at,archived_count)
      VALUES (:month,:cutoff,0)`,{month:clock.archiveMonth,cutoff:clock.cutoff});
    if(!insert.affectedRows){
      await conn.rollback();tx=false;
      return {ok:true,alreadyRan:true,month:clock.archiveMonth,archived:0};
    }
    // Records the exact document IDs moved by this run. Restoring later
    // does not erase the monthly history.
    await conn.execute(`INSERT INTO library_monthly_archive_items
      (archive_month,document_id)
      SELECT :month,d.id FROM library_documents d
      WHERE d.status='active' AND d.updated_at<:cutoff`,
      {month:clock.archiveMonth,cutoff:clock.cutoff});
    const [result]=await conn.execute(`UPDATE library_documents
      SET status='archived',updated_at=NOW()
      WHERE status='active' AND updated_at<:cutoff`,{cutoff:clock.cutoff});
    const count=Number(result.affectedRows||0);
    await conn.execute(`UPDATE library_monthly_archive_runs
      SET archived_count=:count,completed_at=NOW()
      WHERE archive_month=:month`,{count,month:clock.archiveMonth});
    await conn.commit();tx=false;
    return {ok:true,due:true,month:clock.archiveMonth,cutoff:clock.cutoff,archived:count};
  }catch(error){
    if(tx)await conn.rollback();
    throw error;
  }finally{conn.release()}
}
module.exports={localClock,ensureArchiveSchema,archiveLibrary};
