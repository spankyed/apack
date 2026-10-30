/// <reference types="node" />
/**
 * App-only SQLite database construction for EARS. Normal app composition stays on elmdb while the candidate
 * is qualified; packs receive an engine and never open its storage.
 * @packageDocumentation
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EarsDatabase } from '../database.ts';
import { toElmdbSchema, type EngineSchema } from '../schema.ts';
import { SqliteDatabase } from './database.ts';
import { auditSqliteDatabase, type SqliteAuditReport } from './audit.ts';
export type { SqliteAuditReport } from './audit.ts';

export { exportLogicalSnapshot, stageLogicalSnapshot, type SqliteLogicalSnapshotOptions, type SqliteStagedSnapshot } from './logical-snapshot.ts';

/** Format provenance; opening the files performs validation. Format 1 changes in place before release. */
export { DATABASE_FORMAT } from './format.ts';

export interface DatabaseOptions {
  path: string;
  schema?: EngineSchema;
  readOnly?: boolean;
  /** Trusted application-built extension, loaded on this connection before any schema or data writes. */
  nativeVectorExtension?: string;
  /** The candidate currently synchronizes each commit when enabled. False is for disposable fixtures only. */
  syncs?: boolean;
}

export function openDatabase({ schema, ...options }: DatabaseOptions): EarsDatabase {
  return new SqliteDatabase({ ...options, ...(schema ? { schema: toElmdbSchema(schema) } : {}) });
}

/** Rebuild derived indexes from primary data, excluding other writes until current generations are ready. */
export async function rebuildIndexes(database: EarsDatabase): Promise<void> {
  if (!(database instanceof SqliteDatabase)) {
    throw Object.assign(new Error('SQLite index rebuilding requires a SQLite database owner'), { code: 'UNSUPPORTED' });
  }
  await database.withExclusiveWrites(async () => {
    database.rebuildIndexes();
    await database.indexesReady();
  });
}

/** Inspect primary values and derived indexes using private snapshots; never repairs the source. */
export async function auditDatabase(database: EarsDatabase): Promise<SqliteAuditReport> {
  if (!(database instanceof SqliteDatabase)) {
    throw Object.assign(new Error('SQLite audit requires a SQLite database owner'), { code: 'UNSUPPORTED' });
  }
  return auditSqliteDatabase(database);
}

export interface TemporaryDatabases {
  open(schema: EngineSchema): { database: EarsDatabase; dispose(): void };
  disposeAll(): void;
}

export function createTemporaryDatabases(): TemporaryDatabases {
  const held = new Set<EarsDatabase>();
  const remove = (database: EarsDatabase) => {
    if (!held.has(database)) return;
    database.close();
    rmSync(database.path, { recursive: true, force: true });
    held.delete(database);
    if (!held.size) process.off('exit', disposeAll);
  };
  const disposeAll = () => { for (const database of held) remove(database); };
  return {
    open(schema) {
      const path = mkdtempSync(join(tmpdir(), 'ears-sqlite-'));
      let database: EarsDatabase;
      try { database = openDatabase({ path, schema, syncs: false }); }
      catch (error) { rmSync(path, { recursive: true, force: true }); throw error; }
      held.add(database);
      if (held.size === 1) process.once('exit', disposeAll);
      return { database, dispose: () => remove(database) };
    },
    disposeAll,
  };
}
