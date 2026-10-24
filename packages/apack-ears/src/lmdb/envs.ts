/// <reference types="node" />
import { open, type Database, type RootDatabase } from 'lmdb';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkStamp } from './stamp.ts';

/**
 * An entity as format 4 stores it: one record, so a row is one read and a write of the entity one put. Large values
 * (`isLarge`, `values.ts`) are held apart, in `values`, so loading the rows reads none of them.
 */
export interface EntityRecord {
  /** The entity's type, or null for attributes written to an id no entity was created with, which hydration skips */
  type: string | null;
  /** Its small fields as `[kind, value]` pairs, in the order each was first written; pairs keep `__proto__` a field */
  fields: Array<[string, unknown]>;
  /** Its large fields, each kept in `values`: `[kind, size, length]`, the length for a list and null otherwise */
  outOfLine: Array<[string, number, number | null]>;
}

/** A relation as format 4 stores it: the row a read gives back, and when it was first stored */
export interface RelationRecord {
  kind: string;
  source: string;
  target: string;
  /** What the relation carries, null when nothing */
  info: unknown;
  /** When it was first stored, in ms */
  createdAt: number;
}

/**
 * The databases of one LMDB environment: each entity's record, the large values held apart from them (keyed
 * `kind␟id`), and the relations. msgpack throughout, which keeps Dates, nested values and `undefined` as written.
 */
export type LmdbDbs = {
  rows: Database<EntityRecord, string>;
  values: Database<unknown, string>;
  relationRows: Database<RelationRecord, string>;
  root: RootDatabase;
};

/** The data databases, by name: what a reset empties and an import replaces; the environment's own `meta` stays */
export const DATA_DATABASES = ['rows', 'values', 'relationRows'] as const;

/**
 * How this version of `@apackdev/ears` encodes its data in LMDB. An environment records the format it was written in;
 * one in another format is refused rather than misread.
 *
 * Format 4 keeps an entity as one record of its small fields (`EntityRecord`), its large values in their own database
 * so that boot reads none of them, and its relations as records of their own; msgpack throughout. `entityType` is read
 * from the id and stored nowhere. There is no upgrade in the app: `scripts/ears-convert.ts` converts a copy of an older
 * data dir, once, explicitly (`convertToCurrentFormat`).
 */
export const LMDB_FORMAT_VERSION = 4;

/** Whether the databases format 1 wrote hold a row: files that record no format and do are format 1 */
function holdsData(root: RootDatabase): boolean {
  for (const name of ['entities', 'attrs', 'relations']) {
    const db = root.openDB({ name, encoding: 'json' }) as Database<unknown> | undefined;
    if (db) for (const _key of db.getKeys({ limit: 1 })) return true;
  }
  return false;
}

/**
 * Opens (creating it if needed) the LMDB environment at `basePath`; `readOnly` opens an existing one without writing.
 * Throws when the environment is in another storage format (`LMDB_FORMAT_VERSION`).
 */
export function openEnvAt(basePath: string, { readOnly = false }: { readOnly?: boolean } = {}): LmdbDbs {
  // LMDB would create the files before failing, so a directory with no database in it is refused here
  if (readOnly && !fs.existsSync(path.join(basePath, 'data.mdb'))) throw new Error(`No LMDB database at ${basePath}`);
  // Ensure parent directory exists
  const parentDir = path.dirname(basePath);
  if (!readOnly && !fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const root = open({
    path: basePath,
    maxDbs: 8,
    compression: true,
    readOnly,
    // A commit is synchronous and the store syncs in the background (`openLmdbStore`); overlapping syncs would make
    // even an unflushed commit wait for the disk. Every process opens the environment here, so all agree, as LMDB
    // requires of processes sharing one
    overlappingSync: false,
  });
  try {
    checkStamp(root, basePath, readOnly, {
      format: LMDB_FORMAT_VERSION,
      noun: 'database',
      // Data that records no format was written before formats were recorded, which is format 1
      unstamped: (env) => (holdsData(env) ? 1 : undefined),
      older: 'convert a copy of it with scripts/ears-convert.ts',
    });
  } catch (error) {
    root.close();
    throw error;
  }

  return {
    rows: root.openDB({ name: 'rows' }) as Database<EntityRecord, string>,
    values: root.openDB({ name: 'values' }) as Database<unknown, string>,
    relationRows: root.openDB({ name: 'relationRows' }) as Database<RelationRecord, string>,
    root,
  };
}

/** Whether `error` says only that a database was already closed, which closing it again is allowed to meet */
export const isAlreadyClosed = (error: unknown) =>
  error instanceof Error && (error.message.includes('Dbi is not open') || error.message.includes('already been closed'));

/**
 * Closes an environment's databases, then its root, so the root closes even when a child was closed already.
 * Throws anything else it meets: what to do with it is the caller's.
 */
export function closeEnv(dbs: LmdbDbs): void {
  try {
    dbs.rows?.close();
    dbs.values?.close();
    dbs.relationRows?.close();
    dbs.root?.close();
  } catch (error) {
    if (!isAlreadyClosed(error)) throw error;
  }
}
