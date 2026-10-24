import { readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('uses original plugin LSP navigation and preserves diagnostics and session recovery', async ({ app, appPage, electronApp }, testInfo) => {
  const unload=process.env.CLAUDE_RESEARCH_LSP_UNLOAD==='1'
  const lifetime=process.env.CLAUDE_RESEARCH_LSP_LIFETIME==='1'
  const lifecycle=process.env.CLAUDE_RESEARCH_LSP_LIFECYCLE==='1'
  test.setTimeout(lifecycle?180000:150000)
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
  const nativeHumanCount=async()=>{
    const root=join(workspace!,'.claude/projects'),paths=await readdir(root,{recursive:true})
    const path=paths.find(path=>path.endsWith('/'+sessionId+'.jsonl'));expect(path).toBeTruthy()
    const rows=(await readFile(join(root,path!),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    return rows.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true&&!(Array.isArray(row.message?.content)&&row.message.content.some((block:any)=>block.type==='tool_result'))).length
  }
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1], rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Session ready') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Session ready')
    await expect(main).toContainText('Reviewing release notes')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')




  const draft='Keep my release notes while inspecting the definition and diagnostics.'
  const captures:string[]=[],steps:any[]=[],nativeWindow=await electronApp.browserWindow(appPage)
  const receipts=async()=> (await readFile(join(workspace!,'native-lsp-receipts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  const owner=JSON.parse(await readFile(join(workspace!,'native-lsp-owner.json'),'utf8')).owner
  const writeFault=async(value:Record<string,unknown>)=>{const path=join(workspace!,'native-lsp-fault.json');await writeFile(path+'.tmp',JSON.stringify({owner,...value}));await rename(path+'.tmp',path)}
  let budgetStartCount=0,localReloadNoModelRequest=false,lateResponseIsolated=false,freshNavigationAfterInterruption=false,pluginDisabled=false,pluginReenabled=false
  async function crash(failInitialization:boolean){
    const rows=await receipts(),server=rows.filter(row=>row.event==='start'&&!rows.some(exit=>exit.event==='exit'&&exit.pid===row.pid)).at(-1);expect(server).toBeTruthy()
    const before=(await readFile(join(workspace!,'native-debug.log'),'utf8')).split('crashed with exit code 7').length
    await writeFault({action:'crash',pid:server.pid,failInitialization})
    await expect.poll(async()=>(await receipts()).some(row=>row.event==='exit'&&row.pid===server.pid&&row.code===7)).toBe(true)
    await expect.poll(async()=>(await readFile(join(workspace!,'native-debug.log'),'utf8')).split('crashed with exit code 7').length).toBeGreaterThan(before)
  }
  for(const phase of unload?[1,8,7]:lifetime?[1,4,7]:lifecycle?[1,2,3,4,5,6,7]:[1,2,3]){
    if(lifecycle&&phase===4)await crash(false)
    if(phase===5)await crash(true)
    if(phase===6)budgetStartCount=(await receipts()).filter(row=>row.event==='start').length
    if(lifecycle&&phase===7){
      await writeFault({action:'none',failInitialization:false})
      const before=await context(),modelCount=await readFile(join(workspace!,'native-lsp-model-count'),'utf8')
      await composer.fill('')
      await section.getByRole('button',{name:'Use native interface',exact:true}).click()
      await input.press('Control+a');await input.press('Control+k')
      const sequence=(await context()).native.output.at(-1)?.sequence??0
      await input.pressSequentially('/reload-plugins --force');await input.press('Enter')
      await expect.poll(async()=>stripVTControlCharacters((await context()).native.output.filter((row:any)=>row.sequence>sequence).map((row:any)=>row.text).join('')),{timeout:20000}).toContain('Reloaded:')
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
      expect((await context()).turns).toBe(before.turns+1);expect((await context()).native.state.nativePid).toBe(boundNativePid)
      expect(await readFile(join(workspace!,'native-lsp-model-count'),'utf8')).toBe(modelCount);localReloadNoModelRequest=true
    }

    if(unload&&[8,7].includes(phase)){
      const enable=phase===7,before=await context(),modelCount=await readFile(join(workspace!,'native-lsp-model-count'),'utf8')
      await composer.fill('');await section.getByRole('button',{name:'Use native interface',exact:true}).click()
      await input.press('Control+a');await input.press('Control+k')
      const sequence=(await context()).native.output.at(-1)?.sequence??0
      await input.pressSequentially('/plugin '+(enable?'enable':'disable')+' native-history-fixture@inline',{delay:40});await input.press('Enter')
      await expect.poll(async()=>stripVTControlCharacters((await context()).native.output.filter((row:any)=>row.sequence>sequence).map((row:any)=>row.text).join('')),{timeout:20000}).toContain(enable?'Enabled':'Disabled')
      await input.press('Escape');await input.press('Escape')
      await input.press('Control+a');await input.press('Control+k')
      const reloadSequence=(await context()).native.output.at(-1)?.sequence??0
      await input.pressSequentially('/reload-plugins --force',{delay:40});await input.press('Enter')
      await expect.poll(async()=>stripVTControlCharacters((await context()).native.output.filter((row:any)=>row.sequence>reloadSequence).map((row:any)=>row.text).join('')),{timeout:20000}).toContain('Reloaded:')
      if(!enable)await expect.poll(async()=>(await receipts()).some(row=>row.method==='shutdown'),{timeout:15000}).toBe(true)
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
      expect((await context()).turns).toBe(await nativeHumanCount());expect((await context()).turns).toBeGreaterThan(before.turns);expect((await context()).native.state.nativePid).toBe(boundNativePid)
      expect(await readFile(join(workspace!,'native-lsp-model-count'),'utf8')).toBe(modelCount)
      if(enable)pluginReenabled=true;else pluginDisabled=true
    }
    if(lifetime&&phase===4){const server=(await receipts()).find(row=>row.event==='start');await writeFault({action:'hold',pid:server.pid})}
    await writeFile(join(workspace!,'native-lsp-phase'),String(phase))
    const text=phase===1?'Find the release definition.':phase===2?'Inspect the release type.':phase===3?'Check the unmapped document safely.':phase===4?'Recover the release definition after the server crash.':phase===5?'Inspect the startup failure safely.':phase===6?'Respect the language server recovery limit.':'Review the definition after reloading plugins.'
    await composer.fill(text);await card.getByRole('button',{name:'Send',exact:true}).click();await composer.fill(draft)
    if(lifetime&&phase===4){
      await expect.poll(async()=>(await receipts()).some(row=>row.event==='held'),{timeout:15000}).toBe(true)
      await card.getByTitle('Pause agent work',{exact:true}).click()
      await expect.poll(async()=>(await context()).native.state.busy,{timeout:15000}).toBe(false)
      const retired=await context(),held=(await receipts()).find(row=>row.event==='held')
      await expect(composer).toHaveText(draft)
      await writeFault({action:'release',pid:held.pid})
      await expect.poll(async()=>(await receipts()).some(row=>row.event==='released'&&row.id===held.id)).toBe(true)
      expect((await context()).sessionId).toBe(sessionId);expect((await context()).turns).toBe(retired.turns)
      lateResponseIsolated=true;steps.push({phase,interrupted:true,heldId:held.id,retiredTurns:retired.turns});continue
    }
    await expect.poll(async()=>(await context()).turns,{timeout:20000}).toBe(unload?await nativeHumanCount():lifetime?(phase===1?2:4):phase+1+(lifecycle&&phase>=7?1:0))
    await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success')
    await expect(composer).toHaveText(draft)
    expect((await context()).sessionId).toBe(sessionId);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    if(unload&&phase===8){
      const group=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="native_lsp_8"]');await expect(group).toBeVisible()
      const toggle=group.getByRole('button').first();if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click()
      const refusal=appPage.locator('[data-native-tool-result="native_lsp_8"]');await expect(refusal).toContainText('No such tool available: LSP')
      for(const width of [1100,680]){const size={width,height:width===680?600:900};await appPage.setViewportSize(size);await refusal.scrollIntoViewIfNeeded();await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled();const capture=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);const name='native-lsp-disabled-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(capture,'base64'));captures.push(name)}
      expect((await receipts()).filter(row=>row.event==='start')).toHaveLength(1)
      steps.push({phase,disabledAdmissionRefused:true});continue
    }
    const toolGroup=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="native_lsp_'+phase+'"]');await expect(toolGroup).toBeVisible()
    const toolToggle=toolGroup.getByRole('button').first();if(await toolToggle.getAttribute('aria-expanded')==='false')await toolToggle.click()
    const result=appPage.locator('[data-native-tool-result="native_lsp_'+phase+'"]')
    await expect(result).toBeVisible()
    if([1,4,7].includes(phase))await expect(result).toContainText('definitions.review')
    if(phase===2)await expect(result).toContainText('OwnedReleaseDefinition')
    if(phase===3)await expect(result).toContainText(/server|language|support|LSP/i)
    if(lifecycle&&phase===5)await expect(result).toContainText(/crash|connection|closed|start|initializ|disposed/i)
    if(lifecycle&&phase===6){await expect(result).toContainText('exceeded max crash recovery attempts (1)');expect((await receipts()).filter(row=>row.event==='start').length).toBe(budgetStartCount)}
    await expect.poll(()=>readFile(join(workspace!,'native-lsp-result-native_lsp_'+phase+'.json'),'utf8').then(()=>true,()=>false),{timeout:10000}).toBe(true)
    const receipt=JSON.parse(await readFile(join(workspace!,'native-lsp-result-native_lsp_'+phase+'.json'),'utf8'));expect(receipt.props.tool_use_id).toBe('native_lsp_'+phase)
    steps.push({phase,text,resultText:await result.innerText()});if(lifetime&&phase===7)freshNavigationAfterInterruption=true
    if(phase===1){
      const diagnostic=appPage.locator('[data-native-diagnostic]').first()
      await expect(diagnostic).toBeVisible({timeout:15000});await expect(diagnostic.locator('summary')).toContainText(/diagnostic|issue/i)
      await diagnostic.locator('summary').click();await expect(diagnostic.locator('[data-native-diagnostic-detail]')).toContainText('OwnedReleaseDiagnostic')
      await expect(diagnostic).not.toContainText('OwnedStaleDiagnostic')
      for(const width of [1100,680]){
        const size={width,height:width===680?600:900};await appPage.setViewportSize(size)
        await diagnostic.locator('[data-native-diagnostic-detail]').evaluate(element=>element.scrollIntoView({block:'end'}));await expect(diagnostic.locator('[data-native-diagnostic-detail]')).toBeInViewport({ratio:1});await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
        const capture=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
        const name='native-lsp-diagnostic-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(capture,'base64'));captures.push(name)
      }
    }

    if([1,3,4,6,7].includes(phase))for(const[width,height]of[[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await result.scrollIntoViewIfNeeded();await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(window,size)=>{const capture=await window.webContents.capturePage({x:0,y:0,...size});return{size:capture.getSize(),png:capture.toPNG().toString('base64')}},{width,height});expect(image.size).toEqual({width,height})
      const name='native-lsp-'+phase+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(image.png,'base64'));captures.push(name)
    }
  }
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status,{timeout:15000}).toMatch(/^(exited|error)$/)
  if(await section.getByRole('button',{name:'Back to conversation',exact:true}).isVisible())await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue reviewing the same release session.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState,{timeout:15000}).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect((await context()).turns).toBe(unload?await nativeHumanCount():lifetime?5:lifecycle?10:5)
  const prints=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect((await context()).claude.totalCostUsd).toBeCloseTo(prints.at(-1).totalCostUsd,10);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-lsp-app-proof.json'),JSON.stringify({sessionId,boundNativePid,steps,captures,lifecycle,lifetime,unload,pluginDisabled,pluginReenabled,nativeHumanCount:unload?await nativeHumanCount():undefined,lateResponseIsolated,freshNavigationAfterInterruption,budgetStartCount,localReloadNoModelRequest,localReloadHumanInputDelta:lifecycle?1:0,retainedDraft:true,sameSessionRecovery:true}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeLsp:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
