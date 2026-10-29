import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';

const held: Array<{db:SqliteDatabase;path:string}>=[];
afterEach(()=>{for(const {db,path} of held.splice(0)){db.close();rmSync(path,{recursive:true,force:true});}});
const vector=(x:number)=>[x,Math.sqrt(1-x*x),0,0,0,0,0,0];
const bytes=(v:number[])=>Buffer.from(Float32Array.from(v).buffer);
function fixture() {
  const path=mkdtempSync(join(tmpdir(),'ears-ann-generation-'));
  const db=new SqliteDatabase({path,syncs:false,schema:toElmdbSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:8,chunk:'paragraph'}}},relations:{},roles:[]})});
  held.push({db,path});const e=createEarsEngine({database:db});
  const index=new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!);
  db.sql.exec('CREATE TEMP TABLE training(v)');
  for(let i=0;i<512;i++)db.run('INSERT INTO training VALUES (?)',[bytes(Array.from({length:8},(_,j)=>Math.sin((i+1)*(j+1)*1.71)))]);
  const model=db.get('SELECT vec1_train(v,?) model FROM training',[JSON.stringify({distance:'cos',quantizer:'bq',nbucket:4,nthread:1})])!.model as Uint8Array;
  const job=db.indexBuilds.jobs().find(j=>j.kind==='vector')!;
  const write=<T>(fn:()=>T):T=>{db.sql.exec('BEGIN IMMEDIATE');try{const value=fn();db.commitWrite();return value;}catch(error){if(db.sql.inTransaction)db.sql.exec('ROLLBACK');throw error;}};
  const embed=()=>{const pending=e.pendingEmbeddings('Row',{limit:1000});e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:vector(.5)})));};
  return {db,e,index,job,model,write,embed};
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite' && !!process.env.EARS_VEC1_EXTENSION)('generation-owned native vector projection',()=>{
  it('captures foreground changes behind the cursor before readiness without logical commits',()=>{
    const {db,e,index,job,model,write,embed}=fixture();
    const first=e.create('Row',{title:'one\n\ntwo'}).id(),second=e.create('Row',{title:'three'}).id();embed();
    const sequence=db.sequence;write(()=>index.admit(job,model));
    expect(db.sequence).toBe(sequence);expect(()=>index.candidates(job.generation,bytes(vector(1)),100)).toThrow(expect.objectContaining({code:'INDEX_BUILDING'}));
    const all=db.all.bind(db);let plan:Array<Record<string,any>>=[];
    db.all=(sql,parameters=[])=>{if(sql.startsWith('WITH page AS MATERIALIZED'))plan=all('EXPLAIN QUERY PLAN '+sql,parameters);return all(sql,parameters);};
    expect(write(()=>index.step(job.generation,1))).toBe(false);
    expect(plan.some(row=>String(row.detail).includes('chunk_native_admission')&&String(row.detail).includes('embedding_id>?'))).toBe(true);
    expect(plan.some(row=>String(row.detail).startsWith('SEARCH v USING INTEGER PRIMARY KEY'))).toBe(true);
    expect(db.get(`SELECT count(*) n FROM ann_${job.generation}`)!.n).toBe(1);
    // Updating an already-visited vector and adding new owners must both survive later backfill.
    const pending=e.pendingEmbeddings('Row',{limit:1000});expect(pending.chunks).toHaveLength(0);
    const old=db.get('SELECT * FROM embedding_values WHERE entity_id=? ORDER BY chunk LIMIT 1',[first])!;
    e.embed([{id:first,chunk:old.chunk,hash:old.hash,model:old.model,vector:vector(1)}]);
    const third=e.create('Row',{title:'four'}).id();embed();
    while(!write(()=>index.step(job.generation,1))) { /* bounded caller-owned slices */ }
    const answers=index.candidates(job.generation,bytes(vector(1)),100);
    expect(answers).toHaveLength(4);
    expect(index.candidates(job.generation,bytes(vector(1)),100,null,undefined,'owners')).toEqual(answers.map(({owner})=>({owner})));
    expect(answers.find(a=>a.embedding_id===old.id)!.distance).toBeCloseTo(0);
    expect(new Set(answers.map(a=>Number(a.owner)))).toEqual(new Set(db.all('SELECT seq FROM entities WHERE id IN (?,?,?)',[first,second,third]).map(r=>r.seq)));
    expect(index.candidates(job.generation,bytes(vector(1)),1,{sql:'SELECT id FROM entities WHERE id=?',parameters:[third]})).toHaveLength(1);
  });

  it('keeps nested/outer rollback, trash, replacement and destruction in the same transaction',()=>{
    const {db,e,index,job,model,write,embed}=fixture();
    const first=e.create('Row',{title:'one'}).id(),second=e.create('Row',{title:'two'}).id();embed();
    write(()=>index.admit(job,model));write(()=>index.step(job.generation,32));
    const read=()=>index.candidates(job.generation,bytes(vector(1)),100).sort((a,b)=>a.embedding_id-b.embedding_id);
    const before=read();
    expect(()=>e.transact(()=>{
      e.write(first).trash();expect(read()).toHaveLength(1);
      expect(()=>e.transact(()=>{e.write(second).destroy();expect(read()).toEqual([]);throw Error('nested');})).toThrow('nested');
      expect(read()).toHaveLength(1);throw Error('outer');
    })).toThrow('outer');expect(read()).toEqual(before);
    e.write(first).trash();expect(read()).toHaveLength(1);
    e.write(first).restore();expect(read()).toEqual(before);
    e.write(second).set('title','changed');expect(read()).toHaveLength(1);embed();expect(read()).toHaveLength(2);
    e.write(first).destroy();e.write(second).destroy();expect(read()).toEqual([]);
    write(()=>index.retire(job.generation));expect(db.get('SELECT 1 FROM vector_indexes')).toBeUndefined();
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name LIKE 'ann_%'")).toBeUndefined();
  });

  it('reopens the native generation in a read-only EARS backup with an owner-supplied extension',()=>{
    const {db,e,index,job,model,write,embed}=fixture();e.create('Row',{title:'backup'});embed();
    write(()=>index.admit(job,model));write(()=>index.step(job.generation,32));
    const expected=index.candidates(job.generation,bytes(vector(1)),100),sequence=db.sequence;
    const path=mkdtempSync(join(tmpdir(),'ears-ann-backup-'));db.backup(path);
    const reopened=new SqliteDatabase({path,readOnly:true});held.push({db:reopened,path});
    const snapshot=new SqliteVectorIndex(reopened,process.env.EARS_VEC1_EXTENSION!);
    expect(snapshot.candidates(job.generation,bytes(vector(1)),100)).toEqual(expected);
    expect(reopened.sequence).toBe(sequence);
    expect(()=>snapshot.step(job.generation,1)).toThrow(expect.objectContaining({code:'UNIT_REQUIRED'}));
  });

  it('refuses an implicit cursor-index build on a populated store',()=>{
    const {db,e}=fixture();e.create('Row',{title:'incumbent'});
    db.sql.exec('DROP INDEX chunk_native_admission');
    expect(()=>new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!)).toThrow(expect.objectContaining({code:'MAINTENANCE_REQUIRED'}));
    expect(e.query('Row').count()).toBe(1);
  });

  it('rolls back refused admission and rejects stale generations and unsafe writer use',()=>{
    const {db,index,job,model,write}=fixture();
    expect(()=>index.admit(job,model)).toThrow(expect.objectContaining({code:'UNIT_REQUIRED'}));
    expect(()=>write(()=>index.admit({...job,generation:job.generation+1},model))).toThrow(expect.objectContaining({code:'SCHEMA_CHANGED'}));
    expect(()=>write(()=>index.admit(job,Buffer.from('invalid model')))).toThrow();
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name LIKE 'ann_%'")).toBeUndefined();
    expect(db.get('SELECT 1 FROM vector_indexes')).toBeUndefined();
    expect(()=>write(()=>{index.admit(job,model);throw Error('rollback');})).toThrow('rollback');
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name LIKE 'ann_%'")).toBeUndefined();
    write(()=>index.admit(job,model));expect(()=>write(()=>index.step(job.generation,129))).toThrow(expect.objectContaining({code:'VALUE_INVALID'}));
  });
});
