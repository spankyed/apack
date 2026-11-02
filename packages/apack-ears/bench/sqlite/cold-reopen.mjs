// Actual built-package reopen/first-read diagnostic; each invocation owns one closed fixture copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { createEarsEngine } from '../../dist/index.js';
import { loadedNativeBindings } from './load-metrics.ts';

const [phase, backend, directory, output, ...extra] = process.argv.slice(2);
assert(['seed', 'read'].includes(phase) && ['elmdb', 'sqlite'].includes(backend));
assert(directory && output && !extra.length && !existsSync(output));
assert.equal(process.platform, 'linux');
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
const { openDatabase } = await import(backend === 'sqlite' ? '../../dist/sqlite/index.js' : '../../dist/lmdb/index.js');
const schema = { types: { Row: { required: [], indexes: ['group', 'rank'] } }, relations: {}, roles: [] };
const report = { protocol: 'ears-cold-reopen/1', source: process.env.GITHUB_SHA, backend, phase,
  completed: false, qualification: false, execution: 'built-package', n: 10000,
  scope: 'Fresh-process copied-store reopen followed by first field/page/ordered reads; only owned database file pages are controlled, not application/code/device caches',
  node: process.version, cpuModels: [...new Set(cpus().map(cpu => cpu.model))], timesMs: {} };
let database, failure;
try {
  let start = performance.now();
  database = openDatabase({ path: resolve(directory), ...(phase === 'seed' ? { schema, syncs: true } : { readOnly: true }) });
  report.timesMs.open = performance.now() - start;
  start = performance.now();
  const e = createEarsEngine({ database });
  report.timesMs.engine = performance.now() - start;
  if (phase === 'seed') {
    let random = 0x71829;
    const body = () => Array.from({ length: 2048 }, () => {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      return String.fromCharCode(32 + (random >>> 0) % 95);
    }).join('');
    e.transact(() => {
      for (let i = 0; i < report.n; i++) e.create('Row', { id: `Row-${i}`, title: `title-${i}`,
        rank: i, group: `group-${i % 100}`, body: body() });
    }, { durable: true });
    await database.indexesReady();
    await database.durable();
  } else {
    start = performance.now();
    const title = e.getAttr('Row-7919', 'title');
    report.timesMs.firstField = performance.now() - start;
    assert.equal(title, 'title-7919');
    start = performance.now();
    const page = e.query('Row').where('group', 'group-7').orderBy('rank').limit(50).pick(['title', 'rank']);
    report.timesMs.page50 = performance.now() - start;
    assert.equal(page.length, 50);
    assert.deepEqual(page.map(row => row.rank), Array.from({ length: 50 }, (_, i) => 7 + i * 100));
    start = performance.now();
    const ordered = e.query('Row').orderBy('rank').limit(50).pick(['title', 'rank']);
    report.timesMs.ordered50 = performance.now() - start;
    assert.deepEqual(ordered.map(row => row.rank), Array.from({ length: 50 }, (_, i) => i));
    assert.equal(e.query('Row').count(), report.n);
    report.consumed = true;
  }
  report.memory = process.memoryUsage(); report.usage = process.resourceUsage();
  const extensions = backend === 'sqlite' ? [database.nativeVectorExtension] : [];
  if (backend === 'sqlite') assert.equal(typeof extensions[0], 'string');
  report.nativeBindings = loadedNativeBindings(extensions); assert(report.nativeBindings.length > 0);
  for (const extension of extensions) assert(report.nativeBindings.some(binding => binding.path === extension));
  if (backend === 'elmdb') assert(report.nativeBindings.some(binding => binding.path.includes('/elmdb.')));
  report.runtimeSha256 = Object.fromEntries(['index.js', `${backend === 'sqlite' ? 'sqlite' : 'lmdb'}/index.js`].map(name =>
    [name, createHash('sha256').update(readFileSync(new URL('../../dist/' + name, import.meta.url))).digest('hex')]));
} catch (error) { failure = error; }
finally {
  try { database?.close(); } catch (error) { failure = failure ? new AggregateError([failure, error], 'Diagnostic and close failed') : error; }
  report.completed = !failure;
  if (failure) report.failure = { name: failure.name, message: failure.message, code: failure.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failure) throw failure;
