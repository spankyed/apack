import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { SqliteVectorTraining } from '../../src/sqlite/vector-training.ts';

// Test-side barrier establishes a real read snapshot before schema/close races.
// Production worker code and APIs contain no fault/progress hook for these tests.
const control=vi.hoisted(()=>({gate:undefined as SharedArrayBuffer|undefined}));
vi.mock('node:worker_threads',async()=>{
  const actual=await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');
  return {...actual,Worker:class extends actual.Worker {
    constructor(code:ConstructorParameters<typeof actual.Worker>[0],options:ConstructorParameters<typeof actual.Worker>[1]) {
      if(control.gate) {
        if(typeof code!=='string'||!code.includes('  const count=db.prepare('))throw Error('Missing snapshot barrier location');
        code=code.replace('  const count=db.prepare(',`  const gate=new Int32Array(a.testGate);Atomics.store(gate,0,1);Atomics.notify(gate,0);Atomics.wait(gate,1,0);
  const count=db.prepare(`);
        options={...options,workerData:{...options?.workerData,testGate:control.gate}};
      }
      super(code,options);
    }
  }};
});
async function snapshot(gate:SharedArrayBuffer,pending:Promise<unknown>) {
  let waiting=true;
  try {await Promise.race([
    (async()=>{while(waiting&&Atomics.load(new Int32Array(gate),0)!==1)await new Promise<void>(resolve=>setImmediate(resolve));})(),
    pending.then(()=>{throw Error('Worker completed before the snapshot witness');}),
  ]);}finally{waiting=false;}
}
function release(gate:SharedArrayBuffer) {Atomics.store(new Int32Array(gate),1,1);Atomics.notify(new Int32Array(gate),1);}

