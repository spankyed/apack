// Traverse logical primary records from an immutable private copy; physical slot IDs never enter the stream.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from './database.ts';
import { encodeLogicalSnapshot, type LogicalStreamOptions } from './logical-format.ts';
import { logicalRecords } from './logical-records.ts';

function cleanup(db: SqliteDatabase | undefined, root: string, failed: boolean, primary: unknown): void {
  const errors: unknown[] = [];
  try { db?.close(); } catch (error) { errors.push(error); }
  try { rmSync(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(failed ? [primary, ...errors] : errors, 'Logical snapshot cleanup failed', { cause: failed ? primary : errors[0] });
}

/** Internal producer; caller owns backpressure and temporary/exclusive publication of the resulting bytes. */
export async function* exportLogicalSnapshot(source: SqliteDatabase, options: LogicalStreamOptions = {}): AsyncGenerator<Uint8Array> {
  const root = mkdtempSync(join(tmpdir(), 'ears-logical-export-'));
  let snapshot: SqliteDatabase | undefined, failed = false, failure: unknown;
  try {
    const path = join(root, 'snapshot');
    await source.withExclusiveWrites(async () => { source.backup(path); });
    snapshot = new SqliteDatabase({ path, readOnly: true, nativeVectorExtension: source.nativeVectorExtension });
    yield* encodeLogicalSnapshot(snapshot.sequence, logicalRecords(snapshot), options);
  } catch (error) { failed = true; failure = error; throw error; }
  finally { cleanup(snapshot, root, failed, failure); }
}
