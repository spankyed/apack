// Synthetic maintenance resource probe. Run only against the matching built package in disposable CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = [{ name: 'many-small-keys', count: 50000, payloadBytes: 64 }, { name: 'large-infos', count: 10000, payloadBytes: 8192 }];
const compiledPaths = ['index.js', 'schema.js', 'sqlite/database.js', 'sqlite/audit.js', 'sqlite/relation-identity.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorReport = error => ({ name: error?.name, message: error?.message ?? String(error), code: error?.code });
const limits = () => Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
const requiredLimits = { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' };
const snapshot = () => ({ memory: process.memoryUsage(), usage: process.resourceUsage() });

async function child(root, fixtureName, output) {
  const fixture = fixtures.find(row => row.name === fixtureName); assert(fixture);
  assert.equal(process.platform, 'linux'); assert.deepEqual(limits(), requiredLimits);
  assert.equal(process.env.TMPDIR, root); assert(!existsSync(join(root, 'source')));
  const { createEarsEngine } = await import('../../dist/index.js');
  const { SqliteDatabase } = await import('../../dist/sqlite/database.js');
  const { toElmdbSchema } = await import('../../dist/schema.js');
  const { auditSqliteDatabase } = await import('../../dist/sqlite/audit.js');
  const { loadedNativeBindings } = await import('./load-metrics.ts');
  let db, failed = false, failure;
  const result = { completed: false, fixture, source: process.env.GITHUB_SHA, execution: 'built-package',
    node: process.version, platform: process.platform, arch: process.arch, limits: limits(),
    cpuModels: [...new Set(cpus().map(cpu => cpu.model))], syncs: false };
  try {
    db = new SqliteDatabase({ path: join(root, 'source'), syncs: false, schema: toElmdbSchema({
      types: { Row: { required: [] } }, relations: { edge: { key: ['slot'] } }, roles: [],
    }) });
    result.synchronous = db.get('PRAGMA synchronous').synchronous; assert.equal(result.synchronous, 0);
    result.sqlite = db.get('SELECT sqlite_version() version').version;
    const e = createEarsEngine({ database: db }), source = e.create('Row', {}).id(), target = e.create('Row', {}).id();
    const payload = 'x'.repeat(fixture.payloadBytes), setupAt = performance.now();
    for (let offset = 0; offset < fixture.count; offset += 128) db.bulkLoad(
      Array.from({ length: Math.min(128, fixture.count - offset) }, (_, at) => ({
        load: 'relation', id: `Relation-${offset + at}`, kind: 'edge', source, target,
        info: { slot: { a: offset + at, b: [1, 2] }, payload },
      })));
    result.setupMs = performance.now() - setupAt;
    const digest = () => {
      const hash = createHash('sha256');
      for (const row of db.statement('SELECT * FROM relations ORDER BY seq').iterate()) hash.update(db.pack(row));
      return hash.digest('hex');
    };
    const before = digest(), sequence = e.lastCommit();
    assert.equal(typeof globalThis.gc, 'function'); globalThis.gc(); result.baselineGc = true; result.beforeAudit = snapshot();
    const at = performance.now(), audit = await auditSqliteDatabase(db);
    result.auditMs = performance.now() - at;
    // Capture before verification hashes/provenance allocate; maxRSS remains cumulative from process start.
    result.afterAudit = snapshot();
    assert.equal(audit.ok, true); assert.equal(audit.issueCount, 0); assert.equal(audit.checkedRelations, fixture.count);
    assert.equal(digest(), before); assert.equal(e.lastCommit(), sequence);
    assert.equal(db.get('SELECT count(*) n FROM relations').n, fixture.count);
    result.sourceRelationsUnchanged = true; result.sourceCommitUnchanged = true;
    result.audit = audit;
    result.compiledInputs = Object.fromEntries(compiledPaths.map(path => [path, sha(readFileSync(new URL('../../dist/' + path, import.meta.url)))]));
    result.enginePin = readFileSync(new URL('../../../../vendor/elmdb.rev', import.meta.url), 'utf8').trim();
    result.nativeBindings = loadedNativeBindings();
  } catch (error) { failed = true; failure = error; }
  finally {
    try { await db?.drainBackground(); db?.close(); }
    catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Audit probe and close failed', { cause: failure }) : cleanup; failed = true; }
    result.completed = !failed;
    if (failed) result.failure = errorReport(failure);
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  }
  if (failed) throw failure;
}

function diskSnapshot(root) {
  let totalBytes = 0, spoolBytes = 0;
  const visit = path => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      assert(entry.isFile(), 'Owned probe scratch must contain ordinary files');
      let size;
      try { size = statSync(full).size; }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      totalBytes += size;
      if (entry.name === 'relation-identities.sqlite3') spoolBytes += size;
    }
  };
  visit(root); return { totalBytes, spoolBytes };
}
function validateResult(result, fixture, source) {
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  assert(result); assert.equal(result.completed, true); assert.equal(result.source, source);
  assert.equal(result.baselineGc, true); assert.equal(result.execution, 'built-package'); assert.equal(result.syncs, false); assert.equal(result.synchronous, 0);
  assert(typeof result.sqlite === 'string' && /^3\.\d+\.\d+/.test(result.sqlite));
  assert.equal(result.node, process.version); assert.equal(result.platform, 'linux'); assert.equal(result.arch, process.arch);
  assert.deepEqual(result.limits, requiredLimits); assert.deepEqual(result.fixture, fixture);
  assert(Array.isArray(result.cpuModels) && result.cpuModels.length > 0 && result.cpuModels.every(model => typeof model === 'string' && model.trim()));
  assert(result.nativeBindings.some(binding => /[\\/]better_sqlite3\.node$/.test(binding.path)));
  assert(result.nativeBindings.every(binding => /^[a-f0-9]{64}$/.test(binding.sha256)));
  assert(/^[a-f0-9]{40}$/.test(result.enginePin));
  for (const path of compiledPaths) assert(/^[a-f0-9]{64}$/.test(result.compiledInputs[path]));
  assert(finite(result.auditMs) && finite(result.setupMs));
  for (const snapshot of [result.beforeAudit, result.afterAudit]) {
    assert(snapshot && snapshot.memory && snapshot.usage);
    assert(['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'].every(key => finite(snapshot.memory[key])));
    assert(snapshot.memory.rss > 0 && snapshot.memory.heapTotal >= snapshot.memory.heapUsed);
    assert(['maxRSS', 'userCPUTime', 'systemCPUTime'].every(key => finite(snapshot.usage[key])));
    assert(snapshot.usage.maxRSS > 0);
  }
  for (const key of ['maxRSS', 'userCPUTime', 'systemCPUTime']) assert(result.afterAudit.usage[key] >= result.beforeAudit.usage[key]);
  assert.equal(result.sourceRelationsUnchanged, true); assert.equal(result.sourceCommitUnchanged, true);
  assert.equal(result.audit.checkedRelations, fixture.count); assert.equal(result.audit.ok, true); assert.equal(result.audit.issueCount, 0);
}
async function parent(output) {
  assert(output && !existsSync(output)); assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')); assert.equal(process.platform, 'linux'); assert.deepEqual(limits(), requiredLimits);
  mkdirSync(dirname(output), { recursive: true });
  const report = { protocol: 'ears-relation-audit-resources/1', completed: false, source: process.env.GITHUB_SHA,
    scope: 'Three fresh processes per synthetic fixture; OFF maintenance only; observed logical disk peaks and cumulative process memory, not app/power-loss qualification',
    limits: limits(), pollMs: 10, trials: [] };
  const save = () => { writeFileSync(output + '.next', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); renameSync(output + '.next', output); };
  save();
  for (const fixture of fixtures) for (let trial = 0; trial < 3; trial++) {
    const root = mkdtempSync(join(tmpdir(), 'ears-audit-resource-')), resultFile = join(root, 'result.json');
    const record = { fixture: fixture.name, trial, completed: false, peakObservedDiskBytes: 0, peakObservedSpoolBytes: 0, diskSamples: 0, samplingErrors: [] };
    report.trials.push(record); save();
    let sampleError, log = '', timer;
    const sample = () => {
      try {
        const current = diskSnapshot(root); record.diskSamples++;
        record.peakObservedDiskBytes = Math.max(record.peakObservedDiskBytes, current.totalBytes);
        record.peakObservedSpoolBytes = Math.max(record.peakObservedSpoolBytes, current.spoolBytes);
      } catch (error) { sampleError ??= error; if (!record.samplingErrors.length) record.samplingErrors.push(errorReport(error)); }
    };
    let failure, failed = false;
    try {
      const processHandle = spawn(process.execPath, ['--experimental-strip-types', '--expose-gc', fileURLToPath(import.meta.url), '--child', root, fixture.name, resultFile],
        { env: { ...process.env, TMPDIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', bytes => { log = (log + bytes.toString()).slice(-65536); });
      sample(); timer = setInterval(sample, report.pollMs);
      const exit = await new Promise(resolve => {
        processHandle.once('error', error => { failure = error; failed = true; });
        processHandle.once('close', (code, signal) => resolve({ code, signal }));
      });
      clearInterval(timer); sample(); record.exit = exit;
      if (existsSync(resultFile)) record.result = JSON.parse(readFileSync(resultFile, 'utf8'));
      if (failed) throw failure;
      assert.deepEqual(exit, { code: 0, signal: null });
      if (sampleError) throw sampleError;
      const result = record.result; validateResult(result, fixture, report.source);
      assert(record.diskSamples > 0 && record.peakObservedSpoolBytes > 0);
      record.result = result; record.completed = true;
    } catch (error) { failed = true; failure = error; record.failure = errorReport(error); record.log = log; }
    finally {
      clearInterval(timer);
      try { rmSync(root, { recursive: true, force: true }); record.scratchRemoved = !existsSync(root); }
      catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Audit probe and scratch cleanup failed', { cause: failure }) : cleanup; failed = true; record.completed = false; record.cleanupFailure = errorReport(cleanup); }
      save();
    }
    if (failed) throw failure;
  }
  report.completed = true; save();
}
const [, , mode, ...args] = process.argv;
try { if (mode === '--child') await child(...args); else await parent(mode); }
catch (error) { console.error(error); process.exitCode = 1; }
