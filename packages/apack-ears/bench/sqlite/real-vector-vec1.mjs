// Native strategy gate only: one private database per invocation, no EARS adoption.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { getLoadablePath } from 'sqlite-vec';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';

const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const [extensionFile, corpusPath, truthFile, sizeArg, mode, output, modelCache] = process.argv.slice(2);
const size = Number(sizeArg), isVec0 = mode.startsWith('vec0-binary-'), isSqlBinary = mode.startsWith('sql-binary-');
const isBinary = isVec0 || isSqlBinary;
const extension = isBinary ? getLoadablePath() : resolve(extensionFile);
assert([1000,10000,99900].includes(size));
assert(['flat','ivf-bq-256','ivf-bq-1024','scan-bq-256','scan-bq-1024','vec0-binary-256','vec0-binary-1024','sql-binary-256','sql-binary-1024'].includes(mode));
assert(output && !existsSync(output) && !existsSync(output + '.sqlite3'));
const sha = data => createHash('sha256').update(data).digest('hex');
const truthBytes = readFileSync(truthFile), truth = JSON.parse(truthBytes);
assert.equal(truth.protocol,'ears-real-vector-truth/1');
const manifestBytes = readFileSync(corpusPath + '/manifest.json');
assert.equal(sha(manifestBytes),truth.manifestSha256);
const manifest = JSON.parse(manifestBytes);
const corpus = readFileSync(corpusPath + '/corpus.f32'), queries = readFileSync(corpusPath + '/queries.f32');
assert.equal(sha(corpus),manifest.files['corpus.f32'].sha256);
assert.equal(sha(queries),manifest.files['queries.f32'].sha256);
const bytes = 1536 * 4;
const vector = ordinal => corpus.subarray(ordinal * bytes,(ordinal+1) * bytes);
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)] ?? null;
const summary = values => ({count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:Math.max(...values)});
const report = {protocol:'ears-real-vector-vec1/1',qualification:false,source:process.env.EARS_TEST_SOURCE,
  size,mode,backend:isBinary?'sqlite-vec':'vec1',truthSha256:sha(truthBytes),extensionSha256:sha(readFileSync(extension)),
  node:process.version,platform:process.platform,arch:process.arch,cohorts:[]};
