// Evaluation alias only. Production imports and published entry points remain unchanged.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "./database.ts";
import { toElmdbSchema } from "../../src/schema.ts";
import type { DatabaseOptions } from "../../src/lmdb/database.ts";
export const DATABASE_FORMAT = "sqlite/evaluation-1";
export function openDatabase({ schema, ...options }: DatabaseOptions) {
  return new SqliteDatabase({
    ...options,
    ...(schema ? { schema: toElmdbSchema(schema) } : {}),
  });
}
export function createTemporaryDatabases() {
  const held = new Set<SqliteDatabase>();
  const disposeAll = () => {
    for (const db of held) {
      db.close();
      rmSync(db.path, { recursive: true, force: true });
    }
    held.clear();
  };
  process.once("exit", disposeAll);
  return {
    open(schema: NonNullable<DatabaseOptions["schema"]>) {
      const db = openDatabase({
        path: mkdtempSync(join(tmpdir(), "ears-sqlite-host-")),
        schema,
        syncs: false,
      });
      held.add(db);
      return {
        database: db,
        dispose() {
          db.close();
          rmSync(db.path, { recursive: true, force: true });
          held.delete(db);
        },
      };
    },
    disposeAll,
  };
}
