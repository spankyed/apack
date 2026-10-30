// Compare extension filtering with independent ordinary SQLite predicates.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const [extension, output] = process.argv.slice(2);
assert(extension && output && !existsSync(output));
const root = mkdtempSync(join(tmpdir(), 'ears-vector-membership-'));
const vector = i => Buffer.from(Float32Array.from({ length: 8 }, (_, j) => Math.sin((i + 1) * (j + 1) * 1.71)).buffer);
const fixtures = {
  compact: [null, ...Array.from({ length: 128 }, (_, i) => BigInt(i))],
  sparse32: [null, -2147483648n, 2147483646n, ...Array.from({ length: 128 }, (_, i) => BigInt(i * 1000003))],
  wide64: [null, -9223372036854775808n, 9223372036854775807n, -9007199254740991n,
    9007199254740991n, 2147483647n, 2147483648n, 0n, 1n,
    ...Array.from({ length: 128 }, (_, i) => 1000000000000n + BigInt(i) * 1000003n)],
  mixed: [null, '', '1', 'a', 'a\0b', '東京', Buffer.from('a'), -1n, 0n, 1n, 1.5,
    ...Array.from({ length: 128 }, (_, i) => BigInt(i + 10))],
  real: [null, ...Array.from({ length: 128 }, (_, i) => i / 2)],
};
const report = {
  source: process.env.EARS_TEST_SOURCE ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  extensionSha256: createHash('sha256').update(readFileSync(extension)).digest('hex'),
  completed: false, groups: [],
};
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
let db;
try {
  for (const mode of ['none', 'flat', 'ivf-bq']) for (const [fixture, values] of Object.entries(fixtures)) {
    const group = { mode, fixture, checks: 0 };
    report.groups.push(group);
    db = new Database(join(root, mode + '-' + fixture + '.sqlite3'));
    db.loadExtension(extension);
    db.pragma('journal_mode=WAL');
    db.exec('CREATE TABLE reference(owner,active); CREATE VIRTUAL TABLE corpus USING vec1(v,owner,active)');
    if (mode === 'ivf-bq') {
      db.exec('CREATE TABLE training(v)');
      const put = db.prepare('INSERT INTO training VALUES (?)');
      db.transaction(() => { for (let i = 0; i < 512; i++) put.run(vector(i)); })();
      const model = db.prepare('SELECT vec1_train(v,?) model FROM training').get(
        JSON.stringify({ distance: 'cos', quantizer: 'bq', nbucket: 4, nthread: 1 })).model;
      db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
    } else db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(JSON.stringify({ index: mode, distance: 'cos' }));
    const put = db.prepare('INSERT INTO reference(rowid,owner,active) VALUES (?,?,?)');
    const insert = db.prepare('INSERT INTO corpus(rowid,v,owner,active) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (let i = 0; i < values.length; i++) {
        put.run(i + 1, values[i], BigInt(i % 2));
        insert.run(BigInt(i + 1), vector(i), values[i], BigInt(i % 2));
      }
    })();
    const integers = values.filter(value => typeof value === 'bigint');
    const lists = [[], [1n], integers.slice(0, 7), integers.slice(0, 8), integers.slice(0, 9),
      [...integers].reverse(), [...integers, ...integers.slice(0, 12)],
      [...integers, null, '1', 1.5, Buffer.from('a')], Array(12).fill(-999n),
      Array.from({ length: 128 }, (_, i) => BigInt(i))];
    const check = (list, prefix = '', suffix = '') => {
      const where = prefix + 'owner IN (' + list.map(() => '?').join(',') + ')' + suffix;
      const expected = db.prepare('SELECT rowid FROM reference WHERE ' + where + ' ORDER BY rowid').all(...list);
      const actual = db.prepare('SELECT rowid FROM corpus(?,?) WHERE ' + where + ' ORDER BY rowid').all(
        vector(0), JSON.stringify({ K: 10000, nprobe: 100 }), ...list);
      assert.deepEqual(actual, expected, mode + '/' + fixture + ': ' + where + ' / ' + list.map(String).join(','));
      group.checks++;
    };
    for (const list of lists) {
      check(list);
      check(list, 'active=1 AND ');
      check(list, '', ' AND active IN (0,1)');
    }
    // Reuse one prepared query with alternating operand types and values.
    const sql = 'owner IN (?,?,?,?,?,?,?,?)';
    const reference = db.prepare('SELECT rowid FROM reference WHERE ' + sql + ' ORDER BY rowid');
    const native = db.prepare('SELECT rowid FROM corpus(?,?) WHERE ' + sql + ' ORDER BY rowid');
    for (const list of [Array.from({ length: 8 }, (_, i) => BigInt(i)), Array(8).fill('a'),
      Array.from({ length: 8 }, (_, i) => BigInt(7 - i))]) {
      assert.deepEqual(native.all(vector(0), JSON.stringify({ K: 10000, nprobe: 100 }), ...list), reference.all(...list));
      group.checks++;
    }
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE reference SET owner=? WHERE rowid=1').run('changed-type');
    db.prepare('UPDATE corpus SET owner=? WHERE rowid=1').run('changed-type');
    check(integers);
    db.exec('SAVEPOINT inner');
    db.exec('DELETE FROM reference WHERE rowid=2; DELETE FROM corpus WHERE rowid=2');
    check(integers);
    db.exec('ROLLBACK TO inner; RELEASE inner');
    check(integers);
    db.exec('ROLLBACK');
    check(integers);
    db.close(); db = undefined;
    save();
  }
  report.completed = true;
  save();
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  save();
  throw error;
} finally {
  db?.close();
  rmSync(root, { recursive: true, force: true });
}
