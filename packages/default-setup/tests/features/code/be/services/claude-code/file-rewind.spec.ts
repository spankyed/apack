import { afterEach,expect,it } from 'vitest';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionFileRewindPreview,rewindSessionFiles } from '#features/code/be/services/claude-code/session-controls.ts';
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(verdict:unknown={canRewind:true,filesChanged:['fixture.txt'],insertions:1,deletions:1}){
 const cwd=await mkdtemp(join(tmpdir(),'file-rewind-'));directories.push(cwd);
 const cliPath=join(cwd,'fixture.mjs');
 await writeFile(cliPath,`#!${process.execPath}
import{createInterface}from'node:readline';import{writeFileSync}from'node:fs';
const requests=[];const input=createInterface({input:process.stdin});
input.on('line',line=>{const value=JSON.parse(line);requests.push(value);console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:value.request_id,response:value.request.subtype==='initialize'?{commands:[],agents:[],models:[]}:${JSON.stringify(verdict)}}}));});
input.on('close',()=>writeFileSync('capture.json',JSON.stringify({requests,argv:process.argv.slice(2),closed:true})));
`,{mode:0o755});
 return{sessionId:'session-fixture',userMessageId:'user-fixture',cwd,cliPath,env:{PATH:process.env.PATH,HOME:cwd}};
}
for(const dryRun of [true,false]){
 it(`uses explicit structured ${dryRun?'preview':'restoration'} without a user turn`,async()=>{
  const options=await fixture();
  const verdict=await(dryRun?getSessionFileRewindPreview:rewindSessionFiles)(options);
  expect(verdict.canRewind).toBe(true);
  const capture=JSON.parse(await readFile(join(options.cwd,'capture.json'),'utf8'));
  expect(capture.closed).toBe(true);
  expect(capture.argv).toEqual(expect.arrayContaining(['--resume',options.sessionId,'--no-session-persistence']));
  expect(capture.requests.map((request:{type:string})=>request.type)).toEqual(['control_request','control_request']);
  expect(capture.requests[1].request).toEqual({subtype:'rewind_files',user_message_id:options.userMessageId,dry_run:dryRun});
 });
}
it('preserves a negative native capability verdict instead of treating the success envelope as restoration',async()=>{
 const options=await fixture({canRewind:false,error:'No file checkpoint found for this message.'});
 await expect(getSessionFileRewindPreview(options)).resolves.toMatchObject({canRewind:false,error:expect.stringContaining('checkpoint')});
});
it('rejects malformed verdicts and closes the child',async()=>{
 const options=await fixture({});
 await expect(rewindSessionFiles(options)).rejects.toThrow();
 expect(JSON.parse(await readFile(join(options.cwd,'capture.json'),'utf8')).closed).toBe(true);
});
it('refuses extra prompt options before a process is started',async()=>{
 const options={...await fixture(),prompt:'never send'};
 await expect(getSessionFileRewindPreview(options)).rejects.toThrow('unsupported file rewind options');
 await expect(readFile(join(options.cwd,'capture.json'))).rejects.toMatchObject({code:'ENOENT'});
});
