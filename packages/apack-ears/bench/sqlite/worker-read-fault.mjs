// Disposable Linux worker read/allocation refusal and retry; never a production fault hook.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createEarsEngine } from '../../dist/index.js';
import { toElmdbSchema } from '../../dist/schema.js';
import { SqliteDatabase } from '../../dist/sqlite/database.js';
import { SqliteVectorIndex } from '../../dist/sqlite/vector-index.js';
import { SqliteVectorTraining } from '../../dist/sqlite/vector-training.js';
import { loadedNativeBindings } from './load-metrics.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const [output, phase = 'header', ...extra] = process.argv.slice(2); assert(output && !existsSync(output) && !extra.length);
assert(['header', 'embedding-page', 'model-allocation'].includes(phase));
const allocation = phase === 'model-allocation';
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
const preload = process.env.LD_PRELOAD;
assert(preload && preload.endsWith(allocation ? '/worker-model-allocation-fault.so' : '/worker-read-fault.so'));
const extension = process.env.EARS_VEC1_EXTENSION; assert(extension && existsSync(extension));
const directory = mkdtempSync(join(tmpdir(), 'ears-worker-read-fault-')), store = join(directory, 'store');
const arm = join(directory, 'armed'), event = join(directory, 'event.json');
const releaseAllocation = join(directory, 'release-allocation');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { protocol: allocation ? 'ears-worker-allocation-fault/2' : 'ears-worker-read-fault/2', phase, source: process.env.GITHUB_SHA,
  completed: false, qualification: false, execution: 'built-package', node: process.version,
  scope: allocation
    ? 'One model-sized allocation refusal with a real vec1TrainFinal worker stack and retry; not OS/cgroup OOM, arbitrary allocations, mid-kmeans failure or a total-memory bound'
    : 'One selected native worker header/embedding-table-page read error and retry; not compute-stage attribution, device faults, physical power loss or all worker/resource regimes',
  preloadSha256: sha(readFileSync(preload)), extensionSha256: sha(readFileSync(extension)) };
