import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';import {execFileSync} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';
const root=fs.mkdtempSync('/private/tmp/ears-field-normalization-');
const fixture=JSON.parse(fs.readFileSync('packages/apack-ears/tests/fixtures/real-search-relevance.json','utf8'));
const original=fs.readFileSync('packages/apack-ears/src/sqlite/text.ts','utf8');
const rpcScript='/private/tmp/ears-field-normalization-rpc.py';
fs.writeFileSync(rpcScript,fs.readFileSync('/private/tmp/ears-lead-ranking-rpc.py','utf8').replace("db.execute('INSERT INTO fts('+','.join(request['columns'])+') VALUES ('+','.join('?' for _ in row)+')',row)","db.execute('INSERT INTO fts('+','.join(request['columns'])+') VALUES ('+','.join('?' for _ in row)+')',row)\n  if request.get('separate'):\n   db.execute('INSERT INTO fts_f'+str(row[1])+'('+','.join(request['columns'])+') VALUES ('+','.join('?' for _ in row)+')',row)"));
const groups=[];
try {
 for(const variant of ['baseline','per-field-statistics']) {
  let source=original;
  if(variant!=='baseline') {
   const start=source.indexOf('        if (details) args.push(open, close, open, close);');
   const end=source.indexOf('\n      });\n      const single =',start);assert(start>=0&&end>start);
   let select=source.slice(start,end);
   select=select.replace('        if (details)',"        const selections=clause.fields.map(position=>{\n        const fieldTable=table+'_f'+position;\n        if (details)");
   select=select.replace('return `c${i} AS MATERIALIZED (SELECT','return `SELECT').replaceAll('${table}', '${fieldTable}');
   select=select.replace('AND ${eligible})`;',"AND ${eligible}`;\n        });\n        return `c${i} AS MATERIALIZED (${selections.length?selections.join(' UNION ALL '):'SELECT NULL clause,NULL negative,NULL docid,NULL id,NULL field,NULL element,NULL owner,NULL seq,NULL score'+(details?',NULL body,NULL aliases,NULL hbody,NULL halias':'')+' WHERE 0'})`;" );
   source=source.slice(0,start)+select+source.slice(end);
  }
  const context=vm.createContext({createHash,randomUUID,searchTable:()=> 'fts'});
  const runtime=stripTypeScriptTypes(source).replace(/^import .*;\n/gm,'').replace('export class SqliteText','class SqliteText');
  vm.runInContext(runtime+'\nglobalThis.Text = SqliteText;globalThis.parts = identifierParts;',context);
  const file=root+'/'+variant+'.sqlite3';
  const rpc=(method,sql,parameters=[])=>JSON.parse(execFileSync('python3',[rpcScript,file],{input:JSON.stringify({method,sql,parameters}),encoding:'utf8',maxBuffer:16*1024*1024}));
  const db={all:(sql,args)=>rpc('all',sql,args),get:(sql,args)=>rpc('get',sql,args)??undefined,sql:{exec:sql=>rpc('exec',sql)}};
  const text=new context.Text(db),job={type:'Document',name:'search',generation:1,definition:{fields:{name:{weight:3},body:{weight:1}}}};
  text.ensure(job);
  if(variant!=='baseline') {
   const definition=rpc('get',"SELECT sql FROM sqlite_schema WHERE name='fts'").sql;
   for(const field of [0,1])rpc('exec',definition.replace('fts','fts_f'+field));
  }
  const rows=fixture.documents.flatMap((doc,at)=>['name','body'].map((field,index)=>[doc.id,index,0,doc[field],context.parts(doc[field]).text,'e'+(at+1)]));
  const input={method:'populate',separate:variant!=='baseline',entities:fixture.documents.map((d,i)=>[d.id,i+1]),columns:['entity_id','field','element','body','aliases','owner'],rows};
  execFileSync('python3',[rpcScript,file],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:16*1024*1024});
  const cases=fixture.cases.map(test=>{
   const hits=JSON.parse(JSON.stringify(text.search(job,null,test.query,test.options,true,test.topK)));
   const hit=hits.find(h=>test.relevant.includes(h.id));let highlights=true;
   if(hit&&test.highlight){const doc=fixture.documents.find(d=>d.id===hit.id);const field=test.highlight.field;highlights=(hit.highlights[field]??[]).map(([element,start,end])=>{assert.equal(element,0);assert(start>=0&&end>start&&end<=doc[field].length);return doc[field].slice(start,end)}).join(' ').toLowerCase().includes(test.highlight.text.toLowerCase());}
   return {query:test.query,passed:!!hit&&highlights,ids:hits.map(h=>h.id),scores:hits.map(h=>h.score)};
  });
  groups.push({variant,passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).map(c=>c.query),cases});
 }
 fs.writeFileSync('/private/tmp/ears-field-normalization-results.json',JSON.stringify({scope:'Scratch native FTS5 using actual SqliteText search through Python SQLite; per-field ranking populations with the original full-index vocabulary; not packaged driver/performance/adoption qualification',groups},null,2)+'\n');
 for(const group of groups)console.log(JSON.stringify({variant:group.variant,passed:group.passed,failed:group.failed,metadata:group.cases.find(c=>c.query==='generate-entries')}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
