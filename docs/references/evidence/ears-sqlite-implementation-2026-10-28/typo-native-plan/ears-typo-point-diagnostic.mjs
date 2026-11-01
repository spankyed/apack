// Diagnostic only: first-invocation and warm query costs; OS/storage caches are not made cold.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';
const output = process.argv[2];
assert(process.platform === 'linux' && output && !existsSync(output));
const entries = Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)]));
assert(Object.values(entries).every(path => path.includes('/dist/')));
const runtimeHashes = Object.fromEntries([...Object.values(entries), new URL('./text.js', entries['@apackdev/ears/sqlite']).href]
  .map(path => [path, createHash('sha256').update(readFileSync(new URL(path))).digest('hex')]));
const constraints = { cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() };
assert.equal(constraints.cpuMax, '200000 100000'); assert.equal(constraints.memoryMax, String(6 * 1024 ** 3));
const report = { qualification: false, source: process.env.EARS_COST_SOURCE, node: process.version, entries, runtimeHashes, constraints,
  protocol: '1k/10k/100k unique terms; first invocation + 12 warm calls per path; OFF; no discarded samples', profiles: [] };
const summary = samples => { const sorted = [...samples].sort((a, b) => a - b); return { count: sorted.length,
  p50: sorted[Math.floor(sorted.length * .5)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) }; };
