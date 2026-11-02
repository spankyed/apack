// Observe real history-open policy after one descriptor/page-matched EIO; no production fault hook.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openRunHistory, databaseStorage } from '@apackdev/host/database';
import { loadedNativeBindings } from './load-metrics.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
// The private host has no dist build; its real source must exercise the matching built storage/SDK.
for (const entry of ['@apackdev/ears', '@apackdev/ears/sqlite', '@apackdev/sdk/services']) {
  assert.match(import.meta.resolve(entry), /\/dist\//, `${entry} must use its built package`);
}
const [output, ...extra] = process.argv.slice(2); assert(output && !existsSync(output) && !extra.length);
assert(process.env.LD_PRELOAD?.endsWith('/worker-read-fault.so'));
const directory = mkdtempSync(join(tmpdir(), 'ears-history-read-fault-')), store = join(directory, 'history');
const arm = join(directory, 'armed'), event = join(directory, 'event.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const storage = databaseStorage('sqlite/1'), originalOpen = storage.open;
const report = { protocol: 'ears-history-read-fault/2', source: process.env.GITHUB_SHA,
  completed: false, qualification: false, execution: 'host-source-with-built-ears-and-sdk-packages',
  scope: 'One main-thread metadata-page EIO during actual host history open; observes recovery policy, not all corruption/I/O or physical storage regimes',
  openErrors: [] };
let history, inspected, failure;
try {
  history = openRunHistory(store, { storageFormat: 'sqlite/1' });
  history.engine.create('RunNode', { id: 'RunNode-fixture', kind: 'flow', label: 'retained fixture',
    status: 'completed', startedAt: 1700000000000, rootId: 'RunNode-fixture' });
  assert.equal(history.engine.query('RunNode').count(), 1);
  const db = history.database;
  const page = Number(db.get("SELECT rootpage FROM sqlite_schema WHERE type='table' AND name='meta'").rootpage);
  const targetOffset = (page - 1) * Number(db.get('PRAGMA page_size').page_size);
  assert(Number.isSafeInteger(targetOffset) && targetOffset > 0);
  history.database.close(); history = undefined;
  const file = join(store, 'data.sqlite3'), before = sha(readFileSync(file));
  report.targetOffset = targetOffset; report.beforeSha256 = before;
  process.env.EARS_WORKER_READ_FILE = resolve(file); process.env.EARS_WORKER_READ_ARM = arm;
  process.env.EARS_WORKER_READ_EVENT = event; process.env.EARS_WORKER_READ_OFFSET = String(targetOffset);
  process.env.EARS_WORKER_READ_THREAD = 'main';
  // Observe actual native errors without manufacturing or replacing the error sent to the host.
  storage.open = function(options) {
    try { return originalOpen.call(this, options); }
    catch (error) { report.openErrors.push({ code: error.code, message: error.message }); throw error; }
  };
  writeFileSync(arm, 'owned history read fault', { flag: 'wx' });
  try { history = openRunHistory(store, { storageFormat: 'sqlite/1' }); }
  catch (error) { report.refusal = { code: error.code, message: error.message }; }
  finally { storage.open = originalOpen; }
  if (existsSync(event)) report.syscall = JSON.parse(readFileSync(event, 'utf8'));
  unlinkSync(arm);
  assert(report.syscall, 'The real host metadata read must receive the injected EIO');
  assert.equal(report.syscall.mainThread, true); assert.equal(report.syscall.targetMatched, true);
  assert.equal(report.syscall.errno, 5); assert.equal(report.syscall.targetOffset, targetOffset);
  assert(report.syscall.successfulMatchedReads > 0);
  const asides = readdirSync(directory).filter(name => name.startsWith('history.unreadable-'));
  assert(asides.length <= 1);
  report.quarantinedCount = asides.length;
  report.outcome = asides.length ? 'quarantined' : history ? 'opened-incumbent' : 'refused';
  if (history) { report.returnedRows = history.engine.query('RunNode').count(); history.database.close(); history = undefined; }
  const incumbent = asides.length ? join(directory, asides[0]) : store;
  report.incumbentBytesUnchanged = sha(readFileSync(join(incumbent, 'data.sqlite3'))) === before;
  inspected = openRunHistory(incumbent, { storageFormat: 'sqlite/1', readOnly: true });
  assert.equal(inspected.engine.query('RunNode').count(), 1);
  report.incumbentReadableAfterDisarm = true;
  report.policyConcern = report.outcome === 'quarantined';
  report.policyScope = 'A real metadata-page EIO must refuse the open without quarantine or replacement, preserving the incumbent';
  assert.equal(report.outcome, 'refused');
  assert.equal(report.refusal?.code, 'SQLITE_CORRUPT');
  assert.equal(report.quarantinedCount, 0);
  assert.equal(report.incumbentBytesUnchanged, true);
  assert.equal(report.incumbentReadableAfterDisarm, true);
  assert.equal(report.policyConcern, false);
  report.nativeBindings = loadedNativeBindings();
} catch (error) { failure = error; }
finally {
  storage.open = originalOpen;
  for (const cleanup of [
    () => { if (existsSync(arm)) unlinkSync(arm); },
    () => history?.database.close(), () => inspected?.database.close(),
    () => { rmSync(directory, { recursive: true }); report.scratchRemoved = !existsSync(directory); },
  ]) {
    try { await cleanup(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Diagnostic and cleanup failed') : error; }
  }
  for (const name of ['EARS_WORKER_READ_FILE','EARS_WORKER_READ_ARM','EARS_WORKER_READ_EVENT','EARS_WORKER_READ_OFFSET','EARS_WORKER_READ_THREAD']) delete process.env[name];
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failure) throw failure;
