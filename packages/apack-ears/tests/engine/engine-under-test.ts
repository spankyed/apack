// The engine the contract specs run against: an elmdb database in a temporary directory of its own, with no syncs
// (D10), closed and removed when the test file ends. The specs only reach it through this file.
import { afterAll } from 'vitest';
import { createEarsEngine, type EARSRuntimeDeps, type EarsDatabase, type EarsEngine, type RelationRules, type RowRules } from '../../src/index.ts';
import { createTemporaryDatabases } from '../../src/lmdb/index.ts';
import { SqliteDatabase } from '../../bench/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EngineUnderTestOptions {
  types: Iterable<string>;
  relationKinds: Iterable<string>;
  roles: Iterable<string>;
  /** What a type's rows are held to; nothing by default */
  rowRules?: Readonly<Record<string, RowRules>>;
  /** What a kind's edges are held to; nothing by default */
  relationRules?: Readonly<Record<string, RelationRules>>;
  warn?: EARSRuntimeDeps['warn'];
  /** Wraps the database the engine is handed, to watch what it is asked */
  wrap?: (database: EarsDatabase) => EarsDatabase;
  /** Freezes the values reads give back, as the SDK's test runtime does */
  freeze?: boolean;
}

const temporary: Array<{database: SqliteDatabase; path: string}> = [];
afterAll(() => { for (const held of temporary) { held.database.close(); rmSync(held.path,{recursive:true,force:true}); } });
const databases = createTemporaryDatabases();
afterAll(() => databases.disposeAll());

export function freshEngine({ types, relationKinds, roles, rowRules = {}, relationRules = {}, warn, wrap, freeze }: EngineUnderTestOptions): EarsEngine {
  const schema = {
    types: Object.fromEntries([...types].map((type) => [type, rowRules[type] ?? { required: [] }])),
    relations: Object.fromEntries([...relationKinds].map((kind) => [kind, relationRules[kind] ?? {}])),
    roles: [...roles],
  };
  let database: EarsDatabase;
  if (process.env.EARS_EVALUATION_BACKEND === 'sqlite') {
    const path = mkdtempSync(join(tmpdir(),'ears-sqlite-evaluation-'));
    const opened = new SqliteDatabase({path,schema:toElmdbSchema(schema),syncs:false});
    temporary.push({database:opened,path}); database=opened;
  } else database=databases.open(schema).database;
  return createEarsEngine({ database: wrap ? wrap(database) : database, warn, freeze });
}

export type EngineUnderTest = EarsEngine;
