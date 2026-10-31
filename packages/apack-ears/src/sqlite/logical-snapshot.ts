// Public app-only recovery composition. The host owns final artifact and incumbent publication.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EarsDatabase } from '../database.ts';
import { SqliteDatabase } from './database.ts';
import { exportLogicalSnapshot as exportSnapshot } from './logical-export.ts';
import { stageLogicalSnapshot as stageRecords } from './logical-stage.ts';
import { restoreLogicalStage } from './logical-restore.ts';
import type { SqliteAuditReport } from './audit.ts';

export interface SqliteLogicalSnapshotOptions {
  /** Maximum encoded record size; memory may scale with the largest record/value. Defaults to 1 GiB. */
  maxFrameBytes?: number;
}
export interface SqliteStagedSnapshot {
  /** Closed, indexed and audited store inside the newly reserved staging directory. */
  path: string;
  sequence: number;
  audit: SqliteAuditReport;
}

/** Stream one private snapshot, preserving logical primary bytes. The caller owns output publication. */
export function exportLogicalSnapshot(database: EarsDatabase, options: SqliteLogicalSnapshotOptions = {}): AsyncIterable<Uint8Array> {
  if (!(database instanceof SqliteDatabase))
    throw Object.assign(new Error('SQLite logical export requires a SQLite database owner'), { code: 'UNSUPPORTED' });
  return exportSnapshot(database, options);
}

/** Reserve a new private staging directory; verify, restore, index and audit before returning a store path.
 * The parent must exist. Never pass a live profile directory: the host publishes only the returned store.
 * On success the caller owns the directory; on failure only this operation's reserved directory is removed.
 */
export async function stageLogicalSnapshot(chunks: AsyncIterable<Uint8Array>, directory: string,
  options: SqliteLogicalSnapshotOptions = {}): Promise<SqliteStagedSnapshot> {
  mkdirSync(directory, { mode: 0o700 });
  let result: SqliteStagedSnapshot | undefined, failed = false, failure: unknown;
  try {
    await stageRecords(chunks, join(directory, 'spool'), options);
    result = await restoreLogicalStage(join(directory, 'spool'), join(directory, 'store'));
    rmSync(join(directory, 'spool'), { recursive: true });
  } catch (error) { failed = true; failure = error; }
  if (failed) {
    try { rmSync(directory, { recursive: true, force: true }); }
    catch (cleanup) { throw Object.assign(new AggregateError([failure, cleanup], 'Logical snapshot staging and cleanup failed', { cause: failure }),
      { code: (failure as {code?: unknown})?.code }); }
    throw failure;
  }
  return result!;
}
