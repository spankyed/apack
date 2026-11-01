// Diagnostic only: fixed work, no application data, watches, indexing or qualification-budget changes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { loadedNativeBindings } from './load-metrics.ts';

const output = process.argv[2];
assert(process.platform === 'linux' && output && !existsSync(output) && !existsSync(output + '.cpuprofile'), 'Name a new Linux diagnostic report');
const entries = Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)]));
assert(Object.values(entries).every(file => file.includes('/dist/')), 'Use normal built package entries');
const cgroup = file => readFileSync('/sys/fs/cgroup/' + file, 'utf8').trim();
const counters = () => Object.fromEntries(cgroup('cpu.stat').split('\n').map(line => {
  const [key, value] = line.trim().split(/\s+/); return [key, Number(value)];
}));
const difference = (after, before) => Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before[key] ?? 0)]));
const constraints = { cpuMax: cgroup('cpu.max'), memoryMax: cgroup('memory.max'), cpuset: cgroup('cpuset.cpus.effective'),
  allowed: readFileSync('/proc/self/status', 'utf8').split('\n').find(line => line.startsWith('Cpus_allowed_list:')),
  availableParallelism: availableParallelism() };
assert(constraints.cpuMax === '200000 100000', 'Keep the existing two-CPU quota and period');
assert(constraints.memoryMax === String(6 * 1024 ** 3), 'Keep the existing 6 GiB limit');
const root = mkdtempSync(join(tmpdir(), 'ears-runtime-control-'));
const gc = [], observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) gc.push({ start: entry.startTime, duration: entry.duration, detail: entry.detail });
});
const inspector = new Session(); let db;
try {
  const schema = { types: { Row: { required: ['slug'], fields: { slug: { type: 'string' },
    counter: { type: 'number', optional: true }, payload: { type: 'string' } } } }, relations: {}, roles: [] };
  db = openDatabase({ path: root, schema, syncs: false });
  const e = createEarsEngine({ database: db }), n = 100000, needle = 'bucket-7-value';
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', { id: `Row-${i}`,
      slug: `bucket-${i % 100}-value`, payload: i % 128 === 0 ? 'large body '.repeat(1500) : 'body '.repeat(100) });
  }, { durable: false });
  const expected = Array.from({ length: 10 }, (_, i) => `Row-${7 + i * 100}`), traced = [];
  const all = db.all.bind(db), get = db.get.bind(db);
  db.all = (sql, parameters = []) => { const rows = all(sql, parameters); traced.push({ sql, parameters, plan: all('EXPLAIN QUERY PLAN ' + sql, parameters) }); return rows; };
  db.get = (sql, parameters = []) => { const row = get(sql, parameters); traced.push({ sql, parameters, plan: all('EXPLAIN QUERY PLAN ' + sql, parameters) }); return row; };
  assert.deepEqual(e.query('Row').where('slug', needle).limit(10).ids(), expected);
  db.all = all; db.get = get;
  const selection = traced.filter(statement => statement.sql.includes('ORDER BY') && statement.sql.includes('FROM entities')).at(-1);
  assert(selection, 'Capture the actual terminal SELECT');
  let checksum = 0;
  const modes = {
    cpu: () => { let value = checksum; for (let i = 0; i < 3000000; i++) value = (Math.imul(value ^ i, 1664525) + 1013904223) | 0; checksum = value; return expected; },
    facade: () => e.query('Row').where('slug', needle).limit(10).ids(),
    sql: () => all(selection.sql, selection.parameters).map(row => row.id),
  };
  observer.observe({ entryTypes: ['gc'] });
  inspector.connect(); await inspector.post('Profiler.enable'); await inspector.post('Profiler.start');
  const samples = [], ordinals = { cpu: 0, facade: 0, sql: 0 }, before = counters(), started = performance.now();
  // Same fixed work and forward/reverse blocks as the previous sentinel. No warm-up sample is discarded.
  for (let block = 0; block < 20; block++) for (const mode of block % 2 ? ['sql', 'cpu', 'facade'] : ['facade', 'cpu', 'sql']) {
    for (let i = 0; i < 25; i++) {
      const statStart = performance.now(), prior = counters(), cpu = process.cpuUsage(), start = performance.now();
      const rows = modes[mode]();
      const end = performance.now(), used = process.cpuUsage(cpu), after = counters(), statEnd = performance.now();
      assert.deepEqual(rows, expected);
      samples.push({ mode, block, ordinal: ordinals[mode]++, start, end, ms: end - start, statStart, statEnd,
        cpuMicros: used.user + used.system, cgroupDelta: difference(after, prior) });
    }
  }
  const ended = performance.now(), after = counters(), { profile } = await inspector.post('Profiler.stop');
  await new Promise(resolve => setImmediate(resolve));
  writeFileSync(output + '.cpuprofile', JSON.stringify(profile));
  writeFileSync(output, JSON.stringify({ scope: 'runtime/quota diagnostic, not admission acceptance or cold-disk qualification',
    seedRows: n, node: process.version, v8: process.versions.v8, execArgv: process.execArgv, entries, sqlite: get('SELECT sqlite_version() version').version, constraints,
    window: { started, ended, cpuBefore: before, cpuAfter: after, cgroupDelta: difference(after, before) },
    coldBoundary: 150, checksum, samples, gc, traced, nativeBindings: loadedNativeBindings(),
    memory: process.memoryUsage(), resourceUsage: process.resourceUsage() }));
} finally {
  observer.disconnect(); inspector.disconnect(); db?.close(); rmSync(root, { recursive: true, force: true });
}