const save = () => writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const file = process.env.EARS_VECTOR_SCRATCH ? join(process.env.EARS_VECTOR_SCRATCH,basename(output)+'.sqlite3') : output+'.sqlite3';
assert(!existsSync(file));
const cacheKiB = Number(process.env.EARS_VECTOR_CACHE_KIB ?? 2000);
assert([2000,65536].includes(cacheKiB));
let db;
try {
  db = new Database(file); db.loadExtension(extension);
  db.pragma(`cache_size=-${cacheKiB}`);
  report.cacheKiB = -db.pragma('cache_size',{simple:true});
  report.databaseLocation = process.env.EARS_VECTOR_SCRATCH?'private container filesystem':'mounted results directory';
  db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
  report.sqlite = db.prepare('SELECT sqlite_version() v').get().v;
  report.version = db.prepare(isBinary?'SELECT vec_version() v':'SELECT vec1_info() v').get().v;
  report.loadedNative = loadedNativeBindings([extension]);
  if(isBinary) {
    db.exec('CREATE TABLE raw(rowid INTEGER PRIMARY KEY,v BLOB NOT NULL)');
    db.exec(isVec0?'CREATE VIRTUAL TABLE corpus USING vec0(embedding bit[1536],scope integer,active integer)':
      'CREATE TABLE corpus(rowid INTEGER PRIMARY KEY,embedding BLOB NOT NULL,scope INTEGER NOT NULL,active INTEGER NOT NULL); CREATE INDEX eligible ON corpus(active,scope)');
  } else db.exec('CREATE VIRTUAL TABLE corpus USING vec1(v, scope, active)');
  if (isBinary) {
    report.training = {required:false,quantizer:'sqlite-vec vec_quantize_binary; no trained transform'};
  } else if (mode === 'flat') {
    db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(JSON.stringify({index:'flat',distance:'cos'}));
  } else {
    const count = Math.min(20000,size);
    const parameters = {distance:'cos',quantizer:'bq',nbucket:mode.startsWith('scan-')?0:64,nthread:1};
    const identity = {manifestSha256:sha(manifestBytes),extensionSha256:report.extensionSha256,size,parameters,rows:count};
    let model;
    if(modelCache && existsSync(modelCache)) {
      const cached = JSON.parse(readFileSync(modelCache+'.json','utf8'));
      assert.deepEqual(cached.identity,identity);
      model = readFileSync(modelCache); assert.equal(sha(model),cached.sha256);
      report.training = {...cached.training,reused:true};
    } else {
      db.exec('CREATE TABLE training(v BLOB NOT NULL)');
      const insert = db.prepare('INSERT INTO training VALUES (?)');
      db.transaction(()=>{for(let i=0;i<count;i++)insert.run(vector(Math.floor(i*size/count)));})();
      const started = performance.now();
      model = db.prepare('SELECT vec1_train(v,?) model FROM training').get(JSON.stringify(parameters)).model;
      report.training = {rows:count,ms:performance.now()-started,bytes:model.byteLength,reused:false};
      if(modelCache) {
        writeFileSync(modelCache,model,{flag:'wx'});
        writeFileSync(modelCache+'.json',JSON.stringify({identity,sha256:sha(model),training:report.training}),{flag:'wx'});
      }
      db.exec('DROP TABLE training');
    }
    report.modelSha256 = sha(model); report.training.parameters = parameters; save();
    db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
  }
  const rawInsert = isBinary ? db.prepare('INSERT INTO raw(rowid,v) VALUES (?,?)') : undefined;
  const insert = db.prepare(isBinary?'INSERT INTO corpus(rowid,embedding,scope,active) VALUES (?,vec_quantize_binary(?),?,?)':'INSERT INTO corpus(rowid,v,scope,active) VALUES (?,?,?,?)');
  let started = performance.now();
  db.transaction(()=>{for(let i=0;i<size;i++) {
    rawInsert?.run(i+1,vector(i)); insert.run(BigInt(i+1),vector(i),BigInt(i%100),BigInt(i%97===0?0:1));
  }})();
  report.loadMs = performance.now()-started; save();
  const update = db.prepare(isBinary?'UPDATE raw SET v=? WHERE rowid=?':'UPDATE corpus SET v=? WHERE rowid=?');
  const remove = isBinary?db.prepare('DELETE FROM corpus WHERE rowid=?'):undefined;
  const candidates = mode==='flat'?10:Number(mode.split('-').at(-1));
  const statement = db.prepare(isSqlBinary?`WITH found AS MATERIALIZED (
    SELECT rowid FROM corpus WHERE active=1 AND scope < ?
    ORDER BY vec_distance_hamming(vec_bit(embedding),vec_quantize_binary(?)),rowid LIMIT ?
    ) SELECT raw.rowid,vec_distance_cosine(raw.v,?) distance FROM found JOIN raw ON raw.rowid=found.rowid`:
    isVec0?`WITH found AS MATERIALIZED (
    SELECT rowid FROM corpus WHERE embedding MATCH vec_quantize_binary(?) AND k=? AND scope < ? AND active=1
    ) SELECT raw.rowid,vec_distance_cosine(raw.v,?) distance FROM found JOIN raw ON raw.rowid=found.rowid`:
    `SELECT rowid,vec1_cos_distance(v,?) distance FROM corpus(?,?) WHERE scope < ? AND active=1`);
  const options = JSON.stringify({K:candidates,nprobe:16});
  for (const phase of ['initial','updated']) {
    if(phase==='updated') {
      started = performance.now();
      db.transaction(()=>{for(let i=7;i<size;i+=100) {
        const v=vector((i+31337)%99900); update.run(v,i+1);
        if(isBinary) { remove.run(BigInt(i+1)); insert.run(BigInt(i+1),v,BigInt(i%100),BigInt(i%97===0?0:1)); }
      }})();
      report.updateMs = performance.now()-started;
    }
    for (const percent of [100,10,1]) {
      const expected = truth.cohorts.find(c=>c.size===size&&c.phase===phase&&c.scopePercent===percent);
      assert(expected);
      const record = {phase,scopePercent:percent,candidateLimit:candidates,passes:[]}; report.cohorts.push(record);
      for(let pass=0;pass<4;pass++) {
        const samples=[], heartbeat=startHeartbeat(1);
        try {
          for(let q=0;q<100;q++) {
            const blob=queries.subarray(q*bytes,(q+1)*bytes), begin=performance.now();
            const found=isSqlBinary?statement.all(percent,blob,candidates,blob):
              isVec0?statement.all(blob,BigInt(candidates),BigInt(percent),blob):statement.all(blob,blob,options,percent);
            const rows=found.sort((a,b)=>a.distance-b.distance||a.rowid-b.rowid).slice(0,10);
            const ms=performance.now()-begin;
            const ordinals=rows.map(row=>row.rowid-1), answer=expected.answers[q].ordinals;
            assert.equal(new Set(ordinals).size,ordinals.length);
            assert(ordinals.every(i=>i>=0&&i<size&&i%100<percent&&i%97!==0));
            const recall=ordinals.filter(i=>answer.includes(i)).length/answer.length;
            samples.push({q,ms,recall,candidateCount:found.length,ordinals});
            await pause(0);
          }
        } finally {heartbeat.stop();}
        const meanRecall=samples.reduce((sum,s)=>sum+s.recall,0)/samples.length;
        record.passes.push({pass,timed:pass!==0,meanRecall,latencyMs:summary(samples.map(s=>s.ms)),
          heartbeatMs:summary(heartbeat.delaysMs),heartbeatSamples:heartbeat.delaysMs,samples});
        console.log(JSON.stringify({size,mode,phase,percent,pass,meanRecall,latency:record.passes.at(-1).latencyMs}));
        save();
      }
    }
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  report.databaseBytes=statSync(file).size;
  report.maxRssKiB=process.resourceUsage().maxRSS;
  report.completed=true; save();
} catch(error) {report.failure={message:error.message,stack:error.stack};save();throw error;}
finally {db?.close();for(const suffix of ['','-wal','-shm'])rmSync(file+suffix,{force:true});}
