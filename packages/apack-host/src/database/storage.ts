// File and opening policy belongs to the host; packs and the EARS query engine do not select storage.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DATABASE_FORMAT as ELMDB_FORMAT, openDatabase as openElmdb, type DatabaseOptions } from '@apackdev/ears/lmdb';
import { DATABASE_FORMAT as SQLITE_FORMAT, openDatabase as openSqlite } from '@apackdev/ears/sqlite';
import type { EarsDatabase } from '@apackdev/ears';

export interface DatabaseStorage {
  readonly format: string;
  readonly dataFile: string;
  open(options: DatabaseOptions): EarsDatabase;
}

function refuseForeignFile(dir: string, name: string): void {
  try { fs.lstatSync(path.join(dir, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  // A selected backend mismatch is not corruption. In particular run-history boot must not move it aside.
  throw Object.assign(new Error(`${dir} holds ${name}; select its storage format explicitly`), { code: 'STORAGE_MISMATCH' });
}
const elmdb: DatabaseStorage = { format: ELMDB_FORMAT, dataFile: 'data.mdb', open(options) {
  refuseForeignFile(options.path, 'data.sqlite3');
  return openElmdb(options);
} };
const sqlite: DatabaseStorage = { format: SQLITE_FORMAT, dataFile: 'data.sqlite3', open(options) {
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
