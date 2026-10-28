// Run in a disposable environment. Every process owns a fresh synthetic profile; no application data is opened.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const n = Number(process.argv[2] ?? 10000);
const durable = process.argv.includes('--durable');
assert(Number.isInteger(n) && n >= 1000 && n <= 100000);
const schema: EngineSchema = { types: { Row: { required: ['slug'], fields: {
  slug: { type: 'string' }, counter: { type: 'number', optional: true }, payload: { type: 'string' },
} } }, relations: {}, roles: [] };
const path = mkdtempSync(join(tmpdir(), 'ears-admission-load-'));
const db = new SqliteDatabase({ path, schema: toElmdbSchema(schema), syncs: durable });
const e = createEarsEngine({ database: db });
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
try {
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', {
      id: id(i), slug: `bucket-${i % 100}`, payload: i % 128 === 0 ? 'large body '.repeat(1500) : 'body '.repeat(100),
    });
  }, { durable });
  for (let i = 0; i < 50; i++) {
    const watched = id(n - 1 - i);
    watches.push(e.watch(() => e.getAttr(watched, 'counter'), { next: value => heard.set(watched, value), error: error => errors.push(String(error)) }));
  }
  const expected = Array.from({ length: 10 }, (_, i) => id(7 + i * 100));
  for (let i = 0; i < 3; i++) watches.push(e.watch(() => e.query('Row').where('slug', 'bucket-7').limit(10).ids(), {
    next: value => assert.deepEqual(value, expected), error: error => errors.push(String(error)),
  }));
  await e.admin.watchesSettled();
  const before = files();
  let maxObservedBytes = total(before), maxObservedWal = before['data.sqlite3-wal'] ?? 0;
  const batchSamples: Array<{ phase: string; outcome: string; ms: number }> = [];
  let phase = 'build';
  const step = db.indexBuilds.step.bind(db.indexBuilds);
  db.indexBuilds.step = () => { const start = performance.now(); const outcome = step(); batchSamples.push({ phase, outcome, ms: performance.now() - start }); return outcome; };
  const admitted = performance.now();
  e.admin.setSchema({ ...schema, types: { Row: { ...schema.types.Row!, indexes: ['slug'] } } });
  const admissionMs = performance.now() - admitted;
  const sequenceAfterAdmission = db.sequence;
  const operations: number[] = [], stalls: number[] = [], lookup: number[] = [];
  let writes = 0;
  async function foreground(): Promise<void> {
    const waiting = performance.now(); await turn(); stalls.push(performance.now() - waiting);
    const index = n - 1 - writes % 50;
    const started = performance.now();
    e.transact(() => {
      e.write(id(index)).set('counter', writes);
      if (writes % 4 === 0) e.write(id(index)).set('slug', `changed-${writes}`);
    }, { durable });
    assert.equal(e.getAttr(id(index), 'counter'), writes);
    operations.push(performance.now() - started);
    const query = performance.now();
    assert.deepEqual(e.query('Row').where('slug', 'bucket-7').limit(10).ids(), expected);
    lookup.push(performance.now() - query);
    writes++;
    if (writes % 64 === 0) {
      const sample = files();
      maxObservedBytes = Math.max(maxObservedBytes, total(sample));
      maxObservedWal = Math.max(maxObservedWal, sample['data.sqlite3-wal'] ?? 0);
    }
    assert(writes < 100000, 'Background work did not make progress');
  }
  const buildStart = performance.now();
  while (db.indexBuilds.statuses().some(index => index.state === 'building')) await foreground();
  const buildMs = performance.now() - buildStart;
  assert.equal(db.indexBuilds.lastError, undefined);
  assert.equal(db.sequence, sequenceAfterAdmission + writes, 'Only foreground logical commits advance sequence');
  const afterBuild = files();
  const generation = db.indexBuilds.statuses().find(index => index.field === 'slug')!.generation;
  phase = 'gc';
  e.admin.setSchema(schema);
  const gcStart = performance.now();
  while (db.get('SELECT 1 FROM value_index_gc LIMIT 1')) await foreground();
  const gcMs = performance.now() - gcStart;
  assert.equal(db.get('SELECT count(*) n FROM field_index WHERE field=? AND generation=?', ['slug', generation])!.n, 0);
  await e.admin.watchesSettled();
  assert.deepEqual(errors, []);
  for (let i = 0; i < 50; i++) assert.equal(heard.get(id(n - 1 - i)), e.getAttr(id(n - 1 - i), 'counter'));
  const afterGc = files();
  maxObservedBytes = Math.max(maxObservedBytes, total(afterBuild), total(afterGc));
  maxObservedWal = Math.max(maxObservedWal, afterBuild['data.sqlite3-wal'] ?? 0, afterGc['data.sqlite3-wal'] ?? 0);
  const budgets = {
    admissionMs: { actual: admissionMs, limit: 100 },
    operationP99Ms: { actual: quantile(operations, .99), limit: 16 },
    lookupP99Ms: { actual: quantile(lookup, .99), limit: 16 },
    timerStallP99Ms: { actual: quantile(stalls, .99), limit: 16 },
    maxObservedWalBytes: { actual: maxObservedWal, limit: Math.max(16 * 1024 * 1024, (before['data.sqlite3-wal'] ?? 0) + 4 * 1024 * 1024) },
    maxObservedFilesBytes: { actual: maxObservedBytes, limit: total(before) * 2 + 16 * 1024 * 1024 },
  };
  const passed = Object.values(budgets).every(budget => budget.actual <= budget.limit);
  console.log(JSON.stringify({ n, node: process.version, platform: process.platform, arch: process.arch, syncs: durable,
    sqlite: db.get('SELECT sqlite_version() version')!.version, admissionMs, buildMs, gcMs, writes,
    operationMs: summary(operations), lookupMs: summary(lookup), timerStallMs: summary(stalls), batchSamples,
    samples: { operations, lookup, stalls }, files: { before, afterBuild, afterGc }, maxObservedBytes, maxObservedWal,
    freelistPagesAfterGc: db.get('PRAGMA freelist_count'), resourceUsage: process.resourceUsage(), memory: process.memoryUsage(),
    budgets, passed, scope: 'synthetic same-connection value-index admission with foreground reads/writes and 53 watches; not complete app or durability qualification' }));
  if (!passed) process.exitCode = 1;
} finally {
  for (const watch of watches) watch.stop();
  db.close(); rmSync(path, { recursive: true, force: true });
}
