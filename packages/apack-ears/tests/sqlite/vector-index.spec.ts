import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(db.get(`SELECT count(*) n FROM ann_${db.get('SELECT id FROM vector_indexes WHERE generation=?',[job.generation])!.id}`)!.n).toBe(1);
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

  it('stops inside a partial page at the time budget and resumes only committed rows after rollback',()=>{
    const {db,e,index,job,model,write,embed}=fixture();
    for(let i=0;i<5;i++)e.create('Row',{title:`row ${i}`});embed();
    write(()=>index.admit(job,model));
    const first=db.get('SELECT min(id) id FROM embedding_values')!.id;
    const sliced=()=>{
      const clock=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(5);
      try{return index.step(job.generation,128);}finally{clock.mockRestore();}
    };
    expect(()=>write(()=>{expect(sliced()).toBe(false);throw Error('rollback slice');})).toThrow('rollback slice');
    expect(db.get('SELECT after_id,state FROM vector_indexes')).toEqual({after_id:0,state:'building'});
    expect(db.get(`SELECT count(*) n FROM ann_${db.get('SELECT id FROM vector_indexes WHERE generation=?',[job.generation])!.id}`)!.n).toBe(0);
    expect(write(sliced)).toBe(false);
    expect(db.get('SELECT after_id,state FROM vector_indexes')).toEqual({after_id:first,state:'building'});
    expect(db.get(`SELECT count(*) n FROM ann_${db.get('SELECT id FROM vector_indexes WHERE generation=?',[job.generation])!.id}`)!.n).toBe(1);
    while(!write(()=>index.step(job.generation,128))) { /* resume from the last committed row */ }
    expect(index.candidates(job.generation,bytes(vector(1)),100)).toHaveLength(5);
    expect(db.get(`SELECT count(*) n FROM ann_${db.get('SELECT id FROM vector_indexes WHERE generation=?',[job.generation])!.id}`)!.n).toBe(5);
    expect(db.get('SELECT state FROM vector_indexes')!.state).toBe('ready');
  });

  it('preserves the incumbent through refresh, foreground changes and a refused atomic publication',()=>{
    const {db,e,index,job,model,write,embed}=fixture();
    const first=e.create('Row',{title:'first'}).id(),second=e.create('Row',{title:'second'}).id();embed();
    write(()=>index.admit(job,model));while(!write(()=>index.step(job.generation,1))) { /* initial model */ }
    const incumbent=Number(index.ready(job.generation)!.id),sequence=db.sequence;
    const original=index.candidates(job.generation,bytes(vector(1)),100);
    write(()=>index.admit(job,model));
    const replacement=Number(db.get("SELECT id FROM vector_indexes WHERE state='building'")!.id);
    expect(replacement).not.toBe(incumbent);expect(db.sequence).toBe(sequence);
    expect(write(()=>index.step(job.generation,1))).toBe(false);
    expect(index.candidates(job.generation,bytes(vector(1)),100)).toEqual(original);
    expect(()=>e.transact(()=>{e.write(first).trash();throw Error('rollback refresh write');})).toThrow('rollback refresh write');
    expect(index.candidates(job.generation,bytes(vector(1)),100)).toEqual(original);
    e.write(second).trash();const third=e.create('Row',{title:'third'}).id();embed();
    const firstVector=db.get('SELECT chunk,hash,model FROM embedding_values WHERE entity_id=?',[first])!;
    e.embed([{id:first,chunk:firstVector.chunk,hash:firstVector.hash,model:firstVector.model,vector:vector(1)}]);
    const expected=index.candidates(job.generation,bytes(vector(1)),100);
    expect(expected.find(row=>Number(row.owner)===Number(db.get('SELECT seq FROM entities WHERE id=?',[first])!.seq))!.distance).toBeCloseTo(0);
    expect(new Set(expected.map(row=>row.owner))).toEqual(new Set(db.all('SELECT seq FROM entities WHERE id IN (?,?)',[first,third]).map(row=>row.seq)));
    while(Number(db.get('SELECT after_id FROM vector_indexes WHERE id=?',[replacement])!.after_id)<Number(db.get('SELECT max(embedding_id) n FROM chunks WHERE generation=?',[job.generation])!.n))
      expect(write(()=>index.step(job.generation,1))).toBe(false);
    expect(()=>write(()=>{expect(index.step(job.generation,1)).toBe(true);throw Error('refused flip');})).toThrow('refused flip');
    expect(Number(index.ready(job.generation)!.id)).toBe(incumbent);
    expect(db.get('SELECT state FROM vector_indexes WHERE id=?',[replacement])!.state).toBe('building');
    expect(index.candidates(job.generation,bytes(vector(1)),100)).toEqual(expected);
    expect(write(()=>index.step(job.generation,1))).toBe(true);
    expect(Number(index.ready(job.generation)!.id)).toBe(replacement);
    expect(index.candidates(job.generation,bytes(vector(1)),100)).toEqual(expected);
    expect(db.get("SELECT count(*) n FROM sqlite_schema WHERE type='trigger' AND name GLOB ?",[`ann_${incumbent}_*`])!.n).toBe(0);
    expect(db.get('SELECT state FROM vector_indexes WHERE id=?',[incumbent])!.state).toBe('retiring');
    const remaining=Number(db.get(`SELECT count(*) n FROM ann_${incumbent}`)!.n);expect(remaining).toBeGreaterThan(1);
    write(()=>index.collectSuperseded(1));expect(db.get('SELECT 1 FROM vector_indexes WHERE id=?',[incumbent])).toBeDefined();
    expect(Number(db.get(`SELECT count(*) n FROM ann_${incumbent}`)!.n)).toBe(remaining-1);
    while(index.retirementPending())write(()=>index.collectSuperseded(1));
    expect(db.get('SELECT 1 FROM sqlite_schema WHERE name=?',[`ann_${incumbent}`])).toBeUndefined();
    expect(Number(index.ready(job.generation)!.id)).toBe(replacement);
    expect(db.indexBuilds.jobs().find(j=>j.generation===job.generation)?.state).toBe('ready');
  });

  it('keeps an older read snapshot usable while a refreshed physical model is published and retired',()=>{
    const {db,e,index,job,model,write,embed}=fixture();e.create('Row',{title:'snapshot'});embed();
    write(()=>index.admit(job,model));write(()=>index.step(job.generation,32));
    const reader=new SqliteDatabase({path:db.path,readOnly:true});
    try {
      const old=new SqliteVectorIndex(reader,process.env.EARS_VEC1_EXTENSION!);
      reader.sql.exec('BEGIN');const before=old.candidates(job.generation,bytes(vector(1)),100);
      const identity=old.ready(job.generation)!.id;
      write(()=>index.admit(job,model));write(()=>index.step(job.generation,32));
      expect(index.ready(job.generation)!.id).not.toBe(identity);
      while(index.retirementPending())write(()=>index.collectSuperseded(32));
      expect(old.ready(job.generation)!.id).toBe(identity);
      expect(old.candidates(job.generation,bytes(vector(1)),100)).toEqual(before);
      reader.sql.exec('ROLLBACK');expect(old.ready(job.generation)!.id).toBe(index.ready(job.generation)!.id);
      expect(old.candidates(job.generation,bytes(vector(1)),100)).toEqual(before);
    } finally {reader.close();}
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

  it('prepares ordinary empty stores before ingestion and admits native loading after populated reopen',()=>{
    const path=mkdtempSync(join(tmpdir(),'ears-ann-ordinary-'));
    const db=new SqliteDatabase({path,syncs:false,schema:toElmdbSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:8,chunk:'paragraph'}}},relations:{},roles:[]})});
    held.push({db,path});
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name='chunk_native_admission'")).toBeDefined();
    const e=createEarsEngine({database:db});e.create('Row',{title:'loaded before native owner'});
    const pending=e.pendingEmbeddings('Row',{limit:10});
    e.embed(pending.chunks.map(c=>({...c,model:pending.model,vector:vector(.5)})));
    const sequence=db.sequence;db.close();
    const reopened=new SqliteDatabase({path,syncs:false});held[held.length-1]={db:reopened,path};
    const exec=vi.spyOn(reopened.sql,'exec');
    expect(()=>new SqliteVectorIndex(reopened,process.env.EARS_VEC1_EXTENSION!)).not.toThrow();
    expect(exec.mock.calls.some(([sql])=>/CREATE INDEX.*chunk_native_admission/i.test(sql))).toBe(false);
    expect(reopened.sequence).toBe(sequence);
    expect(createEarsEngine({database:reopened}).query('Row').count()).toBe(1);
  });

  it('owns the empty-check transaction and rolls back refused cursor preparation before retry',()=>{
    const {db}=fixture();db.sql.exec('DROP INDEX chunk_native_admission');
    const originalGet=db.get.bind(db),originalExec=db.sql.exec.bind(db.sql);
    const get=vi.spyOn(db,'get').mockImplementation((sql,parameters=[])=>{
      if(sql==='SELECT 1 FROM chunks LIMIT 1')expect(db.sql.inTransaction).toBe(true);
      return originalGet(sql,parameters);
    });
    const refusal=Object.assign(new Error('cursor preparation refused'),{code:'SQLITE_FULL'});
    const exec=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{
      if(sql.startsWith('CREATE INDEX IF NOT EXISTS chunk_native_admission'))throw refusal;
      return originalExec(sql);
    });
    expect(()=>new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!)).toThrow(refusal);
    expect(db.sql.inTransaction).toBe(false);
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name='chunk_native_admission'")).toBeUndefined();
    exec.mockRestore();
    expect(()=>new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!)).not.toThrow();
    expect(db.sql.inTransaction).toBe(false);get.mockRestore();
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
