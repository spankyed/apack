// Diagnostic: matched fresh 10k profiles, normal built entries, OFF commits. No production qualification claim.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';
const output = process.argv[2];
assert(process.platform === 'linux' && output && !existsSync(output));
const entries = Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)]));
assert(Object.values(entries).every(path => path.includes('/dist/')));
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const root = mkdtempSync(join(tmpdir(), 'ears-text-shape-')), n = 10000;
const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
let db, heartbeat, monitor;
const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
const total = values => Object.values(values).reduce((sum, value) => sum + value, 0);
const summarize = values => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) }; };
try {
  db = openDatabase({ path: root, schema, syncs: false });
  const e = createEarsEngine({ database: db }), start = performance.now();
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', { id: `Row-${i}`, name: `openDatabaseStore ticket${i} group${i % 100}`,
      body: 'backup ready ' + (i % 128 === 0 ? 'large body '.repeat(1500) : 'body '.repeat(100)), tags: ['engineering', 'storage', 'ops'] });
  });
  const seedMs = performance.now() - start, before = files(), peak = { filesBytes: total(before), walBytes: 0, rss: process.memoryUsage().rss };
  const memory = [];
  let phase = 'build'; const beats = [];
  heartbeat = startHeartbeat(8, (at, delayMs) => beats.push({ phase, at, delayMs }));
  const sample = () => { const current = files(), rss = process.memoryUsage().rss; peak.filesBytes = Math.max(peak.filesBytes, total(current)); peak.walBytes = Math.max(peak.walBytes, current['data.sqlite3-wal'] ?? 0); peak.rss = Math.max(peak.rss, rss); memory.push({ at: performance.now(), phase, rss }); };
  monitor = setInterval(sample, 20);
  const admitStart = performance.now();
  e.admin.setSchema({ ...schema, types: { Row: { required: [], search: { fields: { name: 3, body: 1, tags: 1 } } } } });
  const admissionMs = performance.now() - admitStart;
  await db.indexesReady(); const buildMs = performance.now() - admitStart; sample();
  const afterBuild = files(), sqlCalls = { all: 0, get: 0, run: 0 }, originals = {};
  for (const key of Object.keys(sqlCalls)) { originals[key] = db[key].bind(db); db[key] = (...args) => { sqlCalls[key]++; return originals[key](...args); }; }
  const samples = { point: [], crossField: [], crossFieldReverse: [], medium: [], mediumReverse: [], negative: [], negativeReverse: [], disjunction: [], broad: [], highlights: [], recency: [], recencyHighlights: [], update: [] }, counts = {};
  const recencyNow = Date.now();
  for (const [name, query, expected, extra] of [['point', 'ticket42', ['Row-42']], ['crossField', 'ticket42 ready', ['Row-42']], ['crossFieldReverse', 'ready ticket42', ['Row-42']], ['medium', 'group7 ready', Array.from({ length: 10 }, (_, i) => `Row-${7 + i * 100}`)], ['mediumReverse', 'ready group7', Array.from({ length: 10 }, (_, i) => `Row-${7 + i * 100}`)], ['negative', 'ticket42 -storage', []], ['negativeReverse', '-storage ticket42', []], ['disjunction', 'ticket42 OR ticket43', ['Row-42', 'Row-43']], ['broad', 'storage', null], ['highlights', 'storage', null], ['recency', 'storage', null, { recency: { field: 'createdAt', halfLife: 3600000, now: recencyNow } }], ['recencyHighlights', 'storage', null, { recency: { field: 'createdAt', halfLife: 3600000, now: recencyNow } }]]) {
    phase = name; const callsBefore = { ...sqlCalls };
    const limit = ['broad', 'highlights', 'recency', 'recencyHighlights'].includes(name) ? 50 : 250;
    const highlighted = name === 'highlights' || name === 'recencyHighlights';
    for (let i = 0; i < limit; i++) {
      await new Promise(resolve => setImmediate(resolve));
      const at = performance.now(), builder = e.query('Row').search(query, { fuzzy: false, ...extra }).limit(10);
      const answer = highlighted ? builder.hits({ fields: ['name'], highlights: true }) : builder.ids();
      samples[name].push(performance.now() - at);
      const ids = highlighted ? answer.map(hit => hit.id) : answer;
      if (expected) assert.deepEqual(ids, expected); else { assert.equal(ids.length, 10); assert.equal(new Set(ids).size, 10); assert(ids.every(id => /^Row-\d+$/.test(id) && Number(id.slice(4)) < n)); }
      if (highlighted) for (const hit of answer) {
        const i = Number(hit.id.slice(4));
        assert.deepEqual(hit.highlights.tags, [[1, 0, 7]]);
        assert.equal(hit.row.name, `openDatabaseStore ticket${i} group${i % 100}`);
      }
    }
    counts[name] = Object.fromEntries(Object.keys(sqlCalls).map(key => [key, sqlCalls[key] - callsBefore[key]]));
  }
  phase = 'update'; const callsBefore = { ...sqlCalls };
  for (let i = 0; i < 1000; i++) {
    await new Promise(resolve => setImmediate(resolve));
    const id = `Row-${n - 1 - i % 50}`, at = performance.now();
    e.write(id).set('name', `renderCanvas changed${i}`); samples.update.push(performance.now() - at);
    assert.equal(e.getAttr(id, 'name'), `renderCanvas changed${i}`);
  }
  counts.update = Object.fromEntries(Object.keys(sqlCalls).map(key => [key, sqlCalls[key] - callsBefore[key]]));
  phase = 'end'; await new Promise(resolve => setTimeout(resolve, 16)); sample(); heartbeat.stop(); heartbeat = undefined;
  clearInterval(monitor); monitor = undefined;
  const report = { qualification: false, cohort: '10k source-string FTS shape, fresh profile, no discarded samples', n, node: process.version, entries, constraints,
    sqlite: db.get('SELECT sqlite_version() version').version, nativeBindings: loadedNativeBindings(), seedMs, admissionMs, buildMs,
    files: { before, afterBuild, afterUpdates: files(), peak }, samples, summaries: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])),
    bindingCalls: counts, heartbeats: beats, memory, memoryAtEnd: process.memoryUsage(), resourceUsage: process.resourceUsage() };
  writeFileSync(output, JSON.stringify(report));
} finally { if (monitor) clearInterval(monitor); heartbeat?.stop(); db?.close(); rmSync(root, { recursive: true, force: true }); }
