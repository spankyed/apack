import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const identity=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/relation-identity.ts','utf8')).replaceAll('export function','function');
const audit=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/audit.ts','utf8'));
const body=audit.slice(audit.indexOf('function primaryData('),audit.indexOf('function metadataAndEmbeddings('));
assert(body.startsWith('function primaryData('));
const context=vm.createContext({});
vm.runInContext(identity+'\n'+body+'\nglobalThis.audit=primaryData;',context);
const groups=[];
for(const n of [16,32,64,128]) {
 const rows=Array.from({length:n},(_,i)=>({id:`Relation-${i}`,kind:'Keyed',source:'Row-source',target:'Row-target',seq:i+1,info:{slot:i},weight:null,source_id:'Row-source',target_id:'Row-target'}));
 let priorRows=0,decodes=0;
 const db={schema:{relations:{Keyed:{key:['slot']}}},unpack:value=>{decodes++;return value;},all:()=>[],hydrate:()=>{},
  statement:sql=>({iterate:function*(...args){
   if(sql.startsWith('SELECT r.id,r.kind')) {yield* rows;return;}
   if(sql.startsWith('SELECT id,info FROM relations')) {
    const seq=args[3],id=args[4];
    for(const row of rows)if(row.seq<=seq&&row.id!==id){priorRows++;yield row;}
   }
  }})};
 const report={checkedEntities:0,checkedRelations:0};const issues=[];
 context.audit(db,report,message=>issues.push(message));
 assert.equal(report.checkedRelations,n);assert.deepEqual(issues,[]);
 assert.equal(priorRows,n*(n-1)/2);assert.equal(decodes,n+priorRows);
 groups.push({distinctKeysSharingEndpoints:n,priorRelationComparisons:priorRows,decodedInfos:decodes});
}
console.log(JSON.stringify({scope:'Actual primaryData loop and key equality over controlled cursor rows; comparison-count proof, not SQL/Node-driver timing or memory qualification',groups},null,2));
