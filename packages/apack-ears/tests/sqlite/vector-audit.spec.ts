import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { auditDatabase, rebuildIndexes, startVectorModels } from '../../src/sqlite/index.ts';

const held:SqliteDatabase[]=[],roots:string[]=[];
afterEach(async()=>{for(const db of held.splice(0)){await db.drainBackground();db.close();}for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
const bytes=(n:number)=>Buffer.from(Float32Array.from(Array.from({length:8},(_,j)=>Math.sin((n+1)*(j+1)*1.71))).buffer);
async function fixture(ready=true) {
  const path=mkdtempSync(join(tmpdir(),'ears-native-audit-'));roots.push(path);
  const db=new SqliteDatabase({path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!,schema:toElmdbSchema({types:{Row:{required:[],embed:{from:['title'],model:'fixture',dims:8}}},relations:{},roles:[]})});held.push(db);
  const e=createEarsEngine({database:db});e.transact(()=>{for(let i=0;i<8;i++)e.create('Row',{id:`Row-${i}`,title:String(i)});});
  const pending=e.pendingEmbeddings('Row');e.embed(pending.chunks.map((c,i)=>({...c,model:pending.model,vector:Array.from({length:8},(_,j)=>Math.sin((i+1)*(j+1)*1.71))})));
  await db.indexesReady();const index=new SqliteVectorIndex(db,process.env.EARS_VEC1_EXTENSION!),job=db.indexBuilds.jobs().find(job=>job.kind==='vector')!;
  db.sql.exec('CREATE TEMP TABLE training(v)');for(let i=0;i<512;i++)db.run('INSERT INTO training VALUES (?)',[bytes(i)]);
  const model=db.get('SELECT vec1_train(v,?) model FROM training',[JSON.stringify({distance:'cos',quantizer:'bq',nbucket:4,nthread:1})])!.model as Uint8Array;
  const write=<T>(fn:()=>T):T=>{db.sql.exec('BEGIN IMMEDIATE');try{const value=fn();db.commitWrite();return value;}catch(error){if(db.sql.inTransaction)db.sql.exec('ROLLBACK');throw error;}};
  write(()=>index.admit(job,model));if(ready)while(!write(()=>index.step(job.generation,128))){};
  const id=Number(db.get('SELECT id FROM vector_indexes')!.id),name='ann_'+id;
  return {db,e,index,job,id,name,write};
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite'&&!!process.env.EARS_VEC1_EXTENSION)('native projection maintenance',()=>{
  it('audits model identity, canonical vectors, owner visibility and triggers without modifying the source',async()=>{
    const {db,e,name}=await fixture();e.write('Row-1').trash();
    const sequence=e.lastCommit(),before=db.all(`SELECT * FROM ${name}_base ORDER BY id`);
    expect(await auditDatabase(db)).toMatchObject({ok:true,comparedNativeModels:1,issueCount:0});
    expect(e.lastCommit()).toBe(sequence);expect(db.all(`SELECT * FROM ${name}_base ORDER BY id`)).toEqual(before);
  });
  it.each(['missing-row','owner','model-hash','trigger'] as const)('reports %s drift independently of intact native pages',async mutation=>{
    const {db,e,name}=await fixture(),sequence=e.lastCommit(),id=db.get('SELECT min(id) id FROM embedding_values')!.id;
    if(mutation==='missing-row')db.run(`DELETE FROM ${name} WHERE rowid=?`,[id]);
    if(mutation==='owner')db.run(`UPDATE ${name} SET owner=987654,active=0 WHERE rowid=?`,[id]);
    if(mutation==='model-hash')db.run("UPDATE vector_indexes SET model_sha256=?",['0'.repeat(64)]);
    if(mutation==='trigger'){db.sql.exec(`DROP TRIGGER ${name}_insert; CREATE TRIGGER ${name}_insert AFTER INSERT ON chunks BEGIN SELECT 1; END;`);}
    const report=await auditDatabase(db);expect(report.ok).toBe(false);expect(report.comparedNativeModels).toBe(1);
    expect(report.issues.join('\n')).toMatch(/native (projection is missing|rows differ|model hash|foreground triggers)/);
    expect(e.lastCommit()).toBe(sequence);
  });
  it('reports native page membership damage through the extension integrity method',async()=>{
    const {db,name}=await fixture();expect(db.run(`DELETE FROM ${name}_idx`).changes).toBeGreaterThan(0);
    const report=await auditDatabase(db);expect(report.ok).toBe(false);expect(report.issueCount).toBeGreaterThan(0);
  });
  it('reports a native table whose catalog ownership has been lost',async()=>{
    const {db,name}=await fixture();db.sql.exec('DELETE FROM vector_indexes');
    const report=await auditDatabase(db);expect(report.ok).toBe(false);expect(report.issues.join('\n')).toContain(`${name}: native projection has no catalog owner`);
  });
  it('allows an incomplete private projection but detects missing rows behind its committed cursor',async()=>{
    const {db,index,job,name,write}=await fixture(false);write(()=>index.step(job.generation,1));
    expect(await auditDatabase(db)).toMatchObject({ok:true,comparedNativeModels:1});
    const id=db.get('SELECT after_id FROM vector_indexes')!.after_id;db.run(`DELETE FROM ${name} WHERE rowid=?`,[id]);
    expect((await auditDatabase(db)).issues.join('\n')).toContain('native projection is missing canonical embeddings');
  });
  it('rebuilds offline under the native claim and retires invalidated models without changing canonical data',async()=>{
    const {db,e,name}=await fixture(),before=e.lastCommit(),vectors=db.all('SELECT * FROM embedding_values ORDER BY id');
    await rebuildIndexes(db);expect(e.lastCommit()).toBe(before);expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(vectors);
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name=?",[name])).toBeUndefined();
    expect(db.get('SELECT 1 FROM vector_indexes')).toBeUndefined();expect(await auditDatabase(db)).toMatchObject({ok:true,comparedNativeModels:0});
  });
  it('refuses rebuild while an independent handle owns native work before admitting any generation',async()=>{
    const {db}=await fixture(),before=db.indexBuilds.jobs();
    const peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});held.push(peer);await startVectorModels(peer);
    await expect(rebuildIndexes(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_EXISTS'});expect(db.indexBuilds.jobs()).toEqual(before);
  });
});
