import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async ({appPage,electronApp},info) => {
  terminalScreen?.dispose(); terminalScreen=undefined
  if(workspace && info.status!==info.expectedStatus) {
    const state=await appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews)
    await writeFile(join(workspace,'native-model-panel-final-failure.json'),JSON.stringify({text:await appPage.locator('body').innerText(),views:state}))
    const win=await electronApp.browserWindow(appPage)
    const image=await win.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(workspace,'native-model-panel-final-failure.png'),Buffer.from(image,'base64'))
  }
})
test('chooses models through original hooks, decisions and same-session recovery', async ({app,appPage,electronApp},testInfo)=>{
  test.setTimeout(150000)
  expect(process.env.CLAUDE_RESEARCH_NATIVE_MODEL_PANEL).toBe('1')
  expect(process.env.HOME).toBe(workspace)
  const restriction=false
  async function replaceDraft(editor:import('@playwright/test').Locator,text:string){
    await editor.click();await editor.press('ControlOrMeta+A');await appPage.keyboard.insertText(text);await expect(editor).toHaveText(text)
  }
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await replaceDraft(card.locator('[contenteditable="true"]'),'Review this project with the current Claude model.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'))
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1)
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!
  expect(dimensions.cols).toBeGreaterThan(1); expect(dimensions.cols).toBeLessThanOrEqual(500)
  terminalScreen = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
  let lastSequence = 0
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Release review') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Release review'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Release review')
    await expect(main).toContainText('Workspace notes and checklist')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Release review')
  const composer = card.locator('[contenteditable="true"]')

  const panel=appPage.getByRole('dialog',{name:'Claude Code model',exact:true})
  const send=card.getByRole('button',{name:'Send',exact:true})
  const draft='Keep my model-review draft and cursor while choosing a model.'
  const receipts:any[]=[],captures:any[]=[]
  const settingsFile=join(workspace!,'.claude/settings.json')
  const settings=async()=>JSON.parse(await readFile(settingsFile,'utf8'))
  const mode=async(value:string)=>writeFile(join(workspace!,'native-model-hook-mode'),value)
  const hooks=async()=> (await readFile(join(workspace!,'native-model-hook-receipts.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  const nativeWindow=await electronApp.browserWindow(appPage)
  const selection=()=>composer.evaluate(element=>{const value=getSelection();return value&&element.contains(value.anchorNode)?{anchor:value.anchorOffset,focus:value.focusOffset,text:value.toString()}:null})
  let savedSelection:unknown
  async function composeDraft(){await replaceDraft(composer,draft);await composer.press('Home');await composer.press('ArrowRight');savedSelection=await selection();expect(savedSelection).not.toBeNull()}
  async function record(stage:string,extra:Record<string,unknown>={}){
    const state=await context();expect(state.sessionId).toBe(sessionId)
    if(stage!=='resumed')expect(state.native.state.nativePid).toBe(boundNativePid)
    const current={stage,sessionId:state.sessionId,nativePid:state.native?.state?.nativePid,model:state.claude.modelOverride,...extra};receipts.push(current)
    await writeFile(join(workspace!,'native-model-panel-progress.json'),JSON.stringify({receipts,captures,stage}))
  }
  async function restored(stage:string,expectedModel?:string){
    await expect(panel).toBeHidden();await expect(composer).toBeVisible();await expect(composer).toHaveText(draft)
    await expect.poll(selection).toEqual(savedSelection)
    if(expectedModel!==undefined)await expect.poll(async()=>(await context()).claude.modelOverride).toBe(expectedModel)
    await record(stage,{draftRetained:true,selectionRetained:true})
  }
  async function open(){
    const direct=card.getByRole('button',{name:'Choose Claude model',exact:true})
    if(await direct.isVisible())await direct.click()
    else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Choose Claude model',exact:true}).click()}
    await expect(panel).toBeVisible()
    try { await expect(panel.getByRole('heading',{name:'Select model',exact:true})).toBeVisible() }
    catch(error) {
      await writeFile(join(workspace!,'native-model-panel-failure.json'),JSON.stringify({panel:await panel.innerText(),native:await context()}))
      const image=await nativeWindow.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
      await writeFile(join(workspace!,'native-model-panel-failure.png'),Buffer.from(image,'base64'))
      throw error
    }
    await expect(panel.locator('textarea.xterm-helper-textarea')).toHaveCount(0)
  }
  async function capture(stage:string,reading:()=>import('@playwright/test').Locator,controls:()=>import('@playwright/test').Locator[]){
    for(const [width,height] of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height})
      if(stage==='picker')await reading().scrollIntoViewIfNeeded()
      await expect(reading()).toBeInViewport({ratio:1})
      for(const control of controls())await expect(control).toBeInViewport({ratio:1})
      if(stage==='recovered'){
        await expect(send).toBeEnabled()
        const paint=await send.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>undefined)));return getComputedStyle(element).backgroundColor})
        expect(paint).toMatch(/^rgb\((37, 99, 235|29, 78, 216)\)$/)
      }
      const file=`native-model-panel-${stage}-${width}-${height}.png`
      const image=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'))
      captures.push({stage,width,height,file,readable:true,controlsReachable:true})
    }
  }
  const choice=(family:string)=>panel.locator('[data-native-settings-option]').filter({hasText:new RegExp(family,'i')}).first()
  const nativeNotice=(text:string)=>expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='assistant'&&row.text.includes(text)))
  const modelBefore=(await context()).claude.modelOverride, savedBefore=(await settings()).model

  await mode('ask')
  await replaceDraft(composer,'');await composer.pressSequentially('/cc-model')
  await appPage.locator('.command-suggestion-popup').getByText('/cc-model',{exact:true}).click()
  await composer.pressSequentially('haiku');await send.click();await expect(composer).toHaveText('')
  await expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='assistant'&&row.text.includes('Use Choose Claude model'))).toBe(true)
  expect((await context()).claude.modelOverride).toBe(modelBefore);expect((await settings()).model).toBe(savedBefore)
  await record('sdk-ask',{modelUnchanged:true,inputAcknowledged:true})
  await composeDraft();await open()
  await capture('picker',()=>choice('Haiku'),()=>[choice('Haiku'),panel.getByRole('button',{name:'Close model selection',exact:true}),panel.getByRole('button',{name:'Refresh',exact:true})])
  const haiku=await choice('Haiku').getAttribute('data-native-settings-option');expect(haiku).toBeTruthy()
  await choice('Haiku').click()
  await expect(panel.getByText('Confirm this model change before continuing.',{exact:false})).toBeVisible()
  const confirm=()=>panel.getByRole('button',{name:/^Yes, switch to/})
  await expect(confirm()).toBeFocused()
  await capture('confirmation',()=>panel.getByText('Confirm this model change before continuing.',{exact:false}).last(),()=>[confirm(),panel.getByRole('button',{name:'No, go back',exact:true}).last()])
  await panel.getByRole('button',{name:'No, go back',exact:true}).last().click()
  if(await panel.isVisible())await panel.getByRole('button',{name:'Close model selection',exact:true}).click()
  await restored('cancel-confirmation');expect((await context()).claude.modelOverride).toBe(modelBefore);expect((await settings()).model).toBe(savedBefore)

  await open();await choice('Haiku').click();await expect(confirm()).toBeVisible();await confirm().click()
  await restored('confirm',haiku!)
  await expect.poll(async()=>(await settings()).model).toBe(haiku)

  await mode('deny');await open();await choice('Sonnet').click()
  await nativeNotice('Keep the current model for the review.').toBe(true)
  await restored('deny');expect((await context()).claude.modelOverride).toBe(haiku);expect((await settings()).model).toBe(haiku)

  await mode('pending');await open();await choice('Opus').click()
  await expect(panel.getByText('Running PreModelSwitch hooks…',{exact:true})).toBeVisible()
  await capture('pending',()=>panel.getByText('Running PreModelSwitch hooks…',{exact:true}),()=>[panel.getByRole('button',{name:'Cancel model change',exact:true})])
  const held=(await hooks()).filter(row=>row.mode==='pending'&&row.phase==='start').at(-1);expect(held?.pid).toBeGreaterThan(0)
  await panel.getByRole('button',{name:'Cancel model change',exact:true}).click();await restored('cancel-pending')
  await expect.poll(()=>{try{process.kill(held.pid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true)
  Object.assign(receipts.find(row=>row.stage==='cancel-pending'),{helperPid:held.pid,helperExited:true})
  expect((await context()).claude.modelOverride).toBe(haiku);expect((await settings()).model).toBe(haiku)

  await mode('timeout');await open();await choice('Sonnet').click()
  await nativeNotice('did not respond before its timeout').toBe(true)
  await restored('timeout');expect((await context()).claude.modelOverride).toBe(haiku);expect((await settings()).model).toBe(haiku)
  const timedOut=(await hooks()).filter(row=>row.mode==='timeout'&&row.phase==='start').at(-1);expect(timedOut?.pid).toBeGreaterThan(0)
  await expect.poll(()=>{try{process.kill(timedOut.pid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true)
  Object.assign(receipts.find(row=>row.stage==='timeout'),{helperPid:timedOut.pid,helperExited:true})

  await mode('allow');await open()
  const selectedModel=await choice('Sonnet').getAttribute('data-native-settings-option');expect(selectedModel).toBeTruthy()
  await choice('Sonnet').click();await restored('allow',selectedModel!)
  await expect.poll(async()=>(await settings()).model).toBe(selectedModel)
  await replaceDraft(composer,'Review the model choice using the selected model.');await send.click()
  await expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='assistant'&&row.text.includes('The selected model handled the review.')),{timeout:15000}).toBe(true)
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await expect.poll(async()=>(await context()).claude.model).toMatch(/sonnet/i)
  const effectiveModel=(await context()).claude.model
  await record('native-turn',{inputAcknowledged:true,observedModel:effectiveModel})

  await composeDraft();await open();await choice('Default').click();await restored('reset','default')
  await expect.poll(async()=>(await settings()).model).toBeUndefined()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status,{timeout:15000}).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft)
  let nativeCost=0
  for(const bucket of await readdir(join(workspace!,'.claude/projects'))){
    try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));nativeCost=rows.filter(row=>row.type==='cost-state').at(-1)?.totalCostUSD??0;break}catch(error:any){if(error.code!=='ENOENT')throw error}
  }
  expect(nativeCost).toBeGreaterThan(0);await expect.poll(async()=>(await context()).claude.totalCostUsd).toBe(nativeCost)
  await replaceDraft(composer,'Continue the same review after model controls close.');await send.click()
  await expect.poll(async()=>(await context()).claude.chatState,{timeout:15000}).toBe('success')
  let resumedCost=0
  await expect.poll(async()=>{const rows=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const last=rows.at(-1);if(last?.sessionId!==sessionId||last.totalCostUsd<=nativeCost)return false;resumedCost=last.totalCostUsd;return (await context()).claude.totalCostUsd===resumedCost}).toBe(true)
  await record('resumed',{inputAcknowledged:true})
  await replaceDraft(composer,'Ready to continue the model review.')
  await capture('recovered',()=>composer,()=>[send])
  expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-model-panel-app.json'),JSON.stringify({sessionId,nativePid:boundNativePid,selectedModel,effectiveModel,resetModel:'default',resetSavedModelAbsent:(await settings()).model===undefined,nativeCost,resumedCost,receipts,captures}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeModelPanel:true,nativeModelConfirmation:true,nativeModelRefusal:true,nativeModelCancellation:true,nativeModelTimeout:true,nativeModelReset:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:(await context()).sessionId,boundNativePid,nativeCost,resumedCost,browserErrors:errors}))
})
