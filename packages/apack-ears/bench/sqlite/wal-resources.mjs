// Bounded retained-reader resource diagnostic over the matching built package, in disposable CI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { createEarsEngine } from '../../dist/index.js';
import { SqliteDatabase } from '../../dist/sqlite/database.js';
import { toElmdbSchema } from '../../dist/schema.js';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';

const [mode, output, regime = 'burst', ...extra] = process.argv.slice(2);
assert(['burst', 'sustained'].includes(regime));
assert(['released', 'retained'].includes(mode)); assert(output && !existsSync(output) && !extra.length);
assert.equal(process.platform, 'linux');
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
const limits = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.deepEqual(limits, { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' });
const directory = mkdtempSync(join(tmpdir(), 'ears-wal-resources-')), store = join(directory, 'store');
const report = { protocol: 'ears-wal-resources/2', source: process.env.GITHUB_SHA, mode, regime,
  completed: false, qualification: false, execution: 'built-package', limits,
  node: process.version, cpuModels: [...new Set(cpus().map(cpu => cpu.model))],
  commits: regime === 'sustained' ? 4096 : 512, scheduledMs: regime === 'sustained' ? 120000 : 0,
  payloadBytes: 65536, syncs: true, samples: [],
  scope: 'One synthetic fresh process per reader state/regime; paced sustained workload is not saturation throughput, independent trial/device variance, physical power loss or complete app qualification',
  measurement: 'Logical sizes and allocated blocks sampled after every commit; transient intra-commit peaks are not observed. Memory includes setup and instrumentation.' };
const connections = [];
let failure;
const files = () => Object.fromEntries(readdirSync(store).map(name => {
  const info = statSync(join(store, name)); return [name, { bytes: info.size, allocatedBytes: info.blocks * 512 }];
}));
const checkpoint = db => db.all('PRAGMA wal_checkpoint(TRUNCATE)')[0];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  const db = new SqliteDatabase({ path: store, schema: toElmdbSchema({ types: { Row: { required: [] } }, relations: {}, roles: [] }) });
  connections.push(db);
  const e = createEarsEngine({ database: db });
  e.create('Row', { id: 'Row-before', body: 'incumbent' });
  assert.equal(checkpoint(db).busy, 0);
  report.sqlite = db.get('SELECT sqlite_version() version').version;
  report.synchronous = db.get('PRAGMA synchronous').synchronous; assert.equal(report.synchronous, 2);
  report.autoCheckpointPages = db.get('PRAGMA wal_autocheckpoint').wal_autocheckpoint;
  assert.equal(report.autoCheckpointPages, 1000); // Keep ordinary production configuration.
  const reader = new SqliteDatabase({ path: store, readOnly: true }); connections.push(reader);
  if (mode === 'retained') reader.sql.exec('BEGIN');
  assert.equal(reader.get('SELECT count(*) n FROM entities').n, 1);
  report.before = { files: files(), memory: process.memoryUsage() };
  report.pacingIntervalMs = report.scheduledMs / report.commits;
  const heartbeat = startHeartbeat(1), cpu = process.cpuUsage(), at = performance.now();
  try {
    for (let i = 0; i < report.commits; i++) {
      const start = performance.now();
      e.create('Row', { id: `Row-${i}`, body: String(i).padStart(8, '0') + 'x'.repeat(report.payloadBytes - 8) });
      const writeMs = performance.now() - start;
      report.samples.push({ commit: i + 1, writeMs, files: files(),
        ...(regime === 'sustained' && { startedAtMs: start - at,
          pacingLateMs: Math.max(0, start - at - i * report.pacingIntervalMs) }) });
      // Retain incomplete numeric evidence if the existing process watchdog terminates a slow trial.
      if (regime === 'sustained' && (i + 1) % 128 === 0)
        writeFileSync(output + '.progress.json', JSON.stringify({ ...report, finishedCommits: i + 1,
          elapsedMs: performance.now() - at, heartbeatDelaysMs: heartbeat.delaysMs }));
      // Every 32 commits checks the actual retained snapshot or fresh reader visibility.
      if ((i + 1) % 32 === 0) assert.equal(reader.get('SELECT count(*) n FROM entities').n, mode === 'retained' ? 1 : i + 2);
      const remaining = at + (i + 1) * report.pacingIntervalMs - performance.now();
      if (regime === 'sustained' && remaining > 0)
        await new Promise(resolve => setTimeout(resolve, Math.ceil(remaining)));
      else await new Promise(resolve => setImmediate(resolve));
    }
  } finally {
    report.elapsedMs = performance.now() - at; report.cpu = process.cpuUsage(cpu);
    heartbeat.stop(); report.heartbeatDelaysMs = heartbeat.delaysMs;
  }
  assert.equal(e.query('Row').count(), report.commits + 1);
  report.finishedCommits = report.samples.length;
  if (regime === 'sustained') assert(report.elapsedMs >= report.scheduledMs - 1, 'Sustained trial must cover its scheduled two minutes');
  report.afterWrites = { files: files(), memory: process.memoryUsage(), usage: process.resourceUsage() };
  report.checkpointWhileReader = checkpoint(db);
  assert.equal(report.checkpointWhileReader.busy, mode === 'retained' ? 1 : 0);
  if (mode === 'retained') {
    assert(report.checkpointWhileReader.checkpointed < report.checkpointWhileReader.log);
    reader.sql.exec('ROLLBACK');
  }
  assert.equal(reader.get('SELECT count(*) n FROM entities').n, report.commits + 1);
  report.checkpointAfterRelease = checkpoint(db); assert.equal(report.checkpointAfterRelease.busy, 0);
  assert.equal(statSync(join(store, 'data.sqlite3-wal')).size, 0);
  // A separate writer owns the lock; a refused EARS write must preserve its sequence and be reusable.
  const other = new SqliteDatabase({ path: store }); connections.push(other);
  const sequence = db.sequence;
  other.sql.exec('BEGIN IMMEDIATE');
  try {
    const before = performance.now();
    assert.throws(() => e.create('Row', { id: 'Row-refused' }), { code: 'SQLITE_BUSY' });
    report.busyRefusalMs = performance.now() - before;
    assert.equal(db.sequence, sequence); assert.equal(e.query('Row').count(), report.commits + 1);
  } finally { other.sql.exec('ROLLBACK'); }
  e.create('Row', { id: 'Row-recovered' });
  assert.equal(e.query('Row').count(), report.commits + 2);
  other.close(); reader.close(); db.close(); connections.length = 0;
  const reopened = new SqliteDatabase({ path: store, readOnly: true }); connections.push(reopened);
  assert.equal(createEarsEngine({ database: reopened }).query('Row').count(), report.commits + 2);
  assert.deepEqual(reopened.all('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
  report.reopenVerified = true; report.afterRelease = { files: files(), memory: process.memoryUsage() };
  report.writeP95Ms = percentile(report.samples.map(sample => sample.writeMs), .95);
  report.heartbeatP99Ms = percentile(report.heartbeatDelaysMs, .99);
  report.heartbeatLimitMs = 16; report.heartbeatWithinLimit = report.heartbeatP99Ms <= 16;
  report.nativeBindings = loadedNativeBindings(); assert(report.nativeBindings.length > 0);
  report.compiledInputs = Object.fromEntries(['index.js', 'sqlite/database.js', 'sqlite/query.js'].map(name =>
    [name, createHash('sha256').update(readFileSync(new URL('../../dist/' + name, import.meta.url))).digest('hex')]));
} catch (error) { failure = error; }
finally {
  for (const connection of connections.reverse()) {
    try { connection.close(); } catch (error) { failure = failure ? new AggregateError([failure, error], 'Probe and close failed') : error; }
  }
  try { rmSync(directory, { recursive: true }); report.scratchRemoved = !existsSync(directory); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Probe and cleanup failed') : error; }
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failure) throw failure;
