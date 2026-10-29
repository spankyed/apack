// Scratch-only upstream ANN compatibility gate. No production dependency or recall/latency qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadedNativeBindings } from './load-metrics.ts';
const require=createRequire(import.meta.url),Database=require('better-sqlite3');
const [extensionArg,output]=process.argv.slice(2),extension=resolve(extensionArg);
assert(output&&!existsSync(output));
const root=mkdtempSync(join(tmpdir(),'ears-ann-compat-')),file=join(root,'database.sqlite3');
const blob=values=>Buffer.from(Float32Array.from([...values,...Array(8-values.length).fill(0)]).buffer);
const q=blob([1,-0]),opposite=blob([-1]);
const report={source:process.env.EARS_TEST_SOURCE,qualification:false,
  scope:'Tiny native graph/transaction/filter/backup controls; no EARS integration, real recall, admission or performance acceptance',
  extensionSha256:createHash('sha256').update(readFileSync(extension)).digest('hex'),passed:[]};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
function open(path,readonly=false) {
  const db=new Database(path,readonly?{readonly:true,fileMustExist:true}:{});db.loadExtension(extension);return db;
}
let db,reader,backup;
try {
  db=open(file);db.pragma('journal_mode=WAL');db.pragma('synchronous=FULL');db.pragma('cache_size=-65536');
  report.version=db.prepare('SELECT vec_version() v').get().v;
  report.debug=db.prepare('SELECT vec_debug() v').get().v;
  report.loadedNative=loadedNativeBindings([extension]);
  assert.equal(report.version,'v0.1.10-alpha.4');save();
  try {
    db.exec(`CREATE VIRTUAL TABLE metadata_probe USING vec0(
      v float[8] distance_metric=cosine INDEXED BY diskann(neighbor_quantizer=binary,n_neighbors=16,search_list_size=1024),
      owner text metadata,active integer metadata)`);
    report.metadataColumns={supported:true};db.exec('DROP TABLE metadata_probe');
  } catch(error) {
    report.metadataColumns={supported:false,error:{code:error.code,message:error.message}};
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE 'metadata_probe%'").get().n,0);
  }
  save();
  db.exec(`CREATE VIRTUAL TABLE corpus USING vec0(v float[8] distance_metric=cosine
    INDEXED BY diskann(neighbor_quantizer=binary,n_neighbors=16,search_list_size=1024))`);
  const insert=db.prepare('INSERT INTO corpus(rowid,v) VALUES (?,?)'),remove=db.prepare('DELETE FROM corpus WHERE rowid=?');
  db.transaction(()=>{
    for(let i=0;i<512;i++)insert.run(i+1,blob([-1,...Array.from({length:7},(_,j)=>.3*Math.sin(i*9.17+j*2.71))]));
    for(const [id,v] of [[10001,q],[10002,blob([.8,.6])],[10003,blob([0,1])],[10004,blob([-.8,.6])]])insert.run(id,v);
  })();
  report.graphNodes=db.prepare('SELECT count(*) n FROM corpus_diskann_nodes00').get().n;
  assert(report.graphNodes>0);save();
  // Request all candidates on this tiny graph, so rollback/snapshot evidence is separate from ANN recall.
  const nearest=handle=>handle.prepare(`SELECT rowid,vec_distance_cosine(v,?) exact FROM corpus
    WHERE v MATCH ? AND k=1024 ORDER BY distance`).all(q,q).sort((a,b)=>a.exact-b.exact||a.rowid-b.rowid)[0]?.rowid;
  assert.equal(nearest(db),10001);report.passed.push('real graph exists; canonical negative-zero bytes retained');
  assert(db.prepare('SELECT v FROM corpus WHERE rowid=10001').get().v.equals(q));save();
  try {
    const rows=db.prepare('SELECT rowid FROM corpus WHERE v MATCH ? AND k=1 AND rowid IN (SELECT value FROM json_each(?)) ORDER BY distance').all(q,JSON.stringify([10003]));
    report.rowidFilter={supported:rows.length===1&&rows[0].rowid===10003,returned:rows.map(row=>row.rowid)};
  } catch(error) {report.rowidFilter={supported:false,error:{code:error.code,message:error.message}};}
  save();
  const replace=(id,v)=>{remove.run(id);insert.run(id,v);};
  reader=open(file,true);assert.equal(nearest(reader),10001);
  db.exec('BEGIN IMMEDIATE');replace(10001,opposite);assert.equal(nearest(db),10002);assert.equal(nearest(reader),10001);
  db.exec('SAVEPOINT nested');remove.run(10002);assert.equal(nearest(db),10003);
  db.exec('ROLLBACK TO nested; RELEASE nested');assert.equal(nearest(db),10002);
  db.exec('ROLLBACK');assert.equal(nearest(db),10001);assert.equal(nearest(reader),10001);
  report.passed.push('own delete/insert, nested savepoint, rollback and reader isolation');save();
  reader.exec('BEGIN');assert.equal(nearest(reader),10001);
  db.transaction(()=>replace(10001,opposite))();assert.equal(nearest(db),10002);assert.equal(nearest(reader),10001);
  reader.exec('COMMIT');assert.equal(nearest(reader),10002);reader.close();reader=undefined;
  db.transaction(()=>replace(10001,q))();assert.equal(nearest(db),10001);
  report.passed.push('held reader snapshot and later committed visibility');save();
  const target=join(root,'backup.sqlite3');db.prepare('VACUUM INTO ?').run(target);
  backup=open(target,true);assert.equal(nearest(backup),10001);
  assert.throws(()=>backup.prepare('DELETE FROM corpus WHERE rowid=10001').run(),error=>String(error.code).startsWith('SQLITE_READONLY'));
  backup.close();backup=undefined;db.close();db=undefined;
  db=open(file);assert.equal(nearest(db),10001);report.passed.push('read-only backup and reopen');
  report.completed=true;report.dropInOwnerFiltering=report.metadataColumns.supported&&report.rowidFilter.supported;save();
} catch(error) {report.failure={message:error.message,code:error.code,stack:error.stack};save();throw error;}
finally {backup?.close();reader?.close();db?.close();rmSync(root,{recursive:true,force:true});}
