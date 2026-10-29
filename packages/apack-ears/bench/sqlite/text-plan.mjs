// Diagnostic only: actual facade SQL plans and binding time; not latency qualification.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { loadedNativeBindings } from './load-metrics.ts';
const output = process.argv[2];
assert(process.platform === 'linux' && output && !existsSync(output));
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const entries = Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)]));
assert(Object.values(entries).every(path => path.includes('/dist/')));
const root = mkdtempSync(join(tmpdir(), 'ears-text-plan-')), n = 10000;
const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
let db;
try {
  db = openDatabase({ path: root, schema, syncs: false });
  const e = createEarsEngine({ database: db });
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', { id: `Row-${i}`, name: `openDatabaseStore ticket${i} group${i % 100}`,
      body: 'backup ready ' + (i % 128 === 0 ? 'large body '.repeat(1500) : 'body '.repeat(100)), tags: ['engineering', 'storage', 'ops'] });
  });
  e.admin.setSchema({ ...schema, types: { Row: { required: [], search: { fields: { name: 3, body: 1, tags: 1 } } } } });
  await db.indexesReady();
  let current;
  const queries = new Map(), samples = [];
  for (const method of ['all', 'get', 'run']) {
    const original = db[method].bind(db);
    db[method] = (sql, parameters = []) => {
      const start = performance.now(), result = original(sql, parameters), ms = performance.now() - start;
      if (current) {
        const key = JSON.stringify([method, sql, parameters]);
        if (!queries.has(key)) queries.set(key, { id: queries.size, method, sql, parameters });
        current.bindings.push({ query: queries.get(key).id, ms, rows: method === 'all' ? result.length : method === 'get' ? Number(result !== undefined) : undefined });
      }
      return result;
    };
  }
  const now = Date.now();
  for (const [name, query, extra] of [['point', 'ticket42'], ['crossField', 'ticket42 ready'], ['medium', 'group7 ready'],
    ['broad', 'storage'], ['highlights', 'storage'], ['recency', 'storage', { recency: { field: 'createdAt', halfLife: 3600000, now } }], ['unlimited', 'storage']]) {
    for (let ordinal = 0; ordinal < 10; ordinal++) {
      await new Promise(resolve => setImmediate(resolve));
      current = { name, ordinal, bindings: [] };
      const start = performance.now(), builder = e.query('Row').search(query, { fuzzy: false, ...extra });
      const answer = name === 'highlights' ? builder.limit(10).hits({ fields: ['name'], highlights: true }) : (name === 'unlimited' ? builder : builder.limit(10)).ids();
      current.totalMs = performance.now() - start;
      current.bindingMs = current.bindings.reduce((sum, binding) => sum + binding.ms, 0);
      current.remainderMs = current.totalMs - current.bindingMs;
      const ids = name === 'highlights' ? answer.map(hit => hit.id) : answer;
      if (name === 'point' || name === 'crossField') assert.deepEqual(ids, ['Row-42']);
      else if (name === 'medium') assert.deepEqual(ids, Array.from({ length: 10 }, (_, i) => `Row-${7 + i * 100}`));
      else { assert.equal(ids.length, name === 'unlimited' ? n : 10); assert.equal(new Set(ids).size, ids.length); }
      if (name === 'highlights') for (const hit of answer) assert.deepEqual(hit.highlights.tags, [[1, 0, 7]]);
      samples.push(current); current = undefined;
    }
  }
  const plans = [...queries.values()].map(query => ({ ...query, plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.parameters) }));
  writeFileSync(output, JSON.stringify({ qualification: false, n, node: process.version, sqlite: db.get('SELECT sqlite_version() version').version,
    entries, constraints, nativeBindings: loadedNativeBindings(), samples, queries: plans }));
} finally { db?.close(); rmSync(root, { recursive: true, force: true }); }
