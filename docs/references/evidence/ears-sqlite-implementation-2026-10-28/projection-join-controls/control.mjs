import fs from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import vm from 'node:vm';import assert from 'node:assert/strict';import{stripTypeScriptTypes}from'node:module';import{execFileSync}from'node:child_process';
const root=fs.mkdtempSync(join(tmpdir(),'ears-projection-join-')),file=root+'/control.sqlite3';
const rpc=(method,sql,parameters=[])=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./sql-rpc.py',import.meta.url)),file],{input:JSON.stringify({method,sql,parameters}),encoding:'utf8',maxBuffer:16*1024*1024}));
try{
 rpc('exec',`CREATE TABLE values_t1(entity_id TEXT PRIMARY KEY,k1 TEXT,v1,k2 TEXT,v2);CREATE TABLE value_overflow(entity_id TEXT,field TEXT,kind TEXT,value,PRIMARY KEY(entity_id,field));INSERT INTO values_t1 VALUES('Row-one','num',7,'@',NULL),('Row-two','null',NULL,NULL,NULL);INSERT INTO value_overflow VALUES('Row-one','body','text','overflow'),('Row-one','flexible','text','extra');`);
 const original=execFileSync('git',['show','470c12dfdd:packages/apack-ears/src/sqlite/values.ts'],{encoding:'utf8'}),changed=fs.readFileSync('packages/apack-ears/src/sqlite/values.ts','utf8');
 const outputs=[];
 for(const [variant,source]of[['before',original],['after',changed]]){
  const context=vm.createContext({});vm.runInContext(stripTypeScriptTypes(source).replace('export class SqliteValues','class SqliteValues')+'\nglobalThis.Values=SqliteValues;',context);
  let calls=0;const values=new context.Values({all:(sql,args)=>{calls++;return rpc('all',sql,args)},get:(sql,args)=>rpc('get',sql,args),run:()=>{throw Error('Read must not write');}},{encode:()=>{throw Error('Scalar fixture must not encode');},decode:()=>{throw Error('Scalar fixture must not decode');}});
  const layout={name:'Row',table:'values_t1',fields:new Map([['rank',1],['body',2]])};
  const cases=[];
  for(const names of [['rank'],['body'],['flexible'],['absent'],['id'],['entityType'],['rank','body'],undefined]){
   calls=0;const rows=JSON.parse(JSON.stringify(values.read(layout,['Row-missing','Row-two','Row-one','Row-one'],names)));
   if(variant==='after'&&names?.length===1)assert.equal(calls,1);
   cases.push({names,rows});
  }
  outputs.push(cases);
 }
 assert.deepEqual(outputs[0],outputs[1]);
 // Corruption diagnostics remain active on both the single-field and wide paths.
 const context=vm.createContext({});vm.runInContext(stripTypeScriptTypes(changed).replace('export class SqliteValues','class SqliteValues')+'\nglobalThis.Values=SqliteValues;',context);
 const values=new context.Values({all:(sql,args)=>rpc('all',sql,args)},{encode:()=>{},decode:()=>{}}),layout={name:'Row',table:'values_t1',fields:new Map([['rank',1],['body',2]])};
 rpc('exec',"INSERT INTO value_overflow VALUES('Row-one','rank','num',8)");
 for(const names of [['rank'],undefined])assert.throws(()=>values.read(layout,['Row-one'],names),e=>e.code==='CORRUPT');
 rpc('exec',"DELETE FROM value_overflow WHERE field IN ('rank','body')");
 for(const names of [['body'],undefined])assert.throws(()=>values.read(layout,['Row-one'],names),e=>e.code==='CORRUPT');
 console.log('Actual old/new generated SQLite queries agree on eight projections with ordered duplicates, missing rows/null/overflow and identity fields; single-field reads use one call, and missing/duplicate overflow still refuses. Python SQLite transport is correctness evidence, not Node-driver speed qualification.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
