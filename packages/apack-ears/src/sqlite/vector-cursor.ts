// Prepare before ingestion; enabling native search must never hide a populated foreground index build.
import type { SqliteDatabase } from './database.ts';

export function prepareEmptyNativeVectorCursor(db: SqliteDatabase): boolean {
  if (db.get("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='chunk_native_admission'")) return true;
  if (db.readOnly) return false;
  // Hold writer ownership across the empty check and DDL. Another connection cannot populate the
  // store between them. Search admission already owns a transaction; a standalone owner supplies one.
  const owned = !db.sql.inTransaction;
  if (owned) db.sql.exec('BEGIN IMMEDIATE');
  try {
    if (db.get('SELECT 1 FROM chunks LIMIT 1')) return false;
    db.sql.exec('CREATE INDEX IF NOT EXISTS chunk_native_admission ON chunks(generation,embedding_id) WHERE embedding_id IS NOT NULL');
    if (owned) db.commitWrite();
    return true;
  } finally {
    if (owned && db.sql.inTransaction) db.sql.exec('ROLLBACK');
  }
}
