import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { SqliteVectorTraining } from '../../src/sqlite/vector-training.ts';

const held:Array<{db:SqliteDatabase;trainer:SqliteVectorTraining;path:string}>=[];
afterEach(async()=>{for(const {db,trainer,path} of held.splice(0)){db.close();await trainer.stop();rmSync(path,{recursive:true,force:true});}});
const schema=(model='fixture'):EngineSchema=>({types:{Row:{required:[],embed:{from:['title'],model,dims:128}}},relations:{},roles:[]});
function fixture(count=512) {
  const path=mkdtempSync(join(tmpdir(),'ears-vector-training-'));
  const db=new SqliteDatabase({path,syncs:false,schema:toElmdbSchema(schema())}),e=createEarsEngine({database:db});
  const index=new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!);
  const trainer=new SqliteVectorTraining(db,process.env.EARS_VEC1_EXTENSION!);held.push({db,trainer,path});
  e.transact(()=>{for(let i=0;i<count;i++)e.create('Row',{title:String(i)});});
  const pending=e.pendingEmbeddings('Row',{limit:1000});
  e.embed(pending.chunks.map((c,i)=>({...c,model:pending.model,vector:Array.from({length:128},(_,j)=>Math.sin((i+1)*(j+1)*1.71))})));
  return {db,e,index,trainer,job:db.indexBuilds.jobs().find(j=>j.kind==='vector')!};
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite'&&!!process.env.EARS_VEC1_EXTENSION)('native vector training ownership',()=>{
  it('yields the foreground, preserves logical commits and returns an installable identified model',async()=>{
    const {db,e,index,trainer,job}=fixture(),sequence=db.sequence;
    let yielded=false;const turn=new Promise<void>(resolve=>setImmediate(()=>{yielded=true;resolve();}));
    const pending=trainer.train(job);e.create('Row',{title:'foreground while training'});
    const result=await pending;await turn;expect(yielded).toBe(true);
    expect(db.sequence).toBe(sequence+1);expect(result.samples).toBe(512);
    expect(result.modelSha256).toBe(createHash('sha256').update(result.model).digest('hex'));
    expect(result.extensionSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.workerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceCommitHex).toMatch(/^[A-F0-9]+$/);
    db.sql.exec('BEGIN IMMEDIATE');index.admit(job,result.model);db.commitWrite();
    for(let ready=false;!ready;){db.sql.exec('BEGIN IMMEDIATE');ready=index.step(job.generation,32);db.commitWrite();}
    expect(index.candidates(job.generation,Buffer.from(Float32Array.from(Array(128).fill(1)).buffer),100)).toHaveLength(100);
    expect(db.sequence).toBe(sequence+1);
  });

  it('rejects stale work after declaration changes without installing it',async()=>{
    const {db,e,trainer,job}=fixture();
    const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'SCHEMA_CHANGED'});
    e.admin.setSchema(schema('changed'));await refused;
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*'")).toBeUndefined();
  });

  it('serializes workers, drains cancellation and permits a fresh attempt',async()=>{
    const {trainer,job}=fixture();const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'CANCELLED'});
    await expect(trainer.train(job)).rejects.toMatchObject({code:'TRAINING_ACTIVE'});
    await trainer.stop();await refused;
    expect((await trainer.train(job)).samples).toBe(512);
  });

  it('rejects close and drains the worker before fixture cleanup',async()=>{
    const {db,trainer,job}=fixture();const pending=trainer.train(job),refused=expect(pending).rejects.toMatchObject({code:'CLOSED'});
    db.close();await refused;await trainer.stop();
  });

  it('refuses foreground transaction ownership and insufficient input without poisoning the database',async()=>{
    const {e,trainer,job}=fixture(8);
    let refusal!:Promise<unknown>;e.transact(()=>{refusal=trainer.train(job);});
    await expect(refusal).rejects.toMatchObject({code:'UNIT_OPEN'});
    await expect(trainer.train(job)).rejects.toMatchObject({code:'TRAINING_DATA'});
    expect(e.query('Row').count()).toBe(8);
  });
});
