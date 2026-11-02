// Actual EARS path over the sealed real-model projection. No source IDs or vector payloads in reports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { getLoadablePath } from 'sqlite-vec';
import { PerformanceObserver } from 'node:perf_hooks';
import { createEarsEngine } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorModels } from '../../src/sqlite/vector-models.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';

const [corpusPath, truthFile, sizeArg, output, mode] = process.argv.slice(2), size = Number(sizeArg);
assert([1000,99900].includes(size) && output && !existsSync(output));
assert(mode === undefined || ['diagnose','native-fresh','native-diagnose'].includes(mode));
const fresh=mode==='native-fresh'||mode==='native-diagnose',diagnostic=mode==='diagnose'||mode==='native-diagnose';
if(fresh)assert(process.env.EARS_VEC1_EXTENSION,'A trusted native extension is required');
assert.equal(endianness(),'LE');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(join(corpusPath,'manifest.json')), manifest = JSON.parse(manifestBytes);
const truthBytes = readFileSync(truthFile), truth = JSON.parse(truthBytes);
assert.equal(truth.protocol,fresh?'ears-real-vector-fresh-truth/1':'ears-real-vector-truth/1'); assert.equal(sha(manifestBytes),truth.manifestSha256);
const corpus = readFileSync(join(corpusPath,'corpus.f32')), queries = readFileSync(join(corpusPath,'queries.f32'));
assert.equal(sha(corpus),manifest.files['corpus.f32'].sha256); assert.equal(sha(queries),manifest.files['queries.f32'].sha256);
const bytes = 1536*4, vector = i => Array.from(new Float32Array(corpus.buffer,corpus.byteOffset+i*bytes,1536));
const queryOrdinals=Array.from({length:100},(_,j)=>499+999*j);
const excluded=new Set(fresh?truth.excludedOrdinals:[]);
if(fresh) {
  assert.deepEqual(truth.queryOrdinals,queryOrdinals);
  const heldOut=new Set(queryOrdinals),expected=new Set(queryOrdinals);
  for(let i=7;i<99900;i+=100)if(heldOut.has((i+31337)%99900))expected.add(i);
  assert.deepEqual([...excluded].sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b));
  const projected=Buffer.concat(queryOrdinals.map(i=>corpus.subarray(i*bytes,(i+1)*bytes)));
  assert.equal(sha(projected),truth.queriesSha256);
  assert.equal(sha(Buffer.from(Uint32Array.from([...excluded].sort((a,b)=>a-b)).buffer)),truth.exclusionsSha256);
}
const queryVectors = Array.from({length:100},(_,q)=>fresh?vector(queryOrdinals[q]):Array.from(new Float32Array(queries.buffer,queries.byteOffset+q*bytes,1536)));
const path = mkdtempSync(join(tmpdir(),'ears-real-vector-'));
const report = {protocol:'ears-integrated-real-vector/1',qualification:false,source:process.env.EARS_TEST_SOURCE,
  size,diagnostic,partition:fresh?'fresh':'original',native:fresh,
  querySha256:fresh?truth.queriesSha256:manifest.files['queries.f32'].sha256,exclusionsSha256:fresh?truth.exclusionsSha256:null,truthSha256:sha(truthBytes),manifestSha256:sha(manifestBytes),node:process.version,arch:process.arch,
  platform:process.platform,batches:{create:128,embed:64,update:64},cohorts:[]};
