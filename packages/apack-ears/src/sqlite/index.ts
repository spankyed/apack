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

/** Format provenance; opening the files performs validation. Format 1 changes in place before release. */
export const DATABASE_FORMAT = 'sqlite/1';

export interface DatabaseOptions {
  path: string;
  schema?: EngineSchema;
  readOnly?: boolean;
  /** The candidate currently synchronizes each commit when enabled. False is for disposable fixtures only. */
  syncs?: boolean;
}

export function openDatabase({ schema, ...options }: DatabaseOptions): EarsDatabase {
  return new SqliteDatabase({ ...options, ...(schema ? { schema: toElmdbSchema(schema) } : {}) });
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
