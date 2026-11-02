import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import{stripTypeScriptTypes}from'node:module';import{createHash}from'node:crypto';
const source=stripTypeScriptTypes(fs.readFileSync('packages/apack-ears/src/sqlite/relation-identity.ts','utf8')).replace(/^import .*;\n/gm,'').replaceAll('export function','function');
const context=vm.createContext({createHash,Buffer,Date,Uint8Array});vm.runInContext(source+'\nglobalThis.same=sameRelationKey;globalThis.fingerprint=relationKeyFingerprint;',context);
const proto=Object.fromEntries([['__proto__',{x:1}]]);
const values=[undefined,null,false,true,0,-0,1,-1,Infinity,-Infinity,1n,'1','', '\ud800','\ud801',[],[undefined],[null],[1,2],[2,1],{}, {a:undefined},{a:1,b:2},{b:2,a:1},proto,new Uint8Array([1]),Buffer.from([1]),new Uint8Array([1,2]),new Date(0),new Date(1),{x:[new Uint8Array([1]),new Date(2)]}];
let pairs=0,equal=0;
for(const a of values)for(const b of values){const left={slot:a},right={slot:b};const same=context.same(['slot'],left,right),x=context.fingerprint(['slot'],left),y=context.fingerprint(['slot'],right);if(same){assert.equal(x,y);equal++;}else assert.notEqual(x,y);pairs++;}
for(const bad of [NaN,new Date(NaN),{nested:NaN},[NaN]])assert.equal(context.fingerprint(['slot'],{slot:bad}),undefined);
assert.equal(context.fingerprint(['slot'],{}),context.fingerprint(['slot'],{slot:null}));
assert.notEqual(context.fingerprint(['slot'],{slot:'\ud800'}),context.fingerprint(['slot'],{slot:'\ud801'}));
console.log(JSON.stringify({pairs,equal,structuralTokenAgreement:true,nonreflexiveKeysSkipped:true,unpairedSurrogatesDistinct:true,scope:'Pure helper semantic controls; actual MessagePack/SQLite audit and collision tests pending'},null,2));
