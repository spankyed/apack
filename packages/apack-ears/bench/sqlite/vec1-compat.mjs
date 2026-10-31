// Tiny transactional/filter/backup gate for upstream SQLite vec1. Not production adoption or performance proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadedNativeBindings } from './load-metrics.ts';
const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const [extensionArg, metadataFile, output] = process.argv.slice(2), extension = resolve(extensionArg);
assert(output && !existsSync(output));
const root = mkdtempSync(join(tmpdir(), 'ears-vec1-compat-'));
const blob = values => Buffer.from(Float32Array.from([...values, ...Array(8 - values.length).fill(0)]).buffer);
const query = blob([1, 0]), original = blob([.8, .6]), opposite = blob([-1, 0]);
const report = { source: process.env.EARS_TEST_SOURCE, qualification: false,
  scope: 'Native extension compatibility on tiny fixtures; no EARS integration, corpus recall, training/admission or latency qualification',
  node: process.version, platform: process.platform, arch: process.arch,
  upstream: JSON.parse(readFileSync(metadataFile, 'utf8')), extension: { path: extension, sha256: createHash('sha256').update(readFileSync(extension)).digest('hex') }, modes: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
let db, reader, backup;
function open(file, readonly = false) {
  const handle = new Database(file, readonly ? { readonly: true, fileMustExist: true } : {});
  handle.loadExtension(extension); return handle;
}
try {
  for (const mode of ['none', 'flat', 'ivf-none', 'ivf-bq']) {
    const record = { mode, passed: [] }; report.modes.push(record); save();
    const file = join(root, mode + '.sqlite3'); db = open(file);
    db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
    record.sqlite = db.prepare('SELECT sqlite_version() v').get().v;
    record.version = db.prepare('SELECT vec1_info() v').get().v;
    record.loadedNative = loadedNativeBindings([extension]);
    db.exec('CREATE VIRTUAL TABLE corpus USING vec1(v, owner, active)');
    if (mode.startsWith('ivf-')) {
      db.exec('CREATE TABLE training(v BLOB NOT NULL)');
      const insert = db.prepare('INSERT INTO training VALUES (?)');
      db.transaction(() => { for (let i = 0; i < 512; i++) insert.run(blob(Array.from({length: 8}, (_, j) => Math.sin((i + 1) * 9.173 + j * 3.11) + Math.cos((i + 2) * (j + 1) * 1.71)))); })();
      const start = performance.now();
      const model = db.prepare('SELECT vec1_train(v,?) model FROM training').get(JSON.stringify({ distance: 'cos', quantizer: mode === 'ivf-none' ? 'none' : 'bq', nbucket: 4, nthread: 1 })).model;
      record.trainingMs = performance.now() - start; record.modelBytes = model.byteLength;
      db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
    } else db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(JSON.stringify({index: mode, distance: 'cos'}));
    const insert = db.prepare('INSERT INTO corpus(rowid,v,owner,active) VALUES (?,?,?,?)');
    for (const [id, vector, owner, active] of [[1,query,'excluded',0], [2,original,'owner-2',1], [3,blob([0,1]),'owner-3',1], [4,blob([-.8,.6]),'owner-4',1]])
      insert.run(BigInt(id), vector, owner, BigInt(active));
    // Scan all buckets/candidates here, including compressed modes; exact reranking owns the expected answer.
    const sql = `SELECT rowid,owner,vec1_cos_distance(v,?) distance FROM corpus(?,?) WHERE active=1
      ORDER BY distance,rowid LIMIT 1`;
    const options = JSON.stringify({K: 100, nprobe: 100});
    const nearest = handle => handle.prepare(sql).get(query,query,options)?.rowid;
    const scoped = handle => handle.prepare(`SELECT rowid FROM corpus(?,?) WHERE active=1 AND owner IN (SELECT value FROM json_each(?))`).all(query,JSON.stringify({K:1,nprobe:100}),JSON.stringify(['owner-3']));
    assert.equal(nearest(db), 2);
    assert.deepEqual(scoped(db).map(row => row.rowid), [3]);
    const filtered = db.prepare('SELECT rowid FROM corpus(?,?) WHERE active=1').all(query,JSON.stringify({K:1,nprobe:100}));
    assert.equal(filtered.length,1); assert([2,3,4].includes(filtered[0].rowid));
    if (mode !== 'ivf-bq') assert.equal(filtered[0].rowid,2);
    for (const id of [2,3,4]) assert.deepEqual(db.prepare('SELECT rowid FROM corpus(?,?) WHERE active=1 AND owner IN (SELECT value FROM json_each(?))').all(query,JSON.stringify({K:1,nprobe:100}),JSON.stringify([`owner-${id}`])).map(row=>row.rowid),[id]);
    record.passed.push('metadata and dynamic owner IN filtering before K'); save();
    reader = open(file, true); assert.equal(nearest(reader),2);
    db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE corpus SET v=? WHERE rowid=2').run(opposite);
    assert.equal(nearest(db),3); assert.equal(nearest(reader),2);
    db.exec('SAVEPOINT nested'); db.prepare('DELETE FROM corpus WHERE rowid=3').run(); assert.equal(nearest(db),4);
    db.exec('ROLLBACK TO nested'); assert.equal(nearest(db),3); db.exec('RELEASE nested; ROLLBACK');
    assert.equal(nearest(db),2); assert.equal(nearest(reader),2); record.passed.push('own update/delete, nested savepoint, rollback and reader isolation'); save();
    db.exec('BEGIN IMMEDIATE'); insert.run(5n,blob([.99,.1]),'owner-5',1n); assert.equal(nearest(db),5); db.exec('ROLLBACK'); assert.equal(nearest(db),2);
    record.passed.push('own insert and rollback'); save();
    reader.exec('BEGIN'); assert.equal(nearest(reader),2);
    db.prepare('UPDATE corpus SET v=? WHERE rowid=2').run(opposite); assert.equal(nearest(db),3); assert.equal(nearest(reader),2);
    reader.exec('COMMIT'); assert.equal(nearest(reader),3);
    db.prepare('UPDATE corpus SET v=? WHERE rowid=2').run(original); assert.equal(nearest(reader),2);
    record.passed.push('held reader snapshot and later committed visibility'); save(); reader.close(); reader = undefined;
    const destination = join(root,mode + '-backup.sqlite3'); db.prepare('VACUUM INTO ?').run(destination);
    backup = open(destination,true); assert.equal(nearest(backup),2); assert.deepEqual(scoped(backup).map(row=>row.rowid),[3]);
    assert.throws(()=>backup.prepare('DELETE FROM corpus WHERE rowid=2').run(), error => String(error.code).startsWith('SQLITE_READONLY'));
    backup.close(); backup = undefined; db.close(); db = undefined;
    db = open(file); assert.equal(nearest(db),2); assert.deepEqual(scoped(db).map(row=>row.rowid),[3]);
    record.passed.push('read-only compacted backup and reopen'); save(); db.close(); db = undefined;
  }
} catch (error) { report.failure = { message: error.message, code: error.code, stack: error.stack }; save(); throw error; }
finally { backup?.close(); reader?.close(); db?.close(); rmSync(root,{recursive:true,force:true}); }
