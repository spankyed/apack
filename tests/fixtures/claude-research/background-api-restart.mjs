import {request} from 'node:http';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveAppEnvironment} from '@apackdev/sdk/env';
import {waitForAppReady} from '@apackdev/testing';

/** Real owned API crash/restart; the native background worker must remain the same. */
export async function verifyBackgroundApiRestart({workspace,job,widget,composer,input,retainedReply,app,appPage,electronApp,context,readInfo,childProcessState,capture,expect}){
 const destination=join(workspace,'background-api-restart-observation.json');
 const portFile=resolveAppEnvironment({env:'test',userDataDir:join(workspace,'app-data')}).apiPortFile;
 const endpoint=async()=>JSON.parse(await readFile(portFile,'utf8'));
 const bus=()=>appPage.evaluate(()=>window.applicationState.getSnapshot().context.busSubscribed);
 await expect.poll(bus).toBe(true);
 const before=await context(),workerBefore=await childProcessState(),infoBefore=await readInfo();
 const mainPid=electronApp.process().pid,apiBefore=await endpoint();
 expect(Number.isSafeInteger(apiBefore.pid)&&apiBefore.pid>1).toBe(true);expect(apiBefore.pid).not.toBe(mainPid);expect(apiBefore.pid).not.toBe(process.pid);
 const raw=await readFile('/proc/'+apiBefore.pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
 expect(Number(fields[1])).toBe(mainPid);
 expect((await readFile('/proc/'+apiBefore.pid+'/cmdline','utf8')).includes('server.js')).toBe(true);
 const audit=async()=>(await readFile(join(workspace,'background-broker-audit.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const oldPost=(await audit()).filter(row=>row.path==='/background-formatter'&&row.status===200&&row.input?.sessionId===job.sessionId).at(-1);
 expect(oldPost?.input.stdout).toBeTruthy();
 const oldConfig=(await audit()).filter(row=>row.path==='/background-status'&&row.status===200&&row.input?.sessionId===job.sessionId&&row.reply?.shellPrefix).map(row=>JSON.parse(Buffer.from(row.reply.shellPrefix.slice(row.reply.shellPrefix.lastIndexOf(' -')+2),'base64url').toString())).find(config=>config.generation===oldPost.input.generation);
 expect(oldConfig).toBeTruthy();
 const draft=await composer.textContent();await input.fill(retainedReply);
 const observation={before,workerBefore,infoBefore,mainPid,apiBefore,apiProcessStart:fields[19],draft,retainedReply,oldPost,oldConfig,phase:'before-crash'};
 const save=()=>writeFile(destination,JSON.stringify(observation,null,2));
 const checkpoints=async()=>{const root=join(tmpdir(),'apack-claude-background-'+process.getuid()),result=[];for(const folder of(await readdir(root).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))).slice(0,16)){const path=join(root,folder);for(const file of(await readdir(path)).slice(0,32)){const text=await readFile(join(path,file),'utf8');if(text.length<=4096)result.push({folder,file,text});}}return result;};
 const apiEnvironment=async pid=>Object.fromEntries((await readFile('/proc/'+pid+'/environ','utf8')).split('\0').filter(row=>['APACK_USER_DATA_DIR','APACK_ENV','TMPDIR'].includes(row.split('=')[0])).map(row=>{const at=row.indexOf('=');return[row.slice(0,at),row.slice(at+1)]}));
 observation.checkpointsBefore=await checkpoints();observation.apiEnvironmentBefore=await apiEnvironment(apiBefore.pid);
 const sendOldPost=()=>new Promise((resolve,reject)=>{const req=request({socketPath:oldConfig.socketPath,path:'/background-formatter',method:'POST',headers:{'x-apack-native-token':oldConfig.brokerToken,'content-type':'application/json'},timeout:3000},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode,at:Date.now()}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Old API formatter replay timed out')));req.end(JSON.stringify({...oldPost.input,startedAt:process.hrtime.bigint().toString()}));});

 const pictures=async stage=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await capture('apack-native-background-api-'+stage+'-'+name+'.png');}};
 await save();await pictures('before');
 try{
  observation.crashedAt=Date.now();await save();process.kill(apiBefore.pid,'SIGKILL');
  await expect.poll(bus,{timeout:10000}).toBe(false);observation.disconnectedAt=Date.now();await save();
  await expect.poll(async()=>endpoint().then(v=>v.pid).catch(error=>error.code==='ENOENT'?apiBefore.pid:Promise.reject(error)),{timeout:15000}).not.toBe(apiBefore.pid);
  observation.apiAfter=await endpoint();expect(observation.apiAfter.pid).not.toBe(apiBefore.pid);await save();
  await expect.poll(bus,{timeout:15000}).toBe(true);observation.busResubscribedAt=Date.now();await save();
  await waitForAppReady(appPage,{timeout:15000});await app.waitForSurface('default-setup/threads');await app.navigate('default-setup/threads');
  await appPage.evaluate(id=>window.applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId:id,restore:true}),before.threadId);
  await expect.poll(async()=>(await context()).threadId,{timeout:10000}).toBe(before.threadId);
  observation.phase='api-reconnected';observation.reconnectedAt=Date.now();observation.after=await context();observation.workerAfter=await childProcessState();await save();
  expect(observation.workerAfter?.start).toBe(workerBefore.start);expect(observation.workerAfter?.state).not.toBe('Z');
  await expect(composer).toHaveText(draft);await expect(widget).toBeVisible();await expect(input).toHaveValue(retainedReply);
  await expect.poll(async()=>(await context()).messages,{timeout:10000}).toEqual(before.messages);
  observation.after=await context();await save();
  expect(observation.after.sessionId).toBe(before.sessionId);expect(observation.after.claude.totalCostUsd).toBe(before.claude.totalCostUsd);
  await widget.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(widget.getByRole('button',{name:'Reply',exact:true})).toBeEnabled();
  observation.checkpointsAfter=await checkpoints();observation.apiEnvironmentAfter=await apiEnvironment(observation.apiAfter.pid);observation.brokerProbe=await sendOldPost().catch(error=>({problem:String(error)}));await save();
  await expect.poll(async()=>(await readInfo())?.observedAt??0,{timeout:10000}).toBeGreaterThan(observation.reconnectedAt);
  observation.infoAfter=await readInfo();expect(observation.infoAfter.sessionId).toBe(job.sessionId);expect(observation.infoAfter.pid).toBe(job.pid);
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeMain '+job.sessionId);
  observation.stalePost=await sendOldPost();
  expect(observation.stalePost.status).toBe(409);
  observation.newProducer=(await audit()).filter(row=>row.path==='/background-status'&&row.status===200&&row.pid===observation.apiAfter.pid&&row.input?.sessionId===job.sessionId&&row.reply?.shellPrefix).map(row=>JSON.parse(Buffer.from(row.reply.shellPrefix.slice(row.reply.shellPrefix.lastIndexOf(' -')+2),'base64url').toString())).at(-1);
  expect(observation.newProducer).toMatchObject({socketPath:oldConfig.socketPath,brokerToken:oldConfig.brokerToken,sessionId:job.sessionId,pid:job.pid});
  expect(observation.newProducer.generation).not.toBe(oldConfig.generation);expect(observation.newProducer.token).not.toBe(oldConfig.token);
  const starts=(await readFile(join(workspace,'native-children.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(row=>JSON.stringify(row.args)===JSON.stringify(['--version']));
  const active=[];for(const start of starts){const state=await childProcessState(start.pid);if(state&&state.state!=='Z')active.push({...start,process:state});}
  expect(active).toHaveLength(1);observation.authorityAfter=active[0];
  await pictures('recovered');observation.phase='recovered';await save();
  return observation;
 }catch(error){observation.phase='failed-'+observation.phase;observation.problem=String(error);observation.lastContext=await context().catch(()=>null);observation.lastInfo=await readInfo().catch(()=>null);observation.workerAtFailure=await childProcessState().catch(()=>null);observation.checkpointsAtFailure=await checkpoints().catch(error=>({problem:String(error)}));observation.allViewsAtFailure=await appPage.evaluate(()=>window.applicationState.system.get('default-setup/threads').getSnapshot().context.nativeTerminalViews).catch(()=>null);await save();for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]){await appPage.setViewportSize(size);await capture('apack-native-background-api-failed-'+name+'.png').catch(()=>{});}throw error;}
}
