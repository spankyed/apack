import {request} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Exercise native settings observations and stale captured transport output on one live child. */
export async function verifyChildFormatterLifecycle({workspace,job,widget,app,appPage,readInfo,context,capture,expect}){
 const path=join(workspace,'background-broker-audit.jsonl');
 const rows=async()=>(await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const configs=async()=>(await rows()).filter(row=>row.path==='/background-status'&&row.status===200&&row.input?.sessionId===job.sessionId&&row.input.formatter);
 const decode=prefix=>JSON.parse(Buffer.from(prefix.slice(prefix.lastIndexOf(' -')+2),'base64url').toString());
 await expect.poll(async()=>(await configs()).at(-1)?.reply?.shellPrefix,{timeout:10000}).toEqual(expect.any(String));
 const before=(await configs()).at(-1),producer=decode(before.reply.shellPrefix),info=await readInfo(),parent=await context();
 const post=(await rows()).filter(row=>row.path==='/background-formatter'&&row.status===200&&row.input?.generation===producer.generation).at(-1);
 expect(post?.input.stdout).toBeTruthy();
 const settingsPath=join(workspace,'.claude/settings.json'),settings=JSON.parse(await readFile(settingsPath,'utf8'));
 expect(settings.statusLine.command).toBe(before.input.formatter.command);
 const stale={...post.input,startedAt:process.hrtime.bigint().toString()};
 const sendStale=()=>new Promise((resolve,reject)=>{
  const req=request({socketPath:producer.socketPath,path:'/background-formatter',method:'POST',headers:{'x-apack-native-token':producer.brokerToken,'content-type':'application/json'},timeout:3000},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,at:Date.now()}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Stale formatter replay timed out')));req.end(JSON.stringify({...stale,startedAt:process.hrtime.bigint().toString()}));
 });
 const shots=async(label)=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await capture('apack-native-background-formatter-'+label+'-'+name+'.png');}};
 const withdrawn={...settings};delete withdrawn.statusLine;
 let withdrawal,replacement,lateWithdrawn,lateRestored;
 try{
  await writeFile(settingsPath,JSON.stringify(withdrawn));
  await expect.poll(async()=>(await configs()).at(-1)?.input.formatter.command,{timeout:10000}).toBe(null);
  withdrawal=(await configs()).at(-1);await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toHaveCount(0);
  await expect(widget.getByLabel('Background session usage',{exact:true})).toBeVisible();lateWithdrawn=await sendStale();expect(lateWithdrawn.status).toBe(409);await shots('withdrawn');
  const helper=join(workspace,'main.py'),replacementHelper=join(workspace,'restored-main.py');await writeFile(replacementHelper,(await readFile(helper,'utf8')).replaceAll('AppNativeMain ','AppNativeRestored '));
  const command=settings.statusLine.command.replace('main.py','restored-main.py');expect(command).not.toBe(settings.statusLine.command);
  await writeFile(settingsPath,JSON.stringify({...settings,statusLine:{...settings.statusLine,command}}));
  await expect.poll(async()=>(await configs()).at(-1)?.input.formatter.command,{timeout:10000}).toBe(command);
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeRestored '+job.sessionId,{timeout:10000});replacement=(await configs()).at(-1);
  expect(decode(replacement.reply.shellPrefix).generation).not.toBe(producer.generation);
  lateRestored=await sendStale();expect(lateRestored.status).toBe(409);
  await app.navigate('host/settings');await app.navigate('default-setup/threads');await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeRestored '+job.sessionId);
  const after=await readInfo(),afterParent=await context();expect(after.pid).toBe(info.pid);expect(after.sessionId).toBe(info.sessionId);expect(afterParent.messages).toEqual(parent.messages);expect(afterParent.claude.totalCostUsd).toBe(parent.claude.totalCostUsd);await shots('restored');
  return{before,producer,info,originalPost:post,withdrawal,replacement,lateWithdrawn,lateRestored,after,parent,afterParent,staleInput:stale,brokerRows:await rows(),scope:'Actual native user-helper withdrawal/replacement and stale captured-post refusal; no managed OS policy or live-held helper cancellation claim.'};
 }finally{await writeFile(settingsPath,JSON.stringify(settings));}
}
