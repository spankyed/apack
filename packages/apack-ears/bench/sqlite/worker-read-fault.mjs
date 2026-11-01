// Disposable Linux native-worker read-error/retry witness; never a production fault hook.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createEarsEngine } from '../../dist/index.js';
import { toElmdbSchema } from '../../dist/schema.js';
import { SqliteDatabase } from '../../dist/sqlite/database.js';
import { SqliteVectorIndex } from '../../dist/sqlite/vector-index.js';
import { SqliteVectorTraining } from '../../dist/sqlite/vector-training.js';
import { loadedNativeBindings } from './load-metrics.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const [output, ...extra] = process.argv.slice(2); assert(output && !existsSync(output) && !extra.length);
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
const preload = process.env.LD_PRELOAD; assert(preload && preload.endsWith('/worker-read-fault.so'));
const extension = process.env.EARS_VEC1_EXTENSION; assert(extension && existsSync(extension));
const directory = mkdtempSync(join(tmpdir(), 'ears-worker-read-fault-')), store = join(directory, 'store');
const arm = join(directory, 'armed'), event = join(directory, 'event.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { protocol: 'ears-worker-read-fault/1', source: process.env.GITHUB_SHA,
  completed: false, qualification: false, execution: 'built-package', node: process.version,
  scope: 'One injected native worker database read error and retry; not mid-training phase attribution, device faults, physical power loss or all worker/resource regimes',
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
  process.env.EARS_WORKER_READ_FILE = resolve(store, 'data.sqlite3');
  process.env.EARS_WORKER_READ_ARM = arm; process.env.EARS_WORKER_READ_EVENT = event;
  writeFileSync(arm, 'owned worker read fault', { flag: 'wx' });
  let refused;
  try { await trainer.train(job); } catch (error) { refused = error; }
  assert(refused, 'A real armed worker read must fail'); assert.match(refused.code ?? '', /^SQLITE_IOERR(?:_READ)?$/);
  report.error = { code: refused.code, message: refused.message };
  report.syscall = JSON.parse(readFileSync(event, 'utf8'));
  assert.equal(report.syscall.targetMatched, true); assert.equal(report.syscall.mainThread, false);
  assert.equal(report.syscall.errno, 5); assert(report.syscall.requestedBytes > 0);
  await trainer.stop();
  assert.equal(db.sequence, sequence); assert.equal(canonical(), before);
  assert.equal(e.query('Row').count(), 512);
  assert.equal(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*'"), undefined);
  report.refusedWithoutPublication = true;
  unlinkSync(arm);
  const trained = await trainer.train(job);
  assert.equal(trained.samples, 512); assert.equal(trained.modelSha256, sha(trained.model));
  assert.equal(db.sequence, sequence); assert.equal(canonical(), before);
  report.retry = { samples: trained.samples, modelSha256: trained.modelSha256, workerSha256: trained.workerSha256 };
  e.create('Row', { title: 'foreground remains writable' }); assert.equal(e.query('Row').count(), 513);
  report.foregroundReusable = true; report.canonicalSha256 = before;
  report.compiledInputs = Object.fromEntries(['sqlite/database.js', 'sqlite/vector-training.js'].map(name =>
    [name, sha(readFileSync(new URL('../../dist/' + name, import.meta.url)))]));
  report.nativeBindings = loadedNativeBindings([extension]);
} catch (error) { failure = error; }
finally {
  for (const cleanup of [
    () => { if (existsSync(arm)) unlinkSync(arm); },
    () => trainer?.stop(),
    () => db?.close(),
    () => { rmSync(directory, { recursive: true }); report.scratchRemoved = !existsSync(directory); },
  ]) {
    try { await cleanup(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Probe and cleanup failed') : error; }
  }
  for (const name of ['EARS_WORKER_READ_FILE', 'EARS_WORKER_READ_ARM', 'EARS_WORKER_READ_EVENT']) delete process.env[name];
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failure) throw failure;
