// Compare deeper search semantics without treating a missing adapter feature as a SQLite impossibility.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEarsEngine } from "../../src/index.ts";
import { openDatabase } from "../../src/lmdb/index.ts";
import { toElmdbSchema } from "../../src/schema.ts";
import { SqliteDatabase } from "./database.ts";
const output: Record<string, unknown> = {};
const schema = {
  types: { Doc: { required: [], search: { fields: { title: 2, body: 1 } } } },
  relations: {},
  roles: [],
};
for (const backend of ["sqlite", "elmdb"]) {
  const dir = mkdtempSync(join(tmpdir(), "ears-sqlite-capabilities-"));
  const db =
    backend === "sqlite"
      ? new SqliteDatabase({
          path: dir,
          schema: toElmdbSchema(schema),
          syncs: false,
        })
      : openDatabase({ path: dir, schema, syncs: false });
  try {
    const e = createEarsEngine({ database: db });
    e.create("Doc", {
      id: "Doc-code",
      body: "openDatabaseStore fails on THR-12",
    });
    e.create("Doc", { id: "Doc-accent", body: "Café crème" });
    e.create("Doc", { id: "Doc-list", body: [7, "zebra", "database engine"] });
    e.create("Doc", { id: "Doc-title", title: "database engine" });
    e.create("Doc", { id: "Doc-cjk", body: "東京都の図書館" });
    e.create("Doc", { id: "Doc-cross", body: ["split", "phrase"] });
    const answers: Record<string, unknown> = {};
    for (const q of [
      "database",
      "openDatabaseStore",
      "thr-12",
      "cafe",
      "東京",
      "title:database",
      '"database engine"',
      "zebra OR cafe",
      "-zebra",
      '"split phrase"',
    ]) {
      try {
        answers[q] = e.query("Doc").search(q, { fuzzy: false }).ids();
      } catch (error) {
        answers[q] = { error: (error as Error).message };
      }
    }
    answers.listHighlights = e
      .query("Doc")
      .search("zebra", { fuzzy: false })
      .hits({ highlights: true })
      .map((h) => ({ id: h.id, highlights: h.highlights }));
    output[backend] = answers;
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(output, null, 2));
