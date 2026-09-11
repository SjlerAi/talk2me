'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const { parse } = require('./monthly-import-parser');

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function refreshMonthlySourceEvidence({ buffer, filename, userId = null } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('A source report file is required.');
  const parsed = parse(buffer, filename);
  if (parsed.importType === 'base_details') {
    throw new Error('Base Details uses its own current/snapshot workflow and does not use source-evidence refresh.');
  }
  const fileHash = hashBuffer(buffer);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[batch]] = await connection.execute(`
      SELECT id,import_type,source_system,original_filename,file_hash,total_rows,status
      FROM monthly_import_batches
      WHERE file_hash=:fileHash
      LIMIT 1
      FOR UPDATE
    `, { fileHash });
    if (!batch) throw new Error('This exact report file is not already in Monthly Import. Upload it normally instead.');
    if (batch.import_type !== parsed.importType || batch.source_system !== parsed.sourceSystem) {
      throw new Error('The source report no longer parses as the same report family/source system as the stored batch.');
    }

    const [storedRows] = await connection.execute(`
      SELECT id,source_row_number,row_fingerprint,raw_data_json
      FROM monthly_import_rows
      WHERE batch_id=:batchId
      ORDER BY source_row_number,id
      FOR UPDATE
    `, { batchId: batch.id });
    if (storedRows.length !== parsed.rows.length) {
      throw new Error(`Evidence refresh stopped: stored batch has ${storedRows.length} rows but the source file parses to ${parsed.rows.length}. No row was changed.`);
    }

    const bySourceRow = new Map(storedRows.map(row => [Number(row.source_row_number), row]));
    const updates = [];
    for (const row of parsed.rows) {
      const stored = bySourceRow.get(Number(row.sourceRowNumber));
      if (!stored) throw new Error(`Evidence refresh stopped: source row ${row.sourceRowNumber} is missing from the stored batch.`);
      if (String(stored.row_fingerprint) !== String(row.rowFingerprint)) {
        throw new Error(`Evidence refresh stopped: fingerprint mismatch at source row ${row.sourceRowNumber}. No evidence was changed.`);
      }
      updates.push({ id: Number(stored.id), rawJson: JSON.stringify(row) });
    }

    for (const item of updates) {
      await connection.execute(`
        UPDATE monthly_import_rows
        SET raw_data_json=:rawJson,updated_at=CURRENT_TIMESTAMP
        WHERE id=:id
      `, item);
    }

    await connection.execute(`
      INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,after_json)
      VALUES (:userId,'monthly_import_source_evidence_refreshed','monthly_import_batches',:batchId,:description,:afterJson)
    `, {
      userId: userId || null,
      batchId: Number(batch.id),
      description: `Refreshed complete source-row evidence for existing monthly import batch #${batch.id} without changing matching, approval, applied status or customer records.`,
      afterJson: JSON.stringify({
        batchId: Number(batch.id), filename: batch.original_filename,
        importType: batch.import_type, sourceSystem: batch.source_system,
        refreshedRows: updates.length, fileHash
      })
    });

    await connection.commit();
    return {
      batchId: Number(batch.id), filename: batch.original_filename,
      importType: batch.import_type, sourceSystem: batch.source_system,
      refreshedRows: updates.length, fileHash
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { hashBuffer, refreshMonthlySourceEvidence };
