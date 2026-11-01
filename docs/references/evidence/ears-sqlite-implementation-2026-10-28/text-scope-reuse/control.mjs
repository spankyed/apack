import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const root=fs.mkdtempSync(join(tmpdir(),'ears-text-scope-control-')),file=join(root,'control.sqlite3');
const rpc=(method,sql,parameters=[])=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./sql-rpc.py',import.meta.url)),file],{input:JSON.stringify({method,sql,parameters}),encoding:'utf8'}));
try {
 const metadata=rpc('exec',`CREATE TABLE entities(id TEXT PRIMARY KEY,seq INTEGER,trashed INTEGER);
 CREATE VIRTUAL TABLE fts USING fts5(entity_id UNINDEXED,field UNINDEXED,element UNINDEXED,body,aliases,owner);`);
 for(let i=0;i<48;i++) rpc('exec',`INSERT INTO entities VALUES('Row-${i}',${i},${Number(i===46)});
 INSERT INTO fts VALUES('Row-${i}',0,0,'needle ${i%3?'alpha':'beta'} ${i%7?'':'banned'}','', 'o${i}');`);
 const before=execFileSync('git',['show','958bf780b7:packages/apack-ears/src/sqlite/text.ts'],{encoding:'utf8'});
 const after=fs.readFileSync('packages/apack-ears/src/sqlite/text.ts','utf8');
 const selected=Array.from({length:24},(_,i)=>`Row-${i*2}`);
 // Membership may contain duplicates and missing IDs; preserve its current set semantics.
 const scope={sql:'SELECT value id FROM json_each(?) WHERE observe_scope(value)',parameters:[JSON.stringify([...selected,selected[0],'Row-missing'])]};
 const cases=[];
 for(const [variant,source] of [['before',before],['after',after]]) {
  const context=vm.createContext({createHash,randomUUID,searchTable:()=> 'fts'});
  const code=stripTypeScriptTypes(source).replace(/^import .*;\n/gm,'').replace('export class SqliteText','class SqliteText');
  vm.runInContext(code+'\nglobalThis.Text=SqliteText;',context);
  let visits=0;
  const db={all:(sql,args)=>{const r=rpc('all',sql,args);visits+=r.visits;return r.value;},get:(sql,args)=>{const r=rpc('get',sql,args);visits+=r.visits;return r.value;}};
  const text=new context.Text(db),job={definition:{fields:{body:{weight:1}}}};
  const results=[];
  for(const query of ['needle','needle alpha','needle OR beta','needle -banned','body:needle alpha','"needle alpha"','needle alph','needle alpha OR beta -banned']) {
   for(const hits of [false,true]) {
    visits=0;
    const answer=JSON.parse(JSON.stringify(text.search(job,scope,query,{fuzzy:false,prefix:true},hits,5)));
    if(variant==='after'&&query==='needle alpha') assert.equal(visits,26);
    results.push({query,hits,answer,visits});
   }
  }
  for(const within of [null,{sql:'SELECT value id FROM json_each(?)',parameters:['[]']}])
   results.push({query:'empty-or-global',scope:within===null?'global':'empty',answer:JSON.parse(JSON.stringify(text.search(job,within,'needle alpha',{fuzzy:false},true,5)))});
  cases.push({variant,results});
 }
 assert.deepEqual(cases[0].results.map(({visits,...r})=>r),cases[1].results.map(({visits,...r})=>r));
 const counts=cases.map(c=>({variant:c.variant,visits:c.results.filter(r=>r.query==='needle alpha').map(r=>({hits:r.hits,visits:r.visits}))}));
 assert(cases[0].results.find(r=>r.query==='needle alpha').visits>26,'negative control must show repeated scope work');
 console.log(JSON.stringify({sqlite:metadata.sqlite,casesPerVariant:cases[0].results.length,answersAndScoresEqual:true,counts},null,2));
} finally {fs.rmSync(root,{recursive:true,force:true});}
