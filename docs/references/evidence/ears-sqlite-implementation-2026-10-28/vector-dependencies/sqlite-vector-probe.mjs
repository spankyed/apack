import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire('/seed/package.json'), Database = require('better-sqlite3');
const root = mkdtempSync('/tmp/vector-contract-'), report = { candidate: 'sqliteai/sqlite-vector 1.1.2', observations: {}, checks: {}, sourceSha256: createHash('sha256').update(readFileSync('/probe.mjs')).digest('hex') };
const blob = vector => Buffer.from(Float32Array.from(vector).buffer);
const query = blob([1, 0, 0]); let db, other;
const observe = (name, body) => { try { return report.observations[name] = body(); } catch(error) { report.observations[name] = { error: error.message, code: error.code }; return undefined; } };
try {
  chmodSync(root, 0); assert.throws(() => readdirSync(root), { code: 'EACCES' }); chmodSync(root, 0o700);
  report.constraints = Object.fromEntries(['cpu.max','memory.max','memory.swap.max'].map(name => [name, readFileSync('/sys/fs/cgroup/'+name,'utf8').trim()]));
  assert.equal(report.constraints['cpu.max'],'200000 100000'); assert.equal(report.constraints['memory.max'],String(6*1024**3)); assert.equal(report.constraints['memory.swap.max'],'0');
  const open = () => { const value = new Database(root+'/data.sqlite'); value.loadExtension('/extension/vector.so'); return value; };
  db = open(); db.pragma('journal_mode=WAL');
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY,embedding BLOB)');
  const put = db.prepare('INSERT INTO items VALUES (?,?)');
  [[1,0,0],[0,1,0],[.9,.1,0],[-1,0,0]].forEach((vector,i) => put.run(i+1,blob(vector)));
  const init = connection => connection.prepare("SELECT vector_init('items','embedding','type=FLOAT32,dimension=3,distance=COSINE')").get();
  init(db); observe('version',()=>db.prepare('SELECT vector_version() version').get());
  const exact = connection => connection.prepare("SELECT rowid,distance FROM vector_full_scan('items','embedding',?,3)").all(query);
  const quantized = connection => connection.prepare("SELECT rowid,distance FROM vector_quantize_scan('items','embedding',?,3)").all(query);
  const refresh = () => db.prepare("SELECT vector_quantize('items','embedding','qtype=INT8')").get();
  const preload = () => db.prepare("SELECT vector_quantize_preload('items','embedding')").get();
  assert.equal(observe('exactInitial',()=>exact(db))[0].rowid,1);
  db.exec('BEGIN'); db.prepare('UPDATE items SET embedding=? WHERE id=1').run(blob([-1,0,0]));
  report.checks.exactOwnWrite = observe('exactInsideUnit',()=>exact(db))?.[0]?.rowid === 3;
  db.exec('ROLLBACK'); report.checks.exactRollback = observe('exactAfterRollback',()=>exact(db))?.[0]?.rowid === 1;
  if (observe('quantizeInitial',refresh)) {
    report.checks.quantizedInitial = observe('quantizedInitial',()=>quantized(db))?.[0]?.rowid === 1;
    observe('preloadInitial',preload);
    observe('preloadedInitial',()=>quantized(db));
    db.prepare('UPDATE items SET embedding=? WHERE id=1').run(blob([-1,0,0]));
    const expected = observe('exactAfterCommit',()=>exact(db));
    report.checks.quantizedTracksCommittedWrite = observe('quantizedAfterCommit',()=>quantized(db))?.[0]?.rowid === expected?.[0]?.rowid;
    observe('refreshCommitted',refresh); observe('preloadCommitted',preload);
    report.checks.explicitRefresh = observe('quantizedAfterExplicitRefresh',()=>quantized(db))?.[0]?.rowid === expected?.[0]?.rowid;
    db.exec('BEGIN'); db.prepare('UPDATE items SET embedding=? WHERE id=1').run(blob([1,0,0]));
    observe('refreshInsideUnit',refresh); observe('preloadInsideUnit',preload); observe('quantizedInsideUnit',()=>quantized(db));
    db.exec('ROLLBACK'); const restored = observe('exactAfterQuantizedRollback',()=>exact(db));
    report.checks.preloadedRollback = observe('quantizedAfterRollback',()=>quantized(db))?.[0]?.rowid === restored?.[0]?.rowid;
    other = open(); init(other); observe('secondHandleQuantized',()=>quantized(other));
  }
  report.loaded = process.report.getReport().sharedObjects.filter(path=>path.endsWith('.node')||path==='/extension/vector.so').map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
  report.compatibleWithoutAdditionalInvalidation = Object.values(report.checks).every(Boolean);
  if (!report.compatibleWithoutAdditionalInvalidation) process.exitCode = 2;
} catch(error) { report.fatal = {message:error.message,stack:error.stack}; process.exitCode=1; }
finally { if(db?.inTransaction)db.exec('ROLLBACK'); other?.close(); db?.close(); chmodSync(root,0o700);rmSync(root,{recursive:true,force:true});writeFileSync('/results/probe.json',JSON.stringify(report,null,2)); }
