// Independent SQLite membership semantics for the scratch text-IN optimization.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url), Database=require('better-sqlite3');
const [extension,output]=process.argv.slice(2);assert(output&&!existsSync(output));
const root=mkdtempSync(join(tmpdir(),'vec1-text-in-'));
const vector=i=>Buffer.from(Float32Array.from({length:8},(_,j)=>Math.sin((i+1)*(j+1)*1.71)).buffer);
const report={source:process.env.EARS_TEST_SOURCE,qualification:false,modes:[]};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
let db;
try {
 for(const mode of ['none','flat','ivf-bq']) for(const fixture of ['mixed','small-integer','wide-integer']) {
  const record={mode,fixture,checks:0};report.modes.push(record);
  db=new Database(join(root,mode+'-'+fixture+'.sqlite3'));db.loadExtension(extension);db.pragma('journal_mode=WAL');
  db.exec('CREATE TABLE reference(owner,active); CREATE VIRTUAL TABLE corpus USING vec1(v,owner,active)');
  if(mode==='ivf-bq') {
   db.exec('CREATE TABLE training(v)');const put=db.prepare('INSERT INTO training VALUES (?)');
   db.transaction(()=>{for(let i=0;i<512;i++)put.run(vector(i));})();
   const model=db.prepare('SELECT vec1_train(v,?) model FROM training').get(JSON.stringify({distance:'cos',quantizer:'bq',nbucket:4,nthread:1})).model;
   db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
  } else db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(JSON.stringify({index:mode,distance:'cos'}));
  const mixed=['','0','1','a','aa','a\0b','a\0c','A','é','e','東京','😀',null,0,1,1.5,Buffer.from('a'),...Array.from({length:128},(_,i)=>'owner-'+i)];
  const values=fixture==='mixed'?mixed:fixture==='small-integer'?[null,...Array.from({length:128},(_,i)=>i)]:[null,-2147483647,2147483646,-10,-1,0,...Array.from({length:128},(_,i)=>100000+i)];
  const put=db.prepare('INSERT INTO reference(rowid,owner,active) VALUES (?,?,?)'),insert=db.prepare('INSERT INTO corpus(rowid,v,owner,active) VALUES (?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<values.length;i++){const stored=fixture==='mixed'||values[i]===null?values[i]:BigInt(values[i]);put.run(i+1,stored,i%2);insert.run(BigInt(i+1),vector(i),stored,i%2);}})();
  const text=values.filter(v=>typeof v===(fixture==='mixed'?'string':'number'));
  const sets=[[],['a'],text.slice(0,7),text.slice(0,8),text.slice(0,9),[...text].reverse(),[...text,'missing','a','a'],[...text,null,1,1.5,Buffer.from('a')],Array(12).fill('missing'),text.slice(-32)];
  function check(list,extra='') {
   const where='owner IN ('+list.map(()=>'?').join(',')+')'+extra;
   const expected=db.prepare('SELECT rowid FROM reference WHERE '+where+' ORDER BY rowid').all(...list);
   const actual=db.prepare('SELECT rowid FROM corpus(?,?) WHERE '+where+' ORDER BY rowid').all(vector(0),JSON.stringify({K:10000,nprobe:100}),...list);
   assert.deepEqual(actual,expected,mode+' '+JSON.stringify(list)+' '+extra);record.checks++;
  }
  for(const list of sets){check(list);check(list,' AND active=1');check(list,' AND active IN (0,1)');}
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE reference SET owner=? WHERE rowid=1').run(text.at(-1));db.prepare('UPDATE corpus SET owner=? WHERE rowid=1').run(text.at(-1));check(text);
  db.exec('SAVEPOINT inner');db.exec('DELETE FROM reference WHERE rowid=2; DELETE FROM corpus WHERE rowid=2');check(text);
  db.exec('ROLLBACK TO inner; RELEASE inner');check(text);db.exec('ROLLBACK');check(text);
  db.close();db=undefined;save();
 }
 report.completed=true;save();
} catch(error){report.failure={message:error.message,stack:error.stack};save();throw error;}
finally{db?.close();rmSync(root,{recursive:true,force:true});}
