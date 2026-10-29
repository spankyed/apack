// Owner-scope complexity prerequisite; no EARS integration or recall acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';
const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const [extension, corpusPath, modelFile, output, extensionProvenance] = process.argv.slice(2);
assert(output && !existsSync(output));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(corpusPath + '/manifest.json'));
const corpus = readFileSync(corpusPath + '/corpus.f32'), queries = readFileSync(corpusPath + '/queries.f32');
assert.equal(sha(corpus), manifest.files['corpus.f32'].sha256);
assert.equal(sha(queries), manifest.files['queries.f32'].sha256);
const model = readFileSync(modelFile), identity = JSON.parse(readFileSync(modelFile + '.json'));
assert.equal(sha(model), identity.sha256);
const actualExtensionSha256 = sha(readFileSync(extension));
let patchProvenance;
if(actualExtensionSha256!==identity.identity.extensionSha256) {
  assert(extensionProvenance,'Different native code requires explicit patch provenance');
  patchProvenance=JSON.parse(readFileSync(extensionProvenance));
  assert.equal(patchProvenance.upstreamExtensionSha256,identity.identity.extensionSha256);
  assert.equal(patchProvenance.patchedExtensionSha256,actualExtensionSha256);
}
assert.equal(identity.identity.size, 99900);
const report = {protocol:'ears-vec1-owner-scope/1',source:process.env.EARS_TEST_SOURCE,qualification:false,
  scope:'Ten observed queries, UUID-shaped text owners, SQL owner-IN versus equivalent range predicates; no integrated or fresh recall acceptance',
  node:process.version,platform:process.platform,arch:process.arch,modelSha256:sha(model),
  loadedNative:[],patchProvenance,records:[]};
const save = () => writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const file = '/metrics/owner-scope.sqlite3', bytes = 1536*4;
assert(!existsSync(file));
const ownerStorage=process.env.EARS_VEC1_OWNER_STORAGE ?? 'uuid';
assert(['uuid','integer'].includes(ownerStorage));
report.ownerStorage=ownerStorage;
const id = ordinal => ownerStorage==='integer' ? BigInt(ordinal+1) : '00000000-0000-4000-8000-'+String(ordinal).padStart(12,'0');
let db;
try {
  db = new Database(file); db.loadExtension(extension);
  db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL'); db.pragma('cache_size=-65536');
  report.loadedNative = loadedNativeBindings([extension]);
  report.sqlite = db.prepare('SELECT sqlite_version() v').get().v;
  report.version = db.prepare('SELECT vec1_info() v').get().v;
  db.exec(`CREATE TABLE owners(id ${ownerStorage==='integer'?'INTEGER':'TEXT'} PRIMARY KEY,scope INTEGER NOT NULL,active INTEGER NOT NULL); CREATE INDEX eligible ON owners(active,scope,id)`);
  db.exec('CREATE VIRTUAL TABLE corpus USING vec1(v,scope,active,owner)');
  db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
  const owner = db.prepare('INSERT INTO owners VALUES (?,?,?)');
  const insert = db.prepare('INSERT INTO corpus(rowid,v,scope,active,owner) VALUES (?,?,?,?,?)');
  const begin = performance.now();
  db.transaction(()=>{for(let i=0;i<99900;i++) {
    const active = i%97===0?0:1;
    owner.run(id(i),i%100,active);
    insert.run(BigInt(i+1),corpus.subarray(i*bytes,(i+1)*bytes),i%100,active,id(i));
  }})();
  report.loadMs = performance.now()-begin; save();
  const options = JSON.stringify({K:256,nprobe:32});
  const prefix = 'SELECT rowid,vec1_cos_distance(v,?) distance FROM corpus(?,?) WHERE ';
  const range = db.prepare(prefix+'scope < ? AND active=1');
  const scoped = db.prepare(prefix+'owner IN (SELECT id FROM owners WHERE active=1 AND scope < ?)');
  const sorted = rows => rows.sort((a,b)=>a.distance-b.distance||a.rowid-b.rowid);
  for(const percent of [100,10,1]) {
    const record = {scopePercent:percent,owners:db.prepare('SELECT count(*) n FROM owners WHERE active=1 AND scope < ?').get(percent).n,samples:[]};
    report.records.push(record);
    record.rangePlan = db.prepare('EXPLAIN QUERY PLAN '+prefix+'scope < ? AND active=1').all(queries.subarray(0,bytes),queries.subarray(0,bytes),options,percent);
    if(percent!==100) record.ownerPlan = db.prepare('EXPLAIN QUERY PLAN '+prefix+'owner IN (SELECT id FROM owners WHERE active=1 AND scope < ?)').all(queries.subarray(0,bytes),queries.subarray(0,bytes),options,percent);
    for(let q=0;q<10;q++) {
      const blob = queries.subarray(q*bytes,(q+1)*bytes);
      const timed = async statement => {
        const heartbeat = startHeartbeat(1), began = performance.now();
        let rows;
        try { rows=sorted(statement.all(blob,blob,options,percent)); }
        finally {heartbeat.stop();}
        const ms = performance.now()-began;
        await pause(0);
        return {rows,ms,heartbeatMs:heartbeat.delaysMs};
      };
      const control = await timed(range);
      const sample = {q,rangeMs:control.ms,rangeHeartbeatMs:control.heartbeatMs};
      if(percent!==100) {
        const answer = await timed(scoped);
        assert.deepEqual(answer.rows,control.rows,'SQL owner filter must match equivalent native range before K');
        assert(answer.rows.every(row=>(row.rowid-1)%100<percent&&(row.rowid-1)%97!==0));
        sample.ownerInMs=answer.ms;sample.ownerInHeartbeatMs=answer.heartbeatMs;
      }
      record.samples.push(sample);save();
    }
    console.log(JSON.stringify(record));
  }
  report.maxRssKiB=process.resourceUsage().maxRSS;report.completed=true;save();
} catch(error) {report.failure={message:error.message,stack:error.stack};save();throw error;}
finally {db?.close();for(const suffix of ['','-wal','-shm'])rmSync(file+suffix,{force:true});}
