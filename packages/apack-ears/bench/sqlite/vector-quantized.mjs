// Native candidate/rerank counterfactual, not an integrated EARS layout or application qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLoadablePath } from 'sqlite-vec';
import { startHeartbeat, loadedNativeBindings } from './load-metrics.ts';
import { DIMENSIONS, corpusGenerator, exactTop, norm, checkCorpusMath } from './vector-corpus.mjs';
const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const [size, output] = process.argv.slice(2), n = Number(size), dimensions = DIMENSIONS, candidates = 64;
assert(process.platform === 'linux' && [1000, 10000, 100000].includes(n) && output && !existsSync(output));
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = vector => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
function quantize(vector) {
  let maximum = 0;
  for (const value of vector) { assert(Number.isFinite(value)); maximum = Math.max(maximum, Math.abs(value)); }
  assert(maximum > 0);
  return Buffer.from(Int8Array.from(vector, value => Math.max(-127, Math.min(127, Math.round(value * (127 / maximum))))).buffer);
}
const constraints = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name => [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.equal(constraints['cpu.max'], '200000 100000'); assert.equal(constraints['memory.max'], String(6 * 1024 ** 3)); assert.equal(constraints['memory.swap.max'], '0');
const report = { source: process.env.EARS_VECTOR_SOURCE, qualification: false, scope: 'native primitive counterfactual; one vector per owner; no EARS integration',
  n, dimensions, candidates, node: process.version, constraints, profiles: [], fixtureHash: hash(readFileSync(new URL('./vector-corpus.mjs', import.meta.url))),
  driverHash: hash(readFileSync(new URL(import.meta.url))) };
const save = () => writeFileSync(output, JSON.stringify(report));
const summary = values => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length,
  p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) }; };
