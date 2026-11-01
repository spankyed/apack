// Diagnostic only: native SQLite primitives, deliberately excluding the EARS API/codec/graph contract.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { getLoadablePath } = require("sqlite-vec");
const db = new Database(":memory:");
db.loadExtension(getLoadablePath());
const results = [];
try {
  for (const n of [1_000, 10_000]) {
    db.exec(
      "DROP TABLE IF EXISTS plain;DROP TABLE IF EXISTS vectors;CREATE TABLE plain(id INTEGER PRIMARY KEY,embedding BLOB);CREATE VIRTUAL TABLE vectors USING vec0(embedding float[256] distance_metric=cosine);"
    );
    const make = (i: number) =>
      Buffer.from(
        Float32Array.from({ length: 256 }, (_, j) =>
          Math.sin(i * 0.17 + j * 0.13)
        ).buffer
      );
    const put = db.prepare("INSERT INTO plain VALUES(?,?)"),
      vec = db.prepare("INSERT INTO vectors(rowid,embedding) VALUES(?,?)");
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        const v = make(i);
        put.run(i, v);
        vec.run(BigInt(i), v);
      }
    })();
    const scalar = db.prepare(
      "SELECT id,vec_distance_cosine(embedding,?) distance FROM plain ORDER BY distance LIMIT 10"
    );
    const knn = db.prepare(
      "SELECT rowid id,distance FROM vectors WHERE embedding MATCH ? AND k=10 ORDER BY distance"
    );
    for (let i = 0; i < 10; i++)
      assert.deepEqual(
        knn.all(make(i)).map((r: any) => r.id),
        scalar.all(make(i)).map((r: any) => r.id)
      );
    const samples: Record<string, number[]> = { scalar: [], vec0: [] };
    for (let round = 0; round < 7; round++)
      for (const [name, stmt] of Object.entries(
        round % 2 ? { vec0: knn, scalar } : { scalar, vec0: knn }
      )) {
        const query = make(round);
        const start = performance.now();
        for (let i = 0; i < 100; i++) stmt.all(query);
        samples[name]!.push((performance.now() - start) * 10);
      }
    results.push({ n, dims: 256, k: 10, samples });
  }
  console.log(
    JSON.stringify({
      sqlite: db
        .prepare("SELECT sqlite_version() version,vec_version() vec")
        .get(),
      results,
    })
  );
} finally {
  db.close();
}
