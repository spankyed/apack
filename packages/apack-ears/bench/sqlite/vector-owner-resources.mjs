// Synthetic chunk-skew resource diagnostic; execute the matching built package in disposable CI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { createEarsEngine } from '../../dist/index.js';
import { SqliteDatabase } from '../../dist/sqlite/database.js';
import { toElmdbSchema } from '../../dist/schema.js';
import { startHeartbeat, loadedNativeBindings } from './load-metrics.ts';

const [countArg, output, ...extra] = process.argv.slice(2);
const count = Number(countArg), owners = 4608, dimensions = 1536;
assert([1, 1024, 16384].includes(count)); assert(output && !existsSync(output) && extra.length === 0);
assert.equal(process.platform, 'linux');
const limits = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.deepEqual(limits, { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' });
assert(typeof process.env.GITHUB_SHA === 'string' && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA));
const directory = mkdtempSync(join(tmpdir(), 'ears-vector-owner-resources-'));
const report = { protocol: 'ears-vector-owner-resources/1', completed: false, qualification: false,
  source: process.env.GITHUB_SHA, node: process.version, dimensions, owners, skewOwnerChunks: count, limits,
  cpuModels: [...new Set(cpus().map(cpu => cpu.model))], execution: 'built-package', syncs: false,
  scope: 'Synthetic low-rank fallback owner/chunk scaling; not trained ANN recall, representative corpus, app responsiveness or a total-memory bound',
  samples: [], heartbeatLimitMs: 16, sampling: '20 warm serial queries in one fresh process per cohort; not independent model/trial variance',
  memoryScope: 'Process snapshots and cumulative maxRSS include setup; file sizes are a post-query snapshot, not peak disk or allocated blocks' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const vector = angle => [Math.cos(angle), Math.sin(angle), ...Array(dimensions - 2).fill(0)];
const query = vector(0), reverse = vector(Math.PI);
const snapshot = () => ({ memory: process.memoryUsage(), usage: process.resourceUsage() });
let db, failure;
try {
  db = new SqliteDatabase({ path: join(directory, 'store'), syncs: false, schema: toElmdbSchema({ types: {
    Row: { required: [], embed: { from: ['title'], model: 'skew-fixture', dims: dimensions, chunk: 'paragraph' } },
  }, relations: {}, roles: [] }) });
  assert.equal(db.nativeVectorExtension, undefined);
  report.modelMode = 'fallback';
  report.synchronous = db.get('PRAGMA synchronous').synchronous; assert.equal(report.synchronous, 0);
  report.sqlite = db.get('SELECT sqlite_version() version').version;
  const e = createEarsEngine({ database: db }), ids = [], angles = new Map(), started = performance.now();
  e.transact(() => {
    ids.push(e.create('Row', { title: Array.from({ length: count }, (_, i) => `paragraph ${i}`).join('\n\n') }).id());
    for (let i = 1; i < owners; i++) {
      const id = e.create('Row', { title: `owner ${i}` }).id(); ids.push(id); angles.set(id, 0.02 + i / owners);
    }
  });
  let stored = 0;
  for (;;) {
    const pending = e.pendingEmbeddings('Row', { limit: 128 });
    if (!pending.count) break;
    assert(pending.chunks.length > 0);
    const batch = pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
      vector: chunk.id === ids[0] ? (chunk.chunk === count - 1 ? query : reverse) : vector(angles.get(chunk.id)) }));
    assert.equal(e.embed(batch).stored, batch.length); stored += batch.length;
  }
  assert.equal(stored, owners - 1 + count);
  report.setupMs = performance.now() - started; report.chunks = stored;
  // The skew owner's only winning vector is its final chunk. Capping canonical chunks would change the answer.
  const expected = ids.slice(0, 5), expectedScores = [1, ...expected.slice(1).map(id => Math.cos(angles.get(id)))];
  const verify = () => {
    const hits = e.query('Row').near(query, { k: 5 }).hits();
    assert.deepEqual(hits.map(hit => hit.id), expected);
    for (let i = 0; i < hits.length; i++) assert(Math.abs(hits[i].score - expectedScores[i]) < 1e-5);
  };
  verify(); report.warmupVerified = true;
  assert.equal(typeof globalThis.gc, 'function'); globalThis.gc(); report.beforeQueries = snapshot();
  for (let trial = 0; trial < 20; trial++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    const pulse = startHeartbeat(1), at = performance.now();
    try { verify(); }
    finally {
      const ms = performance.now() - at; pulse.stop();
      report.samples.push({ ms, heartbeatDelaysMs: pulse.delaysMs });
    }
  }
  report.afterQueries = snapshot();
  const walk = path => Object.fromEntries(readdirSync(path).map(name => {
    const full = join(path, name); return [name, statSync(full).isDirectory() ? walk(full) : statSync(full).size];
  }));
  report.filesAfterQueries = walk(directory);
  report.compiledInputs = Object.fromEntries(['index.js', 'sqlite/vectors.js', 'sqlite/database.js'].map(name =>
    [name, sha(readFileSync(new URL('../../dist/' + name, import.meta.url)))]));
  report.nativeBindings = loadedNativeBindings(); report.correctness = true;
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const beats = report.samples.flatMap(sample => sample.heartbeatDelaysMs);
  assert(beats.length > 0);
  report.queryP95Ms = percentile(report.samples.map(sample => sample.ms), 0.95);
  report.heartbeatP99Ms = percentile(beats, 0.99); report.heartbeatWithinLimit = report.heartbeatP99Ms <= report.heartbeatLimitMs;
} catch (error) { failure = error; }
finally {
  try { await db?.drainBackground(); db?.close(); }
  catch (cleanup) { failure = failure ? new AggregateError([failure, cleanup], 'Resource probe and close failed', { cause: failure }) : cleanup; }
  try { rmSync(directory, { recursive: true, force: true }); report.scratchRemoved = !existsSync(directory); }
  catch (cleanup) { failure = failure ? new AggregateError([failure, cleanup], 'Resource probe and scratch cleanup failed', { cause: failure }) : cleanup; }
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failure) throw failure;
