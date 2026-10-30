import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveAppEnvironment} from '@apackdev/sdk/env';
import {waitForAppReady} from '@apackdev/testing';

/** Real owned API crash/restart; the native background worker must remain the same. */
export async function verifyBackgroundApiRestart({workspace,job,widget,composer,input,retainedReply,app,appPage,electronApp,context,readInfo,childProcessState,capture,expect}){
 const destination=join(workspace,'background-api-restart-observation.json');
 const portFile=resolveAppEnvironment({env:'test',userDataDir:join(workspace,'app-data')}).apiPortFile;
 const endpoint=async()=>JSON.parse(await readFile(portFile,'utf8'));
 const before=await context(),workerBefore=await childProcessState(),infoBefore=await readInfo();
 const mainPid=electronApp.process().pid,apiBefore=await endpoint();
 expect(Number.isSafeInteger(apiBefore.pid)&&apiBefore.pid>1).toBe(true);expect(apiBefore.pid).not.toBe(mainPid);expect(apiBefore.pid).not.toBe(process.pid);
 const raw=await readFile('/proc/'+apiBefore.pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
 expect(Number(fields[1])).toBe(mainPid);
 expect((await readFile('/proc/'+apiBefore.pid+'/cmdline','utf8')).includes('server.js')).toBe(true);
 const draft=await composer.textContent();await input.fill(retainedReply);
 const observation={before,workerBefore,infoBefore,mainPid,apiBefore,apiProcessStart:fields[19],draft,retainedReply,phase:'before-crash'};
 const save=()=>writeFile(destination,JSON.stringify(observation,null,2));
 const pictures=async stage=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await capture('apack-native-background-api-'+stage+'-'+name+'.png');}};
 await save();await pictures('before');
 try{
  observation.crashedAt=Date.now();await save();process.kill(apiBefore.pid,'SIGKILL');
  await expect.poll(async()=>endpoint().then(v=>v.pid).catch(error=>error.code==='ENOENT'?apiBefore.pid:Promise.reject(error)),{timeout:15000}).not.toBe(apiBefore.pid);
  observation.apiAfter=await endpoint();expect(observation.apiAfter.pid).not.toBe(apiBefore.pid);await save();
  await waitForAppReady(appPage,{timeout:15000});await app.waitForSurface('default-setup/threads');await app.navigate('default-setup/threads');
  await appPage.evaluate(id=>window.applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId:id,restore:true}),before.threadId);
  await expect.poll(async()=>(await context()).threadId,{timeout:10000}).toBe(before.threadId);
  observation.phase='api-reconnected';observation.reconnectedAt=Date.now();observation.after=await context();observation.workerAfter=await childProcessState();await save();
  expect(observation.workerAfter?.start).toBe(workerBefore.start);expect(observation.workerAfter?.state).not.toBe('Z');
  await expect(composer).toHaveText(draft);await expect(widget).toBeVisible();await expect(input).toHaveValue(retainedReply);
  expect(observation.after.sessionId).toBe(before.sessionId);expect(observation.after.messages).toEqual(before.messages);expect(observation.after.claude.totalCostUsd).toBe(before.claude.totalCostUsd);
  await widget.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(widget.getByRole('button',{name:'Reply',exact:true})).toBeEnabled();
  await expect.poll(async()=>(await readInfo())?.observedAt??0,{timeout:10000}).toBeGreaterThan(observation.reconnectedAt);
  observation.infoAfter=await readInfo();expect(observation.infoAfter.sessionId).toBe(job.sessionId);expect(observation.infoAfter.pid).toBe(job.pid);
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeMain '+job.sessionId);
  await pictures('recovered');observation.phase='recovered';await save();
  return observation;
 }catch(error){observation.phase='failed-'+observation.phase;observation.problem=String(error);observation.lastContext=await context().catch(()=>null);observation.lastInfo=await readInfo().catch(()=>null);observation.workerAtFailure=await childProcessState().catch(()=>null);await save();throw error;}
}
