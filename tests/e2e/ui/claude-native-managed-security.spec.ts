import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {test,expect} from '@apackdev/testing'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,launcher=process.env.CLAUDE_RESEARCH_LAUNCHER,decision=process.env.CLAUDE_RESEARCH_MANAGED_SECURITY_DECISION
test.skip(!workspace||!launcher||!['trust','reject'].includes(decision??''),'Explicit private original managed-policy fixture required')
test('reviews original startup managed settings and returns to the same conversation',async({app,appPage,electronApp},info)=>{
 test.setTimeout(150000)
 const win=await electronApp.browserWindow(appPage),captures: string[]=[],errors:string[]=[]
 appPage.on('pageerror',error=>errors.push(error.message))
 async function capture(name:string){
  await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
  const size=appPage.viewportSize()!
  const image=await win.evaluate(async(window,size)=>{const png=await window.webContents.capturePage({x:0,y:0,...size});return{size:png.getSize(),data:png.toPNG().toString('base64')}},size)
  expect(image.size).toEqual(size);const path=info.outputPath(name+'.png');await writeFile(path,Buffer.from(image.data,'base64'));captures.push(path)
 }
 try{
  await app.waitForSurface('default-setup/threads');await app.navigate('host/settings')
  await appPage.evaluate(()=>{const actor=(window as any).applicationState.system.get('host/settings');actor.send({type:'TAB.SELECT',tab:'general'});actor.send({type:'GENERAL_NAV.SELECT',item:'secrets'})})
  const provider=appPage.getByText('Claude Code CLI',{exact:true}).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd=>{const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'NEW_THREAD_IN_PROJECT',directory:cwd});actor.send({type:'VIEW_DASHBOARD'});actor.send({type:'SET_MODE',mode:'Claude Code'});actor.send({type:'SET_PHASE',phase:'Edit'})},workspace!)
  const card=appPage.locator('[data-onboarding-id="agent-chat-input"]'),editor=card.locator('[contenteditable="true"]')
  await editor.fill('Review the project before applying organization settings.');await card.getByRole('button',{name:'Send',exact:true}).click()
  const context=()=>appPage.evaluate(()=>{const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return{sessionId:state.currentThread?.context?.claudeCode?.sessionId,claude:state.currentThread?.context?.claudeCode,native:Object.values(state.nativeTerminalViews).find((view:any)=>view.threadId===state.currentThread?.id)}as any})
  await expect.poll(async()=>(await context()).claude?.turns,{timeout:20000}).toBe(1)
  const sessionId=(await context()).sessionId;expect(sessionId).toBeTruthy()
  const section=appPage.getByRole('region',{name:'Claude native interface',exact:true})
  const draft='Keep these review notes while checking organization settings.'
  await editor.fill(draft)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  const review=appPage.getByRole('alertdialog',{name:'Managed settings require approval',exact:true})
  await expect(review).toBeVisible({timeout:20000})
  const initial=(await context()).native.state.notice;expect(initial.kind).toBe('managed_settings_security');expect(initial.sessionId).toBe(sessionId)
  for(const size of [{width:1100,height:900},{width:680,height:600}]){
   await appPage.setViewportSize(size)
   await expect(review).toContainText('statusLine')
   await expect(review).toContainText('Only accept if you trust')
   await expect(review).toContainText('Approving applies:')
   const trust=review.getByRole('button',{name:'Yes, I trust these settings',exact:true}),exit=review.getByRole('button',{name:'No, exit Claude Code',exact:true})
   await expect(trust).toBeInViewport();await expect(exit).toBeInViewport()
   const bounds=await review.evaluate(element=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight}})
   expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
   await capture('managed-security-'+decision+'-'+size.width)
  }
  const before=(await context()).native.state.notice;expect(before.id).toBe(initial.id);expect(before.revision).toBe(initial.revision)
  await review.getByRole('button',{name:decision==='trust'?'Yes, I trust these settings':'No, exit Claude Code',exact:true}).click()
  await expect(review).toBeHidden({timeout:15000})
  if(decision==='trust'){
   const {recognizeOnboardingPrompt}=await import(pathToFileURL(process.env.CLAUDE_RESEARCH_ONBOARDING!).href)
   let navigated=false,confirmed=false,selectedAt=0
   const terminalInput=section.locator('textarea.xterm-helper-textarea')
   await expect.poll(async()=>{
    if((await context()).native.state.status==='live')return true
    const stage=recognizeOnboardingPrompt(await section.innerText(),workspace)
    if(stage==='workspace-trust'&&!navigated){navigated=true;selectedAt=Date.now();await terminalInput.press('ArrowDown')}
    else if(stage==='workspace-trust-selected'&&!navigated){navigated=true;selectedAt=Date.now()}
    else if(stage==='workspace-trust-selected'&&navigated&&!confirmed&&Date.now()-selectedAt>1200){confirmed=true;await terminalInput.press('Enter')}
    return false
   },{timeout:20000,intervals:[250]}).toBe(true)
   await expect.poll(async()=>(await context()).native.state.mainStatus,{timeout:15000}).toContain('ManagedPolicyTrustRequired')
   await section.getByRole('button',{name:'Stop session',exact:true}).click()
  }
  await expect.poll(async()=>(await context()).native.state.status,{timeout:15000}).toMatch(/^(exited|error)$/)
  if(decision==='reject')expect((await context()).native.state.exitCode).toBe(1)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(editor).toHaveText(draft)
  if(decision==='reject'){await expect(section).toContainText('Claude Code closed because you declined the managed settings.');await expect(section).not.toContainText('disconnected unexpectedly')}
  const recovery='Continue reviewing after organization settings consent.'
  await editor.click();await editor.press('ControlOrMeta+A');await appPage.keyboard.insertText(recovery);await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude?.chatState,{timeout:20000}).toBe('success')
  await expect.poll(async()=>{const rows=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(row=>JSON.parse(row));const last=rows.at(-1);return rows.length===2&&last?.sessionId===sessionId&&last.totalCostUsd===(await context()).claude.totalCostUsd}).toBe(true)
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await capture('managed-security-'+decision+'-recovered')
  await writeFile(join(workspace!,'managed-security-app-proof.json'),JSON.stringify({actualAppGui:true,decision,sessionId,finalSessionId:(await context()).sessionId,resumedPrintSameSession:true,retainedDraft:draft,captures,browserErrors:errors,notice:initial}))
 }catch(error){await capture('managed-security-'+decision+'-failed');await writeFile(join(workspace!,'managed-security-failure.json'),JSON.stringify({text:await appPage.locator('body').innerText(),error:String(error)}));throw error}
})
