// Real ENOSPC in an isolated 8-MiB Docker tmpfs; not a device power-loss or filesystem certification test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statfsSync, openSync, writeSync, closeSync, unlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
const [mount,output]=process.argv.slice(2);assert.equal(mount,'/fault');assert(output&&!existsSync(output));
const fs=statfsSync(mount);assert.equal(fs.type,0x01021994);assert(fs.blocks*fs.bsize<=8*1024*1024);
const report={protocol:'ears-real-filesystem-full/2',source:process.env.EARS_TEST_SOURCE??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),filesystem:{type:fs.type,bytes:fs.blocks*fs.bsize},cases:[]};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const schema=toElmdbSchema({types:{Row:{required:[]}},relations:{},roles:[]});
for(const mode of ['commit','write','bulkLoad','unit']){
 const path=join(mount,'profile-'+mode),filler=join(mount,'filler-'+mode);mkdirSync(path);let db,watch;
 const entry={mode};report.cases.push(entry);
 try{
  db=new SqliteDatabase({path,schema});const e=createEarsEngine({database:db});
  entry.synchronous=db.sql.pragma('synchronous',{simple:true});entry.walAutocheckpoint=db.sql.pragma('wal_autocheckpoint',{simple:true});
  assert.equal(entry.synchronous,2);assert.equal(entry.walAutocheckpoint,1000);
  entry.maxPageCount=db.sql.pragma('max_page_count',{simple:true});assert(entry.maxPageCount*4096>64*1024*1024);
  e.create('Row',{id:'Row-before',title:'incumbent'});db.sql.pragma('wal_checkpoint(TRUNCATE)');
  const before=db.sequence,seen=[];entry.sequenceBefore=before;watch=e.watch(()=>e.query('Row').ids(),ids=>seen.push([...ids]));await e.admin.watchesSettled();
  let enteringCommit=false;const originalCommit=db.commitWrite.bind(db);db.commitWrite=()=>{enteringCommit=true;return originalCommit();};
  if(mode==='commit'){
   const fd=openSync(filler,'wx'),bytes=Buffer.alloc(65536,0xa5);let filled=0;
   try{for(;;){filled+=writeSync(fd,bytes);assert(filled<=16*1024*1024);}}
   catch(error){assert.equal(error.code,'ENOSPC');entry.fillerError=error.code;entry.fillerBytes=filled;}
   finally{closeSync(fd);}
   assert.equal(statfsSync(mount).bavail,0);
  }
  let refused;
  try{
   if(mode==='commit')e.create('Row',{id:'Row-refused',title:'must not commit'});
   else if(mode==='bulkLoad')db.bulkLoad([{load:'entity',id:'Row-refused',fields:{body:'x'.repeat(16*1024*1024)}}]);
   else if(mode==='unit')e.transact(()=>{e.create('Row',{id:'Row-earlier'});e.create('Row',{id:'Row-refused',body:'x'.repeat(16*1024*1024)});});
   else e.create('Row',{id:'Row-refused',body:'x'.repeat(16*1024*1024)});
  }catch(error){refused=error;}
  assert.equal(refused?.code,'SQLITE_FULL');entry.error={code:refused.code,message:refused.message};entry.enteredCommit=enteringCommit;entry.availableBytesAtFailure=statfsSync(mount).bavail*fs.bsize;
  if(mode==='commit')assert(enteringCommit,'Real ENOSPC must exercise COMMIT, not only a statement spill');
  assert.equal(db.sql.inTransaction,false);entry.sequenceAfterRefusal=db.sequence;entry.afterRefusalIds=e.query('Row').ids();
  assert.equal(entry.sequenceAfterRefusal,before);assert.deepEqual(entry.afterRefusalIds,['Row-before']);
  await e.admin.watchesSettled();assert.deepEqual(seen,[['Row-before']]);
  if(existsSync(filler))unlinkSync(filler);
  e.create('Row',{id:'Row-recovered'});await e.admin.watchesSettled();entry.sequenceAfterRecovery=db.sequence;assert.equal(entry.sequenceAfterRecovery,before+1);
  assert.deepEqual(seen,[['Row-before'],['Row-before','Row-recovered']]);watch.stop();watch=undefined;db.close();db=undefined;
  db=new SqliteDatabase({path,readOnly:true});assert.deepEqual(createEarsEngine({database:db}).query('Row').ids(),['Row-before','Row-recovered']);
  entry.reopenedReadOnly=true;entry.refusedWriteInvisible=true;entry.watchNotifications=seen;entry.completed=true;save();
 }catch(error){entry.failure={message:error.message,stack:error.stack};save();throw error;}
 finally{watch?.stop();db?.close();if(existsSync(filler))unlinkSync(filler);rmSync(path,{recursive:true,force:true});}
}
report.completed=true;save();
