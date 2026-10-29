// Actual EARS path over the sealed real-model projection. No source IDs or vector payloads in reports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { getLoadablePath } from 'sqlite-vec';
import { createEarsEngine } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorModels } from '../../src/sqlite/vector-models.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';

const [corpusPath, truthFile, sizeArg, output, mode] = process.argv.slice(2), size = Number(sizeArg);
assert([1000,99900].includes(size) && output && !existsSync(output));
assert(mode === undefined || mode === 'diagnose' || mode === 'native-fresh');
const fresh=mode==='native-fresh';
if(fresh)assert(process.env.EARS_VEC1_EXTENSION,'A trusted original native extension is required');
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
  size,diagnostic:mode==='diagnose',partition:fresh?'fresh':'original',native:fresh,
  querySha256:fresh?truth.queriesSha256:manifest.files['queries.f32'].sha256,exclusionsSha256:fresh?truth.exclusionsSha256:null,truthSha256:sha(truthBytes),manifestSha256:sha(manifestBytes),node:process.version,arch:process.arch,
  platform:process.platform,batches:{create:128,embed:64,update:64},cohorts:[]};
const save = () => writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const pct = (values,p) => [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)] ?? null;
const summary = values => ({count:values.length,p50:pct(values,.5),p95:pct(values,.95),p99:pct(values,.99),max:Math.max(...values)});
const files = () => Object.fromEntries(readdirSync(path).map(name=>[name,statSync(join(path,name)).size]));
let db,models,nativeCalls=0;
try {
  db = new SqliteDatabase({path,schema:toElmdbSchema({types:{Row:{required:[],...(fresh?{indexes:['prefix1000','prefix10000','scope10','scope1']}:{}),embed:{from:['title'],model:'public-fixture',dims:1536,chunk:'whole'}}},relations:{},roles:[]})});
  if(fresh)models=new SqliteVectorModels(db,process.env.EARS_VEC1_EXTENSION);
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
  if(fresh) {
    const job=db.indexBuilds.jobs().find(job=>job.type==='Row'&&job.kind==='vector');assert(job);
    assert.equal(db.get(`SELECT count(*) n FROM chunks c JOIN entities e ON e.id=c.entity_id
      WHERE c.generation=? AND e.trashed=0`,[job.generation]).n,
      truth.cohorts.find(c=>c.size===size&&c.phase==='initial'&&c.scopePercent===100).eligible);
    const pulse=startHeartbeat(1),admissionAt=performance.now(),sequence=db.sequence;
    db.sql.exec('BEGIN IMMEDIATE');try{models.enqueue(job);db.commitWrite();}catch(error){if(db.sql.inTransaction)db.sql.exec('ROLLBACK');throw error;}
    try{await db.indexesReady();}finally{pulse.stop();}
    assert.equal(db.sequence,sequence);
    report.modelAdmission={ms:performance.now()-admissionAt,heartbeatMs:summary(pulse.delaysMs),heartbeatSamples:pulse.delaysMs,
      state:db.get('SELECT state,model_sha256,samples,source_commit_hex,extension_sha256,native_version,worker_sha256 FROM vector_training WHERE generation=?',[job.generation]),
      files:files()};assert.equal(report.modelAdmission.state.state,'ready');
    const candidates=models.index.candidates.bind(models.index);
    models.index.candidates=(...args)=>{nativeCalls++;return candidates(...args);};
    save();console.log(JSON.stringify({stage:'native-model-ready',samples:report.modelAdmission.state.samples,ms:report.modelAdmission.ms}));
  }

  if(mode==='diagnose') {
    report.sql=[];report.diagnostics=[];
    const originalAll=db.all.bind(db), originalGet=db.get.bind(db), known=new Map();let stages;
    const describe=value=>value instanceof Uint8Array?{kind:'bytes',length:value.byteLength,sha256:sha(value)}:
      typeof value==='string'?{kind:'string',length:value.length}:{kind:typeof value,value};
    const capture=(method,operation)=>(sql,parameters=[])=>{
      const begin=performance.now(),cpu=process.resourceUsage(),answer=operation(sql,parameters),elapsed=performance.now()-begin,end=process.resourceUsage();
      if(stages) {
        let id=known.get(sql);
        if(id===undefined) {
          id=known.size;known.set(sql,id);
          report.sql.push({id,method,sql,parameters:parameters.map(describe),
            plan:db.sql.prepare('EXPLAIN QUERY PLAN '+sql).all(...parameters)});
        }
        stages.push({id,ms:elapsed,userCpuUs:end.userCPUTime-cpu.userCPUTime,
          systemCpuUs:end.systemCPUTime-cpu.systemCPUTime,rows:Array.isArray(answer)?answer.length:answer?1:0});
        const split=sql.indexOf(') SELECT c.entity_id id,1-min');
        if(split>=0) {
          const first=parameters.findIndex(value=>value instanceof Uint8Array);
          const candidatesSql=sql.slice(0,split)+') SELECT entity_id FROM candidates';
          const before=performance.now(),owners=originalAll(candidatesSql,parameters.slice(0,first+1));
          const candidatesMs=performance.now()-before;
          const rerankSql='WITH candidates AS MATERIALIZED (SELECT value entity_id FROM json_each(?)) '+sql.slice(split+2);
          const rerankParams=[JSON.stringify(owners.map(row=>row.entity_id)),...parameters.slice(first+1)];
          const rerankAt=performance.now(),reranked=originalAll(rerankSql,rerankParams),rerankMs=performance.now()-rerankAt;
          assert.deepEqual(reranked,answer);
          stages.push({kind:'separate-counterfactual',candidatesMs,rerankMs,owners:owners.length,
            candidatesPlan:db.sql.prepare('EXPLAIN QUERY PLAN '+candidatesSql).all(...parameters.slice(0,first+1)),
            rerankPlan:db.sql.prepare('EXPLAIN QUERY PLAN '+rerankSql).all(...rerankParams)});
        }
      }
      return answer;
    };
    db.all=capture('all',originalAll);db.get=capture('get',originalGet);
    try {
      for(const percent of [100,10,1]) {
        const selected=ids.filter((_,i)=>i%100<percent&&i%97!==0&&!excluded.has(i));
        for(let q=0;q<10;q++) {
          stages=[];
          const at=performance.now(),hits=(percent===100?e.query('Row'):e.query.ids(selected)).near(queryVectors[q],{k:10}).hits();
          report.diagnostics.push({percent,q,instrumentedWallMs:performance.now()-at,stages,ordinals:hits.map(hit=>Number(hit.id.slice(4)))});
          stages=undefined;save();
        }
      }
    } finally {db.all=originalAll;db.get=originalGet;}
  } else {
  for(const phase of ['initial','updated']) {
    if(phase==='updated') {
      started=performance.now();
      for(let offset=0;offset<updates.length;offset+=64) e.embed(updates.slice(offset,offset+64).map(({ordinal,...chunk})=>({...chunk,vector:vector((ordinal+31337)%99900)})));
      report.updateMs=performance.now()-started; report.updatedCanonicalRowsVerified=canonicalHash(true);
    }
    for(const cohortSize of [1000,10000,99900].filter(n=>n<=size)) for(const percent of [100,10,1]) {
      const selected=ids.slice(0,cohortSize).filter((_,i)=>i%100<percent&&i%97!==0&&!excluded.has(i));
      const expected=truth.cohorts.find(c=>c.size===cohortSize&&c.phase===phase&&c.scopePercent===percent);assert(expected);
      assert.equal(selected.length,expected.eligible);
      const root=cohortSize===size&&percent===100;
      const record={size:cohortSize,phase,scopePercent:percent,eligible:selected.length,root,passes:[]};report.cohorts.push(record);
      for(let pass=0;pass<4;pass++) {
        const samples=[],pulse=startHeartbeat(1),callsBefore=nativeCalls;
        try {
          for(let q=0;q<100;q++) {
            const begin=performance.now();
            let query=root?e.query('Row'):e.query.ids(selected);
            if(fresh) {
              query=e.query('Row');
              if(cohortSize!==size)query=query.where(cohortSize===1000?'prefix1000':'prefix10000',true);
              if(percent!==100)query=query.where(percent===10?'scope10':'scope1',true);
            }
            const hits=query.near(queryVectors[q],{k:10}).hits();
            const ms=performance.now()-begin,ordinals=hits.map(hit=>Number(hit.id.slice(4))),answer=expected.answers[q].ordinals;
            assert.equal(ordinals.length,answer.length);assert.equal(new Set(ordinals).size,ordinals.length);
            assert(ordinals.every(i=>i>=0&&i<cohortSize&&i%100<percent&&i%97!==0&&!excluded.has(i)));
            assert(hits.every(hit=>Number.isFinite(hit.score)));
            samples.push({q,ms,recall:ordinals.filter(i=>answer.includes(i)).length/answer.length,ordinals,scores:hits.map(hit=>hit.score)});
            await pause(0);
          }
        } finally {pulse.stop();}
        const result={pass,timed:pass!==0,nativeCandidateCalls:nativeCalls-callsBefore,meanRecall:samples.reduce((sum,s)=>sum+s.recall,0)/100,
          latencyMs:summary(samples.map(s=>s.ms)),heartbeatMs:summary(pulse.delaysMs),heartbeatSamples:pulse.delaysMs,samples};
        record.passes.push(result);save();console.log(JSON.stringify({phase,size:cohortSize,percent,pass,meanRecall:result.meanRecall,latency:result.latencyMs}));
      }
    }
  }
  }
  if(fresh) {
    report.gates=report.cohorts.map(cohort=>({size:cohort.size,phase:cohort.phase,scopePercent:cohort.scopePercent,
      passes:cohort.passes.map(pass=>({pass:pass.pass,recall:pass.meanRecall>=.95,heartbeat:pass.heartbeatMs.p99<=16,
        diagnosticLatency:cohort.size<10000||pass.latencyMs.p95<=(cohort.size===10000?100:200)}))}));
    report.frozenGatesPassed=report.gates.every(cohort=>cohort.passes.every(pass=>pass.recall&&pass.heartbeat&&pass.diagnosticLatency));
  }
  report.maxRssKiB=process.resourceUsage().maxRSS; report.filesAfterQueries=files();report.completed=true;save();
} catch(error) {report.failure={message:error.message,stack:error.stack};save();throw error;}
finally {try{await models?.stop();}finally{db?.close();rmSync(path,{recursive:true,force:true});}}
