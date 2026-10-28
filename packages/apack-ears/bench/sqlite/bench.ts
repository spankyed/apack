// Full EARS API comparison. Run each backend in fresh processes; fixture construction is outside timing.
import { mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createEarsEngine, type EARS } from "../../src/index.ts";
import { openDatabase } from "../../src/lmdb/index.ts";
import { toElmdbSchema } from "../../src/schema.ts";
import { SqliteDatabase } from "../../src/sqlite/database.ts";
const backend = process.argv[2],
  durable = process.argv.includes("--durable"),
  n = 10_000;
if (!["sqlite", "elmdb"].includes(backend))
  throw new Error("Expected sqlite or elmdb");
const dir = mkdtempSync(join(tmpdir(), "ears-backend-bench-"));
const schema = {
  types: {
    Message: {
      required: [],
      indexes: ["slug", "thread"],
      search: { fields: { text: 1 } },
    },
    Vector: {
      required: [],
      embed: { from: ["text"], model: "fixture", dims: 256 },
    },
  },
  relations: { in: {}, next: {} },
  roles: [],
};
const db =
  backend === "sqlite"
    ? new SqliteDatabase({
        path: dir,
        schema: toElmdbSchema(schema),
        syncs: durable,
      })
    : openDatabase({ path: dir, schema, syncs: durable });
const e = createEarsEngine({ database: db });
const id = (i: number) => `Message-${i}` as EARS.EntityId;
const vector = (i: number) =>
  Array.from({ length: 256 }, (_, j) => Math.sin(i * 0.17 + j * 0.13));
const setup = performance.now();
try {
  e.transact(
    () => {
      for (let i = 0; i < n; i++)
        e.create("Message", {
          id: id(i),
          slug: `slug-${i}`,
          thread: `thread-${i % 100}`,
          rank: i,
          text: `topic${i % 100} database ${"body ".repeat(100)}`,
        });
      for (let i = 1; i < 300; i++) e.write(id(i - 1)).link("next", id(i));
      for (let i = 1; i <= 50; i++) e.write(id(0)).link("in", id(i));
      for (let i = 0; i < 1_000; i++)
        e.create("Vector", { id: `Vector-${i}`, text: `vector fixture ${i}` });
    },
    { durable }
  );
  const p = e.pendingEmbeddings("Vector", { limit: 2_000 });
  e.embed(
    p.chunks.map((c, i) => ({ ...c, model: p.model, vector: vector(i) }))
  );
  await db.durable();
  const setupMs = performance.now() - setup;
  assert.equal(e.query("Message").count(), n);
  assert.equal(
    e.query("Message").where("thread", "thread-7").limit(50).pickAll().length,
    50
  );
  assert.equal(e.query.ids(id(0)).descendants("next", "Message").count(), 299);
  assert.equal(e.query("Vector").near(vector(0), { k: 10 }).count(), 10);
  const tasks: Record<
    string,
    { iterations: number; fn: (i: number) => unknown }
  > = {
    field: {
      iterations: 2000,
      fn: (i) => e.getAttr(id((i * 7919) % n), "text"),
    },
    row: { iterations: 1000, fn: (i) => e.getRow(id((i * 7919) % n)) },
    unique: {
      iterations: 600,
      fn: (i) =>
        e
          .query("Message")
          .where("slug", `slug-${(i * 7919) % n}`)
          .pickOne(),
    },
    page50: {
      iterations: 100,
      fn: (i) =>
        e
          .query("Message")
          .where("thread", `thread-${i % 100}`)
          .limit(50)
          .pickAll(),
    },
    all10k: { iterations: 3, fn: () => e.query("Message").pickAll() },
    sort10k: {
      iterations: 2,
      fn: () => e.query("Message").orderBy("rank").limit(50).ids(),
    },
    edges50: {
      iterations: 100,
      fn: () => e.query.ids(id(0)).out("in", "Message").pickAll(),
    },
    walk299: {
      iterations: 30,
      fn: () => e.query.ids(id(0)).descendants("next", "Message").ids(),
    },
    text: {
      iterations: 60,
      fn: (i) =>
        e
          .query("Message")
          .search(`topic${i % 100}`, { fuzzy: false })
          .limit(20)
          .ids(),
    },
    vector1k256: {
      iterations: 30,
      fn: (i) => e.query("Vector").near(vector(i), { k: 10 }).ids(),
    },
    write: {
      iterations: durable ? 40 : 200,
      fn: (i) =>
        e.transact(() => e.write(id(i % n)).set("counter", i), { durable }),
    },
    writeBatch100: {
      iterations: durable ? 5 : 10,
      fn: (i) =>
        e.transact(
          () => {
            for (let j = 0; j < 100; j++)
              e.write(id(j)).set("counter", i * 100 + j);
          },
          { durable }
        ),
    },
  };
  const samples: Record<string, number[]> = {};
  let sink: unknown;
  for (const [name, task] of Object.entries(tasks)) {
    for (let i = 0; i < Math.min(10, task.iterations); i++) sink = task.fn(i);
    samples[name] = [];
  }
  for (let round = 0; round < 5; round++) {
    const names = Object.keys(tasks);
    const rotated = [...names.slice(round), ...names.slice(0, round)];
    for (const name of rotated) {
      const task = tasks[name];
      globalThis.gc?.();
      const start = performance.now();
      for (let i = 0; i < task.iterations; i++)
        sink = task.fn(i + round * task.iterations);
      samples[name]!.push(
        ((performance.now() - start) * 1000) / task.iterations
      );
    }
  }
  let deliveries = 0;
  const watches = Array.from({ length: 20 }, (_, i) =>
    e.watch(() => e.getAttr(id(i), "counter"), {
      next: () => {
        deliveries++;
      },
    })
  );
  await e.admin.watchesSettled();
  const start = performance.now();
  for (let i = 0; i < 50; i++) {
    e.write(id(i % 20)).set("counter", i + 100_000);
    await e.admin.watchesSettled();
  }
  samples.watch20 = [((performance.now() - start) * 1000) / 50];
  assert.equal(deliveries, 70);
  for (const w of watches) w.stop();
  const fileBytes = readdirSync(dir).reduce(
    (sum, file) => sum + statSync(join(dir, file)).size,
    0
  );
  const versions =
    backend === "sqlite"
      ? (db as SqliteDatabase).get("SELECT sqlite_version() version")
      : undefined;
  console.log(
    JSON.stringify({
      backend,
      durable,
      n,
      node: process.version,
      versions,
      setupMs,
      fileBytes,
      memory: process.memoryUsage(),
      samples,
      consumed: sink !== undefined,
    })
  );
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
