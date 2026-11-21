import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModels } from '#features/code/be/services/claude-code/models.ts';

it.each([false,true])('closes temporary discovery after native failure=%s',async failure=>{
 const cwd=await mkdtemp(join(tmpdir(),'catalog-fixture-')),cliPath=join(cwd,'fixture.mjs');
 try {
  await writeFile(cliPath,`#!${process.execPath}
import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
const requests=[];const input=createInterface({input:process.stdin});
input.on('line',line=>{const value=JSON.parse(line);requests.push(value);const init=value.request?.subtype==='initialize';
const response=${failure}&&!init?{subtype:'error',request_id:value.request_id,error:'native unavailable'}:{subtype:'success',request_id:value.request_id,response:init?{commands:[],agents:[],models:[]}:{models:[]}};
console.log(JSON.stringify({type:'control_response',response}));});
input.on('close',()=>writeFileSync('capture.json',JSON.stringify(requests)));`,{mode:0o755});
  const result=getModels({cwd,cliPath,env:{PATH:process.env.PATH,HOME:cwd}});
  if(failure) await expect(result).rejects.toThrow('native unavailable'); else await expect(result).resolves.toEqual({models:[]});
  const requests=JSON.parse(await readFile(join(cwd,'capture.json'),'utf8'));
  expect(requests.map((value:{request:{subtype:string}})=>value.request.subtype)).toEqual(['initialize','list_models']);
 } finally {await rm(cwd,{recursive:true,force:true});}
});
it('rejects prompt injection options before acquiring a native process',async()=>{
 await expect(getModels({cwd:'/private-fixture',prompt:'must not send'} as Parameters<typeof getModels>[0])).rejects.toThrow('unsupported model catalog options: prompt');
});
