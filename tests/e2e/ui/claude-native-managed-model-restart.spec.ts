import { readFile, writeFile } from 'node:fs/promises'
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
test('keeps managed model defaults across session selection reset and process restart', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(120000)
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
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  async function settleNative(){
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
  terminalScreen?.dispose();terminalScreen = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
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
  }
  await settleNative()
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  const nativeWindow=await electronApp.browserWindow(appPage),captures:{stage:string;width:number;file:string}[]=[],receipts:any[]=[]
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  const replace=async(text:string)=>{await composer.focus();await composer.press('Control+a');if(text)await composer.pressSequentially(text);await expect(composer).toHaveText(text)}
  const settingsPath=join(workspace!,'.claude/settings.json'),settingsBefore=await readFile(settingsPath,'utf8')
  const capture=async(stage:string)=>{for(const width of [1100,680]){const size={width,height:width===680?600:900};await appPage.setViewportSize(size);await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1});const png=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);const file='native-managed-model-'+stage+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({stage,width,file})}}
  async function select(selection:string){
    const before=await context();await replace('/cc-model');await appPage.locator('.command-suggestion-popup').getByText('/cc-model',{exact:true}).click();await composer.pressSequentially(selection);await card.getByRole('button',{name:'Send',exact:true}).click()
    const acknowledgement='Model selection accepted: '+selection+'. The next turn will report the effective model.'
    await expect.poll(async()=>(await context()).claude.modelOverride).toBe(selection)
    await expect.poll(async()=>(await context()).messages.some((message:any)=>message.sender==='assistant'&&message.text.includes(acknowledgement)&&message.text.includes('for this session only')&&message.text.includes('Managed settings pins')&&message.text.includes('that applies on restart'))).toBe(true)
    expect((await context()).turns).toBe(before.turns);expect((await context()).native.state.nativePid).toBe(before.native.state.nativePid);expect((await context()).sessionId).toBe(sessionId)
    expect(await readFile(settingsPath,'utf8')).toBe(settingsBefore);receipts.push({stage:'select-'+selection,context:await context()})
  }
  async function turn(text:string,count:number,model:RegExp){await replace(text);await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns).toBe(count);await expect.poll(async()=>(await context()).claude.chatState).toBe('success');await expect.poll(async()=>(await context()).claude.model).toMatch(model);receipts.push({stage:text,context:await context()})}
  async function stop(){await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()}
  await expect.poll(async()=>(await context()).claude.model).toMatch(/sonnet/i)
  receipts.push({stage:'managed-start',context:await context()})
  await select('haiku');await turn('Review the release using the session-only Haiku selection.',2,/haiku/i)
  await select('default');await turn('Review the release after resetting this session model.',3,/opus/i)
  const draft='Keep this draft while Claude restarts with the managed default.';await replace(draft)
  const retained=await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  await capture('session-default');await stop()
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained.doc)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await expect.poll(async()=>{const pid=(await context()).native.state.nativePid;return typeof pid==='number'&&pid!==boundNativePid}).toBe(true);await settleNative()
  const reopenedNativePid=(await context()).native.state.nativePid;expect(reopenedNativePid).not.toBe(boundNativePid)
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click();expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained.doc)
  receipts.push({stage:'native-reopened',context:await context()})
  await turn('Continue the release review after restarting Claude.',4,/sonnet/i)
  await replace(draft);await capture('managed-restarted');await stop()
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained.doc)
  await turn('Continue the saved release review after closing the native interface.',5,/sonnet/i)
  expect((await context()).sessionId).toBe(sessionId);expect(await readFile(settingsPath,'utf8')).toBe(settingsBefore)
  await replace(draft);await capture('print-return');expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-managed-model-proof.json'),JSON.stringify({sessionId,boundNativePid,reopenedNativePid,receipts,retained,captures,settingsUnchanged:true,final:await context()},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeManagedModelRestart:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,browserErrors:errors}))
})
