import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorModels } from '../../src/sqlite/vector-models.ts';

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
    e.transact(()=>{for(let i=0;i<count;i++)e.create('Row',{title:String(i)});});
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

  it('enforces one owner and drains workers before allowing file close and a new owner',async()=>{
    const {db,models,job,write}=fixture();
    expect(()=>new SqliteVectorModels(db,process.env.EARS_VEC1_EXTENSION!)).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
    write(()=>models.enqueue(job));models.start();await db.drainBackground();
    await models.stop();await models.stop();db.close();
    const path=db.path,reopened=own(path);reopened.write(()=>reopened.models.recover());
    await reopened.db.indexesReady();expect(reopened.db.get('SELECT state FROM vector_training')!.state).toBe('ready');
  });
});