let db, trainer, failure;
try {
  db = new SqliteDatabase({ path: store, syncs: false, schema: toElmdbSchema({ types: {
    Row: { required: [], embed: { from: ['title'], model: 'worker-read-fixture', dims: 128 } },
  }, relations: {}, roles: [] }) });
  const e = createEarsEngine({ database: db });
  new SqliteVectorIndex(db, extension);
  trainer = new SqliteVectorTraining(db, extension);
  e.transact(() => { for (let i = 0; i < 512; i++) e.create('Row', { title: String(i) }); });
  const pending = e.pendingEmbeddings('Row', { limit: 1000 }); assert.equal(pending.chunks.length, 512);
  e.embed(pending.chunks.map((chunk, i) => ({ ...chunk, model: pending.model,
    vector: Array.from({ length: 128 }, (_, j) => Math.sin((i + 1) * (j + 1) * 1.71)) })));
  const job = db.indexBuilds.jobs().find(job => job.kind === 'vector'); assert(job);
  const canonical = () => sha(Buffer.concat(db.all('SELECT embedding FROM embedding_values ORDER BY id').map(row => row.embedding)));
  const before = canonical(), sequence = db.sequence;
  let expectedSequence = sequence, expectedRows = 512;
  // Place the selected canonical page in the main file rather than a WAL frame. This is
  // fixture setup, outside the injected interval; the worker still owns a fresh read handle.
  const checkpoint = db.get('PRAGMA wal_checkpoint(TRUNCATE)');
  assert.equal(checkpoint.busy, 0); assert.equal(checkpoint.log, 0);
  report.fixtureCheckpoint = checkpoint;
  const targetOffset = phase === 'header' || allocation ? 0 :
    (Number(db.get("SELECT rootpage FROM sqlite_schema WHERE name='embedding_values' AND type='table'").rootpage) - 1)
      * Number(db.get('PRAGMA page_size').page_size);
  assert(Number.isSafeInteger(targetOffset) && (phase === 'header' || allocation ? targetOffset === 0 : targetOffset >= 4096));
  if (!allocation) report.targetOffset = targetOffset;
  if (allocation) {
    // The ordinary unstripped library supplies its actual function bounds; do not patch/rebuild it.
    const symbols = execFileSync('nm', ['-S', '--defined-only', extension], { encoding: 'utf8' });
    const matches = [...symbols.matchAll(/^([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+[tT]\s+vec1TrainFinal$/gm)];
    assert.equal(matches.length, 1, 'The native aggregate must have one identified function range');
    const begin = BigInt('0x' + matches[0][1]), end = begin + BigInt('0x' + matches[0][2]);
    assert(begin > 0n && end > begin && end < BigInt(Number.MAX_SAFE_INTEGER));
    report.functionRange = { begin: Number(begin), end: Number(end), symbolsSha256: sha(Buffer.from(symbols)) };
    process.env.EARS_WORKER_ALLOC_BEGIN = begin.toString(16); process.env.EARS_WORKER_ALLOC_END = end.toString(16);
    process.env.EARS_WORKER_ALLOC_EXTENSION = extension;
    process.env.EARS_WORKER_ALLOC_RELEASE = releaseAllocation;
    process.env.EARS_WORKER_ALLOC_ARM = arm; process.env.EARS_WORKER_ALLOC_EVENT = event;
  } else {
    process.env.EARS_WORKER_READ_OFFSET = String(targetOffset);
    process.env.EARS_WORKER_READ_FILE = resolve(store, 'data.sqlite3');
    process.env.EARS_WORKER_READ_ARM = arm; process.env.EARS_WORKER_READ_EVENT = event;
  }
  writeFileSync(arm, 'owned worker fault', { flag: 'wx' });
  if (allocation) {
    report.canonicalBeforeSha256 = before;
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  let refused;
  let trainingSettled = false;
  const training = trainer.train(job).then(() => { trainingSettled = true; }, error => {
    refused = error; trainingSettled = true;
  });
  if (allocation) {
    try {
      const deadline = performance.now() + 5000;
      while (!existsSync(event + '.ready')) {
        assert(!trainingSettled, 'Worker completed without the selected native allocation barrier');
        assert(performance.now() < deadline, 'Native allocation barrier must become observable');
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert(!trainingSettled, 'The real worker must remain held before the foreground write');
      report.allocation = JSON.parse(readFileSync(event, 'utf8'));
      e.create('Row', { title: 'foreground while native allocation is held' });
      expectedSequence++; expectedRows++;
      assert.equal(db.sequence, expectedSequence); assert.equal(canonical(), before);
      const walBytes = statSync(join(store, 'data.sqlite3-wal')).size;
      assert(walBytes > 0);
      const pinned = db.get('PRAGMA wal_checkpoint(TRUNCATE)');
      assert.equal(pinned.busy, 1, 'The held real worker snapshot must block populated WAL reclamation');
      report.readerHeldBeforeRefusal = { walBytes, checkpoint: pinned };
      report.commits = { before: sequence, afterForeground: db.sequence };
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    } finally { writeFileSync(releaseAllocation, 'release native allocation', { flag: 'wx' }); }
  }
  await training;
  // Retain diagnostics before assertions: even a refusal with an unexpected code must keep its witness.
  if (refused) report.error = { code: refused.code, message: refused.message };
  if (existsSync(event)) report[allocation ? 'allocation' : 'syscall'] = JSON.parse(readFileSync(event, 'utf8'));
  if (allocation) {
    assert(refused, 'The selected real native allocation must fail');
    const witness = report.allocation;
    assert(witness && witness.allocator === 'malloc' && witness.mainThread === false);
    assert.equal(witness.extensionMatched, true); assert.equal(witness.functionMatched, true);
    assert.equal(witness.functionBegin, report.functionRange.begin); assert.equal(witness.functionEnd, report.functionRange.end);
    assert(witness.functionOffset >= witness.functionBegin && witness.functionOffset < witness.functionEnd);
    assert.equal(witness.errno, 12); assert.equal(witness.modelBytes, 24 + 4 * 64 * 128);
    assert(witness.requestedBytes >= witness.modelBytes && witness.requestedBytes <= witness.modelBytes + 64);
    assert.equal(refused.code, 'SQLITE_NOMEM');
  } else {
    assert(refused, 'A real armed worker read must fail');
    assert(report.syscall, 'The owned non-main-thread database pread must actually receive EIO');
    assert.equal(report.syscall.targetMatched, true); assert.equal(report.syscall.mainThread, false);
    assert.equal(report.syscall.errno, 5); assert(report.syscall.requestedBytes > 0);
    assert.equal(report.syscall.targetOffset, targetOffset);
    assert(report.syscall.offset <= targetOffset && targetOffset < report.syscall.offset + report.syscall.requestedBytes);
    if (phase === 'embedding-page') {
      assert(report.syscall.successfulMatchedReads > 0, 'Worker must open/read the database before reaching the canonical embedding table');
      assert(report.syscall.offset > 0, 'Embedding-page fault must be beyond the database header');
    }
    // The pinned runtime preserves the VFS code on the header read, but page-query processing
    // surfaces CORRUPT. Require the observed phase-specific code, never an arbitrary refusal.
    assert.equal(refused.code, phase === 'header' ? 'SQLITE_IOERR_CORRUPTFS' : 'SQLITE_CORRUPT');
  }
  await trainer.stop();
  if (allocation) {
    const released = db.get('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.deepEqual(released, { busy: 0, log: 0, checkpointed: 0 });
    assert.equal(statSync(join(store, 'data.sqlite3-wal')).size, 0);
    report.readerReleasedAfterRefusal = { checkpoint: released, walBytes: 0 };
    report.failedWorkerReaderReleased = true; report.commits.afterFailure = db.sequence;
  }
  assert.equal(db.sequence, expectedSequence); assert.equal(canonical(), before);
  assert.equal(e.query('Row').count(), expectedRows);
  assert.equal(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*'"), undefined);
  report.refusedWithoutPublication = true;
  unlinkSync(arm);
  const trained = await trainer.train(job);
  if (allocation) assert.equal(trained.model.byteLength, report.allocation.modelBytes);
  assert.equal(trained.samples, 512); assert.equal(trained.modelSha256, sha(trained.model));
  assert.equal(db.sequence, expectedSequence); assert.equal(canonical(), before);
  if (allocation) report.commits.afterRetry = db.sequence;
  report.retry = { samples: trained.samples, modelSha256: trained.modelSha256, workerSha256: trained.workerSha256 };
  e.create('Row', { title: 'foreground remains writable' }); assert.equal(e.query('Row').count(), expectedRows + 1);
  if (allocation) {
    assert.equal(db.sequence, expectedSequence + 1); report.commits.afterReuse = db.sequence;
  }
  report.foregroundReusable = true; report.canonicalSha256 = before;
  report.compiledInputs = Object.fromEntries(['sqlite/database.js', 'sqlite/vector-training.js'].map(name =>
    [name, sha(readFileSync(new URL('../../dist/' + name, import.meta.url)))]));
  report.nativeBindings = loadedNativeBindings([extension]);
} catch (error) { failure = error; }
finally {
  for (const cleanup of [
    () => { if (existsSync(arm)) unlinkSync(arm); },
    () => { if (allocation && !existsSync(releaseAllocation)) writeFileSync(releaseAllocation, 'cleanup release', { flag: 'wx' }); },
    () => trainer?.stop(),
    () => db?.close(),
    () => { rmSync(directory, { recursive: true }); report.scratchRemoved = !existsSync(directory); },
  ]) {
    try { await cleanup(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Probe and cleanup failed') : error; }
  }
  for (const name of ['EARS_WORKER_READ_FILE', 'EARS_WORKER_READ_ARM', 'EARS_WORKER_READ_EVENT', 'EARS_WORKER_READ_OFFSET']) delete process.env[name];
  for (const name of ['EARS_WORKER_ALLOC_BEGIN', 'EARS_WORKER_ALLOC_END', 'EARS_WORKER_ALLOC_EXTENSION', 'EARS_WORKER_ALLOC_RELEASE', 'EARS_WORKER_ALLOC_ARM', 'EARS_WORKER_ALLOC_EVENT']) delete process.env[name];
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: allocation ? 'w' : 'wx' });
}
if (failure) throw failure;
