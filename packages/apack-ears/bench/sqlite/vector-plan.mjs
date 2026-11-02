// Actual facade plans and matched exact-search primitives; this is a causal diagnostic, not qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { getLoadablePath } from 'sqlite-vec';
import { loadedNativeBindings } from './load-metrics.ts';
import { DIMENSIONS, corpusGenerator, exactTop, norm, checkCorpusMath } from './vector-corpus.mjs';
const output = process.argv[2], n = 10000, dimensions = DIMENSIONS;
assert(process.platform === 'linux' && output && !existsSync(output));
const root = mkdtempSync(join(tmpdir(), 'ears-vector-plan-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const report = { qualification: false, source: process.env.EARS_VECTOR_SOURCE, node: process.version, n, dimensions,
  distribution: 'clustered', syncs: false, constraints, samples: [], plans: [], facadeBindings: [], truth: [],
  fixtureHash: hash(readFileSync(new URL('./vector-corpus.mjs', import.meta.url))),
  entries: Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)])) };
assert(Object.values(report.entries).every(path => path.includes('/dist/')));
const save = () => writeFileSync(output, JSON.stringify(report));
const paths = ['all', 'tenPercent', 'onePercent'];
const eligible = (i, path) => i % 17 !== 0 && (path === 'all' || (path === 'tenPercent' ? i % 100 < 10 : i % 100 === 0));
const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
const parameter = value => Buffer.isBuffer(value) ? { blobBytes: value.length, sha256: hash(value) } : value;
let db;
try {
  checkCorpusMath(); const generate = corpusGenerator('clustered'), vectors = new Float32Array(n * dimensions), norms = new Float64Array(n);
  for (let i = 0; i < n; i++) { const vector = generate(i); vectors.set(vector, i * dimensions); norms[i] = norm(vector); }
  report.vectorHash = hash(Buffer.from(vectors.buffer));
  const schema = { types: { Row: { required: [], indexes: ['bucket', 'inTen'], embed: { from: ['text'], model: 'fixture:high-dimensional', dims: dimensions } } }, relations: {}, roles: [] };
  db = openDatabase({ path: root, schema, syncs: false }); const e = createEarsEngine({ database: db });
  for (let offset = 0; offset < n; offset += 128) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 128); i++) e.create('Row', { id: `Row-${i}`, text: `document ${i}`, bucket: i % 100, inTen: i % 100 < 10 });
  });
  await db.indexesReady();
  for (;;) {
    const pending = e.pendingEmbeddings('Row', { limit: 32 }); if (!pending.count) break;
    assert(pending.chunks.length > 0);
    assert.deepEqual(e.embed(pending.chunks.map(chunk => {
      const i = Number(chunk.id.slice(4)); return { ...chunk, model: pending.model, vector: Array.from(vectors.subarray(i * dimensions, (i + 1) * dimensions)) };
    })), { stored: pending.chunks.length, stale: 0 });
  }
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) if (i % 17 === 0) e.write(`Row-${i}`).trash();
  });
  const facade = (path, vector) => {
    let query = e.query('Row'); if (path === 'tenPercent') query = query.where('inTen', true); if (path === 'onePercent') query = query.where('bucket', 0);
    return query.near(Array.from(vector), { k: 10 }).hits();
  };
  // Observe original SQL before constructing the duplicate packed index. Timed calls below have no wrappers.
  for (const path of paths) {
    const originals = new Map();
    try {
      for (const method of ['all', 'get']) {
        const original = db[method]; originals.set(method, original);
        db[method] = function(sql, parameters = []) {
          const started = performance.now(), answer = original.call(this, sql, parameters), ms = performance.now() - started;
          report.facadeBindings.push({ path, method, sql, parameters: parameters.map(parameter), ms,
            returnedRows: method === 'all' ? answer.length : Number(answer !== undefined),
            plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + sql).all(...parameters) }); return answer;
        };
      }
      const started = performance.now(), answer = facade(path, generate(0, true));
      report.samples.push({ variant: 'facade-before-packed-build', path, query: 0, repeat: 0, ms: performance.now() - started, answer });
    } finally { for (const [method, original] of originals) db[method] = original; }
  }
  report.beforePacked = { files: files(), pages: db.sql.pragma('page_count', { simple: true }), memory: process.memoryUsage() };
  const buildStart = performance.now();
  db.sql.exec(`CREATE VIRTUAL TABLE diagnostic_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine, live boolean, bucket integer, in_ten boolean)`);
  db.sql.prepare(`INSERT INTO diagnostic_vectors(rowid,embedding,live,bucket,in_ten)
    SELECT CAST(substr(c.entity_id,5) AS INTEGER)+1,v.embedding,e.trashed=0,
      CAST(substr(c.entity_id,5) AS INTEGER)%100,CAST(substr(c.entity_id,5) AS INTEGER)%100<10
    FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id WHERE c.type='Row' AND v.embedding IS NOT NULL`).run();
  report.packedBuildMs = performance.now() - buildStart;
  assert.equal(db.sql.prepare('SELECT count(*) n FROM diagnostic_vectors').get().n, n);
  report.afterPacked = { files: files(), pages: db.sql.pragma('page_count', { simple: true }), memory: process.memoryUsage() };
  const candidates = Object.fromEntries(paths.map(path => [path, Array.from({ length: n }, (_, i) => i).filter(i => eligible(i, path)).map(i => i + 1)]));
  const prepared = new Map();
  for (const path of paths) {
    const condition = path === 'all' ? '' : path === 'tenPercent' ? ' AND in_ten=1' : ' AND bucket=0';
    const scalarCondition = path === 'all' ? '' : ` AND CAST(substr(c.entity_id,5) AS INTEGER)%100${path === 'tenPercent' ? '<10' : '=0'}`;
    const variants = {
      scalarNoGrouping: `SELECT c.entity_id id,1-vec_distance_cosine(v.embedding,?) score FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
        WHERE c.type='Row' AND v.embedding IS NOT NULL AND e.trashed=0${scalarCondition} ORDER BY score DESC,e.seq LIMIT 10`,
      vec0Metadata: `SELECT 'Row-'||(rowid-1) id,1-distance score FROM diagnostic_vectors WHERE embedding MATCH ? AND k=10 AND live=1${condition} ORDER BY distance`,
      vec0CandidateIds: `SELECT 'Row-'||(rowid-1) id,1-distance score FROM diagnostic_vectors WHERE embedding MATCH ? AND k=10
        AND rowid IN (SELECT value FROM json_each(?)) ORDER BY distance`,
    };
    for (const [variant, sql] of Object.entries(variants)) {
      const parameters = [Buffer.from(generate(0, true).buffer), ...(variant === 'vec0CandidateIds' ? [JSON.stringify(candidates[path])] : [])];
      report.plans.push({ path, variant, sql, parameters: parameters.map(parameter), plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + sql).all(...parameters) });
      prepared.set(`${path}/${variant}`, db.sql.prepare(sql));
    }
  }
  for (let q = 0; q < 16; q++) {
    const vector = generate(q, true), buffer = Buffer.from(vector.buffer);
    for (const path of paths) {
      const truth = exactTop(vectors, norms, vector, dimensions, i => eligible(i, path));
      const wanted = truth.map(row => `Row-${row.ordinal}`); report.truth.push({ path, query: q, answer: truth });
      const variants = ['facade', 'scalarNoGrouping', 'vec0Metadata', 'vec0CandidateIds'];
      for (let repeat = 0; repeat < 3; repeat++) {
        const offset = (q + repeat) % variants.length;
        for (let v = 0; v < variants.length; v++) {
          await new Promise(resolve => setImmediate(resolve)); const variant = variants[(offset + v) % variants.length], started = performance.now();
          const answer = variant === 'facade' ? facade(path, vector) : prepared.get(`${path}/${variant}`).all(buffer,
            ...(variant === 'vec0CandidateIds' ? [JSON.stringify(candidates[path])] : []));
          const sample = { path, query: q, repeat, variant, ms: performance.now() - started, answer }; report.samples.push(sample);
          assert.deepEqual(answer.map(row => row.id), wanted, `${path}/${q}/${repeat}/${variant}`);
        }
      }
      save();
    }
  }
  report.sqlite = db.sql.prepare('SELECT sqlite_version() sqlite, vec_version() vec').get();
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { report.nativeBindings = loadedNativeBindings([getLoadablePath()]); report.memory = process.memoryUsage(); report.resources = process.resourceUsage(); save(); db?.close(); rmSync(root, { recursive: true, force: true }); }
