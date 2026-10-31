// Fixed offline-repair growth probe; source correctness and cost observations, not application acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase, rebuildIndexes } from '@apackdev/ears/sqlite';
import { loadedNativeBindings } from './load-metrics.ts';

const n = Number(process.argv[2]), mode = process.argv[3], output = process.argv[4];
assert([1000, 10000, 100000].includes(n) && ['off', 'full'].includes(mode) && output && !existsSync(output));
assert.equal(process.platform, 'linux');
const constraints = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name => [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.equal(constraints['cpu.max'], '200000 100000'); assert.equal(constraints['memory.max'], String(6 * 1024 ** 3)); assert.equal(constraints['memory.swap.max'], '0');
const root = mkdtempSync(join(tmpdir(), 'ears-membership-cost-'));
const report = { qualification: false, source: process.env.EARS_TEST_SOURCE, n, mode, node: process.version, constraints,
  driverSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), entries: Object.fromEntries(
    ['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)])) };
assert(Object.values(report.entries).every(value => value.includes('/dist/')));
const files = () => Object.fromEntries(readdirSync(root).map(name => [name, statSync(join(root, name)).size]));
const state = db => ({ files: files(), memory: process.memoryUsage(), pages: db.get('PRAGMA page_count'), freePages: db.get('PRAGMA freelist_count') });
let db, observer;
try {
  db = openDatabase({ path: root, syncs: mode === 'full', schema: { types: { Row: { required: [] } }, relations: {}, roles: [] } });
  const e = createEarsEngine({ database: db }), start = performance.now();
  for (let offset = 0; offset < n; offset += 256) e.transact(() => {
    for (let i = offset; i < Math.min(n, offset + 256); i++) e.create('Row', { id: `Row-${i}`,
      tags: [i % 8, 'group-' + (i % 32), false, null, 0, -0, 'duplicate', 'duplicate'],
      body: String(i).padStart(16, '0') + ':'.repeat(2032) });
  });
  await db.indexesReady(); report.seedMs = performance.now() - start;
  report.pragmas = { synchronous: db.get('PRAGMA synchronous'), journal: db.get('PRAGMA journal_mode') };
  assert.equal(e.query('Row').where('tags', 'duplicate').count(), n);
  const persisted = e.getAttr('Row-0', 'tags'), before = e.lastCommit();
  report.membersBeforeDamage = db.get('SELECT count(*) n FROM value_members').n;
  report.damagedMembers = Number(db.run("DELETE FROM value_members WHERE field='tags' AND kind='text' AND value='duplicate'").changes);
  assert.equal(report.damagedMembers, n);
  assert.equal(e.query('Row').where('tags', 'duplicate').count(), 0);
  observer = openDatabase({ path: root, readOnly: true }); const old = createEarsEngine({ database: observer });
  report.before = state(db);
  const original = db.values.rebuildMembers.bind(db.values);
  db.values.rebuildMembers = () => {
    const began = performance.now(); original(); report.membershipSqlMs = performance.now() - began;
  };
  const began = performance.now(); await rebuildIndexes(db); report.totalRepairMs = performance.now() - began;
  report.after = state(db); report.membersAfterRepair = db.get('SELECT count(*) n FROM value_members').n;
  assert.equal(report.membersAfterRepair, report.membersBeforeDamage);
  assert.equal(e.lastCommit(), before); assert.deepEqual(e.getAttr('Row-0', 'tags'), persisted);
  assert.equal(e.query('Row').where('tags', 'duplicate').count(), n);
  assert.equal(e.query('Row').where('tags', 'group-7').count(), Math.floor((n + 24) / 32));
  assert.equal(e.getAttr(`Row-${n - 1}`, 'body'), String(n - 1).padStart(16, '0') + ':'.repeat(2032));
  assert.throws(() => old.query('Row').count(), error => error.code === 'SCHEMA_CHANGED');
  report.checks = { membership: true, selective: true, primary: true, commitIdentity: true, staleHandle: true };
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  report.native = loadedNativeBindings(); report.resources = process.resourceUsage();
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  observer?.close(); db?.close(); rmSync(root, { recursive: true, force: true });
}
