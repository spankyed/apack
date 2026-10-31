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
import { SqliteVectorModels } from './vector-models.ts';
import { resolveNativeVectorExtension } from './native-extension.ts';
import { loadGraphCommunityCore } from './community-core.ts';
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
  const communityCore = loadGraphCommunityCore();
  return new SqliteDatabase({ communityCore, ...options, nativeVectorExtension: options.nativeVectorExtension ?? resolveNativeVectorExtension(), ...(schema ? { schema: toElmdbSchema(schema) } : {}) });
}

/** Claim this store's native model service and recover abandoned attempts before background work starts.
 * Read-only connections never own training. The database's drain/close lifecycle owns the resulting service.
 */
export async function startVectorModels(database: EarsDatabase): Promise<void> {
  if (!(database instanceof SqliteDatabase)) throw Object.assign(new Error('Native models require a SQLite owner'), { code: 'UNSUPPORTED' });
  if (database.readOnly) throw Object.assign(new Error('Read-only connections cannot own native model work'), { code: 'READ_ONLY' });
  await database.withExclusiveWrites(async () => {
    database.assertNativeMaintenance();
    const models = new SqliteVectorModels(database, database.nativeVectorExtension ?? resolveNativeVectorExtension());
    try {
      database.indexBuilds.assertRunning();
      database.sql.exec('BEGIN IMMEDIATE');
      database.assertNativeMaintenance();models.recover(); database.commitWrite();
    } catch (error) {
      const failures: unknown[] = [error];
      if (database.sql.inTransaction) try { database.sql.exec('ROLLBACK'); } catch (rollback) { failures.push(rollback); }
      try { await models.stop(); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length > 1) throw Object.assign(new AggregateError(failures, 'Native model startup and cleanup failed', { cause: error }), { code: (error as {code?: unknown})?.code });
      throw error;
    }
  });
}

/** Drain asynchronous native work through maintenance while retaining the service claim.
 * Logical indexing remains available; only a previously running service resumes afterward.
 */
export async function withNativeModelsPaused<T>(database:EarsDatabase,operation:()=>Promise<T>):Promise<T> {
  if(!(database instanceof SqliteDatabase))throw Object.assign(new Error('Native model suspension requires a SQLite owner'),{code:'UNSUPPORTED'});
  if(database.readOnly)throw Object.assign(new Error('Read-only connections cannot own native maintenance'),{code:'READ_ONLY'});
  return database.withExclusiveWrites(()=>{database.assertNativeMaintenance();return database.indexBuilds.withNativeModelsPaused(operation);});
}

/** Queue background physical model refresh without changing logical generations or blocking ordinary writes.
 * Resolves after durable admission, not training. Use waitForNativeModels for explicit completion.
 */
export async function refreshNativeModels(database:EarsDatabase):Promise<void> {
  if(!(database instanceof SqliteDatabase))throw Object.assign(new Error('Native model refresh requires a SQLite owner'),{code:'UNSUPPORTED'});
  await database.withExclusiveWrites(async()=>{database.refreshNativeModels();});
}

/** Wait for optional native work as well as declared logical indexes; requires a live service on this handle. */
export function waitForNativeModels(database: EarsDatabase): Promise<void> {
  if (!(database instanceof SqliteDatabase)) return Promise.reject(Object.assign(new Error('Native model readiness requires a SQLite owner'), { code: 'UNSUPPORTED' }));
  return database.nativeModelsReady();
}

/** Repair damaged native groups and rebuild derived indexes from primary data under maintenance ownership. */
export async function rebuildIndexes(database: EarsDatabase): Promise<void> {
  if (!(database instanceof SqliteDatabase)) {
    throw Object.assign(new Error('SQLite index rebuilding requires a SQLite database owner'), { code: 'UNSUPPORTED' });
  }
  await withNativeModelsPaused(database,async () => {
    database.rebuildIndexes({repairNative:true});
    await database.indexesReady();
    while(database.collectInvalidatedNativeModels())await new Promise<void>(resolve=>setImmediate(resolve));
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
