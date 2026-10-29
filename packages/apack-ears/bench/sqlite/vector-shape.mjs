// Run in disposable Linux only, one fresh process/backend/size. Synthetic qualification is not real-model relevance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '@apackdev/ears';
import { getLoadablePath } from 'sqlite-vec';
import { DIMENSIONS, corpusGenerator, exactTop, norm, checkCorpusMath } from './vector-corpus.mjs';
import { startHeartbeat, loadedNativeBindings } from './load-metrics.ts';
const [backend, size, output] = process.argv.slice(2), n = Number(size), dimensions = DIMENSIONS;
assert(process.platform === 'linux' && ['sqlite', 'elmdb'].includes(backend) && [1000, 10000, 100000].includes(n) && output && !existsSync(output));
const entry = backend === 'sqlite' ? '@apackdev/ears/sqlite' : '@apackdev/ears/lmdb';
const { openDatabase } = await import(entry);
const entries = Object.fromEntries(['@apackdev/ears', entry].map(name => [name, import.meta.resolve(name)]));
assert(Object.values(entries).every(path => path.includes('/dist/')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const report = { source: process.env.EARS_VECTOR_SOURCE, backend, n, dimensions, node: process.version, constraints, entries,
  nativeRevision: readFileSync(new URL('../../../../vendor/elmdb.rev', import.meta.url), 'utf8').trim(),
  entryHashes: Object.fromEntries(Object.values(entries).map(path => [path, hash(readFileSync(new URL(path)))])),
  fixtureHash: hash(readFileSync(new URL('./vector-corpus.mjs', import.meta.url))), syncs: false,
  scope: 'synthetic held-out high-dimensional engine diagnostic; not physical cold storage, matched durable writes, real embeddings or app acceptance', profiles: [] };
const save = () => writeFileSync(output, JSON.stringify(report));
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
};
const paths = ['all', 'tenPercent', 'onePercent'];
const eligible = (i, path) => i % 17 !== 0 && (path === 'all' || (path === 'tenPercent' ? i % 100 < 10 : i % 100 === 0));
try {
  checkCorpusMath(); report.fixtureChecks = 'passed';
  for (const distribution of ['clustered', 'mixed']) {
    const root = mkdtempSync(join(tmpdir(), 'ears-vector-shape-')), profile = { distribution, samples: [], truth: [], heartbeat: [] };
    report.profiles.push(profile); let db, pulse;
    const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
    try {
      const generationStart = performance.now(), generate = corpusGenerator(distribution);
      const vectors = new Float32Array(n * dimensions), norms = new Float64Array(n);
      for (let i = 0; i < n; i++) { const vector = generate(i); vectors.set(vector, i * dimensions); norms[i] = norm(vector); }
      const queries = Array.from({ length: 16 }, (_, i) => generate(i, true));
      profile.generationMs = performance.now() - generationStart;
      profile.vectorHash = hash(Buffer.from(vectors.buffer)); profile.queryHashes = queries.map(vector => hash(Buffer.from(vector.buffer)));
      const schema = { types: { Row: { required: [], indexes: ['bucket', 'inTen'], embed: { from: ['text'], model: 'fixture:high-dimensional', dims: dimensions } } }, relations: {}, roles: [] };
      const setupStart = performance.now(); db = openDatabase({ path: root, schema, syncs: false });
      const e = createEarsEngine({ database: db });
      for (let offset = 0; offset < n; offset += 128) e.transact(() => {
        for (let i = offset; i < Math.min(n, offset + 128); i++) e.create('Row', { id: `Row-${i}`, text: `document ${i}`, bucket: i % 100, inTen: i % 100 < 10 });
      });
      if (db.indexesReady) await db.indexesReady();
      for (;;) {
        const pending = e.pendingEmbeddings('Row', { limit: 32 }); if (!pending.count) break;
        assert(pending.chunks.length > 0);
        const answer = e.embed(pending.chunks.map(chunk => {
          const i = Number(chunk.id.slice(4)); return { ...chunk, model: pending.model, vector: Array.from(vectors.subarray(i * dimensions, (i + 1) * dimensions)) };
        }));
        assert.equal(answer.stored, pending.chunks.length); assert.equal(answer.stale, 0);
      }
      for (let offset = 0; offset < n; offset += 256) e.transact(() => {
        for (let i = offset; i < Math.min(n, offset + 256); i++) if (i % 17 === 0) e.write(`Row-${i}`).trash();
      });
      assert.equal(e.pendingEmbeddings('Row').count, 0); profile.setupMs = performance.now() - setupStart;
      profile.filesAfterBuild = files(); profile.memoryAfterBuild = process.memoryUsage(); save();
      async function sample(phase, repetitions) {
        const truthStart = performance.now(), truth = new Map();
        for (let q = 0; q < queries.length; q++) for (const path of paths) {
          const answer = exactTop(vectors, norms, queries[q], dimensions, i => eligible(i, path));
          truth.set(`${q}/${path}`, answer); profile.truth.push({ phase, query: q, path, answer });
        }
        profile[phase + 'TruthMs'] = performance.now() - truthStart;
        pulse = startHeartbeat(8, (at, delayMs) => profile.heartbeat.push({ phase, at, delayMs }));
        try {
          for (let q = 0; q < queries.length; q++) for (const path of paths) {
            const wanted = truth.get(`${q}/${path}`), wantedIds = new Set(wanted.map(row => `Row-${row.ordinal}`));
            for (let repeat = 0; repeat < repetitions; repeat++) {
              await new Promise(resolve => setImmediate(resolve));
              let query = e.query('Row');
              if (path === 'tenPercent') query = query.where('inTen', true);
              if (path === 'onePercent') query = query.where('bucket', 0);
              const input = Array.from(queries[q]), before = hash(Buffer.from(queries[q].buffer)), started = performance.now();
              const answer = query.near(input, { k: 10 }).hits(), ms = performance.now() - started;
              const ids = answer.map(row => row.id), recall = ids.filter(id => wantedIds.has(id)).length / wanted.length;
              const observation = { phase, query: q, path, repeat, ms, recall, answer }; profile.samples.push(observation);
              assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, wanted.length);
              assert(ids.every(id => eligible(Number(id.slice(4)), path)), 'invalid candidate/trash result');
              assert.equal(hash(Buffer.from(queries[q].buffer)), before); assert.deepEqual(input, Array.from(queries[q]));
              if (backend === 'sqlite') assert.equal(recall, 1, 'exact SQLite search differs from independent Float32 cosine truth');
            }
          }
          await new Promise(resolve => setTimeout(resolve, 16));
        } finally { pulse.stop(); pulse = undefined; }
        save();
      }
      await sample('initial', 3);
      // Content invalidation and embedding publication intentionally remain two separate operations.
      const changed = Array.from({ length: 32 }, (_, i) => i + 1).filter(i => i % 17 !== 0);
      profile.updatedOrdinals = changed;
      const stale = e.pendingEmbeddings('Row').chunks; assert.equal(stale.length, 0);
      const oldChunks = [];
      for (const i of changed) {
        e.write(`Row-${i}`).set('text', `intermediate ${i}`);
        const chunk = e.pendingEmbeddings('Row', { limit: 32 }).chunks.find(chunk => chunk.id === `Row-${i}`); assert(chunk); oldChunks.push(chunk);
      }
      const contentStart = performance.now();
      e.transact(() => { for (const i of changed) e.write(`Row-${i}`).set('text', `revised ${i}`); });
      profile.contentBatchMs = performance.now() - contentStart;
      assert.equal(e.pendingEmbeddings('Row').count, changed.length);
      const refused = e.embed(oldChunks.map(chunk => ({ ...chunk, model: 'fixture:high-dimensional', vector: Array.from(generate(Number(chunk.id.slice(4)), false, 1)) })));
      assert.deepEqual(refused, { stored: 0, stale: changed.length });
      const pending = e.pendingEmbeddings('Row', { limit: 64 });
      const replacement = pending.chunks.map(chunk => {
        const i = Number(chunk.id.slice(4)), vector = generate(i, false, 1); vectors.set(vector, i * dimensions); norms[i] = norm(vector);
        return { ...chunk, model: pending.model, vector: Array.from(vector) };
      });
      const embedStart = performance.now(); assert.deepEqual(e.embed(replacement), { stored: changed.length, stale: 0 });
      profile.embeddingBatchMs = performance.now() - embedStart; assert.equal(e.pendingEmbeddings('Row').count, 0);
      profile.vectorHashAfterUpdates = hash(Buffer.from(vectors.buffer));
      await sample('updated', 1);
      profile.filesAfterQueries = files(); profile.memoryAfterQueries = process.memoryUsage(); profile.resourceUsage = process.resourceUsage();
      profile.summary = Object.fromEntries(paths.map(path => {
        const samples = profile.samples.filter(row => row.path === path), warm = samples.filter(row => row.phase === 'initial' && row.repeat > 0);
        return [path, { meanRecall: samples.reduce((sum, row) => sum + row.recall, 0) / samples.length,
          meanRecallByPhase: Object.fromEntries(['initial', 'updated'].map(phase => {
            const rows = samples.filter(row => row.phase === phase); return [phase, rows.reduce((sum, row) => sum + row.recall, 0) / rows.length];
          })), warmMs: summary(warm.map(row => row.ms)) }];
      }));
      profile.heartbeatSummary = summary(profile.heartbeat.map(row => row.delayMs));
      profile.budgets = { recall: Object.values(profile.summary).every(row => row.meanRecall >= .95),
        latency: n === 1000 ? null : Object.values(profile.summary).every(row => row.warmMs.p95 <= (n === 10000 ? 100 : 200)),
        heartbeat: n === 1000 ? null : profile.heartbeatSummary.p99 <= 16 };
      save(); assert(profile.budgets.recall, 'native recall target missed');
      if (n !== 1000) assert(profile.budgets.latency && profile.budgets.heartbeat, 'provisional execution strategy ceiling missed');
    } finally { pulse?.stop(); db?.close(); rmSync(root, { recursive: true, force: true }); }
  }
  report.nativeBindings = loadedNativeBindings(); report.resourceUsage = process.resourceUsage();
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { report.nativeBindings = loadedNativeBindings([getLoadablePath()]); report.resourceUsage = process.resourceUsage(); report.memoryAtEnd = process.memoryUsage(); save(); }
