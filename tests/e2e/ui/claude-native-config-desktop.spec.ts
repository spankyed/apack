import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test.afterEach(async ({appPage,electronApp},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus||!workspace)return
  await writeFile(join(workspace,'native-config-desktop-failure.txt'),await appPage.locator('body').innerText())
  const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!
  const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
  await writeFile(testInfo.outputPath('native-config-desktop-failure.png'),Buffer.from(image,'base64'))
})
test('edits original Settings through desktop controls and retains composing', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1];return cols?{cols:Number(cols),rows:200}:undefined;
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

  await appPage.setViewportSize({width:1100,height:900})
  const draft = 'Keep these release notes while changing Claude settings.'
  await composer.fill(draft)
  const saved = await composer.evaluate(element => ({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  const panel = appPage.getByRole('dialog',{name:'Claude Code settings',exact:true})
  async function open() {
    const direct = card.getByRole('button',{name:'Claude settings',exact:true})
    if (await direct.isVisible()) await direct.click()
    else { await card.getByRole('button',{name:'More actions',exact:true}).click(); await appPage.getByRole('menuitem',{name:'Claude settings',exact:true}).click() }
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).toBeVisible({timeout:15000})
    await expect(panel.locator('textarea.xterm-helper-textarea')).toHaveCount(0)
  }
  await open()
  const local = async () => JSON.parse(await readFile(join(workspace!,'.claude/settings.local.json'),'utf8').catch(()=>'{}'))
  const user = async () => JSON.parse(await readFile(join(workspace!,'.claude/settings.json'),'utf8'))
  const search = panel.getByRole('textbox',{name:'Search Claude Code settings',exact:true})
  await panel.getByRole('checkbox',{name:'Show tips',exact:true}).click()
  await expect.poll(async()=>(await local()).spinnerTipsEnabled).toBe(false)
  await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).not.toBeChecked()
  await expect(panel.getByRole('status')).toHaveText('Saved by Claude Code')
  await search.fill('Reduce motion')
  await panel.getByRole('checkbox',{name:'Reduce motion',exact:true}).click()
  await expect.poll(async()=>(await local()).prefersReducedMotion).toBe(true)
  await expect(panel.getByRole('checkbox',{name:'Reduce motion',exact:true})).toBeChecked()
  await search.fill('Time format')
  await panel.getByRole('combobox',{name:'Time format',exact:true}).selectOption('24-hour')
  await expect.poll(async()=>(await user()).timeFormat).toBe('24-hour')
  await search.fill('Language')
  await panel.getByRole('textbox',{name:'Language',exact:true}).fill('French')
  await panel.getByRole('button',{name:'Save',exact:true}).click()
  await expect.poll(async()=>(await user()).language).toBe('French')
  await expect(panel.getByRole('status')).toHaveText('Saved by Claude Code')
  const nativeWindow = await electronApp.browserWindow(appPage), captures:string[]=[]
  for (const [width,height] of [[1100,900],[680,600]]) {
    await appPage.setViewportSize({width,height})
    for (const label of ['Search Claude Code settings','Language']) await expect(panel.getByRole('textbox',{name:label,exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeInViewport()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
    const path=testInfo.outputPath('native-config-desktop-language-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));captures.push(path)
  }
  await search.fill('Thinking')
  const locked = panel.getByRole('checkbox',{name:/Thinking/})
  await expect(locked).toBeDisabled()
  await expect(panel.locator('[data-native-setting="thinking"] label > span').last()).toBeVisible()
  expect(await panel.locator('[data-native-setting="thinking"] label > span').last().innerText()).not.toBe('Thinking')
  await panel.getByRole('button',{name:'Close settings',exact:true}).click()
  await expect(panel).toHaveCount(0); await expect(composer).toHaveText(draft); await composer.focus()
  expect(await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))).toEqual(saved)
  await appPage.setViewportSize({width:1100,height:900});await open()
  await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).not.toBeChecked()
  await search.fill('Reduce motion');await expect(panel.getByRole('checkbox',{name:'Reduce motion',exact:true})).toBeChecked()
  await search.fill('Time format');await expect(panel.getByRole('combobox',{name:'Time format',exact:true})).toHaveValue('24-hour')
  await search.fill('Language');await expect(panel.getByRole('textbox',{name:'Language',exact:true})).toHaveValue('French')
  await search.fill('')
  for (const [width,height] of [[1100,900],[680,600]]) {
    await appPage.setViewportSize({width,height});await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport();await expect(search).toBeInViewport()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
    const path=testInfo.outputPath('native-config-desktop-list-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));captures.push(path)
  }
  const frameCaptures:string[]=[]
  const tabs=panel.getByRole('navigation',{name:'Claude Code settings tabs'})
  for(const tab of ['Status','Usage','Stats']){
    await tabs.getByRole('button',{name:tab,exact:true}).click()
    await expect(tabs.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-current','page')
    if(tab==='Status'){await expect(panel.locator('dt').filter({hasText:/^Version$/})).toHaveText('Version');await expect(panel.locator('dd').filter({hasText:/^2\.1\.302$/})).toHaveCount(1)}
    if(tab==='Usage')await expect(panel.getByText('Context window',{exact:true})).toBeVisible()
    if(tab==='Stats'){
      await expect(panel.getByRole('button',{name:'Models',exact:true})).toBeEnabled()
      await expect(panel.getByText('Sessions',{exact:true})).toBeVisible()
      await panel.getByRole('button',{name:'Models',exact:true}).click()
      await expect(panel.locator('thead')).toContainText('Cache read')
      await panel.getByRole('button',{name:/Change dates/}).click()
      await expect(panel.getByRole('button',{name:/Change dates/})).toContainText('Last 7 days')
    }
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height})
      await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
      await expect(tabs.getByRole('button',{name:tab,exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const path=testInfo.outputPath('native-settings-desktop-'+tab.toLowerCase()+'-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));frameCaptures.push(path)
    }
  }
  await tabs.getByRole('button',{name:'Config',exact:true}).click();await expect(search).toBeVisible()
  await panel.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toHaveCount(0);await expect(composer).toHaveText(draft)
  const before=(await context()).turns
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns,{timeout:15000}).toBeGreaterThan(before)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue the same session after desktop settings.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-config-desktop-proof.json'),JSON.stringify({sessionId,boundNativePid,local:await local(),user:await user(),captures,frameCaptures,desktopFrameTabs:true,nativeStatsDates:true,retainedDraft:true,reopenedValues:true,lockedControl:true}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeConfigDesktop:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
