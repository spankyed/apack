import {readFile,writeFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {resolveAppEnvironment} from '@apackdev/sdk/env'
import {test,expect} from '@apackdev/testing'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE
const launcher=process.env.CLAUDE_RESEARCH_LAUNCHER
// Only the outer, offline research probe owns the native launcher and this retained test profile.
test.skip(!workspace||!launcher||process.env.CLAUDE_RESEARCH_BACKGROUND_APP_RESTART!=='1','Explicit owned two-launch research journey required')
test('recovers a linked live child after complete Electron shutdown and relaunch',async({app,appPage,electronApp},testInfo)=>{
 test.setTimeout(90000)
 const saved=JSON.parse(await readFile(join(workspace!,'background-app-restart-saved.json'),'utf8'))
 const processState=async(pid:number)=>{try{const text=await readFile('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');return{state:fields[0],start:fields[19]}}catch(error:any){if(error.code==='ENOENT')return{state:'gone'};throw error}}
 const api=JSON.parse(await readFile(resolveAppEnvironment({env:'test',userDataDir:join(workspace!,'app-data')}).apiPortFile,'utf8'))
 const report:any={saved,mainPid:electronApp.process().pid,apiPid:api.pid,reopenedAt:Date.now(),phase:'reopened'}
 const save=()=>writeFile(join(workspace!,'background-app-restart-observation.json'),JSON.stringify(report,null,2))
 const context=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return{threadId:c.currentThread?.id,sessionId:c.currentThread?.context?.claudeCode?.sessionId,claude:c.currentThread?.context?.claudeCode,messages:c.currentThread?.messages,native:Object.values(c.nativeTerminalViews).find((v:any)=>v.threadId===c.currentThread?.id)}as any})
 const card=appPage.locator('[data-onboarding-id="agent-chat-input"]'),composer=card.getByTestId('composer-editor-area').getByRole('textbox')
 const widget=appPage.getByRole('region',{name:'Background Claude session',exact:true}),input=widget.getByLabel('Message background session',{exact:true})
 const pictures=async(stage:string)=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]as const){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await appPage.screenshot({path:testInfo.outputPath('apack-native-background-app-'+stage+'-'+name+'.png')})}}
 try{
  expect(report.mainPid).not.toBe(saved.mainPid);expect(api.pid).not.toBe(saved.apiPid)
  report.oldMain=await processState(saved.mainPid);report.oldApi=await processState(saved.apiPid)
  expect(report.oldMain.state).toMatch(/^(gone|Z)$/);expect(report.oldApi.state).toMatch(/^(gone|Z)$/)
  report.worker=await processState(saved.job.pid);expect(report.worker.start).toBe(saved.worker.start);expect(report.worker.state).not.toBe('Z')
  await app.waitForSurface('default-setup/threads');await app.navigate('default-setup/threads')
  await appPage.evaluate(id=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId:id,restore:true}),saved.before.threadId)
  await expect.poll(async()=>(await context()).threadId).toBe(saved.before.threadId)
  await expect.poll(async()=>(await context()).messages,{timeout:10000}).toEqual(saved.before.messages)
  report.after=await context();expect(report.after.sessionId).toBe(saved.before.sessionId);expect(report.after.claude.totalCostUsd).toBe(saved.before.claude.totalCostUsd)
  await expect(widget).toBeVisible();await expect(composer).toHaveText(saved.retainedDraft)
  // Collect both independent recovery gaps before the assertions choose the first failure.
  report.replyVisible=await input.isVisible();report.replyDraft=report.replyVisible?await input.inputValue():null
  await widget.getByRole('button',{name:'Refresh status',exact:true}).click()
  try{await expect.poll(async()=>(await context()).native?.backgroundInfo?.observedAt??0,{timeout:10000}).toBeGreaterThan(report.reopenedAt);report.freshStatus=true}catch(error){report.freshStatus=false;report.statusProblem=String(error)}
  report.afterRefresh=await context();await save();await pictures('reopened')
  expect(report.replyDraft,'Unsent child reply survives a real window destruction').toBe(saved.retainedReply)
  expect(report.freshStatus,'A fresh native producer reconnects after graceful shutdown').toBe(true)
  await expect(widget.getByLabel('Background Claude configured status',{exact:true})).toContainText('AppNativeMain '+saved.job.sessionId)
  const starts=(await readFile(join(workspace!,'native-children.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>JSON.stringify(row.args)===JSON.stringify(['--version']))
  const authorities=[]
  for(const start of starts){const state=await processState(start.pid);if(!['gone','Z'].includes(state.state))authorities.push({...start,process:state})}
  expect(authorities).toHaveLength(1);report.authority=authorities[0]
  await widget.getByRole('button',{name:'Send message',exact:true}).click();await expect(input).toHaveValue('',{timeout:20000})
  const journal=async()=>{const directory=join(workspace!,'.claude/projects');return(await Promise.all((await readdir(directory,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>readFile(join(directory,e.name,saved.job.sessionId+'.jsonl'),'utf8').catch(()=>'')))).join('\n').split('\n').filter(Boolean).map(line=>JSON.parse(line))}
  await expect.poll(async()=>(await journal()).filter(row=>row.origin?.kind==='human'&&row.message?.content===saved.retainedReply).length,{timeout:15000}).toBe(1)
  await expect.poll(async()=>{const rows=await journal(),human=rows.find(row=>row.origin?.kind==='human'&&row.message?.content===saved.retainedReply),ancestors=new Set(human?[human.uuid]:[]);for(const row of rows)if(ancestors.has(row.parentUuid)){ancestors.add(row.uuid);if(row.type==='assistant'&&row.message?.content?.some((block:any)=>block.type==='text'&&block.text))return true}return false},{timeout:15000}).toBe(true)
  report.rows=await journal();report.workerAfterReply=await processState(saved.job.pid);expect(report.workerAfterReply.start).toBe(saved.worker.start)
  report.parentAfterReply=await context();expect(report.parentAfterReply.messages).toEqual(saved.before.messages);expect(report.parentAfterReply.claude.totalCostUsd).toBe(saved.before.claude.totalCostUsd)
  await pictures('reply');report.phase='verified'
 }catch(error){report.phase='failed-'+report.phase;report.problem=String(error);report.failureContext=await context().catch(()=>null);await pictures('failed').catch(()=>{});throw error}
 finally{
  if(await widget.getByRole('button',{name:'Stop background session',exact:true}).isVisible()){
   await widget.getByRole('button',{name:'Stop background session',exact:true}).click()
   await expect.poll(async()=>{const state=await processState(saved.job.pid);return state.state==='gone'||state.state==='Z'||state.start!==saved.worker.start},{timeout:15000}).toBe(true)
   report.workerAfterStop=await processState(saved.job.pid)
   if(report.authority){await expect.poll(async()=>{const state=await processState(report.authority.pid);return state.state==='gone'||state.state==='Z'||state.start!==report.authority.process.start},{timeout:10000}).toBe(true);report.authorityAfterStop=await processState(report.authority.pid)}
   if(report.phase==='verified'){await expect(widget.getByLabel('Background session usage',{exact:true})).toHaveCount(0);await expect(composer).toHaveText(saved.retainedDraft);await pictures('stopped')}
  }
  await save()
 }
 await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({nativeBackgroundAppRestart:true,nativeBackgroundDraftsRestored:true,nativeBackgroundFreshStatus:true,nativeBackgroundWorkerContinuity:true,nativeBackgroundUiStop:true,nativeBackgroundAppProcessesReplaced:true,nativeBackgroundParentPreserved:true,sessionId:saved.before.sessionId,backgroundSessionId:saved.job.sessionId,jobId:saved.job.id,actualAppGui:true}))
})
