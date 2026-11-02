// File and opening policy belongs to the host; packs and the EARS query engine do not select storage.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DATABASE_FORMAT as ELMDB_FORMAT, openDatabase as openElmdb, type DatabaseOptions } from '@apackdev/ears/lmdb';
import { DATABASE_FORMAT as SQLITE_FORMAT, openDatabase as openSqlite, rebuildIndexes as rebuildSqliteIndexes, auditDatabase as auditSqliteDatabase, exportLogicalSnapshot as exportSqliteSnapshot, stageLogicalSnapshot as stageSqliteSnapshot, startVectorModels, withNativeModelsPaused } from '@apackdev/ears/sqlite';
import { APP_ENVS, appDataDirFor } from '@apackdev/sdk/env';
import type { EarsDatabase } from '@apackdev/ears';

export interface DatabaseStorage {
  readonly format: string;
  readonly dataFile: string;
  /** Only diagnosed file corruption permits run-history quarantine; resource and derived failures refuse. */
  isUnreadableOpenError(error: unknown): boolean;
  open(options: DatabaseOptions): EarsDatabase;
  /** Starts claimed optional model work on a managed writable app store. */
  startBackground?(database: EarsDatabase): Promise<void>;
  /** Drain asynchronous storage services while keeping logical indexing usable for acceptance. */
  withBackgroundPaused?<T>(database:EarsDatabase,operation:()=>Promise<T>):Promise<T>;
  /** Offline derived-index maintenance, when implemented by the selected storage. */
  rebuildIndexes?(database: EarsDatabase): Promise<void>;
  /** Snapshot-based inspection; a finding never implicitly repairs primary or derived data. */
  audit?(database: EarsDatabase): ReturnType<typeof auditSqliteDatabase>;
  /** Lossless primary stream; host file publication remains separate. */
  exportLogicalSnapshot?: typeof exportSqliteSnapshot;
  /** Creates a closed, fully validated store inside a new caller-owned staging container. */
  stageLogicalSnapshot?: typeof stageSqliteSnapshot;
}

function refuseForeignFile(dir: string, name: string): void {
  try { fs.lstatSync(path.join(dir, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  // A selected backend mismatch is not corruption. In particular run-history boot must not move it aside.
  throw Object.assign(new Error(`${dir} holds ${name}; select its storage format explicitly`), { code: 'STORAGE_MISMATCH' });
}
const unreadableOpen = (...codes: string[]) => (error: unknown): boolean =>
  !(error instanceof AggregateError) && !(error as { databaseConnectionUnclosed?: boolean })?.databaseConnectionUnclosed && codes.includes((error as { code?: string })?.code ?? '');

const elmdb: DatabaseStorage = { isUnreadableOpenError: unreadableOpen('NOT_A_DATABASE', 'WRONG_FORMAT', 'CORRUPTED'), format: ELMDB_FORMAT, dataFile: 'data.mdb', open(options) {
  refuseForeignFile(options.path, 'data.sqlite3');
  return openElmdb(options);
} };
// A page-read EIO can surface as SQLITE_CORRUPT with intact files. Refuse ambiguous corruption;
// only SQLite's not-a-database diagnosis permits automatic history quarantine.
const sqlite: DatabaseStorage = { isUnreadableOpenError: unreadableOpen('SQLITE_NOTADB'), withBackgroundPaused: withNativeModelsPaused, startBackground: startVectorModels, format: SQLITE_FORMAT, dataFile: 'data.sqlite3', rebuildIndexes: rebuildSqliteIndexes, audit: auditSqliteDatabase, exportLogicalSnapshot: exportSqliteSnapshot, stageLogicalSnapshot: stageSqliteSnapshot, open(options) {
  refuseForeignFile(options.path, 'data.mdb');
  return openSqlite(options);
} };

/** The implementation owning a live store's format; unknown formats cannot enter replacement. */
export function databaseStorage(format: string): DatabaseStorage {
  if (format === elmdb.format) return elmdb;
  if (format === sqlite.format) return sqlite;
  throw new Error(`Unsupported database storage format: ${format}`);
}

/** Inspect real data-file names, then open to validate. Backup metadata never selects a backend. */
export function backupStorage(dir: string): DatabaseStorage | undefined {
  const present = [elmdb, sqlite].filter(storage => {
    try { fs.lstatSync(path.join(dir, storage.dataFile)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  });
  if (present.length > 1) throw new Error(`${dir} contains ambiguous database files`);
  return present[0];
}

function canonicalPath(dir: string): string {
  const resolved = path.resolve(dir);
  try { return fs.realpathSync(resolved); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      if (fs.lstatSync(resolved).isSymbolicLink()) return canonicalPath(path.resolve(path.dirname(resolved), fs.readlinkSync(resolved)));
    } catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError; }
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(canonicalPath(parent), path.basename(resolved));
  }
}

/** Temporary candidate boot selection; default profiles and implicit storage never opt into SQLite. */
export function configuredDatabaseFormat(userDataDir = process.env.APACK_USER_DATA_DIR): string {
  const format = process.env.APACK_STORAGE_FORMAT ?? ELMDB_FORMAT;
  databaseStorage(format);
  if (format === SQLITE_FORMAT) {
    if (!userDataDir || !path.isAbsolute(userDataDir)) {
      throw new Error('SQLite candidate selection requires an explicit absolute APACK_USER_DATA_DIR');
    }
    const selected = canonicalPath(userDataDir);
    if (APP_ENVS.some(env => {
      const relative = path.relative(canonicalPath(appDataDirFor(env)), selected);
      return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    })) {
      throw new Error('SQLite candidate selection requires an isolated profile outside the default app data directories');
    }
  }
  return format;
}

/** Managed app startup only; forensic readers and offline constructors do not start workers. */
export async function startDatabaseBackground(database: EarsDatabase): Promise<void> {
  if (!database.readOnly) await databaseStorage(database.format).startBackground?.(database);
}
