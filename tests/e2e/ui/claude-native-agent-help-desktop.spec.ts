import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
import {readNativeHelpBody} from './native-help-reading.ts'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test.afterEach(async ({appPage,electronApp},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus||!workspace)return
  await writeFile(join(workspace,'native-agent-settings-failure.txt'),await appPage.locator('body').innerText())
  await writeFile(join(workspace!,'native-stats-loading-failure-trace.json'),JSON.stringify(await appPage.evaluate(()=>{const target=globalThis as any;target.__claudeStatsLoadingObserver?.disconnect();return target.__claudeStatsLoadingTrace??[]})))
  const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!
  const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
  await writeFile(testInfo.outputPath('native-agent-settings-failure.png'),Buffer.from(image,'base64'))
})
test('reads original Help for the selected Agent and preserves both drafts', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
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
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
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

  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()

  const parent='Keep the parent release review draft unchanged.'
  await expect.poll(async()=>(await context()).messages.some((message:any)=>message.text?.includes('ParentSubagentFixtureComplete'))).toBe(true)
  await composer.fill(parent);const before=await context()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),field=form.locator('[contenteditable="true"]')
  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[],samples:any[]=[],readings:any[]=[]
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  await field.focus();await field.press('Control+a');await field.pressSequentially('/help')
  await expect.poll(async()=>{const view=(await context()).native.state.view;return view.kind==='agent'&&view.taskId===taskId}).toBe(true)
  const originalView=(await context()).native.state.view,workerMessages=await focused.locator('[data-native-agent-message]').count()
  const baseline=await context()
  await form.getByRole('button',{name:'Send to Agent',exact:true}).click()
  const panel=appPage.getByRole('dialog',{name:'Claude Code help',exact:true})
  await expect(panel).toBeVisible()
  for(const tab of ['General','Commands','Custom commands']){
    if(tab!=='General')await panel.getByRole('button',{name:tab,exact:true}).click()
    await expect(panel.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-current','page')
    await expect(panel.getByRole('alert')).toHaveCount(0)
    if(tab==='General'){await expect(panel).toContainText('Claude understands your codebase');await expect(panel.locator('p').filter({hasText:/shift \+ tab.*auto-accept edits/})).toHaveCount(1)}
    if(tab==='Custom commands'){await expect(panel.locator('dt').filter({hasText:/^\/review-release$/})).toHaveCount(1);await expect(panel).toContainText('Review the release checklist and report remaining risks.')}
    if(tab==='Commands'){await expect(panel.locator('dt').filter({hasText:/^\/help$/})).toHaveCount(1);await expect(panel.locator('dt')).not.toHaveCount(0)}
    for(const width of [1100,680]){
      const size={width,height:width===680?600:900};await appPage.setViewportSize(size)
      await expect.poll(()=>panel.locator('div[tabindex="0"]').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true)
      await expect(panel.getByRole('button',{name:'Close help',exact:true})).toBeInViewport({ratio:1})
      await expect(panel.getByRole('button',{name:tab,exact:true})).toBeInViewport({ratio:1})
      const reading=await readNativeHelpBody(appPage,panel.locator('div[tabindex="0"]'));readings.push({tab,width,...reading})
      const png=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
      const file='native-agent-help-'+tab.toLowerCase().replaceAll(' ','-')+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push(file)
      samples.push({tab,width,text:await panel.innerText()})
    }
    await panel.getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled()
    await expect(panel.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-current','page')
  }
  await expect(panel.locator('a[href="https://code.claude.com/docs/en/overview"]')).toHaveCount(1)
  await panel.getByRole('button',{name:'Close help',exact:true}).click();await expect(panel).toBeHidden();await expect(field).toBeFocused()
  const after=await context();expect(after.turns).toBe(baseline.turns);expect(after.claude.totalCostUsd).toBe(baseline.claude.totalCostUsd);expect(after.native.state.nativePid).toBe(boundNativePid)
  expect(after.native.state.view).toEqual(originalView)
  expect(await focused.locator('[data-native-agent-message]').count()).toBe(workerMessages)
  await field.press('Control+a');await field.pressSequentially('Keep the worker release draft after Help.')
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parent)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(parent)
  await composer.focus();await composer.press('Control+a');await composer.pressSequentially('Continue the release review after reading worker Help.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-help-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,originalView,baseline,after,final:await context(),samples,captures,readings,parent,workerMessages},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeHelpDesktop:true,nativeAgentHelpDesktop:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
