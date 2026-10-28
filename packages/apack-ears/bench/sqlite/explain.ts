// Capture the actual generated SQL for a selective EARS query, not a hand-optimized substitute.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEarsEngine } from "../../src/index.ts";
import { toElmdbSchema } from "../../src/schema.ts";
import { SqliteDatabase } from "../../src/sqlite/database.ts";
const dir = mkdtempSync(join(tmpdir(), "ears-sqlite-explain-"));
const db = new SqliteDatabase({
  path: dir,
  schema: toElmdbSchema({
    types: { Note: { required: [], indexes: ["slug"] } },
    roles: [],
    relations: {},
  }),
  syncs: false,
});
try {
  const e = createEarsEngine({ database: db });
  e.create("Note", { slug: "key", title: "value" });
  let selected: { sql: string; parameters: any[] } | undefined;
  const all = db.all.bind(db);
  db.all = (sql, parameters = []) => {
    if (sql.includes("field_index x")) selected = { sql, parameters };
    return all(sql, parameters);
  };
  e.query("Note").where("slug", "key").pickOne();
  if (!selected) throw new Error("Did not observe an indexed query");
  const { sql, parameters } = selected;
  console.log(
    JSON.stringify(
      { sql, parameters, plan: all("EXPLAIN QUERY PLAN " + sql, parameters) },
      null,
      2
    )
  );
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