const paths = ['all', 'tenPercent', 'onePercent'];
const eligible = (i, path) => i % 17 !== 0 && (path === 'all' || (path === 'tenPercent' ? i % 100 < 10 : i % 100 === 0));
function open(file, d) {
  const db = new Database(file), extension = getLoadablePath(); db.loadExtension(extension);
  report.vectorExtension = { path: extension, sha256: hash(readFileSync(extension)), version: db.prepare('SELECT vec_version() v').get().v };
  report.nativeBindingsWhileOpen = loadedNativeBindings([extension]);
  db.pragma('journal_mode=WAL'); db.pragma('synchronous=OFF');
  if (d) db.exec(`CREATE TABLE raw(id INTEGER PRIMARY KEY,embedding BLOB NOT NULL,live INTEGER NOT NULL,bucket INTEGER NOT NULL,in_ten INTEGER NOT NULL);
    CREATE INDEX raw_ten ON raw(live,in_ten); CREATE INDEX raw_one ON raw(live,bucket);
    CREATE VIRTUAL TABLE quantized USING vec0(embedding int8[${d}] distance_metric=cosine,live boolean);`);
  return db;
}
function operations(db) {
  const writeCosts = { rawMs: 0, quantizeMs: 0, derivedMs: 0, rows: 0 };
  const rawPut = db.prepare('INSERT INTO raw VALUES(?,?,?,?,?)'), quantPut = db.prepare('INSERT INTO quantized(rowid,embedding,live) VALUES(?,vec_int8(?),?)');
  const rawUpdate = db.prepare('UPDATE raw SET embedding=? WHERE id=?'), quantUpdate = db.prepare('UPDATE quantized SET embedding=vec_int8(?) WHERE rowid=?');
  const scope = path => path === 'all' ? '' : path === 'tenPercent' ? ' AND in_ten=1' : ' AND bucket=0';
  const lookup = Object.fromEntries(paths.slice(1).map(path => [path, db.prepare('SELECT id FROM raw WHERE live=1' + scope(path))]));
  const knn = db.prepare('SELECT rowid,distance FROM quantized WHERE embedding MATCH vec_int8(?) AND k=? AND live=1 ORDER BY distance');
  const scopedKnn = db.prepare('SELECT rowid,distance FROM quantized WHERE embedding MATCH vec_int8(?) AND k=? AND live=1 AND rowid IN (SELECT value FROM json_each(?)) ORDER BY distance');
  const rerank = Object.fromEntries(paths.map(path => [path, db.prepare(`SELECT id,1-vec_distance_cosine(embedding,?) score FROM raw
    WHERE id IN (SELECT value FROM json_each(?)) AND live=1${scope(path)} ORDER BY score DESC,id LIMIT ?`)]));
  return {
    writeCosts,
    put(i, vector, live = i % 17 !== 0) {
      const id = i + 1, a = performance.now(); rawPut.run(id, bytes(vector), Number(live), i % 100, Number(i % 100 < 10));
      const b = performance.now(), encoded = quantize(vector), c = performance.now(); quantPut.run(BigInt(id), encoded, BigInt(Number(live)));
      writeCosts.rawMs += b - a; writeCosts.quantizeMs += c - b; writeCosts.derivedMs += performance.now() - c; writeCosts.rows++;
    },
    update(id, vector) {
      const a = performance.now(); rawUpdate.run(bytes(vector), id); const b = performance.now(), encoded = quantize(vector), c = performance.now();
      quantUpdate.run(encoded, BigInt(id)); writeCosts.rawMs += b - a; writeCosts.quantizeMs += c - b; writeCosts.derivedMs += performance.now() - c; writeCosts.rows++;
    },
    native(vector, k = 1) { return knn.all(quantize(vector), BigInt(k)); },
    search(path, vector, k = 10) {
      const begin = performance.now(), encoded = quantize(vector);
      const selected = path === 'all' ? undefined : lookup[path].all().map(row => row.id);
      const preparedAt = performance.now();
      const approximate = selected === undefined ? knn.all(encoded, BigInt(candidates)) : scopedKnn.all(encoded, BigInt(candidates), JSON.stringify(selected));
      const foundAt = performance.now(), rows = rerank[path].all(bytes(vector), JSON.stringify(approximate.map(row => row.rowid)), k), end = performance.now();
      return { rows, ms: end - begin, preparationMs: preparedAt - begin, candidatesMs: foundAt - preparedAt,
        rerankMs: end - foundAt, candidateRows: approximate.length, scopedRows: selected?.length };
    },
  };
}
function checkTransactions() {
  const root = mkdtempSync(join(tmpdir(), 'ears-int8-contract-')), file = join(root, 'db.sqlite'), q = new Float32Array([1, 0, 0]); let db, writer, restored;
  try {
    db = open(file, 3); const op = operations(db);
    db.transaction(() => [[1, 0, 0], [.9, .1, 0], [0, 1, 0], [-1, 0, 0]].forEach((v, i) => op.put(i, Float32Array.from(v), true)))();
    const top = () => op.native(q)[0].rowid; assert.equal(top(), 1); assert.equal(op.search('all', q, 1).rows[0].id, 1);
    db.exec('BEGIN'); op.update(1, new Float32Array([-1, 0, 0])); assert.equal(top(), 2);
    db.exec('SAVEPOINT nested'); db.exec('DELETE FROM raw WHERE id=2; DELETE FROM quantized WHERE rowid=2'); assert.equal(top(), 3);
    db.exec('ROLLBACK TO nested; RELEASE nested'); assert.equal(top(), 2); db.exec('ROLLBACK'); assert.equal(top(), 1);
    db.exec('BEGIN'); db.exec('UPDATE raw SET live=0 WHERE id=1; UPDATE quantized SET live=0 WHERE rowid=1'); assert.equal(top(), 2);
    db.exec('ROLLBACK'); assert.equal(top(), 1);
    writer = open(file); const other = operations(writer); db.exec('BEGIN'); assert.equal(top(), 1);
    writer.transaction(() => other.update(1, new Float32Array([-1, 0, 0])))(); assert.equal(top(), 1);
    db.exec('COMMIT'); assert.equal(top(), 2); assert.equal(op.search('all', q, 1).rows[0].id, 2);
    writer.close(); writer = undefined;
    db.prepare('VACUUM INTO ?').run(join(root, 'backup.sqlite'));
    restored = open(join(root, 'backup.sqlite')); assert.equal(operations(restored).search('all', q, 1).rows[0].id, 2); restored.close(); restored = undefined;
    db.close(); db = open(file); assert.equal(operations(db).native(q)[0].rowid, 2);
    return { ownWrite: true, savepoint: true, rollback: true, metadata: true, snapshot: true, backup: true, reopen: true };
  } finally { restored?.close(); writer?.close(); db?.close(); rmSync(root, { recursive: true, force: true }); }
}
try {
  checkCorpusMath(); report.contracts = checkTransactions(); save();
  for (const distribution of ['clustered', 'mixed']) {
    const root = mkdtempSync(join(tmpdir(), 'ears-int8-shape-')), file = join(root, 'db.sqlite'), profile = { distribution, samples: [], truth: [], heartbeat: [] }; report.profiles.push(profile);
    let db, pulse;
    const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
    try {
      const generate = corpusGenerator(distribution), vectors = new Float32Array(n * dimensions), norms = new Float64Array(n), start = performance.now();
      db = open(file, dimensions); const op = operations(db);
      for (let offset = 0; offset < n; offset += 128) db.transaction(() => {
        for (let i = offset; i < Math.min(n, offset + 128); i++) { const vector = generate(i); vectors.set(vector, i * dimensions); norms[i] = norm(vector); op.put(i, vector); }
      })();
      profile.setupMs = performance.now() - start; profile.buildWriteCosts = { ...op.writeCosts };
      profile.pageSize = db.pragma('page_size', { simple: true }); profile.pageCount = db.pragma('page_count', { simple: true });
      profile.vectorHash = hash(bytes(vectors)); profile.filesAfterBuild = files(); profile.memoryAfterBuild = process.memoryUsage();
      const queries = Array.from({ length: 16 }, (_, i) => generate(i, true)); profile.queryHashes = queries.map(vector => hash(bytes(vector)));
      async function sample(phase, repetitions) {
        const groundTruth = new Map(), started = performance.now();
        for (let q = 0; q < queries.length; q++) for (const path of paths) {
          const answer = exactTop(vectors, norms, queries[q], dimensions, i => eligible(i, path)); groundTruth.set(`${q}/${path}`, answer); profile.truth.push({ phase, query: q, path, answer });
        }
        profile[phase + 'TruthMs'] = performance.now() - started;
        pulse = startHeartbeat(8, (at, delayMs) => profile.heartbeat.push({ phase, at, delayMs }));
        try {
          for (let q = 0; q < queries.length; q++) for (const path of paths) for (let repeat = 0; repeat < repetitions; repeat++) {
            await new Promise(resolve => setImmediate(resolve));
            const answer = op.search(path, queries[q]), wanted = groundTruth.get(`${q}/${path}`), truthIds = new Set(wanted.map(row => row.ordinal + 1));
            const ids = answer.rows.map(row => row.id), recall = ids.filter(id => truthIds.has(id)).length / wanted.length;
            profile.samples.push({ phase, query: q, path, repeat, ...answer, recall });
            assert.equal(ids.length, wanted.length); assert.equal(new Set(ids).size, ids.length); assert(ids.every(id => eligible(id - 1, path)));
          }
          await new Promise(resolve => setTimeout(resolve, 16));
        } finally { pulse.stop(); pulse = undefined; }
        save();
      }
      await sample('initial', 3);
      const changed = Array.from({ length: 32 }, (_, i) => i + 1).filter(i => i % 17 !== 0), updateStart = performance.now();
      db.transaction(() => { for (const i of changed) { const vector = generate(i, false, 1); vectors.set(vector, i * dimensions); norms[i] = norm(vector); op.update(i + 1, vector); } })();
      profile.writeCostsAfterUpdates = { ...op.writeCosts };
      profile.updatedOrdinals = changed; profile.updateBatchMs = performance.now() - updateStart; profile.updatedVectorHash = hash(bytes(vectors));
      await sample('updated', 1);
      assert.deepEqual(queries.map(vector => hash(bytes(vector))), profile.queryHashes, 'query vectors were mutated');
      profile.summary = Object.fromEntries(paths.map(path => {
        const rows = profile.samples.filter(row => row.path === path), warm = rows.filter(row => row.phase === 'initial' && row.repeat > 0);
        return [path, { warmMs: summary(warm.map(row => row.ms)), candidateMs: summary(warm.map(row => row.candidatesMs)), rerankMs: summary(warm.map(row => row.rerankMs)),
          meanRecallByPhase: Object.fromEntries(['initial', 'updated'].map(phase => { const selected = rows.filter(row => row.phase === phase); return [phase, selected.reduce((sum, row) => sum + row.recall, 0) / selected.length]; })) }];
      }));
      profile.heartbeatSummary = summary(profile.heartbeat.map(row => row.delayMs)); profile.filesAfterQueries = files(); profile.memoryAfterQueries = process.memoryUsage();
      profile.budgets = { recall: Object.values(profile.summary).every(row => Object.values(row.meanRecallByPhase).every(value => value >= .95)),
        latency: n === 1000 ? null : Object.values(profile.summary).every(row => row.warmMs.p95 <= (n === 10000 ? 100 : 200)), heartbeat: n === 1000 ? null : profile.heartbeatSummary.p99 <= 16 };
      save(); assert(profile.budgets.recall, 'fixed 64-candidate recall target missed');
      if (n !== 1000) assert(profile.budgets.latency && profile.budgets.heartbeat, 'provisional execution strategy ceiling missed');
    } finally { pulse?.stop(); db?.close(); rmSync(root, { recursive: true, force: true }); }
  }
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { report.nativeBindingsAfterClose = loadedNativeBindings([getLoadablePath()]); report.memoryAtEnd = process.memoryUsage(); report.resources = process.resourceUsage(); save(); }