const held:Array<{db:SqliteDatabase;trainer:SqliteVectorTraining;path:string}>=[];
afterEach(async()=>{control.gate=undefined;for(const {db,trainer,path} of held.splice(0)){db.close();await trainer.stop();rmSync(path,{recursive:true,force:true});}});
const schema=(model='fixture'):EngineSchema=>({types:{Row:{required:[],embed:{from:['title'],model,dims:128}}},relations:{},roles:[]});
function fixture(count=512,syncs=false) {
  const path=mkdtempSync(join(tmpdir(),'ears-vector-training-'));
  const db=new SqliteDatabase({path,syncs,schema:toElmdbSchema(schema())}),e=createEarsEngine({database:db});
  const index=new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!);
  const trainer=new SqliteVectorTraining(db,process.env.EARS_VEC1_EXTENSION!);held.push({db,trainer,path});
  e.transact(()=>{for(let i=0;i<count;i++)e.create('Row',{title:String(i)});});
  const pending=e.pendingEmbeddings('Row',{limit:1000});
  e.embed(pending.chunks.map((c,i)=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((i+1)*(j+1)*1.71))})));
  return {db,e,index,trainer,path,job:db.indexBuilds.jobs().find(j=>j.kind==='vector')!};
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite'&&!!process.env.EARS_VEC1_EXTENSION)('native vector training ownership',()=>{
  it('yields the foreground, preserves logical commits and returns an installable identified model',async()=>{
    const {db,e,index,trainer,job}=fixture(),sequence=db.sequence;
    let yielded=false;const turn=new Promise<void>(resolve=>setImmediate(()=>{yielded=true;resolve();}));
    const pending=trainer.train(job);e.create('Row',{title:'foreground while training'});
    const result=await pending;await turn;expect(yielded).toBe(true);
    expect(db.sequence).toBe(sequence+1);expect(result.samples).toBe(512);
    expect(result.modelSha256).toBe(createHash('sha256').update(result.model).digest('hex'));
    expect(result.extensionSha256).toBe(createHash('sha256').update(readFileSync(process.env.EARS_VEC1_EXTENSION!)).digest('hex'));expect(result.workerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceCommitHex).toMatch(/^[A-F0-9]+$/);
    db.sql.exec('BEGIN IMMEDIATE');index.admit(job,result.model);db.commitWrite();
    for(let ready=false;!ready;){db.sql.exec('BEGIN IMMEDIATE');ready=index.step(job.generation,32);db.commitWrite();}
    expect(index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),100)).toHaveLength(100);
    expect(db.sequence).toBe(sequence+1);
  });

  it.each([false, true])('keeps foreground writes live while a training snapshot pins WAL, then releases the checkpoint (%s syncs)', async syncs => {
    const { db, e, trainer, job, path } = fixture(512, syncs);
    const sequence = db.sequence, sourceCommit = db.get("SELECT hex(value) value FROM meta WHERE key='commit'")!.value;
    const gate = control.gate = new SharedArrayBuffer(8);
    const pending = trainer.train(job);
    try {
      await snapshot(gate, pending);
      for (let i = 0; i < 16; i++) e.create('Row', { title: `foreground-${i}` });
      expect(db.sequence).toBe(sequence + 16);
      expect(e.query('Row').count()).toBe(528);
      expect(db.get('PRAGMA busy_timeout')!.timeout).toBe(0);
      const checkpoint = db.get('PRAGMA wal_checkpoint(TRUNCATE)')!;
      expect(checkpoint.busy).toBe(1);
      expect(statSync(join(path, 'data.sqlite3-wal')).size).toBeGreaterThan(0);
    } finally { release(gate); control.gate = undefined; }
    const model = await pending;
    expect(model.samples).toBe(512);
    expect(model.sourceCommitHex).toBe(sourceCommit);
    expect(db.sequence).toBe(sequence + 16);
    expect(e.query('Row').count()).toBe(528);
    expect(db.all('PRAGMA wal_checkpoint(TRUNCATE)')).toEqual([{ busy: 0, log: 0, checkpointed: 0 }]);
    expect(statSync(join(path, 'data.sqlite3-wal')).size).toBe(0);
  });

  it.each([1, 8])('refuses a malformed derived vector in the real worker and retries after repair (%i bytes)', async bytes => {
    const { db, trainer, job } = fixture(), sequence = db.sequence;
    const canonical = db.all('SELECT * FROM embedding_values ORDER BY id');
    const row = canonical[0]!;
    // Corrupt only the rebuildable projection. The real SQLite/native aggregate must report failure;
    // no worker message, SQL method or extension error is mocked in this case.
    db.run('UPDATE embedding_search SET normalized=? WHERE embedding_id=?', [Buffer.alloc(bytes), row.id]);
    await expect(trainer.train(job)).rejects.toMatchObject({ code: 'SQLITE_ERROR' });
    expect(db.sequence).toBe(sequence);
    expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(canonical);
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*'")).toBeUndefined();
    // Rebuild that projection from its authoritative bytes, then reuse the drained trainer.
    db.search.vectors.put(row.id, row.embedding, row.dims);
    const result = await trainer.train(job);
    expect(result.samples).toBe(512);
    expect(result.modelSha256).toBe(createHash('sha256').update(result.model).digest('hex'));
    expect(db.sequence).toBe(sequence);
    expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(canonical);
  });

  it('rejects stale work after declaration changes without installing it',async()=>{
    const {db,e,trainer,job}=fixture();
    const gate=control.gate=new SharedArrayBuffer(8);
    const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'SCHEMA_CHANGED'});
    try{await snapshot(gate,pending);e.admin.setSchema(schema('changed'));}finally{release(gate);control.gate=undefined;}
    await refused;
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*'")).toBeUndefined();
  });

  it('serializes workers, drains cancellation and permits a fresh attempt',async()=>{
    const {trainer,job}=fixture();const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'CANCELLED'});
    await expect(trainer.train(job)).rejects.toMatchObject({code:'TRAINING_ACTIVE'});
    await trainer.stop();await refused;
    expect((await trainer.train(job)).samples).toBe(512);
  });

  it('rejects close and drains the worker before fixture cleanup',async()=>{
    const {db,trainer,job}=fixture(),gate=control.gate=new SharedArrayBuffer(8);
    const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'CLOSED'});
    try{await snapshot(gate,pending);db.close();}finally{release(gate);control.gate=undefined;}
    await refused;await trainer.stop();
  });

  it('refuses foreground transaction ownership and insufficient input without poisoning the database',async()=>{
    const {db,e,trainer,job}=fixture(8),unit=db.begin();
    try{await expect(trainer.train(job)).rejects.toMatchObject({code:'UNIT_OPEN'});}finally{unit.abort();}
    await expect(trainer.train(job)).rejects.toMatchObject({code:'TRAINING_DATA'});
    expect(e.query('Row').count()).toBe(8);
  });
});
