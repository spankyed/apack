import { createRequire } from 'node:module'
import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
type Screen = { rows:number; write(text:string, done:()=>void):void; dispose():void; buffer:{active:{baseY:number;getLine(row:number):{translateToString(trim:boolean):string}|undefined}} }
let terminalScreen:Screen|undefined
test.afterEach(()=>{terminalScreen?.dispose();terminalScreen=undefined})
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('directly resumes unrepresented saved native history with its metadata and accounting baseline', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(140000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: workspace!, phase: ['enter', 'auto-enter'].includes(planScenario) ? 'Edit' : 'Plan' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  async function command(name: string, args = '') {
    const editor = card.locator('[contenteditable="true"]')
    await editor.fill(''); await editor.pressSequentially('/' + name)
    await appPage.locator('.command-suggestion-popup').getByText('/' + name, { exact: true }).click()
    if (args) await editor.pressSequentially(args)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(editor).toHaveText('')
  }
  await command('cc-set-dir', workspace!)
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
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
    if (native?.state?.status === 'live' && native.state.mainStatus?.includes('AppNativeMain ' + sessionId)) return true
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
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain ' + sessionId)
  await appPage.setViewportSize({ width: 680, height: 600 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })
  const composer = card.locator('[contenteditable="true"]')
  if (planScenario === 'accept-edits') {
    await composer.pressSequentially('/cc-model')
    await appPage.locator('.command-suggestion-popup').getByText('/cc-model', { exact: true }).click()
    await composer.pressSequentially('haiku')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.modelOverride).toBe('haiku')
  }
  const sourceThreadId = (await context()).threadId
  const costBeforeCheckpoint=(await context()).claude.totalCostUsd
  await composer.fill('NativeForkCheckpointAlpha: remember this source-only marker.')
  const importedImage=process.env.CLAUDE_RESEARCH_IMPORT_IMAGE==='1'?(await readFile(join(workspace!,'native-app-image.png'))).toString('base64'):undefined
  if(importedImage){
    await card.evaluate((element,data)=>{const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0)),clipboard=new DataTransfer();clipboard.items.add(new File([bytes],'import-marker.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}))},importedImage)
    await expect(card.getByTitle('import-marker 1.png',{exact:true})).toBeVisible()
  }
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.native?.state.busy === false && c.messages.some((m: any) => m.sender === 'assistant' && m.context?.claudeTerminalMessage && m.text === 'Fixture completed.') }).toBe(true)
  const checkpoint = (await context()).messages.filter((m: any) => m.sender === 'assistant' && m.context?.claudeTerminalMessage && m.text === 'Fixture completed.').at(-1)
  expect(checkpoint.context.cliUuid).toBeTruthy()
  await expect.poll(async () => (await context()).claude.turns).toBe(2)
  const nativeJournalCost=async()=>{for(const bucket of await _readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));return rows.filter(row=>row.type==='cost-state').at(-1)?.totalCostUSD}catch(error:any){if(error.code!=='ENOENT')throw error}}}
  await expect.poll(async()=>{const cost=await nativeJournalCost();return typeof cost==='number'&&cost>costBeforeCheckpoint&&(await context()).claude.totalCostUsd===cost}).toBe(true)
  const clientReceipts=async()=>JSON.parse(await readFile(join(workspace!,'native-resume-client-receipts.json'),'utf8').catch(()=>'[]'))
  const uiPresses=async()=>{const rows=(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return rows.filter(row=>row.meta?.event?.type==='CLAUDE_UI_PRESS')}
  await appPage.getByRole('button',{name:'Review imported checkpoint',exact:true}).click()
  await expect.poll(async()=>(await clientReceipts()).length).toBe(1)
  const retiredClientAction=(await uiPresses()).at(-1).meta.event
  const {holdOwnedPromptReplies}=await import(pathToFileURL(process.env.CLAUDE_RESEARCH_PROMPT_REPLY_HOLD!).href)
  const promptReplies=await holdOwnedPromptReplies(appPage)
  const retiredDraft='Keep this old native read out of the resumed composer.'
  await composer.fill(retiredDraft)
  const initialTools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await initialTools.getAttribute('aria-expanded')!=='true')await initialTools.click()
  await promptReplies.arm()
  await card.getByRole('button',{name:'Review resumed draft',exact:true}).click()
  await expect.poll(async()=>(await promptReplies.receipts()).length).toBe(1)
  const retiredPromptReply=(await promptReplies.receipts())[0]
  expect(retiredPromptReply.box.text).toBe(retiredDraft)
  const nativeFacts = (await context()).claude
  const nativeCost = nativeFacts.totalCostUsd
  expect(nativeCost).toBeGreaterThan(0)
  await command('cc-reset')
  await expect.poll(async () => (await context()).claude).toBeUndefined()
  await command('cc-resume', sessionId)
  await expect.poll(async () => (await context()).threadId).not.toBe(sourceThreadId)
  const imported = await context()
  expect(imported.sessionId).toBe(sessionId)
  expect(imported.claude.cwd).toBe(workspace)
  if(importedImage){
    const user=imported.messages.find((row:any)=>row.text.startsWith('NativeForkCheckpointAlpha: remember this source-only marker.'))
    expect(user?.references?.images?.map((image:any)=>image.url)).toEqual(['data:image/png;base64,'+importedImage])
    const originalMedia=user.context.claudeTerminalMessage.media
    expect(originalMedia.filter((block:any)=>block.type==='image').map((block:any)=>block.source)).toEqual([{type:'base64',media_type:'image/png',data:importedImage}])
  }
  expect(imported.messages.filter((m: any) => m.context?.cliUuid === checkpoint.context.cliUuid)).toHaveLength(1)
  await writeFile(join(workspace!, 'import-before-continuation.json'), JSON.stringify({nativeCost,imported}, null, 2))
  expect(imported.claude.totalCostUsd).toBe(nativeCost)
  expect(imported.claude.model).toBe(nativeFacts.model)
  expect(imported.claude.turns).toBe(2)
  expect(imported.claude.startedAt).toBeGreaterThan(0)
  expect(imported.claude.lastTurnAt).toBeGreaterThanOrEqual(imported.claude.startedAt)
  await expect(appPage.getByText('Model unavailable', { exact: true })).toHaveCount(0)
  await expect(appPage.getByText('2 turns', { exact: true })).toBeVisible()
  const resumedDraft='Continue after importing the saved native conversation.'
  await composer.fill(resumedDraft)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  terminalScreen?.dispose();terminalScreen=undefined
  {
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
    if (native?.state?.status === 'live' && native.state.mainStatus?.includes('AppNativeMain ' + sessionId)) return true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-resume-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  }
  const reopenedNativePid=(await context()).native.state.nativePid
  expect(reopenedNativePid).not.toBe(boundNativePid)
  expect((await context()).native.state.sessionId).toBe(sessionId)
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText(resumedDraft)
  await expect(appPage.getByText('Checkpoint review count 0',{exact:true})).toBeVisible()
  const freshMount=await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;const [mountId]=Object.entries(c.nativeUiViews).find(([,v]:[string,any])=>v.threadId===c.currentThread.id&&v.state?.status==='live')!;return {threadId:c.currentThread.id,mountId}})
  const addressedRetiredClient={...retiredClientAction,...freshMount}
  const beforeRetired=(await uiPresses()).length
  await appPage.evaluate(event=>(window as any).applicationState.send({type:'SEND_TO_SURFACE',surface:'default-setup/threads',events:[event]}),addressedRetiredClient)
  await expect.poll(async()=>(await uiPresses()).slice(beforeRetired).some(row=>row.meta.from&&row.meta.event.mountId===freshMount.mountId&&row.meta.event.actionId===retiredClientAction.actionId)).toBe(true)
  await expect(appPage.getByText('Checkpoint review count 0',{exact:true})).toBeVisible()
  await appPage.getByRole('button',{name:'Review imported checkpoint',exact:true}).click()
  await expect.poll(async()=>(await clientReceipts()).length).toBe(2)
  expect((await clientReceipts()).map((row:any)=>row.pressed)).toEqual([1,1])
  await expect(composer).toHaveText(resumedDraft)
  const tools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  const promptResponses=async()=>(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.meta?.event?.type==='CLAUDE_PROMPT_HOST_RESPONSE')
  const beforePromptResponses=(await promptResponses()).length
  await promptReplies.release(0)
  await expect.poll(async()=>(await promptResponses()).slice(beforePromptResponses).some(row=>row.meta.from&&row.meta.event.requestId===retiredPromptReply.requestId&&row.meta.event.mountId===retiredPromptReply.mountId&&row.meta.event.threadId===retiredPromptReply.threadId&&row.meta.event.kind==='read')).toBe(true)
  await expect(composer).toHaveText(resumedDraft)
  await promptReplies.close()
  const resumedReads=async()=>JSON.parse(await readFile(join(workspace!,'native-resume-draft-receipts.json'),'utf8').catch(()=>'[]'))
  const shutdownReads=await resumedReads()
  await card.getByRole('button',{name:'Review resumed draft',exact:true}).click()
  await expect.poll(async()=>(await resumedReads()).length).toBe(shutdownReads.length+1)
  const freshDraftRead=(await resumedReads()).at(-1)
  expect(freshDraftRead.result.text).toBe(resumedDraft)
  expect(shutdownReads.some((row:any)=>row.requestId===freshDraftRead.requestId)).toBe(false)
  await expect(composer).toHaveText(resumedDraft)
  await tools.click()
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    const review=appPage.getByRole('button',{name:'Review imported checkpoint',exact:true})
    if(importedImage){
      const image=appPage.locator('img[src="data:image/png;base64,'+importedImage+'"]')
      await image.scrollIntoViewIfNeeded()
      await expect(image).toBeInViewport()
      await expect.poll(()=>image.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }else{await review.scrollIntoViewIfNeeded();await expect(review).toBeInViewport()}
    await expect(composer).toHaveText(resumedDraft)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
    expect(await appPage.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual({width,height:width===680?600:900})
    const window=await electronApp.browserWindow(appPage)
    const png=await window.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('apack-native-session-import-'+width+'.png'),Buffer.from(png,'base64'))
  }
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue after importing the saved native conversation.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.claude.chatState === 'success' && c.messages.filter((m: any) => m.text === 'Fixture completed.').length === 3 }).toBe(true)
  const continued = await context()
  expect(continued.sessionId).toBe(sessionId)
  expect(continued.claude.totalCostUsd).toBeGreaterThan(nativeCost)
  const nativeTotal = (await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1).totalCostUsd
  expect(continued.claude.totalCostUsd).toBe(nativeTotal)
  expect(continued.claude.cwd).toBe(workspace)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'direct-resume', nativeDirectResume: true, nativeSavedSessionImport: true, importedNativeMetadata: true, nativeImportProjectPreserved: true, nativeImportAccountingBaseline: true, nativeHistoryIdentity: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, nativeCost, continuedCost: continued.claude.totalCostUsd, sourceThreadId, importedThreadId: continued.threadId, boundNativePid, reopenedNativePid, nativeResumedDrawing:true, retiredPromptReply:{...retiredPromptReply,backendDelivered:true,releasedAfterNewNativePid:reopenedNativePid,freshReadVerified:true}, nativeImportedClient:true, nativeImportedImage:!!importedImage, addressedRetiredClient, clientReceipts:await clientReceipts(), resumedDraftRead:freshDraftRead, shutdownReads, browserErrors: errors }, null, 2))
})
