import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(async({appPage,electronApp},info)=>{
 if(info.status!==info.expectedStatus&&!appPage.isClosed()){
  const state=await appPage.evaluate(()=>({focused:document.hasFocus(),visibility:document.visibilityState,text:document.body.innerText.slice(-16000),buttons:[...document.querySelectorAll('button[aria-label="Expand tool activity"]')].map(node=>({rect:node.getBoundingClientRect().toJSON(),style:{display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,opacity:getComputedStyle(node).opacity}}))})).catch(error=>({error:String(error)}))
  await writeFile(join(workspace!,'native-search-failure.json'),JSON.stringify(state))
  const window=await electronApp.browserWindow(appPage)
  const png=await window.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64')).catch(()=>undefined)
  if(png)await writeFile(info.outputPath('native-search-failure.png'),Buffer.from(png,'base64'))
 }
 terminalScreen?.dispose();terminalScreen=undefined
})
test('reviews original Glob and Grep results while preserving everyday composing', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(180000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns, { timeout: 15000 }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return
    const rows=(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
    const event=rows.map(row=>row.meta?.event).filter(event=>event?.type==='CLAUDE_TERMINAL_RESIZE'&&event.ownerId===ownerId).at(-1)
    return event?{cols:event.columns,rows:event.rows}:undefined
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!;
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('AppNativeMain ' + sessionId) === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain ' + sessionId)
    await expect(main).toContainText('Second native status line')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain ' + sessionId)
  const composer = card.locator('[contenteditable="true"]')
  const ownedWindow=await electronApp.browserWindow(appPage)
  await ownedWindow.evaluate(window=>{window.show();window.focus()})
  await appPage.bringToFront()
  await expect.poll(()=>appPage.evaluate(()=>document.hasFocus())).toBe(true)
  const idleRedraw=process.env.CLAUDE_RESEARCH_IDLE_REDRAW==='1'
  const cwdNavigation=process.env.CLAUDE_RESEARCH_CWD_NAVIGATION==='1'
  const cases=cwdNavigation||idleRedraw?[]:JSON.parse(await readFile(join(workspace!,'native-search-review-steps.json'),'utf8'))
  const results=[],navigation=[]
  for(const [index,step] of cases.entries()){
    const phase=index+1,id='native_search_review_'+phase
    await composer.fill('SearchReviewTurn'+phase+': '+step.purpose)
    await card.getByRole('button',{name:'Send',exact:true}).click()
    await expect(appPage.getByText('Search review step '+phase+' complete.',{exact:true})).toBeVisible({timeout:15000})
    const group=appPage.locator('[data-native-tool-ids~="'+id+'"]')
    await expect(async()=>{
      const expand=group.getByRole('button',{name:'Expand tool activity',exact:true})
      if(await expand.isVisible())await expand.click({timeout:1000})
      else{const tools=group.getByRole('button',{name:/^Native tools/});if(await tools.isVisible()&&await tools.getAttribute('aria-expanded')!=='true')await tools.click({timeout:1000})}
      await expect(appPage.locator('[data-native-tool-use-id="'+id+'"]')).toBeVisible({timeout:1000})
    }).toPass({timeout:10000})
    const receipt=async()=>JSON.parse(await readFile(join(workspace!,id+'-original.json'),'utf8').catch(()=>'{}'))
    await expect.poll(async()=>(await receipt()).props?.tool_use_id,{timeout:15000}).toBe(id)
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    const original=await receipt()
    expect(original.props.tool).toBe(step.tool)
    expect(original.props.isErrored).toBe(phase===4)
    const result=appPage.locator('[data-native-tool-use-id="'+id+'"]').locator('[data-native-tool-format]').last()
    await expect(result).toBeVisible()
    const draft='Keep my release review after search step '+phase+'.'
    await composer.fill(draft)
    for(const width of [1100,680]){
      const height=width===680?600:900
      await appPage.setViewportSize({width,height})
      await expect(async()=>{await result.evaluate(element=>element.scrollIntoView({block:'nearest'}));await expect(result).toBeInViewport()}).toPass({timeout:5000})
      await expect(composer).toHaveText(draft)
      await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
      const window=await electronApp.browserWindow(appPage)
      const png=await window.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath('native-search-'+phase+'-'+width+'.png'),Buffer.from(png,'base64'))
    }
    results.push({phase,id,original:original.props,formattedText:await result.innerText()})
  }
  let idleProof:any
  if(idleRedraw){
    const initial=await context(),childrenBefore=await readFile(join(workspace!,'native-children.jsonl'),'utf8')
    const messageIds=initial.messages.map((message:any)=>message.id)
    const tools=card.getByRole('button',{name:'Session tools',exact:true})
    await composer.fill('Keep this release review local.')
    for(const [index,width] of [1100,680].entries()){
      await appPage.setViewportSize({width,height:width===680?600:900})
      if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
      await card.getByRole('button',{name:'Refresh session context',exact:true}).click()
      await expect(card.getByText('Session context refreshed '+(index+1),{exact:true})).toBeVisible()
      await composer.click();await composer.press('End');await composer.pressSequentially(' More.')
      const draft=await composer.innerText()
      const snapshot=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())
      await appPage.getByText('Getting Started',{exact:true}).first().click()
      await expect.poll(async()=>{const id=(await context()).threadId;return !!id&&id!==initial.threadId}).toBe(true)
      await appPage.getByText(initial.topic,{exact:true}).first().click()
      await expect.poll(async()=>(await context()).threadId).toBe(initial.threadId)
      await expect.poll(()=>composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(snapshot)
      expect(await composer.innerText()).toBe(draft)
      await expect.poll(async()=>(await context()).native?.state?.nativePid).toBe(boundNativePid)
      expect((await context()).messages.map((message:any)=>message.id)).toEqual(messageIds)
      expect((await context()).claude.turns).toBe(initial.claude.turns)
      if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
      await expect(card.getByText('Session context refreshed '+(index+1),{exact:true})).toBeVisible()
      for(const control of [composer,card.getByRole('button',{name:'Refresh session context',exact:true}),card.getByRole('button',{name:'Send',exact:true})])await expect(control).toBeInViewport()
      const png=await ownedWindow.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath('native-idle-redraw-'+width+'.png'),Buffer.from(png,'base64'))
    }
    const childrenAfter=await readFile(join(workspace!,'native-children.jsonl'),'utf8');expect(childrenAfter).toBe(childrenBefore)
    const receipt=JSON.parse(await readFile(join(workspace!,'native-idle-redraw-receipts.json'),'utf8'));expect(receipt.count).toBe(2)
    idleProof={messageIds,turnsBefore:initial.claude.turns,turnsAfter:(await context()).claude.turns,childrenBefore,childrenAfter,receipt,draft:await composer.innerText()}
  }
  if(cwdNavigation){
    const draft='Keep this release draft while browsing files.\nSecond line stays unsent.'
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900})
      await composer.fill(draft)
      const draftBefore=await composer.innerText(),documentBefore=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())
      await card.getByTitle(workspace!,{exact:true}).click()
      await app.waitForSurface('default-setup/code')
      await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code').getSnapshot().context.baseDirectory)).toBe(workspace)
      const explorerDirectory=await appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code').getSnapshot().context.baseDirectory)
      await app.navigate('default-setup/threads')
      await expect.poll(()=>composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(documentBefore)
      expect(await composer.innerText()).toBe(draftBefore)
      await expect(status).toContainText('AppNativeMain '+sessionId)
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
      const png=await ownedWindow.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath('native-cwd-return-'+width+'.png'),Buffer.from(png,'base64'))
      navigation.push({width,explorerDirectory,draftBefore,documentBefore,documentAfter:await composer.evaluate(element=>(element as any).editor.state.doc.toJSON()),draft:await composer.innerText(),nativePid:(await context()).native.state.nativePid,sessionId:(await context()).sessionId})
    }
  }
  await writeFile(join(workspace!,'native-search-review-proof.json'),JSON.stringify({results,navigation,idleProof,sessionId,boundNativePid}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue the release review after the search error.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeSearchReview:!cwdNavigation&&!idleRedraw,nativeCwdNavigation:cwdNavigation,nativeIdleRedraw:idleRedraw,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
