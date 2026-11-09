import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {stripVTControlCharacters} from 'node:util'
import {resolveAppEnvironment} from '@apackdev/sdk/env'
import {test,expect} from '@apackdev/testing'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,onboarding=process.env.CLAUDE_RESEARCH_ONBOARDING
let screenTerminal:import('@xterm/xterm').Terminal|undefined
test.afterEach(()=>screenTerminal?.dispose())
test.skip(!workspace||!onboarding,'Explicit private native composer cold-reopen fixture required')
test('cold restores independent Plan, draft and directory choices before original native admission',async({app,appPage,electronApp},testInfo)=>{
 test.setTimeout(90000)
 const saved=JSON.parse(await readFile(join(workspace!,'native-composer-cold-state.json'),'utf8'))
 const {sessionId,boundNativePid,planText,editText,firstDirectory,secondDirectory,originalMode}=saved
 const api=JSON.parse(await readFile(resolveAppEnvironment({env:'test',userDataDir:join(workspace!,'app-data')}).apiPortFile,'utf8'))
 expect(electronApp.process().pid).not.toBe(saved.mainPid);expect(api.pid).not.toBe(saved.apiPid)
 for(const pid of [saved.mainPid,saved.apiPid]){let live=false;try{execFileSync('/bin/ps',['-p',String(pid),'-o','pid='],{stdio:'pipe'});live=true}catch(error:any){expect(error.status).toBe(1)}expect(live).toBe(false)}
 const errors:string[]=[];appPage.on('pageerror',e=>errors.push(e.message))
 await app.waitForSurface('default-setup/threads');await app.navigate('default-setup/threads')
 await appPage.evaluate(threadId=>{const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'VIEW_THREAD',threadId});actor.send({type:'VIEW_DASHBOARD'})},saved.threadId)
 const card=appPage.locator('[data-onboarding-id="agent-chat-input"]'),composer=card.locator('[contenteditable="true"]'),status=card.getByTestId('composer-native-status')
 const section=appPage.getByRole('region',{name:'Claude native interface',exact:true}),input=section.locator('textarea.xterm-helper-textarea')
 const context=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {phase:c.phase,threadId:c.currentThread?.id,sessionId:c.currentThread?.context?.claudeCode?.sessionId,claude:c.currentThread?.context?.claudeCode,messages:c.currentThread?.messages,native:Object.values(c.nativeTerminalViews).find((v:any)=>v.threadId===c.currentThread?.id)} as any})
 await expect(composer).toHaveText(planText);await expect(card.getByRole('button',{name:'Plan',exact:true})).toBeVisible()
 expect((await context()).claude.permissionMode).toBe(originalMode)
 expect((await context()).claude.additionalDirs).toEqual([firstDirectory,secondDirectory])
 expect((await context()).claude.nativeLaunch).toEqual(saved.savedLaunch)
 expect((await readFile(join(workspace!,'native-children.jsonl'),'utf8')).trim().split('\n')).toHaveLength(2)
 const history=async()=>{const c=await context();return c.messages.filter((row:any)=>row.context?.cliUuid).map((row:any)=>({id:row.id,uuid:row.context.cliUuid,text:row.text,sender:row.sender}))}
 expect(await history()).toEqual(saved.history);expect((await context()).claude.totalCostUsd).toBe(saved.cost)
 await section.getByRole('button',{name:'Use native interface',exact:true}).click()
 const {recognizeOnboardingPrompt}=await import(pathToFileURL(onboarding!).href)
 ;(globalThis as any).self??=globalThis
 const {Terminal}=createRequire(import.meta.url)('@app/claude-terminal-xterm')
 let sequence=0,navigated=false,navigationAttempts=0,trustAt=0,trustAttempts=0
 await expect.poll(async()=>{
  const native=(await context()).native
  if(!native?.state||typeof native.state.nativePid!=='number'||native.state.nativePid===boundNativePid)return false
  if(native.state.status==='live')return native.state.mainStatus?.includes('Session ready')===true
  if(['error','exited'].includes(native.state.status))throw Error('Cold native owner exited before trust admission')
  if(!screenTerminal){const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8')),row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(m=>m[0]).filter(row=>row.includes(native.state.ownerId)).at(-1),cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];if(!cols||!rows)return false;screenTerminal=new Terminal({cols:Number(cols),rows:Number(rows),allowProposedApi:true})}
  const chunks=native.output.filter((chunk:any)=>chunk.sequence>sequence)
  if(chunks.length){await new Promise<void>(resolve=>screenTerminal!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));sequence=chunks.at(-1).sequence}
  const buffer=screenTerminal!.buffer.active,text=Array.from({length:screenTerminal!.rows},(_,row)=>buffer.getLine(buffer.baseY+row)?.translateToString(true)??'').join('\n'),screen=recognizeOnboardingPrompt(text,workspace)
  await writeFile(join(workspace!,'native-composer-cold-gate.json'),JSON.stringify({screen,text,navigated,navigationAttempts,trustAttempts,pid:native.state.nativePid,ownerId:native.state.ownerId}))
  if(screen==='workspace-trust'&&navigationAttempts<3&&(!navigated||Date.now()-trustAt>1200)){navigated=true;navigationAttempts++;trustAt=Date.now();await input.press('ArrowDown')}
  else if(screen==='workspace-trust-selected'&&trustAttempts===0&&(!navigated||Date.now()-trustAt>1200)){trustAttempts++;await input.press('Enter')}
  return false
 },{timeout:25000,intervals:[250]}).toBe(true)
 const reopenedNativePid=(await context()).native.state.nativePid
 expect(reopenedNativePid).not.toBe(boundNativePid)
 await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
 await expect(composer).toHaveText(planText);await expect(card.getByRole('button',{name:'Plan',exact:true})).toBeVisible()
 expect(await history()).toEqual(saved.history);expect((await context()).claude.permissionMode).toBe(originalMode)
 expect((await context()).claude.nativeLaunch.addDir).toEqual([firstDirectory,secondDirectory])
 for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(status).toContainText('Session ready');await expect(composer).toHaveText(planText);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-composer-cold-'+width+'.png')})}
 const send=async(text:string,mode:string)=>{await composer.fill(text);await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('');await expect.poll(async()=>(await context()).claude.permissionMode).toBe(mode);await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await expect.poll(async()=>(await context()).messages.filter((row:any)=>row.text===text).length).toBe(1)}
 await send(planText,'plan');const planned=await context()
 await card.getByRole('button',{name:'Plan',exact:true}).click();await appPage.getByRole('menuitem',{name:'Edit',exact:true}).click();expect((await context()).claude.permissionMode).toBe('plan')
 await send(editText,originalMode);const edited=await context()
 const reference=JSON.parse(await readFile(join(workspace!,'reference-fixture.json'),'utf8'))
 await composer.fill('ResearchDirectoryTurn2');await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')
 const approval=appPage.getByRole('region',{name:'Read approval',exact:true});await expect(approval).toBeVisible();await expect(approval.getByTestId('native-read-path')).toHaveText(reference.secondFile);await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toHaveCount(0)
 await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
 const ready=await context();expect(ready.sessionId).toBe(sessionId)
 const launch=ready.claude.nativeLaunch,additionalDirs=ready.claude.additionalDirs
 await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
 const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
 await composer.fill('Continue after cold-restoring release review choices.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
 await writeFile(join(workspace!,'native-staged-directory-proof.json'),JSON.stringify({firstDirectory,secondDirectory,launch,additionalDirs,boundNativePid,reopenedNativePid,sessionId}))
 await writeFile(join(workspace!,'native-composer-phase-proof.json'),JSON.stringify({sessionId,boundNativePid,reopenedNativePid,originalMode,planText,editText,plannedMode:planned.claude.permissionMode,editedMode:edited.claude.permissionMode,history:await history(),priorMainPid:saved.mainPid,priorApiPid:saved.apiPid,coldMainPid:electronApp.process().pid,coldApiPid:api.pid,historyBefore:saved.history,costBefore:saved.cost,toolCallCountBefore:saved.toolCallCount}))
 await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeComposerPhase:true,nativeComposerCold:true,nativeComposerPhaseReload:false,nativeComposerPhaseOnSend:true,nativeComposerPhaseRestore:true,nativeStagedDirectories:true,nativeStagedDirectoryHandoff:true,nativeStagedDirectoryReopen:true,nativeStagedDirectoryRead:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,browserErrors:errors}))
})
