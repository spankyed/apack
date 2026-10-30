import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorModels } from '../../src/sqlite/vector-models.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';

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
    await db.indexesReady();expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:128,chunk:'paragraph'}},
      Other:{required:[],embed:{from:['title'],model:'other',dims:128}}},relations:{},roles:[]});
    e.create('Other',{title:'other'});const other=e.pendingEmbeddings('Other');
    e.embed(other.chunks.map(c=>({...c,model:other.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    await db.indexesReady();
    const all=db.all.bind(db),pages=vi.spyOn(db,'all').mockImplementation((sql,parameters=[])=>all(sql,parameters));
    e.write('Row-000000').set('unrelated','changed');await db.indexesReady();
    expect(pages.mock.calls.some(([sql])=>sql.startsWith('WITH admission_page AS MATERIALIZED'))).toBe(false);
    const sequence=db.sequence;
    expect(()=>e.transact(()=>{seed(1);throw Error('rollback growth');})).toThrow('rollback growth');
    await db.indexesReady();expect(db.sequence).toBe(sequence);
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.create('Row',{id:'Row-004096',title:'new'});await db.indexesReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const pending=e.pendingEmbeddings('Row');expect(pending.chunks).toHaveLength(1);
    e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    const committed=db.sequence;await db.indexesReady();
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
    await db.indexesReady();
    expect(pages.mock.calls.some(([sql])=>sql.startsWith('WITH admission_page AS MATERIALIZED'))).toBe(false);
    pages.mockRestore();
    const candidates=vi.spyOn(models.index,'candidates');
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    expect(e.query('Row').near(vector,{k:5}).ids()).toHaveLength(5);
    expect(candidates).toHaveBeenCalled();
  });

  it('admits canonical embeddings imported after an initially ineligible generation',async()=>{
    const {db,e}=fixture(4096);await db.indexesReady();
    const id=e.create('Row',{title:'imported'}).id();await db.indexesReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const chunk=db.get('SELECT * FROM chunks WHERE entity_id=?',[id])!;
    db.bulkLoad([{load:'embedding',id,index:chunk.index_name,chunk:chunk.chunk,hash:chunk.hash,model:chunk.model,
      vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))}]);
    const sequence=db.sequence;await db.indexesReady();
    expect(db.get('SELECT state,samples FROM vector_training')).toEqual({state:'ready',samples:4097});
    expect(db.sequence).toBe(sequence);
  });

  it("discovers another connection's committed embeddings when readiness is polled",async()=>{
    const {db}=fixture(4096);await db.indexesReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    const peer=new SqliteDatabase({path:db.path,syncs:false});
    try {
      const other=createEarsEngine({database:peer});other.create('Row',{id:'Row-004096',title:'peer'});
      const pending=other.pendingEmbeddings('Row');expect(pending.chunks).toHaveLength(1);
      other.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71))})));
    }finally{peer.close();}
    const sequence=db.sequence;await db.indexesReady();
    expect(db.get('SELECT state,samples FROM vector_training')).toEqual({state:'ready',samples:4097});
    expect(db.sequence).toBe(sequence);
  });

  it('requires enough live distinct owners and rechecks eligibility after restoring trashed chunks',async()=>{
    const {db,e,seed}=fixture(0);
    const first=e.create('Row',{title:Array.from({length:4100},(_,i)=>`part ${i}`).join('\n\n')}).id();
    seed(0);await db.indexesReady();
    expect(db.get('SELECT count(*) n FROM chunks WHERE embedding_id IS NOT NULL')!.n).toBe(4100);
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    seed(254);await db.indexesReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.write(first).trash();seed(1);await db.indexesReady();
    expect(db.get('SELECT 1 FROM vector_training')).toBeUndefined();
    e.write(first).restore();const sequence=db.sequence;await db.indexesReady();
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
    commit.mockRestore();await db.indexesReady();
    expect(db.get('SELECT state FROM vector_training WHERE generation=?',[job.generation])!.state).toBe('ready');
    expect(pages.length).toBeGreaterThan(32);expect(Math.max(...pages)).toBeLessThanOrEqual(128);
    expect(plan.some(row=>String(row.detail).includes('chunk_native_admission')&&String(row.detail).includes('embedding_id>?'))).toBe(true);
  });

  it('discovers rebuilt generations without a logical commit and skips unsupported training dimensions',async()=>{
    const {db,e,job}=fixture(4097);await db.indexesReady();const sequence=db.sequence;
    db.rebuildIndexes();await db.indexesReady();
    const rebuilt=db.indexBuilds.jobs().find(j=>j.kind==='vector')!;
    expect(rebuilt.generation).not.toBe(job.generation);expect(db.sequence).toBe(sequence);
    expect(db.get('SELECT state,samples FROM vector_training WHERE generation=?',[rebuilt.generation]))
      .toEqual({state:'ready',samples:4097});
    e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:128,chunk:'paragraph'}},
      Other:{required:[],embed:{from:['title'],model:'small',dims:8}}},relations:{},roles:[]});
    e.create('Other',{title:'small'});const pending=e.pendingEmbeddings('Other');
    e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:[1,0,0,0,0,0,0,0]})));
    await db.indexesReady();const small=db.indexBuilds.jobs().find(j=>j.kind==='vector'&&j.type==='Other')!;
    expect(db.get('SELECT 1 FROM vector_training WHERE generation=?',[small.generation])).toBeUndefined();
    expect(e.query('Other').near([1,0,0,0,0,0,0,0],{k:1}).ids()).toHaveLength(1);
  });

  it('does not enqueue or keep polling a failed logical generation with a large partial projection',async()=>{
    const {db,e,models}=fixture(4608);await db.indexesReady();
    const refile=db.search.refileIndex.bind(db.search);let rows=0;
    const failure=vi.spyOn(db.search,'refileIndex').mockImplementation((row,seq,job)=>{
      if(job.kind==='vector'&&++rows>4200)throw Error('fixture projection failure');
      return refile(row,seq,job);
    });
    db.rebuildIndexes();await expect(db.indexesReady()).rejects.toMatchObject({code:'INDEX_FAILED'});
    failure.mockRestore();
    const failed=db.indexBuilds.jobs().find(job=>job.kind==='vector'&&job.state==='failed')!;
    expect(failed).toBeDefined();
    expect(db.get('SELECT count(*) n FROM chunks WHERE generation=? AND embedding_id IS NOT NULL',[failed.generation])!.n)
      .toBeGreaterThan(4096);
    for(let i=0;i<100;i++)db.indexBuilds.step();
    expect(db.get('SELECT 1 FROM vector_training WHERE generation=?',[failed.generation])).toBeUndefined();
    expect(models.hasWork()).toBe(false);
    expect(e.query('Row').count()).toBe(4608);
  });

  it('uses the shared scheduler to train, project and publish readiness without logical commits',async()=>{
    const {db,e,models,job,write}=fixture(),sequence=db.sequence,events:number[]=[];
    const off=db.onIndexesChanged(changes=>events.push(changes.sequence));
    try {
      write(()=>models.enqueue(job));await db.indexesReady();
      const state=db.get('SELECT * FROM vector_training WHERE generation=?',[job.generation])!;
      expect(state.state).toBe('ready');expect(state.model).toBeNull();expect(state.samples).toBe(512);
      expect(state.extension_sha256).toMatch(/^[a-f0-9]{64}$/);expect(db.sequence).toBe(sequence);
      expect(events).toEqual([sequence]);
      expect(models.index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),100)).toHaveLength(100);
      e.admin.setSchema({types:{Row:{required:[],embed:{from:['title'],model:'replacement',dims:128}}},relations:{},roles:[]});
      await db.indexesReady();
      for(let i=0;i<1000&&db.get('SELECT 1 FROM index_gc WHERE generation=?',[job.generation]);i++)db.indexBuilds.step();
      expect(db.get('SELECT 1 FROM vector_indexes WHERE generation=?',[job.generation])).toBeUndefined();
      expect(db.get(`SELECT 1 FROM sqlite_schema WHERE name='ann_${job.generation}'`)).toBeUndefined();
      expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(512);
      expect(()=>models.index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),1)).toThrow(expect.objectContaining({code:'SCHEMA_CHANGED'}));
    }finally{off();}
  });

  it('routes real EARS queries through ready native candidates with scoped exact fallbacks and unit visibility',async()=>{
    const {db,e,models,job,write}=fixture(4608);
    const vector=Array.from({length:128},(_,j)=>Math.sin((j+1)*1.71));
    const native=vi.spyOn(models.index,'candidates');
    const original=e.query('Row').near(vector,{k:1}).ids();expect(native).not.toHaveBeenCalled();
    write(()=>models.enqueue(job));await db.indexesReady();
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
    const {db,e,models}=fixture(4608);await db.indexesReady();
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
    const {db}=fixture(4608);await db.indexesReady();
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
    write(()=>models.enqueue(job));await db.indexesReady();
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
    await db.indexesReady();expect(db.get('SELECT state FROM vector_training')!.state).toBe('ready');
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
    const resumed=own(path);resumed.write(()=>resumed.models.recover());await resumed.db.indexesReady();
    expect(resumed.db.get('SELECT state,model_sha256 FROM vector_training')).toEqual({state:'ready',model_sha256:hash});
    expect(resumed.db.sequence).toBe(sequence);
  });

  it('persists failure and supports explicit retry after additional primary embeddings',async()=>{
    const {db,e,models,job,write,seed}=fixture(8);write(()=>models.enqueue(job));
    await expect(db.indexesReady()).rejects.toMatchObject({code:'INDEX_FAILED'});
    expect(JSON.parse(db.get('SELECT error FROM vector_training')!.error).code).toBe('TRAINING_DATA');
    expect(e.query('Row').count()).toBe(8);seed(512);write(()=>models.retry(job.generation));await db.indexesReady();
    expect(db.get('SELECT state FROM vector_training')!.state).toBe('ready');
    expect(e.query('Row').count()).toBe(520);
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
    await reopened.db.indexesReady();expect(reopened.db.get('SELECT state FROM vector_training')!.state).toBe('ready');
  });
});
