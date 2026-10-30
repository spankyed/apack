import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Real Linux managed-file withdrawal/restoration on the independently running child. */
export async function verifyChildFormatterPolicy({workspace,job,widget,app,appPage,readInfo,context,capture,expect}){
 const control=JSON.parse(await readFile('/control/policy-transition.json','utf8')).directory;
 expect(control).toMatch(/^\/work\/\.claude-research\/policy-transition-[^/]+$/);
 const ready=JSON.parse(await readFile(join(control,'ready.json'),'utf8'));expect(ready.profile).toBe('background-formatter');
 const rows=async()=>(await readFile(join(workspace,'background-broker-audit.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const configs=async()=>(await rows()).filter(row=>row.path==='/background-status'&&row.status===200&&row.input?.sessionId===job.sessionId&&row.input.formatter);
 const readJson=async name=>JSON.parse(await readFile(join(workspace,name),'utf8'));
 const before=(await configs()).at(-1),info=await readInfo(),parent=await context();
 expect(before.input.formatter.command).toBeTruthy();
 const capturePhase=async phase=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await capture('apack-native-background-policy-'+phase+'-'+name+'.png');}};
 let restriction,restoration,held,suppressed,after;
 try{
  await writeFile(join(workspace,'background-policy-helper-arm'),job.sessionId);
  await expect.poll(()=>readJson('background-policy-helper-started.json').catch(error=>error.code==='ENOENT'?null:Promise.reject(error)),{timeout:10000}).toEqual(expect.objectContaining({sessionId:job.sessionId}));
  held=await readJson('background-policy-helper-started.json');
  await writeFile(join(control,'request-1.json'),JSON.stringify({sequence:1,mode:'restricted'}));
  await expect.poll(async()=>JSON.parse((await configs()).at(-1)?.input.formatter.policy??'{}').disableAllHooks,{timeout:10000}).toBe(true);
  restriction=(await configs()).at(-1);expect(restriction.input.formatter.command).toBe(null);
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toHaveCount(0);
  await writeFile(join(workspace,'background-policy-helper-release'),'release');
  await expect.poll(()=>readJson('background-policy-helper-finished.json').catch(error=>error.code==='ENOENT'?null:Promise.reject(error)),{timeout:5000}).toEqual(expect.objectContaining({sessionId:job.sessionId,marker:'STALE_BACKGROUND_POLICY_HELPER'}));
  suppressed=await readInfo();expect(suppressed?.statusLine).toBeUndefined();await capturePhase('restricted');
  await writeFile(join(control,'request-2.json'),JSON.stringify({sequence:2,mode:'restored'}));
  await expect.poll(async()=>JSON.parse((await configs()).at(-1)?.input.formatter.policy??'{}').disableAllHooks,{timeout:10000}).toBe(false);
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeMain '+job.sessionId,{timeout:10000});
  restoration=(await configs()).at(-1);
  await app.navigate('host/settings');await app.navigate('default-setup/threads');
  after=await readInfo();expect(after.sessionId).toBe(job.sessionId);expect(after.pid).toBe(info.pid);expect(after.statusLine).not.toContain('STALE_BACKGROUND_POLICY_HELPER');
  const afterParent=await context();expect(afterParent.messages).toEqual(parent.messages);expect(afterParent.claude.totalCostUsd).toBe(parent.claude.totalCostUsd);await capturePhase('restored');
  return{before,info,parent,held,restriction,suppressed,restoration,after,afterParent,ready,finished:await readJson('background-policy-helper-finished.json'),receipts:await Promise.all([1,2].map(async n=>JSON.parse(await readFile(join(control,'receipt-'+n+'.json'),'utf8')))),brokerRows:await rows(),scope:'Real Linux managed-file hooks disable/restore after parent Stop, with a delayed child formatter; no MDM, zero-exit old helper or full restart claim.'};
 }finally{await writeFile(join(workspace,'background-policy-helper-release'),'release');await writeFile(join(control,'finish'),'finish');}
}
