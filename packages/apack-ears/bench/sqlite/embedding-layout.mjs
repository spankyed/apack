// Paired exact-query layout diagnostic. This does not qualify whole-app vector latency or durability.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLoadablePath } from 'sqlite-vec';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { DIMENSIONS, corpusGenerator, exactTop, norm, checkCorpusMath } from './vector-corpus.mjs';
import { loadedNativeBindings } from './load-metrics.ts';
const output = process.argv[2];
assert(process.platform === 'linux' && output && !existsSync(output));
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { qualification: false, source: process.env.EARS_TEST_SOURCE, node: process.version, constraints,
  fixtureHash: hash(readFileSync(new URL('./embedding-layout.mjs', import.meta.url))),
  corpusHash: hash(readFileSync(new URL('./vector-corpus.mjs', import.meta.url))), dimensions: DIMENSIONS,
  distribution: 'clustered', durability: 'OFF disposable fixtures', sizes: [],
  entries: Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)])) };
assert(Object.values(report.entries).every(path => path.includes('/dist/')));
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
let db, root;
try {
  checkCorpusMath();
  for (const n of [1000, 10000]) {
    root = mkdtempSync(join(tmpdir(), 'ears-embedding-layout-'));
    const row = { n, samples: [], plans: [], truths: [] }; report.sizes.push(row); save();
    const generate = corpusGenerator('clustered'), vectors = new Float32Array(n * DIMENSIONS), norms = new Float64Array(n);
    for (let i = 0; i < n; i++) { const vector = generate(i); vectors.set(vector, i * DIMENSIONS); norms[i] = norm(vector); }
    row.vectorHash = hash(Buffer.from(vectors.buffer));
    db = openDatabase({ path: root, syncs: false, schema: { types: { Row: { required: [], embed: { from: ['text'], model: 'layout-fixture', dims: DIMENSIONS } } }, relations: {}, roles: [] } });
    const e = createEarsEngine({ database: db });
    for (let offset = 0; offset < n; offset += 128) e.transact(() => {
      for (let i = offset; i < Math.min(n, offset + 128); i++) e.create('Row', { id: `Row-${i}`, text: `document ${i}` });
    });
    await db.indexesReady();
    for (;;) {
      const pending = e.pendingEmbeddings('Row', { limit: 32 }); if (!pending.count) break;
      assert(pending.chunks.length > 0);
      assert.deepEqual(e.embed(pending.chunks.map(chunk => { const i = Number(chunk.id.slice(4));
        return { ...chunk, model: pending.model, vector: Array.from(vectors.subarray(i * DIMENSIONS, (i + 1) * DIMENSIONS)) };
      })), { stored: pending.chunks.length, stale: 0 });
    }
    for (let offset = 0; offset < n; offset += 256) e.transact(() => {
      for (let i = offset; i < Math.min(n, offset + 256); i++) if (i % 17 === 0) e.write(`Row-${i}`).trash();
    });
    const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
    row.primary = { files: files(), memory: process.memoryUsage(), vectorRows: db.get('SELECT count(*) n FROM embedding_values').n };
    assert.equal(row.primary.vectorRows, n);
    // Duplicate only inside this diagnostic. Match the old inline column order, payload and primary/index keys.
    db.sql.exec(`CREATE TABLE diagnostic_inline(entity_id TEXT NOT NULL,type TEXT NOT NULL,index_name TEXT NOT NULL,generation INTEGER NOT NULL,
      chunk INTEGER NOT NULL,model TEXT NOT NULL,dims INTEGER NOT NULL,hash TEXT NOT NULL,text TEXT NOT NULL,
      embedding BLOB,PRIMARY KEY(entity_id,index_name,generation,chunk));
      INSERT INTO diagnostic_inline SELECT c.entity_id,c.type,c.index_name,c.generation,c.chunk,c.model,c.dims,c.hash,c.text,v.embedding
      FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id;`);
    row.withDiagnosticCopy = { files: files(), memory: process.memoryUsage() };
    const job = db.get("SELECT * FROM index_builds WHERE kind='vector'");
    for (const path of ['all', 'tenPercent', 'onePercent']) {
      const selected = Array.from({ length: n }, (_, i) => i).filter(i => path === 'all' || (path === 'tenPercent' ? i % 100 < 10 : i % 100 === 0));
      const eligible = i => i % 17 !== 0 && (path === 'all' || (path === 'tenPercent' ? i % 100 < 10 : i % 100 === 0));
      const ids = selected.map(i => `Row-${i}`), condition = path === 'all' ? '' : 'AND c.entity_id IN (SELECT value FROM json_each(?))';
      const statements = new Map();
      for (const variant of ['inline', 'linked']) {
        const sql = `SELECT c.entity_id id,1-min(vec_distance_cosine(${variant === 'inline' ? 'c' : 'v'}.embedding,?)) score
          FROM ${variant === 'inline' ? 'diagnostic_inline' : 'chunks'} c
          ${variant === 'linked' ? 'JOIN embedding_values v ON v.id=c.embedding_id' : ''}
          JOIN entities e ON e.id=c.entity_id WHERE c.type=? AND c.index_name=? AND c.generation=?
          AND c.${variant === 'inline' ? 'embedding' : 'embedding_id'} IS NOT NULL AND e.trashed=0 ${condition}
          AND c.entity_id!=? GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`;
        statements.set(variant, db.sql.prepare(sql));
        const parameters = [Buffer.from(generate(0, true).buffer), 'Row', job.name, job.generation,
          ...(path === 'all' ? [] : [JSON.stringify(ids)]), '', 10];
        row.plans.push({ path, variant, sql, plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + sql).all(...parameters) });
      }
      for (let q = 0; q < 8; q++) {
        const vector = generate(q, true), wanted = exactTop(vectors, norms, vector, DIMENSIONS, eligible).map(hit => `Row-${hit.ordinal}`);
        row.truths.push({ path, query: q, wanted });
        const parameters = [Buffer.from(vector.buffer), 'Row', job.name, job.generation,
          ...(path === 'all' ? [] : [JSON.stringify(ids)]), '', 10];
        let previous;
        // Preregistered ABBA order, each query and filter, retaining first calls as well as warm calls.
        for (const variant of ['inline', 'linked', 'linked', 'inline']) {
          await new Promise(resolve => setImmediate(resolve));
          const start = performance.now(), answer = statements.get(variant).all(...parameters), ms = performance.now() - start;
          row.samples.push({ path, query: q, variant, ms, answer });
          assert.deepEqual(answer.map(hit => hit.id), wanted);
          if (previous) assert.deepEqual(answer, previous); previous = answer;
        }
        // Untimed facade control: the application's current path must answer the same query/filter.
        const query = path === 'all' ? e.query('Row') : e.query.ids(ids.filter(id => Number(id.slice(4)) % 17 !== 0));
        assert.deepEqual(query.near(Array.from(vector), { k: 10 }).ids(), wanted);
        save();
      }
    }
    row.final = { files: files(), memory: process.memoryUsage(), resources: process.resourceUsage() };
    report.sqlite = db.sql.prepare('SELECT sqlite_version() sqlite,vec_version() vec').get();
    db.close(); db = undefined; rmSync(root, { recursive: true, force: true }); root = undefined;
  }
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  report.bindings = loadedNativeBindings([getLoadablePath()]); save();
  db?.close(); if (root) rmSync(root, { recursive: true, force: true });
}