const save = () => writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const pct = (values,p) => [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)] ?? null;
const summary = values => ({count:values.length,p50:pct(values,.5),p95:pct(values,.95),p99:pct(values,.99),max:Math.max(...values)});
const files = () => Object.fromEntries(readdirSync(path).map(name=>[name,statSync(join(path,name)).size]));
let db,models,nativeCalls=0,automaticEnqueues=0,admissionPages=0,admissionReferences=0;
try {
  db = new SqliteDatabase({path,schema:toElmdbSchema({types:{Row:{required:[],...(fresh?{indexes:['prefix1000','prefix10000','scope10','scope1']}:{}),embed:{from:['title'],model:'public-fixture',dims:1536,chunk:'whole'}}},relations:{},roles:[]})});
  if(fresh)models=new SqliteVectorModels(db,process.env.EARS_VEC1_EXTENSION);
  if(models) {
    const enqueue=models.enqueue.bind(models);
    models.enqueue=(...args)=>{automaticEnqueues++;return enqueue(...args);};
    const all=db.all.bind(db);
    db.all=(sql,parameters=[])=>{
      const answer=all(sql,parameters);
      if(sql.startsWith('WITH admission_page AS MATERIALIZED')) {
        assert(answer.length<=128);admissionPages++;admissionReferences+=answer.length;
        assert(answer.every(row=>!Object.values(row).some(value=>value instanceof Uint8Array)));
      }
      return answer;
    };
  }
  const e = createEarsEngine({database:db}), ids=[], updates=[];
  report.sqlite = db.get('SELECT sqlite_version() v').v; report.sqliteVec = db.get('SELECT vec_version() v').v;
  report.loadedNative = loadedNativeBindings([getLoadablePath(),...(fresh?[process.env.EARS_VEC1_EXTENSION]:[])]);
  report.cacheKiB = -db.sql.pragma('cache_size',{simple:true});
  report.synchronous = db.sql.pragma('synchronous',{simple:true});
  if(fresh)assert.equal(report.synchronous,2,'Fresh validation requires FULL durability');
  let started = performance.now();
  for(let offset=0;offset<size;offset+=128) e.transact(()=>{
    for(let i=offset;i<Math.min(size,offset+128);i++) ids.push(e.create('Row',{id:`Row-${String(i).padStart(6,'0')}`,title:`row ${i}`,...(fresh?{prefix1000:i<1000,prefix10000:i<10000,scope10:i%100<10,scope1:i%100<1}:{})}).id());
  });
  report.createMs = performance.now()-started; save(); started=performance.now();
  let stored=0;
  for(;;) {
    const pending=e.pendingEmbeddings('Row',{limit:64});
    if(!pending.count) break;
    assert(pending.chunks.length>0);
    const batch=pending.chunks.map(chunk=>{
      const ordinal=Number(chunk.id.slice(4)); assert(ordinal>=0&&ordinal<size);
      if(ordinal%100===7) updates.push({...chunk,model:pending.model,ordinal});
      return {...chunk,model:pending.model,vector:vector(ordinal)};
    });
    assert.equal(e.embed(batch).stored,batch.length); stored+=batch.length;
    if(stored%4096===0) console.log(JSON.stringify({stage:'embed',stored}));
  }
  assert.equal(stored,size); report.embedMs=performance.now()-started;
  e.transact(()=>{for(let i=0;i<size;i++)if(i%97===0||excluded.has(i))e.write(ids[i]).trash();});
  function canonicalHash(updated) {
    const actual=createHash('sha256'), expected=createHash('sha256'); let count=0;
    for(const row of db.statement('SELECT v.embedding FROM embedding_values v JOIN entities e ON e.id=v.entity_id ORDER BY e.seq,v.chunk').iterate()) {
      actual.update(row.embedding);
      const index=updated&&count%100===7?(count+31337)%99900:count;
      expected.update(corpus.subarray(index*bytes,(index+1)*bytes));count++;
    }
    assert.equal(count,size); assert.equal(actual.digest('hex'),expected.digest('hex'));
    return count;
  }
  report.initialCanonicalRowsVerified=canonicalHash(false); report.filesAfterLoad=files(); save();
  const checkpointMode=process.env.EARS_CHECKPOINT_PROBE;
  assert(['auto','manual'].includes(checkpointMode));
  const beforeCheckpoint=db.sql.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(beforeCheckpoint[0].busy,0);
  const beforeAdmissionAutoThreshold=db.sql.pragma('wal_autocheckpoint',{simple:true});
  assert.equal(beforeAdmissionAutoThreshold,1000);
  if(checkpointMode==='manual')db.sql.pragma('wal_autocheckpoint=0');
  report.checkpointProbe={mode:checkpointMode,beforeCheckpoint,beforeAdmissionAutoThreshold,
    admissionAutoThreshold:db.sql.pragma('wal_autocheckpoint',{simple:true}),filesAtAdmissionStart:files()};
  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);

  if(fresh) {
    const job=db.indexBuilds.jobs().find(job=>job.type==='Row'&&job.kind==='vector');assert(job);
    assert.equal(db.get(`SELECT count(*) n FROM chunks c JOIN entities e ON e.id=c.entity_id
      WHERE c.generation=? AND e.trashed=0`,[job.generation]).n,
      truth.cohorts.find(c=>c.size===size&&c.phase==='initial'&&c.scopePercent===100).eligible);
    const pulse=startHeartbeat(1),admissionAt=performance.now(),sequence=db.sequence,trace=[],gc=[],restore=[];
    let observer,finished;
    if(diagnostic) {
      const measure=(target,name,label)=>{
        const original=target[name];target[name]=function(...args){const at=performance.now();try{return original.apply(this,args);}finally{trace.push({stage:label,atMs:at-admissionAt,ms:performance.now()-at,...(label==='writer-commit'?{walBytes:existsSync(join(path,'data.sqlite3-wal'))?statSync(join(path,'data.sqlite3-wal')).size:0}:{})});}};
        restore.push(()=>{target[name]=original;});
      };
      measure(models,'start','worker-launch');measure(models.index,'admit','native-admit');
      measure(models.index,'step','native-projection');measure(db,'commitWrite','writer-commit');
      measure(db.indexBuilds,'step','scheduler-step');
      observer=new PerformanceObserver(entries=>{for(const entry of entries.getEntries())gc.push({atMs:entry.startTime-admissionAt,ms:entry.duration});});
      observer.observe({entryTypes:['gc']});
    }
    // Exercise normal owner eligibility: no explicit enqueue in this harness.
    try{await db.indexesReady();}finally{finished=performance.now();pulse.stop();}
    if(observer){await pause(0);observer.disconnect();for(const reset of restore)reset();}
    assert.equal(db.sequence,sequence);
    report.modelAdmission={ms:finished-admissionAt,...(diagnostic?{trace,gc}:{}),heartbeatMs:summary(pulse.delaysMs),heartbeatSamples:pulse.delaysMs,
      state:db.get('SELECT state,model_sha256,samples,source_commit_hex,extension_sha256,native_version,worker_sha256 FROM vector_training WHERE generation=?',[job.generation]),
      files:files()};if(size>4096)assert.equal(report.modelAdmission.state.state,'ready');else assert.equal(report.modelAdmission.state,undefined);
    const candidates=models.index.candidates.bind(models.index);
    models.index.candidates=(...args)=>{nativeCalls++;return candidates(...args);};
    save();console.log(JSON.stringify({stage:report.modelAdmission.state?'native-model-ready':'native-model-not-required',samples:report.modelAdmission.state?.samples??0,ms:report.modelAdmission.ms}));
  }

  const hits=e.query('Row').near(queryVectors[0],{k:10}).ids();assert.equal(hits.length,10);
  report.automaticAdmission={enqueues:automaticEnqueues,pages:admissionPages,references:admissionReferences,
    firstQueryHits:hits.length,nativeCandidateCalls:nativeCalls,explicitHarnessEnqueues:0};
  if(size>4096){assert.equal(automaticEnqueues,1);assert(nativeCalls>0);}
  else{assert.equal(automaticEnqueues,0);assert.equal(nativeCalls,0);}
  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);
  report.checkpointProbe.filesAfterAdmission=files();
  const checkpointAt=performance.now();
  report.checkpointProbe.finalPassiveCheckpoint=db.sql.pragma('wal_checkpoint(PASSIVE)');
  report.checkpointProbe.finalCheckpointMs=performance.now()-checkpointAt;
  report.checkpointProbe.finalCanonicalRowsVerified=canonicalHash(false);
  report.checkpointProbe.scope='admission-only attribution; manual checkpoint is foreground and not an adopted scheduling solution';
  report.maxRssKiB=process.resourceUsage().maxRSS;
  report.completed=true;save();
} catch(error) {report.failure={message:error.message,stack:error.stack};save();throw error;}
finally {try{await models?.stop();}finally{db?.close();rmSync(path,{recursive:true,force:true});}}
