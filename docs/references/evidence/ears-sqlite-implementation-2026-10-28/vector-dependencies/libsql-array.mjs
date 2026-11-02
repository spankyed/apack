import Database from 'libsql';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, chmodSync, rmSync } from 'node:fs';
const root = mkdtempSync('/tmp/libsql-contract-'), file = root+'/main.sqlite';
const report = { candidate: 'libsql 0.5.29', variant: 'explicit positional arrays for single BLOB bindings', node:process.version, observations:{}, checks:{} };
const blob = vector => Buffer.from(Float32Array.from(vector).buffer), q = blob([1,0,0]);
const save = () => writeFileSync('/results/probe.json',JSON.stringify(report,(_key,value)=>typeof value==='bigint'?String(value)+'n':value,2));
const observe = (name,body) => { report.stage=name; console.log('begin',name); save(); try { const result=body();report.observations[name]=result;save();console.log('done',name);return result; } catch(error) { report.observations[name]={error:error.message,code:error.code};save();return undefined; } };
let db, other;
try {
 chmodSync(root,0);assert.throws(()=>readdirSync(root),{code:'EACCES'});chmodSync(root,0o700);
 report.constraints=Object.fromEntries(['cpu.max','memory.max','memory.swap.max'].map(name=>[name,readFileSync('/sys/fs/cgroup/'+name,'utf8').trim()]));
 assert.equal(report.constraints['cpu.max'],'200000 100000');assert.equal(report.constraints['memory.max'],String(6*1024**3));assert.equal(report.constraints['memory.swap.max'],'0');
 report.loaded=process.report.getReport().sharedObjects.filter(path=>path.endsWith('.node')).map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
 report.sourceSha256=createHash('sha256').update(readFileSync('/probe/probe.mjs')).digest('hex');
 observe('open',()=>{db=new Database(file);return true;});observe('version',()=>db.prepare('SELECT sqlite_version() version').get());
 observe('wal',()=>db.pragma('journal_mode=WAL'));
 observe('createTable',()=>{db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, embedding F32_BLOB(3), bucket INTEGER)');return true;});
 const insert=db.prepare('INSERT INTO items VALUES (?,vector32(?),?)');
 [[1,0,0],[.9,.1,0],[0,1,0],[-1,0,0]].forEach((v,i)=>observe('insert-'+i,()=>insert.run(i+1,blob(v),i<2?0:1)));
 observe('createIndex',()=>{db.exec("CREATE INDEX item_vectors ON items(libsql_vector_idx(embedding, 'metric=cosine', 'max_neighbors=16', 'compress_neighbors=float8'))");return true;});
 const top=connection=>connection.prepare("SELECT t.id FROM vector_top_k('item_vectors',vector32(?),1) v JOIN items t ON t.rowid=v.id").all([q]);
 assert.equal(Number(observe('initial',()=>top(db))[0].id),1);
 const update=db.prepare('UPDATE items SET embedding=vector32(?) WHERE id=1');
 db.exec('BEGIN');update.run([blob([-1,0,0])]);report.checks.indexOwnWrite=Number(observe('insideUnit',()=>top(db))?.[0]?.id)===2;
 db.exec('SAVEPOINT inner_unit');db.exec('DELETE FROM items WHERE id=2');report.checks.indexOwnDelete=Number(observe('insideSavepoint',()=>top(db))?.[0]?.id)===3;
 db.exec('ROLLBACK TO inner_unit');db.exec('RELEASE inner_unit');report.checks.savepointRollback=Number(observe('afterSavepointRollback',()=>top(db))?.[0]?.id)===2;
 db.exec('ROLLBACK');report.checks.unitRollback=Number(observe('afterUnitRollback',()=>top(db))?.[0]?.id)===1;
 update.run([blob([-1,0,0])]);report.checks.committedUpdate=Number(observe('afterCommit',()=>top(db))?.[0]?.id)===2;
 other=new Database(file);report.checks.reopen=Number(observe('otherHandleAfterCommit',()=>top(other))?.[0]?.id)===2;other.close();other=undefined;
 observe('functionRegistration',()=>{db.function('probe_identity',{},value=>value);return db.prepare('SELECT probe_identity(7) n').get();});
 report.checks.functionRegistration=report.observations.functionRegistration?.n===7;
 const filtered=observe('postFilteredTopOne',()=>db.prepare("SELECT t.id FROM vector_top_k('item_vectors',vector32(?),1) v JOIN items t ON t.rowid=v.id WHERE t.bucket=1").all([q]));
 const exactFiltered=observe('scopedExact',()=>db.prepare('SELECT id FROM items WHERE bucket=1 ORDER BY vector_distance_cos(embedding,vector32(?)),id LIMIT 1').all([q]));
 report.checks.postFilterPreservesScopedTopK=filtered?.[0]?.id===exactFiltered?.[0]?.id;
 other=new Database(file,{readonly:true,fileMustExist:true});
 let refused=false;try{other.prepare('INSERT INTO items VALUES (999,vector32(?),0)').run([q]);}catch(error){refused=true;report.observations.readonlyWriteError={message:error.message,code:error.code};}
 report.checks.readonlyOption=refused;other.close();other=undefined;db.exec('DELETE FROM items WHERE id=999');
 observe('json',()=>db.prepare("SELECT value FROM json_each('[1,2]')").all());
 observe('fts5',()=>{db.exec('CREATE VIRTUAL TABLE search USING fts5(body)');db.exec("INSERT INTO search VALUES('known word')");return db.prepare("SELECT rowid FROM search WHERE search MATCH 'known'").all();});
 const backup=root+'/backup.sqlite';
 if(observe('vacuumInto',()=>{db.prepare('VACUUM INTO ?').run(backup);return true;})){
  other=new Database(backup);report.checks.backupIndex=Number(observe('backupIndex',()=>top(other))?.[0]?.id)===2;other.close();other=undefined;
 }
 report.loaded=process.report.getReport().sharedObjects.filter(path=>path.endsWith('.node')).map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
 report.package=JSON.parse(readFileSync('/probe/node_modules/libsql/package.json','utf8')).version;
 report.dropIn=Object.values(report.checks).every(Boolean);
 if(!report.dropIn)process.exitCode=2;
}catch(error){report.fatal={message:error.message,stack:error.stack};process.exitCode=1;}
finally{if(db?.inTransaction)db.exec('ROLLBACK');other?.close();db?.close();chmodSync(root,0o700);rmSync(root,{recursive:true,force:true});save();}
