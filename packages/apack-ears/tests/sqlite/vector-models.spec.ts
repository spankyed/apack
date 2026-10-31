import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorModels } from '../../src/sqlite/vector-models.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { SqliteVectorTraining } from '../../src/sqlite/vector-training.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';
import { startVectorModels, waitForNativeModels, refreshNativeModels, withNativeModelsPaused, rebuildIndexes } from '../../src/sqlite/index.ts';

const held:Array<{db:SqliteDatabase;models:SqliteVectorModels;path:string}>=[];
afterEach(async()=>{
  vi.restoreAllMocks();const all=held.splice(0);for(const {db} of all)db.close();
  for(const {models} of all)await models.stop();
  for(const path of new Set(all.map(s=>s.path)))rmSync(path,{recursive:true,force:true});
});
const schema=toElmdbSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:128,chunk:'paragraph'}}},relations:{},roles:[]});
function own(path:string,fresh=false) {
  const db=new SqliteDatabase({path,syncs:false,...(fresh?{schema}:{})});
  const models=new SqliteVectorModels(db,process.env.EARS_VEC1_EXTENSION!);held.push({db,models,path});
  const e=createEarsEngine({database:db}),job=db.indexBuilds.jobs().find(j=>j.kind==='vector')!;
  const write=<T>(fn:()=>T):T=>{db.sql.exec('BEGIN IMMEDIATE');try{const result=fn();db.commitWrite();return result;}catch(error){if(db.sql.inTransaction)db.sql.exec('ROLLBACK');throw error;}};
  const seed=(count:number)=>{
    const first=Number(db.get('SELECT count(*) n FROM entities')!.n);
    // Pending vectors are ordered by ID; earlier query limits use creation sequence. Keep those aligned.
    e.transact(()=>{for(let i=first;i<first+count;i++)e.create('Row',{id:`Row-${String(i).padStart(6,'0')}`,title:String(i)});});
    let offset=0;
    for(;;) {
      const pending=e.pendingEmbeddings('Row',{limit:1000});if(!pending.chunks.length)break;
      e.embed(pending.chunks.map((c,i)=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((offset+i+1)*(j+1)*1.71))})));
      offset+=pending.chunks.length;
    }
  };
  return {db,models,e,job,write,seed};
}
function fixture(count=512) {const f=own(mkdtempSync(join(tmpdir(),'ears-vector-models-')),true);f.seed(count);return f;}

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite'&&!!process.env.EARS_VEC1_EXTENSION)('durable native model admission',()=>{
  it('automatically admits an eligible committed generation, while small scopes and rolled-back growth stay exact',async()=>{
    const {db,e,models,job,seed}=fixture(4096);
    await db.nativeModelsReady();expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:128,chunk:'paragraph'}},
      Other:{required:[],embed:{from:['title'],model:'other',dims:128}}},relations:{},roles:[]});
    e.create('Other',{title:'other'});const other=e.pendingEmbeddings('Other');
    e.embed(other.chunks.map(c=>({...c,model:other.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    await db.nativeModelsReady();
    const all=db.all.bind(db),pages=vi.spyOn(db,'all').mockImplementation((sql,parameters=[])=>all(sql,parameters));
    e.write('Row-000000').set('unrelated','changed');await db.nativeModelsReady();
    expect(pages.mock.calls.some(([sql])=>sql.startsWith('WITH admission_page AS MATERIALIZED'))).toBe(false);
    const sequence=db.sequence;
    expect(()=>e.transact(()=>{seed(1);throw Error('rollback growth');})).toThrow('rollback growth');
    await db.nativeModelsReady();expect(db.sequence).toBe(sequence);
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.create('Row',{id:'Row-004096',title:'new'});await db.nativeModelsReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const pending=e.pendingEmbeddings('Row');expect(pending.chunks).toHaveLength(1);
    e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    const committed=db.sequence;await db.nativeModelsReady();
    expect(db.get('SELECT state,samples FROM vector_training WHERE generation=?',[job.generation]))
      .toEqual({state:'ready',samples:4097});
    expect(db.sequence).toBe(committed);
    const scanned=pages.mock.calls.filter(([sql])=>sql.startsWith('WITH admission_page AS MATERIALIZED'));
    expect(scanned.length).toBeGreaterThan(0);
    expect(new Set(scanned.map(([,parameters])=>parameters?.[0]))).toEqual(new Set([job.generation]));
    pages.mockClear();
    const known=e.pendingEmbeddings('Row').count;expect(known).toBe(0);
    const original=db.get('SELECT * FROM chunks WHERE entity_id=?',['Row-000000'])!;
    e.embed([{id:'Row-000000',chunk:original.chunk,hash:original.hash,model:original.model,
      vector:Array.from({length:128},(_,j)=>Math.cos((j+1)*1.71))}]);
    await db.nativeModelsReady();
    expect(pages.mock.calls.some(([sql])=>sql.startsWith('WITH admission_page AS MATERIALIZED'))).toBe(false);
    pages.mockRestore();
    const candidates=vi.spyOn(models.index,'candidates');
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    expect(e.query('Row').near(vector,{k:5}).ids()).toHaveLength(5);
    expect(candidates).toHaveBeenCalled();
  });

  it('admits canonical embeddings imported after an initially ineligible generation',async()=>{
    const {db,e}=fixture(4096);await db.nativeModelsReady();
    const id=e.create('Row',{title:'imported'}).id();await db.nativeModelsReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const chunk=db.get('SELECT * FROM chunks WHERE entity_id=?',[id])!;
    db.bulkLoad([{load:'embedding',id,index:chunk.index_name,chunk:chunk.chunk,hash:chunk.hash,model:chunk.model,
      vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))}]);
    const sequence=db.sequence;await db.nativeModelsReady();
    expect(db.get('SELECT state,samples FROM vector_training')).toEqual({state:'ready',samples:4097});
    expect(db.sequence).toBe(sequence);
  });

  it("discovers another connection's committed embeddings when readiness is polled",async()=>{
    const {db}=fixture(4096);await db.nativeModelsReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const peer=new SqliteDatabase({path:db.path,syncs:false});
    try {
      const other=createEarsEngine({database:peer});other.create('Row',{id:'Row-004096',title:'peer'});
      const pending=other.pendingEmbeddings('Row');expect(pending.chunks).toHaveLength(1);
      other.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    }finally{peer.close();}
    const sequence=db.sequence;await db.nativeModelsReady();
    expect(db.get('SELECT state,samples FROM vector_training')).toEqual({state:'ready',samples:4097});
    expect(db.sequence).toBe(sequence);
  });

  it('requires enough live distinct owners and rechecks eligibility after restoring trashed chunks',async()=>{
    const {db,e,seed}=fixture(0);
    const first=e.create('Row',{title:Array.from({length:4100},(_,i)=>`part ${i}`).join('\n\n')}).id();
    seed(0);await db.nativeModelsReady();
    expect(db.get('SELECT count(*) n FROM chunks WHERE embedding_id IS NOT NULL')!.n).toBe(4100);
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    seed(254);await db.nativeModelsReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.write(first).trash();seed(1);await db.nativeModelsReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.write(first).restore();const sequence=db.sequence;await db.nativeModelsReady();
    expect(db.get('SELECT state,samples FROM vector_training')).toEqual({state:'ready',samples:4355});
    expect(db.sequence).toBe(sequence);
  });

  it('bounds eligibility to metadata pages and retries the same enqueue after its commit is refused',async()=>{
    const {db,e,job}=fixture(4097);let sequence=db.sequence;
    const all=db.all.bind(db);const pages:number[]=[];let plan:Array<Record<string,any>>=[];
    db.all=(sql,parameters=[])=>{
      const rows=all(sql,parameters);
      if(sql.startsWith('WITH admission_page AS MATERIALIZED')) {
        pages.push(rows.length);expect(rows.every(row=>!Object.values(row).some(value=>value instanceof Uint8Array))).toBe(true);
        plan=all('EXPLAIN QUERY PLAN '+sql,parameters);
      }
      return rows;
    };
    const exec=db.sql.exec.bind(db.sql);let refused=false;
    const commit=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{
      if(sql==='COMMIT'&&!refused&&db.get("SELECT 1 FROM vector_training WHERE state='pending'")) {
        refused=true;throw Object.assign(Error('refuse automatic enqueue'),{code:'SQLITE_BUSY'});
      }
      return exec(sql);
    });
    let outcome:string|undefined;
    for(let i=0;i<100&&!refused;i++) {
      // Relevant commits keep arriving, but do not change the captured range of stored vectors.
      // Restarting eligibility on every revision would never reach the enqueue below.
      e.create('Row',{id:`Row-extra-${i}`,title:`unembedded ${i}`});sequence=db.sequence;
      outcome=db.indexBuilds.step();
    }
    expect(refused).toBe(true);expect(outcome).toBe('busy');
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();expect(db.sequence).toBe(sequence);
    commit.mockRestore();await db.nativeModelsReady();
    expect(db.get('SELECT state FROM vector_training WHERE generation=?',[job.generation])!.state).toBe('ready');
    expect(pages.length).toBeGreaterThan(32);expect(Math.max(...pages)).toBeLessThanOrEqual(128);
    expect(plan.some(row=>String(row.detail).includes('chunk_native_admission')&&String(row.detail).includes('embedding_id>?'))).toBe(true);
  });

  it('discovers rebuilt generations without a logical commit and skips unsupported training dimensions',async()=>{
    const {db,e,job}=fixture(4097);await db.nativeModelsReady();const sequence=db.sequence;
    db.rebuildIndexes();await db.nativeModelsReady();
    const rebuilt=db.indexBuilds.jobs().find(j=>j.kind==='vector')!;
    expect(rebuilt.generation).not.toBe(job.generation);expect(db.sequence).toBe(sequence);
    expect(db.get('SELECT state,samples FROM vector_training WHERE generation=?',[rebuilt.generation]))
      .toEqual({state:'ready',samples:4097});
    e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:128,chunk:'paragraph'}},
      Other:{required:[],embed:{from:['title'],model:'small',dims:8}}},relations:{},roles:[]});
    e.create('Other',{title:'small'});const pending=e.pendingEmbeddings('Other');
    e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:[1,0,0,0,0,0,0,0]})));
    await db.nativeModelsReady();const small=db.indexBuilds.jobs().find(j=>j.kind==='vector'&&j.type==='Other')!;
    expect(db.get('SELECT 1 FROM vector_training WHERE generation=?',[small.generation])).toBeUndefined();
    expect(e.query('Other').near([1,0,0,0,0,0,0,0],{k:1}).ids()).toHaveLength(1);
  });

  it('does not enqueue or keep polling a failed logical generation with a large partial projection',async()=>{
    const {db,e,models}=fixture(4608);await db.nativeModelsReady();
    const refile=db.search.refileIndex.bind(db.search);let rows=0;
    const failure=vi.spyOn(db.search,'refileIndex').mockImplementation((row,seq,job)=>{
      if(job.kind==='vector'&&++rows>4200)throw Error('fixture projection failure');
      return refile(row,seq,job);
    });
    db.rebuildIndexes();await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'INDEX_FAILED'});
    failure.mockRestore();
    const failed=db.indexBuilds.jobs().find(job=>job.kind==='vector'&&job.state==='failed')!;
    expect(failed).toBeDefined();
    expect(db.get('SELECT count(*) n FROM chunks WHERE generation=? AND embedding_id IS NOT NULL',[failed.generation])!.n)
      .toBeGreaterThan(4096);
    // Retirement may still own the previous model. Each cleanup step must retire at least one row;
    // allow that finite work plus catalog cleanup without mistaking it for failed-generation polling.
    const enqueue=vi.spyOn(models,'enqueue'),cleanupBudget=e.query('Row').count()+32;
    for(let i=0;i<cleanupBudget&&models.hasWork();i++)db.indexBuilds.step();
    expect(models.hasWork()).toBe(false);
    expect(enqueue.mock.calls.some(([job])=>job.generation===failed.generation)).toBe(false);
    expect(db.get('SELECT 1 FROM vector_training WHERE generation=?',[failed.generation])).toBeUndefined();
    expect(e.query('Row').count()).toBe(4608);
  });

  it('uses the shared scheduler to train, project and publish readiness without logical commits',async()=>{
    const {db,e,models,job,write}=fixture(),sequence=db.sequence,events:number[]=[];
    const off=db.onIndexesChanged(changes=>events.push(changes.sequence));
    try {
      write(()=>models.enqueue(job));await db.nativeModelsReady();
      const state=db.get('SELECT * FROM vector_training WHERE generation=?',[job.generation])!;
      expect(state.state).toBe('ready');expect(state.model).toBeNull();expect(state.samples).toBe(512);
      expect(state.extension_sha256).toMatch(/^[a-f0-9]{64}$/);expect(db.sequence).toBe(sequence);
      expect(events).toEqual([sequence]);
      expect(models.index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),100)).toHaveLength(100);
      e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'replacement',dims:128}}},relations:{},roles:[]});
      await db.nativeModelsReady();
      for(let i=0;i<1000&&db.get('SELECT 1 FROM index_gc WHERE generation=?',[job.generation]);i++)db.indexBuilds.step();
      expect(db.get('SELECT 1 FROM vector_indexes WHERE generation=?',[job.generation])).toBeUndefined();
      expect(db.get("SELECT 1 FROM sqlite_schema WHERE name GLOB 'ann_[0-9]*'")).toBeUndefined();
      expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(512);
      expect(()=>models.index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),1)).toThrow(expect.objectContaining({code:'SCHEMA_CHANGED'}));
    }finally{off();}
  });

  it('routes real EARS queries through ready native candidates with scoped exact fallbacks and unit visibility',async()=>{
    const {db,e,models,job,write}=fixture(4608);
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    const native=vi.spyOn(models.index,'candidates');
    const original=e.query('Row').near(vector,{k:1}).ids();expect(native).not.toHaveBeenCalled();
    write(()=>models.enqueue(job));await db.nativeModelsReady();
    const hits=e.query('Row').near(vector,{k:20}).hits();
    expect(native).toHaveBeenCalled();expect(hits).toHaveLength(20);expect(hits[0]!.id).toBe(original[0]);
    expect(hits[0]!.score).toBeCloseTo(1);
    native.mockClear();
    expect(e.query.ids(original[0]!).near(vector,{k:1}).ids()).toEqual(original);
    expect(native).not.toHaveBeenCalled();
    e.query('Row').near(vector,{k:33}).ids();expect(native).not.toHaveBeenCalled();
    expect(()=>e.transact(()=>{
      e.write(original[0]!).trash();expect(e.query('Row').near(vector,{k:1}).ids()).not.toContain(original[0]);
      throw Error('rollback native query');
    })).toThrow('rollback native query');
    expect(e.query('Row').near(vector,{k:1}).ids()).toEqual(original);
    expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(4608);
  });

  it('loads trusted native candidates on independent readers and writers without creating training owners',async()=>{
    const {db,e,models}=fixture(4608);await db.nativeModelsReady();
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    const expected=e.query('Row').near(vector,{k:20}).ids();
    const training=db.all('SELECT generation,state,attempt,model_sha256 FROM vector_training');
    const extension=process.env.EARS_VEC1_EXTENSION!;
    const native=vi.spyOn(SqliteVectorIndex.prototype,'candidates');
    const reader=new SqliteDatabase({path:db.path,readOnly:true,nativeVectorExtension:extension});
    let peer:SqliteDatabase|undefined;
    try {
      const read=createEarsEngine({database:reader});native.mockClear();
      expect(read.query('Row').near(vector,{k:20}).ids()).toEqual(expected);expect(native).toHaveBeenCalled();
      expect(()=>read.create('Row',{title:'refused'})).toThrow(expect.objectContaining({code:'READ_ONLY'}));
      peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:extension});
      const writer=createEarsEngine({database:peer});
      expect(()=>peer!.loadNativeVectors('untrusted-relative.so')).toThrow(expect.objectContaining({code:'VALUE_INVALID'}));
      expect(()=>peer!.loadNativeVectors(join(db.path,'other.so'))).toThrow(expect.objectContaining({code:'NATIVE_CHANGED'}));
      expect(()=>writer.transact(()=>{writer.write(expected[0]!).trash();throw Error('rollback peer');})).toThrow('rollback peer');
      expect(read.query('Row').near(vector,{k:20}).ids()).toEqual(expected);
      writer.write(expected[0]!).trash();native.mockClear();
      expect(read.query('Row').near(vector,{k:20}).ids()).not.toContain(expected[0]);expect(native).toHaveBeenCalled();
      const row=writer.create('Row',{id:'Row-peer-new',title:'peer new'});
      const pending=writer.pendingEmbeddings('Row');writer.embed(pending.chunks.map(c=>({...c,model:pending.model,vector})));
      expect(read.query('Row').near(vector,{k:20}).ids()).toContain(row.id());
      expect(peer.all('SELECT generation,state,attempt,model_sha256 FROM vector_training')).toEqual(training);
      expect(models.hasWork()).toBe(true); // Existing owner observes the peer commit; no peer trainer was created.
      const release=peer.claimVectorTrainingOwner();expect(release).toBeTypeOf('function');release();
    } finally {peer?.close();reader.close();}
  });

  it('retains the trusted connection loader in native-bearing export and private audit copies',async()=>{
    const {db}=fixture(4608);await db.nativeModelsReady();
    const load=vi.spyOn(SqliteDatabase.prototype,'loadNativeVectors');
    let bytes=0;for await(const chunk of exportLogicalSnapshot(db))bytes+=chunk.byteLength;
    expect(bytes).toBeGreaterThan(0);expect(load).toHaveBeenCalledWith(db.nativeVectorExtension);
    load.mockClear();const report=await auditSqliteDatabase(db);
    expect(report.ok).toBe(true);expect(load.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(load.mock.calls.every(([path])=>path===db.nativeVectorExtension)).toBe(true);
  });

  it('expands repeated chunk owners, reranks canonical chunks and preserves ties, scopes and like exclusions',async()=>{
    const {db,e,models,job,write}=fixture(4608);
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    const first=e.query('Row').near(vector,{k:1}).ids()[0]!;
    write(()=>models.enqueue(job));await db.nativeModelsReady();
    const repeated=e.create('Row',{title:Array.from({length:300},(_,i)=>`paragraph ${i}`).join('\n\n')}).id();
    const tied=e.create('Row',{title:'tie'}).id();
    const pending=e.pendingEmbeddings('Row',{limit:1000});expect(pending.chunks).toHaveLength(301);
    e.embed(pending.chunks.map(chunk=>({...chunk,model:pending.model,vector:
      chunk.id===repeated&&chunk.chunk===0?vector.map(value=>-value):vector})));
    const actual=models.index.candidates.bind(models.index);
    const native=vi.spyOn(models.index,'candidates');
    const hits=e.query('Row').near(vector,{k:3}).hits();
    expect(hits.map(hit=>hit.id)).toEqual([first,repeated,tied]);
    expect(hits.every(hit=>Math.abs(hit.score-1)<1e-5)).toBe(true);
    expect(native.mock.calls.map(call=>call[2])).toContain(512);
    expect(native.mock.calls.map(call=>call[2])).toContain(1024);
    expect(native.mock.calls.every(call=>call[2]<=4096)).toBe(true);
    native.mockClear();
    const scoped=e.query('Row').limit(4500).near(vector,{k:3}).ids();
    expect(scoped[0]).toBe(first);expect(scoped).not.toContain(repeated);expect(scoped).not.toContain(tied);
    expect(native).toHaveBeenCalled();expect(native.mock.calls.every(call=>call[3]!==null)).toBe(true);
    expect(e.query('Row').like(first,{k:2}).ids()).toEqual([repeated,tied]);
    // Independently count actual scope execution: selected owners must not run the scope a third
    // time during canonical reranking. Keep native selection real, including owner-cap expansion.
    let inRerank=false,scopeCalls=0,rerankScopeCalls=0;
    db.sql.function('vector_scope_probe',(_id)=>{scopeCalls++;if(inRerank)rerankScopeCalls++;return 1;});
    const all=db.all.bind(db);
    const statements=vi.spyOn(db,'all').mockImplementation((sql,parameters=[])=>{
      inRerank=sql.startsWith('SELECT c.entity_id id,');
      try{return all(sql,parameters);}finally{inRerank=false;}
    });
    const scopeIds=e.query('Row').limit(4500).ids();
    db.sql.exec('BEGIN');
    try {
      const selected=db.search.vectors.search({
        sql:'SELECT id FROM entities WHERE id IN (SELECT value FROM json_each(?)) AND vector_scope_probe(id)',
        parameters:[JSON.stringify(scopeIds)],
      },'Row',job.name,job.generation,128,vector,3);
      expect(selected.map(row=>row.id)).toEqual(scoped);
      expect(scopeCalls).toBeGreaterThan(0);
      expect(rerankScopeCalls).toBe(0);
    } finally {db.sql.exec('ROLLBACK');statements.mockRestore();}

    // Native candidate distances are advisory: canonical owner scoring must still compute the answer.
    native.mockImplementation((...args)=>actual(...args).map(row=>({...row,distance:12345})));
    expect(e.query('Row').near(vector,{k:3}).hits()).toEqual(hits);
    expect(()=>e.transact(()=>{
      e.write(repeated).set('title','changed');
      expect(e.query('Row').near(vector,{k:3}).ids()).not.toContain(repeated);
      throw Error('rollback multi-chunk edit');
    })).toThrow('rollback multi-chunk edit');
    expect(e.query('Row').near(vector,{k:3}).hits()).toEqual(hits);
  });

  it('keeps native candidates available to owners and peer readers during pending and failed physical refresh',async()=>{
    const {db,e,models,job,write}=fixture(4608);await db.nativeModelsReady();
    const incumbent=models.index.ready(job.generation)!.id,sequence=db.sequence;
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    const before=e.query('Row').near(vector,{k:1}).ids();
    const native=vi.spyOn(models.index,'candidates'),start=vi.spyOn(models,'start').mockReturnValue(false);
    write(()=>models.refresh(job.generation));await db.indexesReady();
    expect(e.query('Row').near(vector,{k:1}).ids()).toEqual(before);expect(native).toHaveBeenCalled();
    const peer=new SqliteDatabase({path:db.path,readOnly:true,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
    try {
      const reader=createEarsEngine({database:peer}),candidate=vi.spyOn(peer,'nativeVectorOwners');
      expect(reader.query('Row').near(vector,{k:1}).ids()).toEqual(before);expect(candidate.mock.results.some(result=>Array.isArray(result.value))).toBe(true);
    }finally{peer.close();}
    const training=vi.spyOn(SqliteVectorTraining.prototype,'train').mockRejectedValueOnce(Object.assign(Error('refresh failed'),{code:'TRAINING_FAILED'}));
    start.mockRestore();db.indexBuilds.wake();
    await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'INDEX_FAILED'});training.mockRestore();
    expect(JSON.parse(db.get('SELECT error FROM vector_training')!.error)).toEqual({message:'refresh failed',code:'TRAINING_FAILED'});
    native.mockClear();expect(e.query('Row').near(vector,{k:1}).ids()).toEqual(before);expect(native).toHaveBeenCalled();
    expect(models.index.ready(job.generation)!.id).toBe(incumbent);expect(db.sequence).toBe(sequence);
    write(()=>models.retry(job.generation));await db.nativeModelsReady();
    expect(models.index.ready(job.generation)!.id).not.toBe(incumbent);
    expect(db.all('SELECT id,state FROM vector_indexes')).toEqual([{id:models.index.ready(job.generation)!.id,state:'ready'}]);
    expect(db.sequence).toBe(sequence);expect(e.query('Row').near(vector,{k:1}).ids()).toEqual(before);
  });

  it('resumes an interrupted private projection after reopening without sacrificing the incumbent',async()=>{
    const first=fixture();first.write(()=>first.models.enqueue(first.job));await first.db.nativeModelsReady();
    const incumbent=first.models.index.ready(first.job.generation)!.id,sequence=first.db.sequence;
    const wake=vi.spyOn(first.db.indexBuilds,'wake').mockImplementation(()=>{});
    first.write(()=>first.models.refresh(first.job.generation));expect(first.models.start()).toBe(true);await first.models.settled();
    first.write(()=>first.models.step()).accept();first.write(()=>first.models.step()).accept();
    expect(first.db.get('SELECT state FROM vector_training')!.state).toBe('projecting');
    first.write(()=>first.models.step()).accept();
    const replacement=first.db.get("SELECT id,after_id FROM vector_indexes WHERE state='building'")!;
    expect(replacement.after_id).toBeGreaterThan(0);
    expect(first.models.index.ready(first.job.generation)!.id).toBe(incumbent);
    const projection=vi.spyOn(first.models.index,'step').mockImplementationOnce(()=>{throw Object.assign(Error('injected projection refusal'),{code:'SQLITE_IOERR'});});
    expect(()=>first.write(()=>first.models.step())).toThrow('injected projection refusal');projection.mockRestore();
    expect(first.models.index.ready(first.job.generation)!.id).toBe(incumbent);
    wake.mockRestore();await first.models.stop();first.db.close();
    const reopened=own(first.db.path);expect(reopened.models.index.ready(first.job.generation)!.id).toBe(incumbent);
    await reopened.db.nativeModelsReady();
    expect(reopened.models.index.ready(first.job.generation)!.id).toBe(replacement.id);
    expect(reopened.db.sequence).toBe(sequence);expect(reopened.e.query('Row').count()).toBe(512);
  });

  it('admits public refresh durably without holding write exclusion through background training',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));await db.nativeModelsReady();
    const incumbent=models.index.ready(job.generation)!.id,sequence=db.sequence,jobs=db.indexBuilds.jobs();
    const unit=db.begin();await expect(refreshNativeModels(db)).rejects.toMatchObject({code:'UNIT_OPEN'});unit.abort();
    await refreshNativeModels(db);
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('pending');
    expect(db.sequence).toBe(sequence);expect(db.indexBuilds.jobs()).toEqual(jobs);
    expect(models.index.ready(job.generation)!.id).toBe(incumbent);
    expect(()=>e.create('Row',{title:'write during refresh'})).not.toThrow();
    await waitForNativeModels(db);expect(models.index.ready(job.generation)!.id).not.toBe(incumbent);
    await models.stop();await expect(refreshNativeModels(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
  });

  it('drains the real worker while retaining the service claim and logical readiness through nested maintenance',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));expect(models.start()).toBe(true);
    const waiting=db.nativeModelsReady(),cancelled=expect(waiting).rejects.toMatchObject({code:'BACKGROUND_PAUSED'});
    let release!:()=>void,drained=false,entered=false;const gate=new Promise<void>(resolve=>{release=resolve;});
    const stop=SqliteVectorTraining.prototype.stop;
    vi.spyOn(SqliteVectorTraining.prototype,'stop').mockImplementationOnce(async function(this:SqliteVectorTraining){await stop.call(this);drained=true;await gate;});
    const maintenance=withNativeModelsPaused(db,async()=>{
      entered=true;expect(models.isPaused).toBe(true);expect(models.start()).toBe(false);
      await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'BACKGROUND_PAUSED'});
      await withNativeModelsPaused(db,async()=>{expect(models.isPaused).toBe(true);});
      expect(models.isPaused).toBe(true);
      e.admin.declare({types:{Later:{required:[]}},relations:{},roles:[]});
      e.transact(()=>{for(let i=0;i<150;i++)e.create('Later',{title:'maintenance marker'});});
      e.admin.declare({types:{Later:{required:[],substrings:['title']}},relations:{},roles:[]});
      await db.indexesReady();expect(e.query('Later').matching('marker').count()).toBe(150);
      return 42;
    });
    await vi.waitFor(()=>expect(drained).toBe(true),{timeout:5000});expect(entered).toBe(false);
    const peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
    try {
      expect(()=>new SqliteVectorModels(peer,process.env.EARS_VEC1_EXTENSION!)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      expect(()=>e.create('Row',{title:'outside maintenance'})).toThrow(expect.objectContaining({code:'WRITE_PAUSED'}));
    }finally{peer.close();release();}
    await expect(maintenance).resolves.toBe(42);await cancelled;
    expect(models.isPaused).toBe(false);await db.nativeModelsReady();
    expect(db.get('SELECT state FROM vector_training WHERE generation=?',[job.generation])!.state).toBe('ready');
  });

  it('rolls back a refused corpus epoch and invalidates the old model on successful same-schema replacement',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));await db.nativeModelsReady();
    const incumbent=models.index.ready(job.generation)!.id,sequence=db.sequence,source=fixture();
    source.e.write('Row-000000').set('title','imported corpus');
    const exec=db.sql.exec.bind(db.sql),failure=Object.assign(Error('replacement commit refused'),{code:'SQLITE_BUSY'});let refused=false;
    const commit=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{if(sql==='COMMIT'&&!refused){refused=true;throw failure;}return exec(sql);});
    await expect(withNativeModelsPaused(db,async()=>{db.replaceWith(source.db.path);})).rejects.toBe(failure);commit.mockRestore();
    expect(models.index.ready(job.generation)!.id).toBe(incumbent);expect(db.sequence).toBe(sequence);
    expect(e.getRow('Row-000000')?.title).toBe('0');
    await withNativeModelsPaused(db,async()=>{
      db.replaceWith(source.db.path);await db.indexesReady();
      expect(e.getRow('Row-000000')?.title).toBe('imported corpus');
      expect(models.index.ready(job.generation)).toBeUndefined();
      expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
      expect(db.get('SELECT state FROM vector_indexes WHERE id=?',[incumbent])!.state).toBe('retiring');
    });
    await db.nativeModelsReady();expect(models.index.ready(job.generation)).toBeUndefined();
    expect(db.get('SELECT 1 FROM vector_indexes')).toBeUndefined();expect(db.sequence).toBe(sequence+1);
  });

  it('keeps cleared data usable and permits physical cleanup only after the paused worker has exited',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));expect(models.start()).toBe(true);
    await withNativeModelsPaused(db,async()=>{
      e.admin.clear();e.create('Row',{id:'Row-reset',title:'new corpus'});await db.indexesReady();
      expect(e.query('Row').ids()).toEqual(['Row-reset']);expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    });
    await db.nativeModelsReady();expect(e.query('Row').ids()).toEqual(['Row-reset']);
    await withNativeModelsPaused(db,async()=>{db.close();rmSync(db.path,{recursive:true,force:true});});
    expect(db.isOpen).toBe(false);expect(models.isPaused).toBe(false);
  });

  it('retains both maintenance and resume failures and releases a failed service for explicit restart',async()=>{
    const {db}=fixture(0),original=Object.assign(Error('maintenance refused'),{code:'MAINTENANCE_REFUSED'});
    const recovery=Object.assign(Error('native recovery refused'),{code:'SQLITE_IOERR'});
    vi.spyOn(SqliteVectorModels.prototype,'recover').mockImplementationOnce(()=>{throw recovery;});
    let failure:unknown;try{await withNativeModelsPaused(db,async()=>{throw original;});}catch(error){failure=error;}
    expect(failure).toMatchObject({code:'MAINTENANCE_REFUSED',backgroundRecoveryFailed:true,cause:original});
    expect((failure as AggregateError).errors).toEqual([original,recovery]);
    await startVectorModels(db);await waitForNativeModels(db);await db.drainBackground();
  });

  it('excludes another service during offline maintenance without starting a trainer',async()=>{
    const {db,models}=fixture();await models.stop();
    const peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
    let owner:SqliteVectorModels|undefined;
    try {
      await withNativeModelsPaused(db,async()=>{
        await expect(waitForNativeModels(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
        await expect(startVectorModels(db)).rejects.toMatchObject({code:'BACKGROUND_PAUSED'});
        await withNativeModelsPaused(db,async()=>{});
        expect(()=>new SqliteVectorModels(peer,process.env.EARS_VEC1_EXTENSION!)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      });
      await expect(waitForNativeModels(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
      owner=new SqliteVectorModels(peer,process.env.EARS_VEC1_EXTENSION!);
      let entered=false;await expect(withNativeModelsPaused(db,async()=>{entered=true;})).rejects.toMatchObject({code:'BACKGROUND_OWNER_EXISTS'});
      expect(entered).toBe(false);await owner.stop();
    }finally{await owner?.stop();peer.close();}
    await withNativeModelsPaused(db,async()=>{db.close();rmSync(db.path,{recursive:true,force:true});});
    expect(db.isOpen).toBe(false);
  });

  it('aborts a unit left open by maintenance before releasing write exclusion',async()=>{
    const {db,e}=fixture(0);const units:Array<ReturnType<SqliteDatabase['begin']>>=[];
    await expect(withNativeModelsPaused(db,async()=>{units.push(db.begin());})).rejects.toMatchObject({code:'UNIT_OPEN',backgroundRecoveryFailed:true});
    expect(units[0]!.isOpen).toBe(false);expect(db.sql.inTransaction).toBe(false);
    expect(()=>e.create('Row',{title:'after refused maintenance'})).not.toThrow();
    await expect(withNativeModelsPaused(db,async()=>{units.push(db.begin());})).rejects.toMatchObject({code:'UNIT_OPEN'});
    expect(units).toHaveLength(2);expect(units.every(unit=>!unit.isOpen)).toBe(true);
    await startVectorModels(db);await waitForNativeModels(db);await db.drainBackground();
  });

  it('refuses stale handles before maintenance and before resuming a paused service',async()=>{
    for(const point of ['entry','resume']) {
      const {db,models}=fixture(0),peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
      const change=()=>peer.setSchema(toElmdbSchema({types:{Row:{required:[],embed:{from:['title'],model:'replacement',dims:128}}},relations:{},roles:[]}));
      let entered=false;
      try {
        if(point==='entry')change();
        await expect(withNativeModelsPaused(db,async()=>{entered=true;if(point==='resume')change();})).rejects.toMatchObject({code:'SCHEMA_CHANGED'});
        expect(entered).toBe(point==='resume');expect(models.isPaused).toBe(false);
      }finally{peer.close();}
    }
  });

  it('drains training during rebuild and resumes the retained service with fresh logical generations',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));expect(models.start()).toBe(true);
    const sequence=e.lastCommit(),vectors=db.all('SELECT * FROM embedding_values ORDER BY id');
    await rebuildIndexes(db);expect(models.isPaused).toBe(false);
    expect(db.indexBuilds.jobs().find(current=>current.kind==='vector')!.generation).not.toBe(job.generation);
    expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(vectors);expect(e.lastCommit()).toBe(sequence);
    expect(db.get('SELECT 1 FROM vector_indexes')).toBeUndefined();await db.nativeModelsReady();
    expect(await auditSqliteDatabase(db)).toMatchObject({ok:true,comparedNativeModels:0});
  });

  it('drains and closes a quarantined unknown-commit handle while preserving its committed data for inspection',async()=>{
    const {db,e,models,job,write}=fixture();write(()=>models.enqueue(job));expect(models.start()).toBe(true);
    const exec=db.sql.exec.bind(db.sql),cause=Object.assign(Error('commit acknowledgement lost'),{code:'SQLITE_IOERR'});let injected=false;
    const fault=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{const result=exec(sql);if(sql==='COMMIT'&&!injected){injected=true;throw cause;}return result;});
    expect(()=>e.create('Row',{id:'Row-unknown-commit',title:'inspect after reopen'})).toThrow(expect.objectContaining({code:'COMMIT_UNKNOWN'}));fault.mockRestore();
    await db.withExclusiveWrites(async()=>{
      expect(()=>e.query('Row').count()).toThrow(expect.objectContaining({code:'COMMIT_UNKNOWN'}));
      expect(()=>e.create('Row',{title:'must refuse'})).toThrow(expect.objectContaining({code:'COMMIT_UNKNOWN'}));
      await db.drainBackground();db.close();
    });
    expect(db.isOpen).toBe(false);await models.stop();
    const reopened=own(db.path);reopened.write(()=>reopened.models.recover());
    expect(reopened.e.getRow('Row-unknown-commit')?.title).toBe('inspect after reopen');
    await reopened.db.nativeModelsReady();
  });

  it('retains a completed model when its result transaction rolls back before acknowledgement',async()=>{
    const {db,models,job,write}=fixture();write(()=>models.enqueue(job));expect(models.start()).toBe(true);await models.settled();
    db.sql.exec('BEGIN IMMEDIATE');const first=models.step();expect(first.progressed).toBe(true);
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('trained');db.sql.exec('ROLLBACK');
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('training');
    db.sql.exec('BEGIN IMMEDIATE');const replay=models.step();expect(replay.progressed).toBe(true);db.sql.exec('ROLLBACK');
    // Refuse the shared scheduler's actual result COMMIT, while SQLite still owns the transaction.
    const exec=db.sql.exec.bind(db.sql);let refused=false;
    vi.spyOn(db.sql,'exec').mockImplementation(sql=>{
      if(sql==='COMMIT'&&!refused){refused=true;throw Object.assign(new Error('injected result commit refusal'),{code:'SQLITE_BUSY'});}
      return exec(sql);
    });
    expect(db.indexBuilds.step()).toBe('busy');expect(refused).toBe(true);
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('training');
    db.sql.exec('BEGIN IMMEDIATE');const retained=models.step();expect(retained.progressed).toBe(true);db.sql.exec('ROLLBACK');
    await db.nativeModelsReady();expect(db.get('SELECT state FROM vector_training')!.state).toBe('ready');
  });

  it('recovers abandoned attempts and resumes committed model work after reopening',async()=>{
    const first=fixture();first.write(()=>first.models.enqueue(first.job));expect(first.models.start()).toBe(true);
    await first.models.settled();
    // A replacement attempt must never inherit this completed older response.
    first.write(()=>first.db.run("UPDATE vector_training SET attempt='replacement-attempt'"));
    const stale=first.write(()=>first.models.step());stale.accept();
    expect(first.db.get('SELECT state,attempt,model FROM vector_training')).toEqual({state:'training',attempt:'replacement-attempt',model:null});
    await first.models.stop();
    expect(first.db.get('SELECT state FROM vector_training')!.state).toBe('training');
    const path=first.db.path,sequence=first.db.sequence;first.db.close();
    const next=own(path);next.write(()=>next.models.recover());
    expect(next.db.get('SELECT state FROM vector_training')!.state).toBe('pending');
    expect(next.models.start()).toBe(true);await next.models.settled();
    const accepted=next.write(()=>next.models.step());accepted.accept();
    const hash=next.db.get('SELECT model_sha256 FROM vector_training')!.model_sha256;
    expect(next.db.get('SELECT state FROM vector_training')!.state).toBe('trained');
    await next.models.stop();next.db.close();
    const resumed=own(path);resumed.write(()=>resumed.models.recover());await resumed.db.nativeModelsReady();
    expect(resumed.db.get('SELECT state,model_sha256 FROM vector_training')).toEqual({state:'ready',model_sha256:hash});
    expect(resumed.db.sequence).toBe(sequence);
  });

  it('persists failure and supports explicit retry after additional primary embeddings',async()=>{
    const {db,e,models,job,write,seed}=fixture(8);write(()=>models.enqueue(job));
    await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'INDEX_FAILED'});
    expect(JSON.parse(db.get('SELECT error FROM vector_training')!.error).code).toBe('TRAINING_DATA');
    expect(e.query('Row').count()).toBe(8);seed(512);write(()=>models.retry(job.generation));await db.nativeModelsReady();
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('ready');
    expect(e.query('Row').count()).toBe(520);
  });

  it('recovers abandoned attempts only after claiming managed model ownership',async()=>{
    const {db,models,job,write}=fixture();
    write(()=>{models.enqueue(job);db.run("UPDATE vector_training SET state='training',attempt='abandoned'");});
    await models.stop();
    await expect(waitForNativeModels(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
    await startVectorModels(db);
    expect(db.get('SELECT state,attempt FROM vector_training')).toEqual({state:'pending',attempt:null});
    const peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
    try {
      await expect(startVectorModels(peer)).rejects.toMatchObject({code:'BACKGROUND_OWNER_EXISTS'});
      expect(db.get('SELECT state,attempt FROM vector_training')).toEqual({state:'pending',attempt:null});
    } finally {peer.close();}
    await waitForNativeModels(db);
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('ready');
    await db.drainBackground();
  });

  it('releases a failed managed startup claim and preserves its original recovery error',async()=>{
    const {db,models}=fixture();await models.stop();
    const failure=Object.assign(new Error('fixture recovery refusal'),{code:'SQLITE_IOERR'});
    const recover=vi.spyOn(SqliteVectorModels.prototype,'recover').mockImplementationOnce(()=>{throw failure;});
    await expect(startVectorModels(db)).rejects.toBe(failure);
    expect(db.sql.inTransaction).toBe(false);recover.mockRestore();
    await startVectorModels(db);await waitForNativeModels(db);await db.drainBackground();
  });

  it('refuses native ownership on a read-only connection without creating a service',async()=>{
    const {db,models}=fixture();await models.stop();
    const reader=new SqliteDatabase({path:db.path,readOnly:true,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});
    try {
      await expect(startVectorModels(reader)).rejects.toMatchObject({code:'READ_ONLY'});
      await expect(waitForNativeModels(reader)).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
      await expect(reader.indexesReady()).resolves.toBeUndefined();
    } finally {reader.close();}
  });

  it('keeps logical readiness usable while optional native work is pending or failed',async()=>{
    const {db,e,models,job,write}=fixture();
    vi.spyOn(models,'start').mockReturnValue(false);write(()=>models.enqueue(job));
    await db.indexesReady();let complete=false;
    const native=db.nativeModelsReady().then(()=>{complete=true;});
    const failed=expect(native).rejects.toMatchObject({code:'INDEX_FAILED'});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(complete).toBe(false);expect(e.query('Row').count()).toBe(512);
    write(()=>db.run("UPDATE vector_training SET state='failed',error=?",[JSON.stringify({code:'TRAINING_FAILED',message:'fixture'})]));
    db.indexBuilds.wake();await failed;
    await expect(db.indexesReady()).resolves.toBeUndefined();
    await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'INDEX_FAILED'});
  });

  it('settles logical backfill independently when a native waiter is cancelled by stopping its owner',async()=>{
    const {db,e,models}=fixture();db.rebuildIndexes();
    const logical=db.indexesReady(),native=db.nativeModelsReady();
    const cancelled=expect(native).rejects.toMatchObject({code:'CANCELLED'});
    await models.stop();await cancelled;await logical;
    expect(e.query('Row').count()).toBe(512);
    await expect(db.nativeModelsReady()).rejects.toMatchObject({code:'BACKGROUND_OWNER_REQUIRED'});
  });

  it('does not misreport a committed primary write when a background readiness probe fails',()=>{
    const {db,e,models}=fixture(),sequence=db.sequence;
    const failure=Object.assign(new Error('fixture model metadata read failure'),{code:'SQLITE_IOERR'});
    vi.spyOn(models,'hasWork').mockImplementation(()=>{throw failure;});
    expect(()=>e.create('Row',{id:'Row-committed-after-probe',title:'retained'})).not.toThrow();
    expect(db.sequence).toBe(sequence+1);expect(e.getRow('Row-committed-after-probe')?.title).toBe('retained');
    expect(db.indexBuilds.lastError).toBe(failure);
  });

  it('excludes independent connections until the owning native worker actually drains',async()=>{
    const {db,models,job,write}=fixture();
    const extension=process.env.EARS_VEC1_EXTENSION!,peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:extension});
    let second:SqliteVectorModels|undefined;
    try {
      expect(()=>new SqliteVectorModels(peer,extension)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      const release=peer.claimVectorTrainingOwner();release(); // A refused file claim must release its handle claim.
      write(()=>models.enqueue(job));expect(models.start()).toBe(true);
      const draining=db.drainBackground();
      expect(()=>new SqliteVectorModels(peer,extension)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      await draining;second=new SqliteVectorModels(peer,extension);
      expect(second).toBeDefined();
    }finally{await second?.stop();peer.close();}
  });

  it('enforces one owner and drains workers before allowing file close and a new owner',async()=>{
    const {db,e,models,job,write}=fixture();
    expect(()=>new SqliteVectorModels(db,process.env.EARS_VEC1_EXTENSION!)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
    write(()=>models.enqueue(job));models.start();const draining=db.drainBackground();
    expect(()=>e.create('Row',{title:'during drain'})).toThrow(expect.objectContaining({code:'WRITE_PAUSED'}));
    await draining;await db.drainBackground();
    expect(()=>e.create('Row',{title:'after drain'})).toThrow(expect.objectContaining({code:'WRITE_PAUSED'}));
    await models.stop();await models.stop();db.close();
    const path=db.path,reopened=own(path);reopened.write(()=>reopened.models.recover());
    await reopened.db.nativeModelsReady();expect(reopened.db.get('SELECT state FROM vector_training')!.state).toBe('ready');
  });
});
