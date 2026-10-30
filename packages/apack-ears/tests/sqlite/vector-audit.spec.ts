import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { auditDatabase, rebuildIndexes, startVectorModels } from '../../src/sqlite/index.ts';

const held:SqliteDatabase[]=[],roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const db of held.splice(0)){await db.drainBackground();db.close();}for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
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
  it.each(['missing-trigger','missing-table','missing-model','corrupt-model','missing-shadow','damaged-pages','orphan-catalog','missing-catalog','wrong-shadow-schema'] as const)('repairs %s from canonical data under explicit rebuild',async damage=>{
    const {db,e,name}=await fixture(),sequence=e.lastCommit(),vectors=db.all('SELECT * FROM embedding_values ORDER BY id');
    if(damage==='missing-trigger')db.sql.exec(`DROP TRIGGER ${name}_insert`);
    if(damage==='missing-table')db.sql.exec(`DROP TABLE ${name}`);
    if(damage==='missing-model')db.sql.exec(`DELETE FROM ${name}_model`);
    if(damage==='corrupt-model')db.run(`UPDATE ${name}_model SET val=?`,[Buffer.alloc(12,255)]);
    if(damage==='missing-shadow')db.sql.exec(`DROP TABLE ${name}_config`);
    if(damage==='damaged-pages')db.sql.exec(`DELETE FROM ${name}_idx`);
    if(damage==='orphan-catalog')db.sql.exec('DELETE FROM vector_indexes');
    if(damage==='missing-catalog')db.sql.exec('DROP TABLE vector_indexes');
    if(damage==='wrong-shadow-schema')db.sql.exec(`ALTER TABLE ${name}_base RENAME COLUMN vector TO malformed_vector`);
    expect((await auditDatabase(db)).ok).toBe(false);
    await rebuildIndexes(db);
    expect(e.lastCommit()).toBe(sequence);expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(vectors);
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name GLOB ? LIMIT 1",[name+'*'])).toBeUndefined();
    expect(await auditDatabase(db)).toMatchObject({ok:true,comparedNativeModels:0});
    expect(()=>e.create('Row',{title:'after repair'})).not.toThrow();
  });
  it('rolls back repair and logical admission together when the commit is refused',async()=>{
    const {db,e,name}=await fixture(),sequence=e.lastCommit();db.sql.exec(`DROP TRIGGER ${name}_insert`);
    const exec=db.sql.exec.bind(db.sql),failure=Object.assign(Error('repair commit refused'),{code:'SQLITE_BUSY'});let refused=false;
    const original=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{if(sql==='COMMIT'&&!refused){refused=true;throw failure;}return exec(sql);});
    await expect(rebuildIndexes(db)).rejects.toBe(failure);original.mockRestore();
    expect(db.get('SELECT state FROM vector_indexes')!.state).toBe('ready');
    expect(db.get(`SELECT count(*) n FROM ${name}_base`)!.n).toBe(8);expect(e.lastCommit()).toBe(sequence);
    await rebuildIndexes(db);expect(await auditDatabase(db)).toMatchObject({ok:true});
  });
  it('does not classify a native integrity I/O error as permission to discard the model',async()=>{
    const {db,name}=await fixture(),getAll=db.all.bind(db),failure=Object.assign(Error('native integrity I/O failed'),{code:'SQLITE_IOERR_READ'});
    const fault=vi.spyOn(db,'all').mockImplementation((sql,parameters=[])=>{if(sql===`PRAGMA integrity_check(${name})`)throw failure;return getAll(sql,parameters);});
    await expect(rebuildIndexes(db)).rejects.toBe(failure);fault.mockRestore();
    expect(db.get('SELECT state FROM vector_indexes')!.state).toBe('ready');expect(await auditDatabase(db)).toMatchObject({ok:true,comparedNativeModels:1});
  });
  it('refuses an unrecognized table in the native namespace without deleting its rows',async()=>{
    const {db}=await fixture();db.sql.exec('CREATE TABLE ann_999999(payload); INSERT INTO ann_999999 VALUES (42)');
    await expect(rebuildIndexes(db)).rejects.toMatchObject({code:'CORRUPT'});
    expect(db.get('SELECT payload FROM ann_999999')).toEqual({payload:42});
  });
  it('rolls back a native DROP when later cleanup reports an I/O failure',async()=>{
    const {db,name}=await fixture();db.sql.exec(`DROP TRIGGER ${name}_insert`);
    const exec=db.sql.exec.bind(db.sql),failure=Object.assign(Error('repair cleanup I/O failed'),{code:'SQLITE_IOERR'});
    const fault=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{if(sql===`DROP TABLE IF EXISTS ${name}_base`)throw failure;return exec(sql);});
    await expect(rebuildIndexes(db)).rejects.toBe(failure);fault.mockRestore();
    expect(db.get(`SELECT count(*) n FROM ${name}_base`)!.n).toBe(8);expect(db.get('SELECT state FROM vector_indexes')!.state).toBe('ready');
    await rebuildIndexes(db);expect(await auditDatabase(db)).toMatchObject({ok:true});
  });
  it('quarantines an unacknowledged committed repair and recovers its persisted state only after reopen',async()=>{
    const {db,e,name}=await fixture(),sequence=e.lastCommit(),vectors=db.all('SELECT * FROM embedding_values ORDER BY id');db.sql.exec(`DROP TRIGGER ${name}_insert`);
    const exec=db.sql.exec.bind(db.sql),failure=Object.assign(Error('repair commit acknowledgement lost'),{code:'SQLITE_IOERR'});let injected=false;
    const fault=vi.spyOn(db.sql,'exec').mockImplementation(sql=>{const value=exec(sql);if(sql==='COMMIT'&&!injected){injected=true;throw failure;}return value;});
    await expect(rebuildIndexes(db)).rejects.toMatchObject({code:'COMMIT_UNKNOWN'});fault.mockRestore();
    expect(()=>e.query('Row').count()).toThrow(expect.objectContaining({code:'COMMIT_UNKNOWN'}));await db.drainBackground();db.close();
    const reopened=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});held.push(reopened);await reopened.indexesReady();
    expect(reopened.sequence).toBe(sequence);expect(reopened.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(vectors);
    expect(reopened.get("SELECT 1 FROM sqlite_schema WHERE name=?",[name])).toBeUndefined();expect(await auditDatabase(reopened)).toMatchObject({ok:true});
  });
  it('refuses an unsafe catalog identity without discarding native storage',async()=>{
    const {db,name}=await fixture();db.sql.exec('UPDATE vector_indexes SET id=-1');
    await expect(rebuildIndexes(db)).rejects.toMatchObject({code:'CORRUPT'});
    expect(db.get('SELECT id FROM vector_indexes')).toEqual({id:-1});expect(db.get(`SELECT count(*) n FROM ${name}_base`)!.n).toBe(8);
  });
  it('refuses rebuild while an independent handle owns native work before admitting any generation',async()=>{
    const {db}=await fixture(),before=db.indexBuilds.jobs();
    const peer=new SqliteDatabase({path:db.path,syncs:false,nativeVectorExtension:process.env.EARS_VEC1_EXTENSION!});held.push(peer);await startVectorModels(peer);
    await expect(rebuildIndexes(db)).rejects.toMatchObject({code:'BACKGROUND_OWNER_EXISTS'});expect(db.indexBuilds.jobs()).toEqual(before);
  });
});
