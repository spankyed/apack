// Synthetic warm SQLite/function diagnostic; no application profile or production scoring is changed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getLoadablePath } from 'sqlite-vec';
import { loadedNativeBindings } from '../../packages/apack-ears/bench/sqlite/load-metrics.ts';

const [mode, ...args] = process.argv.slice(2), self = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.deepEqual(limits, { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' });
assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''));
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
  return { count: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) };
};
if (mode === 'child') {
  const [extension, output] = args; assert(args.length === 2 && !existsSync(output));
  const report = { completed: false, source: process.env.GITHUB_SHA, scriptSha256: sha(readFileSync(self)), limits, node: process.version,
    cpuModels: [...new Set(cpus().map(cpu => cpu.model))], extensionSha256: sha(readFileSync(extension)), fixtures: [],
    scope: 'Warm in-memory SQLite scan/sort plus distance function; fixture/oracle costs outside timings; not EARS latency/recall or process variance qualification' };
  let db, failed = false, failure;
  try {
    db = new Database(':memory:'); db.loadExtension(getLoadablePath()); db.loadExtension(extension);
    report.sqlite = db.prepare('SELECT sqlite_version() value').get().value;
    report.sqliteVec = db.prepare('SELECT vec_debug() value').get().value;
    report.vec1 = db.prepare('SELECT vec1_info() value').get().value;
    for (const [count, dimensions] of [[1024, 256], [4096, 1536]]) {
      let state = 0x13579bdf;
      const vector = () => {
        const values = new Float32Array(dimensions); let squared = 0;
        for (let i = 0; i < dimensions; i++) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          values[i] = (state >>> 0) / 4294967296 - .5; squared += values[i] ** 2;
        }
        const norm = Math.sqrt(squared); for (let i = 0; i < dimensions; i++) values[i] /= norm;
        return Buffer.from(values.buffer);
      };
      const vectors = Array.from({ length: count }, vector);
      const queries = [vectors[0], vectors.at(-1), ...Array.from({ length: 14 }, vector)];
      const digest = createHash('sha256'); for (const bytes of [...vectors, ...queries]) digest.update(bytes);
      const result = { count, dimensions, fixtureSha256: digest.digest('hex'), maximumOracleError: {}, samples: [] };
      report.fixtures.push(result);
      const cosine = (left, right) => {
        const a = new Float32Array(left.buffer, left.byteOffset, dimensions), b = new Float32Array(right.buffer, right.byteOffset, dimensions);
        let dot = 0, aa = 0, bb = 0;
        for (let i = 0; i < dimensions; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
        return 1 - dot / Math.sqrt(aa * bb);
      };
      const oracle = queries.map(query => vectors.map(bytes => cosine(query, bytes)));
      const cutoffs = oracle.map(distances => [...distances].sort((a, b) => a - b)[63]);
      db.exec('CREATE TABLE vectors(id INTEGER PRIMARY KEY,v BLOB NOT NULL)');
      const put = db.prepare('INSERT INTO vectors VALUES(?,?)');
      db.transaction(() => vectors.forEach((bytes, i) => put.run(i + 1, bytes)))();
      const functions = ['vec_distance_cosine', 'vec1_cos_distance'];
      const statements = Object.fromEntries(functions.map(name => [name,
        db.prepare(`SELECT id,${name}(v,?) distance FROM vectors ORDER BY distance,id LIMIT 64`)]));
      result.plans = Object.fromEntries(functions.map(name => [name, db.prepare(
        `EXPLAIN QUERY PLAN SELECT id,${name}(v,?) distance FROM vectors ORDER BY distance,id LIMIT 64`
      ).all(queries[0]).map(row => row.detail)]));
      const check = (name, query, rows) => {
        assert.equal(rows.length, 64); const chosen = new Set(rows.map(row => row.id)); assert.equal(chosen.size, 64);
        let error = result.maximumOracleError[name] ?? 0;
        for (const row of rows) {
          assert(Number.isSafeInteger(row.id) && row.id >= 1 && row.id <= count && Number.isFinite(row.distance));
          error = Math.max(error, Math.abs(row.distance - oracle[query][row.id - 1]));
          assert(oracle[query][row.id - 1] <= cutoffs[query] + 2e-5);
        }
        assert(error <= 1e-5, 'Canonical distance must match independent Float64 accumulation');
        oracle[query].forEach((distance, i) => { if (distance < cutoffs[query] - 2e-5) assert(chosen.has(i + 1)); });
        result.maximumOracleError[name] = error;
      };
      for (let query = 0; query < queries.length; query++) for (const name of functions)
        check(name, query, statements[name].all(queries[query]));
      for (let round = 0; round < 5; round++) for (let query = 0; query < queries.length; query++) {
        const order = (round + query) % 2 ? [...functions].reverse() : functions;
        for (const name of order) {
          const started = performance.now(), rows = statements[name].all(queries[query]);
          result.samples.push({ function: name, round, query, ms: performance.now() - started });
          check(name, query, rows);
        }
      }
      result.summary = Object.fromEntries(functions.map(name => [name, summary(result.samples.filter(sample => sample.function === name).map(sample => sample.ms))]));
      result.sqliteVecOverVec1P95 = result.summary.vec_distance_cosine.p95Ms / result.summary.vec1_cos_distance.p95Ms;
      db.exec('DROP TABLE vectors');
    }
    report.nativeBindings = loadedNativeBindings([getLoadablePath(), extension]);
    report.usage = process.resourceUsage();
  } catch (error) { failed = true; failure = error; }
  finally {
    try { db?.close(); }
    catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Distance probe and close failed', { cause: failure }) : cleanup; failed = true; }
    report.completed = !failed;
    if (failed) report.failure = { message: failure?.message ?? String(failure), stack: failure?.stack };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failed) throw failure;
} else {
  assert.equal(mode, 'compare'); const [generic, dispatch, output] = args;
  assert(args.length === 3 && !existsSync(output));
  const report = { completed: false, source: process.env.GITHUB_SHA, limits, children: [],
    scope: 'One fresh process per artifact with matched within-process SQL/function timings; no production scoring/build change' };
  try {
    for (const [name, extension] of [['generic', generic], ['dispatch', dispatch]]) {
      const receiptFile = output + '.' + name + '.json';
      const child = spawnSync(process.execPath, ['--experimental-strip-types', self, 'child', resolve(extension), receiptFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : null;
      report.children.push({ name, exit: { code: child.status, signal: child.signal }, receipt,
        logTail: (child.stderr ?? '').slice(-8192) });
      if (child.error) throw child.error;
      assert.equal(child.status, 0); assert.equal(child.signal, null); assert(receipt?.completed);
      assert(receipt.vec1.includes(name === 'generic' ? '(Scalar,' : '(AVX2,'));
      assert.equal(receipt.source, report.source); assert.equal(receipt.scriptSha256, sha(readFileSync(self)));
      assert.deepEqual(receipt.limits, limits);
      assert(receipt.nativeBindings.some(binding => binding.sha256 === receipt.extensionSha256));
    }
    const [a, b] = report.children.map(child => child.receipt);
    assert.deepEqual(a.cpuModels, b.cpuModels);
    assert.deepEqual(a.fixtures.map(f => f.fixtureSha256), b.fixtures.map(f => f.fixtureSha256));
    report.completed = true;
  } catch (error) { report.failure = { message: error?.message ?? String(error), stack: error?.stack }; throw error; }
  finally { writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
}
