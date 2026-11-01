// Run in a disposable environment. Every process owns a fresh synthetic profile; no application data is opened.
import assert from 'node:assert/strict';
import { getLoadablePath } from 'sqlite-vec';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';
import { mkdtempSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';

const n = Number(process.argv[2] ?? 10000);
const durable = process.argv.includes('--durable');
const search = process.argv.includes('--search');
const diagnostic = process.argv.includes('--diagnostic');
const cpuModels = [...new Set(cpus().map(cpu => cpu.model))];
const noQueryWatches = process.argv.includes('--no-query-watches');
assert(!noQueryWatches || diagnostic, 'The watch control is diagnostic only');
const spans: Array<{ kind: string; phase: string; start: number; end: number }> = [];
const heartbeatSamples: Array<{ phase: string; at: number; delayMs: number }> = [];
let phase = 'seed';
function measured<T>(kind: string, read: () => T): T {
  if (!diagnostic) return read();
  const start = performance.now();
  try { return read(); } finally { spans.push({ kind, phase, start, end: performance.now() }); }
}
const needle = search ? 'bucket-7-value' : 'bucket-7';
const progress = (stage: string) => { if (process.argv.includes('--progress')) writeSync(2, JSON.stringify({ stage, at: performance.now() }) + '\n'); };
assert(Number.isInteger(n) && n >= 1000 && n <= 100000);
const schema: EngineSchema = { types: { Row: { required: ['slug'], fields: {
  slug: { type: 'string' }, counter: { type: 'number', optional: true }, payload: { type: 'string' },
} } }, relations: {}, roles: [] };
const path = mkdtempSync(join(tmpdir(), 'ears-admission-load-'));
const db = new SqliteDatabase({ path, schema: toElmdbSchema(schema), syncs: durable });
const e = createEarsEngine({ database: db });
const commitWrite = db.commitWrite;
const id = (i: number) => `Row-${i}` as EARS.EntityId;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const quantile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};
const summary = (values: readonly number[]) => ({ count: values.length, p50: quantile(values, .5), p95: quantile(values, .95), p99: quantile(values, .99), max: Math.max(0, ...values) });
const files = () => Object.fromEntries(readdirSync(path).map(name => [name, statSync(join(path, name)).size]));
const total = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);
const heard = new Map<string, unknown>(), errors: unknown[] = [];
const watches: Array<{ stop(): void }> = [];
let heartbeat: ReturnType<typeof startHeartbeat> | undefined;
let runtimeTrace: { stop(): Promise<void> } | undefined;
const runtimeTracePrefix = process.env.EARS_ADMISSION_TRACE;
assert(!runtimeTracePrefix || (diagnostic && n === 100000 && search !== durable), 'Runtime tracing requires the declared 100k OFF search or FULL value diagnostic');
try {
  let nativeBindings = loadedNativeBindings();
  assert(nativeBindings.some(binding => binding.path.replaceAll('\\', '/').includes('/better-sqlite3/')), 'No loaded SQLite binding reported');
  progress('seed-start');
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', {
      id: id(i), slug: `bucket-${i % 100}${search ? '-value' : ''}`, payload: i % 128 === 0 ? 'large body '.repeat(1500) : 'body '.repeat(100),
    });
  }, { durable });
  progress('seed-end');
  for (let i = 0; i < 50; i++) {
    const watched = id(n - 1 - i);
    watches.push(e.watch(() => measured('watch-point', () => e.getAttr(watched, 'counter')), { next: value => heard.set(watched, value), error: error => errors.push(String(error)) }));
  }
  const expected = Array.from({ length: 10 }, (_, i) => id(7 + i * 100));
  for (let i = 0; i < (noQueryWatches ? 0 : 3); i++) watches.push(e.watch(() => measured('watch-query', () => e.query('Row').where('slug', needle).limit(10).ids()), {
    next: value => assert.deepEqual(value, expected), error: error => errors.push(String(error)),
  }));
  await e.admin.watchesSettled();
  const before = files();
  if (runtimeTracePrefix) runtimeTrace = await (await import('./admission-runtime.ts')).startAdmissionTrace(runtimeTracePrefix);
  // Commit timing is opt-in and includes the whole synchronous SQLite COMMIT call, not exclusive fsync.
  // Ordinary latency cohorts keep their original method and contain no per-commit observer.
  if (diagnostic) db.commitWrite = () => measured('write-commit', () => commitWrite.call(db));
  let maxObservedBytes = total(before), maxObservedWal = before['data.sqlite3-wal'] ?? 0;
  const batchSamples: Array<{ phase: string; outcome: string; ms: number }> = [];
  phase = 'build';
  const step = db.indexBuilds.step.bind(db.indexBuilds);
  db.indexBuilds.step = () => { const start = performance.now(); const outcome = measured('background', step); batchSamples.push({ phase, outcome, ms: performance.now() - start }); return outcome; };
  heartbeat = startHeartbeat(8, diagnostic ? (at, delayMs) => heartbeatSamples.push({ phase, at, delayMs }) : undefined);
  const admitted = performance.now();
  const read = db.values.read.bind(db.values); let admissionReads = 0;
  db.values.read = (...args) => { admissionReads++; return read(...args); };
  e.admin.setSchema({ ...schema, types: { Row: { ...schema.types.Row!, ...(search ? {
    search: { fields: { slug: 1 } }, substrings: ['slug'], embed: { from: ['slug'], model: 'fixture', dims: 3 },
  } : { indexes: ['slug'] }) } } });
  db.values.read = read;
  assert.equal(admissionReads, 0, 'Admission hydrated primary entity values');
  const admissionMs = performance.now() - admitted;
  const sequenceAfterAdmission = db.sequence; progress('admitted');
  const operations: number[] = [], turnWaits: number[] = [], lookup: number[] = [];
  const searchLookups: Array<{ state: 'building' | 'ready'; ms: number }> = [];
  let indexingErrors = 0;
  const searchWatches = search && !noQueryWatches ? Array.from({ length: 3 }, () => e.watch(() => measured('watch-search', () => e.query('Row').containing(needle).limit(10).ids()), {
    next: value => assert.deepEqual(value, expected),
    error: error => { if ((error as { code?: unknown })?.code === 'INDEX_BUILDING') indexingErrors++; else errors.push(String(error)); },
  })) : [];
  watches.push(...searchWatches);
  let writes = 0;
  async function foreground(): Promise<void> {
    const waiting = performance.now(); await turn(); turnWaits.push(performance.now() - waiting);
    const index = n - 1 - writes % 50;
    const started = performance.now();
    e.transact(() => {
      e.write(id(index)).set('counter', writes);
      if (writes % 4 === 0) e.write(id(index)).set('slug', `changed-${writes}`);
    }, { durable });
    assert.equal(e.getAttr(id(index), 'counter'), writes);
    operations.push(performance.now() - started);
    if (diagnostic) spans.push({ kind: 'foreground-write', phase, start: started, end: performance.now() });
    const query = performance.now();
    assert.deepEqual(e.query('Row').where('slug', needle).limit(10).ids(), expected);
    lookup.push(performance.now() - query);
    if (diagnostic) spans.push({ kind: 'foreground-lookup', phase, start: query, end: performance.now() });
    if (search && phase === 'build') {
      const at = performance.now(); let state: 'building' | 'ready' = 'ready';
      try { assert.deepEqual(e.query('Row').containing(needle).limit(10).ids(), expected); }
      catch (error) { assert.equal((error as { code?: unknown })?.code, 'INDEX_BUILDING'); state = 'building'; }
      searchLookups.push({ state, ms: performance.now() - at });
    }
    writes++;
    if (writes % 64 === 0) {
      const sample = files();
      maxObservedBytes = Math.max(maxObservedBytes, total(sample));
      maxObservedWal = Math.max(maxObservedWal, sample['data.sqlite3-wal'] ?? 0);
    }
    assert(writes < 100000, 'Background work did not make progress');
  }
  const buildStart = performance.now();
  while (db.indexBuilds.jobs().some(index => index.state === 'building')) await foreground();
  const buildMs = performance.now() - buildStart;
  assert.equal(db.indexBuilds.lastError, undefined);
  assert.equal(db.sequence, sequenceAfterAdmission + writes, 'Only foreground logical commits advance sequence');
  const afterBuild = files(); progress('build-end');
  const built = db.indexBuilds.jobs().filter(index => search ? index.kind !== 'value' : index.kind === 'value' && index.name === 'slug');
  if (search) {
    const at = performance.now(); assert.deepEqual(e.query('Row').containing(needle).limit(10).ids(), expected);
    searchLookups.push({ state: 'ready', ms: performance.now() - at });
    assert.equal(e.pendingEmbeddings('Row').count, n);
    await e.admin.watchesSettled();
  }
  for (const watch of searchWatches) watch.stop();
  phase = 'gc';
  e.admin.setSchema(schema);
  const gcStart = performance.now();
  while (db.get('SELECT 1 FROM index_gc LIMIT 1')) await foreground();
  const gcMs = performance.now() - gcStart;
  for (const job of built) {
    if (job.kind === 'value') assert.equal(db.get('SELECT count(*) n FROM field_index WHERE field=? AND generation=?', [job.name, job.generation])!.n, 0);
    else if (job.kind === 'vector') assert.equal(db.get('SELECT count(*) n FROM chunks WHERE generation=?', [job.generation])!.n, 0);
    else assert.equal(db.get('SELECT 1 FROM sqlite_schema WHERE name=?', [searchTable(job)]), undefined);
  }
  await e.admin.watchesSettled();
  assert.deepEqual(errors, []);
  for (let i = 0; i < 50; i++) assert.equal(heard.get(id(n - 1 - i)), e.getAttr(id(n - 1 - i), 'counter'));
  const afterGc = files(); progress('gc-end');
  maxObservedBytes = Math.max(maxObservedBytes, total(afterBuild), total(afterGc));
  maxObservedWal = Math.max(maxObservedWal, afterBuild['data.sqlite3-wal'] ?? 0, afterGc['data.sqlite3-wal'] ?? 0);
  heartbeat.stop();
  if (runtimeTrace) await runtimeTrace.stop();
  if (search) {
    nativeBindings = loadedNativeBindings([getLoadablePath()]);
    assert(nativeBindings.some(binding => binding.path === getLoadablePath()), 'Loaded vector extension was not fingerprinted');
  }
  assert(heartbeat.delaysMs.length > 0, 'No independent heartbeat samples captured');
  const budgets = {
    admissionMs: { actual: admissionMs, limit: 100 },
    ...(search ? { searchLookupP99Ms: { actual: quantile(searchLookups.map(s => s.ms), .99), limit: 16 } } : {}),
    operationP99Ms: { actual: quantile(operations, .99), limit: 16 },
    lookupP99Ms: { actual: quantile(lookup, .99), limit: 16 },
    turnWaitP99Ms: { actual: quantile(turnWaits, .99), limit: 16 },
    heartbeatDelayP99Ms: { actual: quantile(heartbeat.delaysMs, .99), limit: 16 },
    maxObservedWalBytes: { actual: maxObservedWal, limit: Math.max(16 * 1024 * 1024, (before['data.sqlite3-wal'] ?? 0) + 4 * 1024 * 1024) },
    maxObservedFilesBytes: { actual: maxObservedBytes, limit: total(before) * 2 + 16 * 1024 * 1024 },
  };
  const passed = Object.values(budgets).every(budget => budget.actual <= budget.limit);
  console.log(JSON.stringify({ ...(diagnostic ? { diagnostic: { noQueryWatches, spans, heartbeatSamples, qualification: false } } : {}), n, indexKind: search ? 'text/vector/trigram' : 'value', admissionReads, searchLookups, indexingErrors, node: process.version, platform: process.platform, arch: process.arch, cpuModels, syncs: durable,
    sqlite: db.get('SELECT sqlite_version() version')!.version, admissionMs, buildMs, gcMs, writes,
    operationMs: summary(operations), lookupMs: summary(lookup), turnWaitMs: summary(turnWaits), heartbeatIntervalMs: heartbeat.intervalMs, heartbeatDelayMs: summary(heartbeat.delaysMs), batchSamples, nativeBindings,
    samples: { operations, lookup, turnWaits, heartbeatDelays: heartbeat.delaysMs }, files: { before, afterBuild, afterGc }, maxObservedBytes, maxObservedWal,
    freelistPagesAfterGc: db.get('PRAGMA freelist_count'), resourceUsage: process.resourceUsage(), memory: process.memoryUsage(),
    budgets, passed, scope: search ? 'synthetic short-string text/vector/trigram admission with foreground writes, scalar/substring reads and 56 watches; readiness refusals are tagged; not relevance/recall, large-text, app or durability qualification' : 'synthetic same-connection value-index admission with foreground reads/writes and 53 watches; not complete app or durability qualification' }));
  if (!passed) process.exitCode = 1;
} finally {
  if (diagnostic) db.commitWrite = commitWrite;
  heartbeat?.stop();
  try { if (runtimeTrace) await runtimeTrace.stop(); }
  finally {
    for (const watch of watches) watch.stop();
    db.close(); rmSync(path, { recursive: true, force: true });
  }
}
