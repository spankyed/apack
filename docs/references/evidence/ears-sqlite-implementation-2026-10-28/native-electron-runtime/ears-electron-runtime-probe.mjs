import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const load=createRequire('/electron/packages/api/package.json');
const {openDatabase,startVectorModels,waitForNativeModels}=await import(pathToFileURL(load.resolve('@apackdev/ears/sqlite')).href);
const {createEarsEngine}=await import(pathToFileURL(load.resolve('@apackdev/ears')).href);
const root=mkdtempSync(join(tmpdir(),'ears-electron-model-'));
const db=openDatabase({path:root,syncs:false,schema:{types:{Smoke:{required:[],embed:{from:['title'],model:'smoke',dims:128}}},relations:{},roles:[]}});
const vector=i=>Array.from({length:128},(_,j)=>Math.sin((i+1)*(j+1)*1.71));
try {
 await startVectorModels(db);const engine=createEarsEngine({database:db});
 engine.transact(()=>{for(let i=0;i<4097;i++)engine.create('Smoke',{id:'Smoke-'+String(i).padStart(6,'0'),title:String(i)});});
 let offset=0;
 for(;;){const pending=engine.pendingEmbeddings('Smoke',{limit:1000});if(!pending.chunks.length)break;engine.embed(pending.chunks.map((c,i)=>({...c,model:pending.model,vector:vector(offset+i)})));offset+=pending.chunks.length;}
 await waitForNativeModels(db);assert.equal(offset,4097);
 const model=db.get("SELECT state,samples,model_sha256 FROM vector_training WHERE state='ready'");assert(model);
 assert.equal(model.samples,4097);assert(db.get("SELECT 1 FROM vector_indexes WHERE state='ready'"));
 assert.deepEqual(engine.query('Smoke').near(vector(0),{k:1}).ids(),['Smoke-000000']);
 writeFileSync('/results/electron-native-model.json',JSON.stringify({versions:process.versions,architecture:process.arch,platform:process.platform,driverVersion:load('better-sqlite3/package.json').version,embedded:offset,model,query:'self-match',workerCompleted:true},null,2)+'\n');
 console.log('Electron runtime: canonical writes, kernel claim, native worker, ready model and ANN query passed');
}finally{await db.drainBackground();db.close();rmSync(root,{recursive:true,force:true});}
