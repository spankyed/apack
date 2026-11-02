import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {stripTypeScriptTypes} from 'node:module';
const identity=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/relation-identity.ts','utf8')).replaceAll('export function','function').replace(/^import .*;\n/gm,'');
const source=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/database.ts','utf8'));
const start=source.indexOf('  matchingRelation('),end=source.indexOf('  role(',start);
assert(start>=0&&end>start);
const context=vm.createContext({});vm.runInContext(identity+'\nclass Control {\n'+source.slice(start,end)+'\n}\nglobalThis.Control=Control;',context);
const holder=new context.Control(),data=Array.from({length:128},(_,i)=>({id:`Relation-${i}`,info:{slot:i}}));
let visited=0,active=0,failAt=-1;
holder.statement=()=>({iterate:function*(_kind,_source,_target,exclude){active++;try{for(const row of data)if(row.id!==exclude){visited++;yield row;}}finally{active--;}}});
holder.unpack=info=>{if(info.slot===failAt)throw Error('damaged info');return info;};
const summaries=[];
for(const [slot,wanted]of[[0,1],[127,128],[128,128]]) {
 visited=0;const answer=holder.matchingRelation('edge','Row-a','Row-b',['slot'],{slot});
 assert.equal(visited,wanted);assert.equal(active,0);assert.equal(answer?.id,slot<128?`Relation-${slot}`:undefined);summaries.push({slot,visited,cursorClosed:true});
}
visited=0;assert.equal(holder.matchingRelation('edge','Row-a','Row-b',['slot'],{slot:0},'Relation-0'),undefined);assert.equal(visited,127);assert.equal(active,0);
failAt=2;visited=0;assert.throws(()=>holder.matchingRelation('edge','Row-a','Row-b',['slot'],{slot:127}),/damaged info/);assert.equal(visited,3);assert.equal(active,0);
console.log(JSON.stringify({scope:'Actual helper/equality over controlled cursor rows; not native SQL/type or memory qualification',summaries,exclusionAndDecodeFailureClose:true},null,2));
