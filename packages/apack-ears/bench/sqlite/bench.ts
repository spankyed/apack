// Full EARS API comparison. Run each backend in fresh processes; fixture construction is outside timing.
import { mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import type { EARS, EngineSchema } from "../../src/index.ts";
import type { SqliteDatabase } from "../../src/sqlite/database.ts";
import { loadedNativeBindings } from "./load-metrics.ts";
const backend = process.argv[2],
  durable = process.argv.includes("--durable"),
  n = 10_000;
if (!["sqlite", "elmdb"].includes(backend))
  throw new Error("Expected sqlite or elmdb");
// Like the ordinary EARS benchmarks, read source types before build but execute the shipped package.
const DIST = '../../dist/index.js';
const DIST_BACKEND = backend === 'sqlite' ? '../../dist/sqlite/index.js' : '../../dist/lmdb/index.js';
const { createEarsEngine } = await import(DIST) as typeof import('../../src/index.ts');
const { openDatabase: openBackend } = await import(DIST_BACKEND) as
  typeof import('../../src/sqlite/index.ts') | typeof import('../../src/lmdb/index.ts');
const dir = mkdtempSync(join(tmpdir(), "ears-backend-bench-"));
const schema = {
  types: {
    Message: {
      required: [],
      indexes: ["slug", "thread"],
      search: { fields: { text: 1 } },
    },
    Large: {
      required: [],
      fields: { title: { type: 'string' }, counter: { type: 'number' }, body: { type: 'string' } },
    },
    Vector: {
      required: [],
      embed: { from: ["text"], model: "fixture", dims: 256 },
    },
  },
  relations: { in: {}, next: {} },
  roles: [],
} satisfies EngineSchema;
const db = openBackend({ path: dir, schema, syncs: durable });
const e = createEarsEngine({ database: db });
const id = (i: number) => `Message-${i}` as EARS.EntityId;
const vector = (i: number) =>
  Array.from({ length: 256 }, (_, j) => Math.sin(i * 0.17 + j * 0.13));
// Both repeated and deterministic high-entropy ASCII bodies: compression is part of the native baseline.
let random = 0x71829;
const variedBody = Array.from({ length: 256 * 1024 }, () => {
  random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
  return String.fromCharCode(32 + (random >>> 0) % 95);
}).join('');
const repeatedBody = 'sample body '.repeat(Math.ceil(256 * 1024 / 12)).slice(0, 256 * 1024);
const largeId = (i: number) => `Large-${i}` as EARS.EntityId;
const bodies = [repeatedBody, variedBody];
const streamBodies = Array.from({ length: 16 }, (_, i) => variedBody.slice(0, (i + 1) * 16 * 1024));
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
      for (let i = 0; i < 64; i++) e.create('Large', { id: largeId(i), title: `large-${i}`, counter: 0, body: bodies[i % 2] });
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
    smallFieldLargeRow: { iterations: 1000, fn: i => e.getAttr(largeId(i % 64), 'counter') },
    projectedLargePage: { iterations: 100, fn: () => e.query('Large').limit(50).pick(['title', 'counter']) },
    updateSmallRepeatedBody: { iterations: durable ? 40 : 200, fn: i => e.transact(() => e.write(largeId(0)).set('counter', i), { durable }) },
    updateSmallVariedBody: { iterations: durable ? 40 : 200, fn: i => e.transact(() => e.write(largeId(1)).set('counter', i), { durable }) },
    streamBody16Chunks: { iterations: durable ? 2 : 4, fn: () => {
      for (const body of streamBodies) e.transact(() => e.write(largeId(3)).set('body', body), { durable });
    } },
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
    e.transact(() => e.write(id(i % 20)).set("counter", i + 100_000), { durable });
    await e.admin.watchesSettled();
  }
  samples.watch20 = [((performance.now() - start) * 1000) / 50];
  assert.equal(deliveries, 70);
  for (const w of watches) w.stop();
  const fileBytes = readdirSync(dir).reduce(
    (sum, file) => sum + statSync(join(dir, file)).size,
    0
  );
  // A separate instrumented diagnostic pass, excluded from the uninstrumented timing samples above.
  // Driver spans include preparation/binding/native execution/result marshalling; the binding does not expose
  // these individually. Remaining facade time includes JS plan construction, mapping, checks and instrumentation.
  const diagnostics: Record<string, unknown> = {};
  if (backend === 'sqlite') {
    const sqlite = db as SqliteDatabase;
    let driverMs = 0, codecMs = 0, driverCalls = 0, codecCalls = 0;
    const all = sqlite.all.bind(sqlite), get = sqlite.get.bind(sqlite), run = sqlite.run.bind(sqlite);
    const pack = sqlite.pack.bind(sqlite), unpack = sqlite.unpack.bind(sqlite);
    const driver = <T>(call: () => T): T => { const start = performance.now(); try { return call(); } finally { driverCalls++; driverMs += performance.now() - start; } };
    const codec = <T>(call: () => T): T => { const start = performance.now(); try { return call(); } finally { codecCalls++; codecMs += performance.now() - start; } };
    sqlite.all = (sql, args) => driver(() => all(sql, args));
    sqlite.get = (sql, args) => driver(() => get(sql, args));
    sqlite.run = (sql, args) => driver(() => run(sql, args));
    sqlite.pack = value => codec(() => pack(value));
    sqlite.unpack = bytes => codec(() => unpack(bytes));
    try {
      for (const name of ['field', 'unique', 'page50', 'edges50', 'smallFieldLargeRow', 'projectedLargePage', 'updateSmallVariedBody']) {
        driverMs = codecMs = driverCalls = codecCalls = 0;
        const started = performance.now();
        for (let i = 0; i < 10; i++) sink = tasks[name]!.fn(i);
        const totalMs = performance.now() - started;
        diagnostics[name] = { iterations: 10, totalMs, driverMs, codecMs, driverCalls, codecCalls,
          remainingMs: totalMs - driverMs - codecMs };
      }
    } finally { sqlite.all = all; sqlite.get = get; sqlite.run = run; sqlite.pack = pack; sqlite.unpack = unpack; }
    diagnostics.uniquePlan = e.query('Message').where('slug', 'slug-7').explain();
    diagnostics.pagePlan = e.query('Message').where('thread', 'thread-7').limit(50).explain();
    diagnostics.graphPlan = e.query.ids(id(0)).out('in', 'Message').explain();
  }
  const versions =
    backend === "sqlite"
      ? (db as SqliteDatabase).get("SELECT sqlite_version() version")
      : undefined;
  const memory = process.memoryUsage(), resourceUsage = process.resourceUsage();
  const extension = backend === 'sqlite' ? (db as SqliteDatabase).nativeVectorExtension : undefined;
  const nativeBindings = loadedNativeBindings(backend === 'sqlite' ? [(await import('sqlite-vec')).getLoadablePath(), ...(extension ? [extension] : [])] : []);
  console.log(
    JSON.stringify({
      backend,
      execution: 'built-package',
      durable,
      n,
      node: process.version,
      versions,
      nativeBindings,
      setupMs,
      fileBytes,
      memory,
      resourceUsage,
      files: Object.fromEntries(readdirSync(dir).map(file => [file, statSync(join(dir, file)).size])),
      samples,
      diagnostics,
      largeFixture: { rows: 64, bodyBytes: 256 * 1024, streamChunks: 16, streamChunkBytes: 16 * 1024 },
      timingUnit: "microseconds per task (stream task includes 16 commits)",
      durabilityPolicy: durable ? "durable transaction acknowledgments; backend policies differ and need operational qualification" : "syncs disabled fixture; not a production durability comparison",
      consumed: sink !== undefined,
    })
  );
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