try {
  for (const n of [10000]) {
    const root = mkdtempSync(join(tmpdir(), 'ears-typo-cost-')), profile = { n, queries: {}, heartbeats: [] };
    report.profiles.push(profile);
    let db, heartbeat;
    const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
    try {
      const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
      db = openDatabase({ path: root, schema, syncs: false });
      const e = createEarsEngine({ database: db }), start = performance.now();
      for (let offset = 0; offset < n; offset += 256) e.transact(() => {
        for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', { id: `Row-${i}`,
          name: i === 42 ? 'checkpoint' : i === 43 ? 'abcdefghijklmnopqrstuvwxyz012345' : i === 44 ? '数据库恢复' : 'lex' + i.toString(36).padStart(7, '0'),
          body: 'sharedword' });
      });
      profile.seedMs = performance.now() - start;
      const admission = performance.now();
      e.admin.setSchema({ ...schema, types: { Row: { required: [], search: { fields: { name: 3, body: 1 } } } } });
      profile.admissionMs = performance.now() - admission;
      await db.indexesReady(); profile.readyMs = performance.now() - admission;
      profile.filesAfterBuild = files(); profile.memoryBeforeQueries = process.memoryUsage();
      const cases = [
        ['exact', 'checkpoint', ['Row-42']], ['deletion', 'checkpoin', ['Row-42']],
        ['transposition', 'chekcpoint', ['Row-42']], ['absent', 'zzzzzzzzzz', []],
        ['maxToken', 'abcdefghijklmnopqrstuvwxyz01234x', ['Row-43']],
        ['phrase', '"checkpoint"', ['Row-42']], ['prefix', 'checkpoi', ['Row-42'], { prefix: true }],
        ['unicode', '数据库恢复', ['Row-44']],
        ['broad', 'sharedword', Array.from({ length: 10 }, (_, i) => `Row-${i}`)],
        ['highlights', 'checkpoint', ['Row-42']],
      ];
      let phase = 'start'; heartbeat = startHeartbeat(8, (at, delayMs) => profile.heartbeats.push({ phase, at, delayMs }));
      for (const [name, text, expected, options] of cases) {
        phase = name;
        const samples = [], state = { firstInvocationMs: undefined, warmMs: samples };
        profile.queries[name] = state;
        const query = () => {
          const builder = e.query('Row').search(text, options).limit(10);
          return name === 'highlights' ? builder.hits({ fields: ['name'], highlights: true }) : builder.ids();
        };
        for (let ordinal = 0; ordinal < 13; ordinal++) {
          await new Promise(resolve => setImmediate(resolve));
          const start = performance.now(), answer = query(), ms = performance.now() - start;
          if (ordinal === 0) state.firstInvocationMs = ms; else samples.push(ms);
          const ids = name === 'highlights' ? answer.map(hit => hit.id) : answer;
          assert.deepEqual(ids, expected, `${n}/${name}/${ordinal}`);
          if (name === 'highlights') {
            assert.deepEqual(answer[0].highlights, { name: [[0, 0, 10]] });
            assert.deepEqual(answer[0].row, { id: 'Row-42', name: 'checkpoint' });
          }
        }
        state.summary = summary(samples);
        // Separate from timed calls: observe returned vocabulary rows and bound MATCH input size.
        const original = db.all.bind(db), calls = [];
        db.all = (sql, args) => {
          const rows = original(sql, args); calls.push({ sql, returnedRows: rows.length,
            stringArgumentBytes: (args ?? []).filter(arg => typeof arg === 'string').reduce((sum, arg) => sum + Buffer.byteLength(arg), 0) });
          return rows;
        };
        try { query(); } finally { db.all = original; }
        state.observedCalls = calls;
      }
      profile.nativeDiagnostic = {};
      const table = db.all("SELECT name FROM sqlite_schema WHERE type='table'").map(row => row.name).find(name => /^fts_[a-f0-9]{24}$/.test(name));
      assert(table);
      db.sql.exec(`CREATE VIRTUAL TABLE temp.typo_dictionary USING fts5vocab(main,${table},col)`);
      for (const [name, text] of [['broad', 'sharedword'], ['maxToken', 'abcdefghijklmnopqrstuvwxyz01234x']]) {
        const originalAll = db.all.bind(db); let captured;
        db.all = (sql, args) => { const rows = originalAll(sql, args); if (/^WITH c\d+ AS MATERIALIZED/.test(sql)) captured = {sql, args, rows}; return rows; };
        try { e.query('Row').search(text).limit(10).ids(); } finally { db.all = originalAll; }
        assert(captured && typeof captured.args[0] === 'string');
        const full = captured.args[0], alternatives = [...full.matchAll(/\(body : "[^"]*" OR aliases : "[^"]*"\)/g)].map(match => match[0]);
        assert(alternatives.length > 1);
        const probe = `SELECT alternative.value FROM json_each(?) alternative WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${table} MATCH alternative.value)`;
        const input = JSON.stringify(alternatives), begin = performance.now();
        const present = db.sql.prepare(probe).all(input).map(row => row.value), probeMs = performance.now() - begin;
        assert.equal(present.length, 1, 'Counterfactual must preserve the only matching alternative');
        const state = { full, present, generatedAlternatives: alternatives.length, probeMs,
          probePlan: db.sql.prepare('EXPLAIN QUERY PLAN '+probe).all(input), samples: [] };
        profile.nativeDiagnostic[name] = state;
        const terms = alternatives.map(expression => /body : "([^"]+)"/.exec(expression)[1]);
        const lookup = `SELECT alternative.value FROM json_each(?) alternative WHERE EXISTS
          (SELECT 1 FROM temp.typo_dictionary v WHERE v.term=alternative.value AND v.col IN ('body','aliases'))`;
        const words = JSON.stringify(terms), point = db.sql.prepare(lookup);
        state.pointPlan = db.sql.prepare('EXPLAIN QUERY PLAN '+lookup).all(words); state.pointMs = [];
        for (let ordinal=0;ordinal<13;ordinal++) {
          await new Promise(resolve=>setImmediate(resolve)); const begin=performance.now(),rows=point.all(words);
          state.pointMs.push(performance.now()-begin);
          assert.deepEqual(rows.map(row=>`(body : "${row.value}" OR aliases : "${row.value}")`),present);
        }

      }
      await new Promise(resolve => setTimeout(resolve, 16)); heartbeat.stop(); heartbeat = undefined;
      profile.filesAfterQueries = files(); profile.memoryAfterQueries = process.memoryUsage();
      profile.resourceUsage = process.resourceUsage(); profile.sqlite = db.get('SELECT sqlite_version() version').version;
    } finally { heartbeat?.stop(); db?.close(); rmSync(root, { recursive: true, force: true }); }
  }
  report.nativeBindings = loadedNativeBindings(); report.resourceUsage = process.resourceUsage();
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { writeFileSync(output, JSON.stringify(report)); }
