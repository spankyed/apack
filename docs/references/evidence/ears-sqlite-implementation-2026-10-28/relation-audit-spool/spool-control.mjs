import fs from 'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{fileURLToPath}from'node:url';import vm from'node:vm';import assert from'node:assert/strict';import{stripTypeScriptTypes}from'node:module';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const source=fs.readFileSync('packages/apack-ears/src/sqlite/audit.ts','utf8'),audit=stripTypeScriptTypes(source);
const body=audit.slice(audit.indexOf('function primaryData('),audit.indexOf('function metadataAndEmbeddings('));
const identity=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/relation-identity.ts','utf8')).replace(/^import .*;\n/gm,'').replaceAll('export function','function');
const ddl=source.match(/identities\.exec\(`([\s\S]*?)`\)/)[1];
const context=vm.createContext({createHash,Buffer,Date,Uint8Array});vm.runInContext(identity+'\n'+body+'\nglobalThis.audit=primaryData;',context);
const fingerprint=context.relationKeyFingerprint,equal=context.sameRelationKey,root=fs.mkdtempSync(join(tmpdir(),'ears-audit-spool-control-'));const groups=[];
try {
 for(const [n,duplicate,collision]of[[16,false,false],[32,false,false],[64,false,false],[64,true,false],[16,false,true]]) {
  const file=join(root,`${n}-${duplicate}-${collision}.sqlite3`);
  const rpc=(method,sql,parameters=[])=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./sql-rpc.py',import.meta.url)),file],{input:JSON.stringify({method,sql,parameters}),encoding:'utf8'}));
  rpc('exec',ddl);
  const rows=Array.from({length:n},(_,i)=>({id:`Relation-${i}`,kind:'edge',source:'Row-a',target:'Row-b',seq:i+1,info:{slot:{a:i,b:[1,2]}},weight:null,source_id:'Row-a',target_id:'Row-b'}));
  if(duplicate)rows.push({...rows[17],id:'Relation-duplicate',seq:n+1,info:{slot:{b:[1,2],a:17}}});
  let comparisons=0,decodes=0,candidateRows=0,inserts=0;
  context.relationKeyFingerprint=collision?()=> 'forced':fingerprint;
  context.sameRelationKey=(...args)=>{comparisons++;return equal(...args);};
  const identities={prepare:sql=>({iterate:function*(...parameters){const found=rpc('all',sql,parameters);candidateRows+=found.length;yield* found;},run:(...parameters)=>{inserts++;return rpc('get',sql,parameters);}})};
  const byId=new Map(rows.map(row=>[row.id,row]));
  const db={schema:{relations:{edge:{key:['slot']}}},unpack:value=>{decodes++;return structuredClone(value);},all:()=>[],hydrate:()=>{},
   get:(_sql,[id])=>byId.has(id)?{info:byId.get(id).info}:undefined,
   statement:sql=>({iterate:function*(){if(sql.startsWith('SELECT r.id,r.kind'))yield* rows;}})};
  const report={checkedEntities:0,checkedRelations:0},issues=[];
  context.audit(db,report,message=>issues.push(message),identities);
  assert.equal(report.checkedRelations,rows.length);assert.equal(issues.length,Number(duplicate));
  assert.equal(comparisons,collision?n*(n-1)/2:Number(duplicate));assert.equal(candidateRows,comparisons);
  assert.equal(decodes,rows.length+comparisons);assert.equal(inserts,n);
  groups.push({distinctKeys:n,duplicate,forcedCollision:collision,comparisons,candidateRows,decodes,spooledIdentities:inserts});
 }
 console.log(JSON.stringify({scope:'Actual primaryData/equality/fingerprint over controlled primary cursors plus real file-backed Python SQLite scratch; per-RPC connections, not Node transaction/type/codec or resource qualification',groups},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
