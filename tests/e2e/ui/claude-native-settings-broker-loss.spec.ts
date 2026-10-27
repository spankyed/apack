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
test('retires native Settings across broker loss and restores retained composing', async ({ app, appPage, electronApp }, testInfo) => {
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

  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[]
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  const draft='Keep this release review draft while reconnecting Claude.'
  await composer.focus();await composer.press('Control+a');await composer.pressSequentially(draft)
  const retained=await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  const panel=appPage.getByRole('dialog',{name:'Claude Code settings',exact:true})
  const panelIdentity=()=>appPage.evaluate(()=>{const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;const matches=Object.entries(state.nativeUiViews).filter(([,view]:any)=>view.threadId===state.currentThread.id&&view.state?.agentInput?.status==='panel');if(matches.length!==1)return;const [mountId,view]:any=matches[0];return {threadId:state.currentThread.id,mountId,input:view.state.agentInput}})
  const capture=async(label:string)=>{for(const width of [1100,680]){const size={width,height:width===680?600:900};await appPage.setViewportSize(size);if(label==='disconnected'){await expect(composer).toBeInViewport({ratio:1});await expect(section.getByRole('button',{name:'Use native interface',exact:true})).toBeInViewport({ratio:1})}else{await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport({ratio:1});await expect(panel.getByRole('button',{name:'Config',exact:true})).toBeInViewport({ratio:1})}const png=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);const file='native-settings-broker-'+label+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push(file)}}
  await card.getByRole('button',{name:'Claude settings',exact:true}).click();await expect(panel).toBeVisible()
  await expect(panel.getByRole('button',{name:'Config',exact:true})).toHaveAttribute('aria-current','page')
  await expect.poll(panelIdentity).toBeTruthy();const old=(await panelIdentity())!
  expect(old.input.settings.snapshot.revision).toBeTruthy();await capture('before-loss')
  const live=(await context()).native.state,failure={kind:'broker',brokerPid:live.pid,nativePid:live.nativePid,at:Date.now(),retiredAt:0}
  expect(failure.nativePid).toBe(boundNativePid);expect(failure.brokerPid).toBeGreaterThan(1);expect(failure.brokerPid).not.toBe(process.pid)
  process.kill(failure.brokerPid,'SIGKILL')
  await expect.poll(async()=>(await context()).native.state.status).toBe('error')
  await expect.poll(()=>{try{process.kill(boundNativePid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true);failure.retiredAt=Date.now()
  await expect(panel).toBeHidden();await expect(composer).toHaveText(draft)
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained.doc)
  await capture('disconnected')
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  let navigation=false,confirmed=false,selectedAt=0
  await expect.poll(async()=>{const native=(await context()).native,text=await section.innerText(),prompt=recognizeOnboardingPrompt(text,workspace);if(prompt==='workspace-trust'&&!navigation){navigation=true;selectedAt=Date.now();await input.press('ArrowDown')}else if(prompt==='workspace-trust-selected'&&!navigation){navigation=true;selectedAt=Date.now()}else if(prompt==='workspace-trust-selected'&&navigation&&!confirmed&&Date.now()-selectedAt>1200){confirmed=true;await input.press('Enter')}return native.state.status==='live'},{timeout:25000,intervals:[250]}).toBe(true)
  const freshPid=(await context()).native.state.nativePid;expect(freshPid).not.toBe(boundNativePid)
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft)
  await card.getByRole('button',{name:'Claude settings',exact:true}).click();await expect(panel).toBeVisible()
  await expect(panel.getByRole('button',{name:'Config',exact:true})).toHaveAttribute('aria-current','page')
  const fresh=(await panelIdentity())!;expect(fresh.input.panel.id).not.toBe(old.input.panel.id)
  const staleRequests=[]
  for(const mountId of [old.mountId,fresh.mountId]){
    const requestId=crypto.randomUUID();staleRequests.push(requestId)
    await appPage.evaluate(({old,mountId,requestId})=>(window as any).applicationState.system.get('default-setup/threads').send({type:'CLAUDE_UI_SETTINGS',threadId:old.threadId,mountId,revision:old.input.revision,panelId:old.input.panel.id,requestId,action:{kind:'tab',revision:old.input.settings.snapshot.revision,tab:'Stats'}}),{old,mountId,requestId})
  }
  await appPage.waitForTimeout(250)
  await expect(panel.getByRole('button',{name:'Config',exact:true})).toHaveAttribute('aria-current','page');await expect(panel.getByRole('alert')).toHaveCount(0)
  const afterStale=(await panelIdentity())!;expect(afterStale.input.panel.id).toBe(fresh.input.panel.id);expect(staleRequests).not.toContain(afterStale.input.settings.requestId)
  await capture('recovered')
  await panel.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toBeHidden();await expect(composer).toHaveText(draft);await expect(composer).toBeFocused()
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained.doc)
  expect(await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())).toEqual(retained.selection)
  const beforeReturn=await context();expect(beforeReturn.turns).toBe(1)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft);await composer.focus();await composer.press('Control+a');await composer.pressSequentially('Continue the release review after reconnecting Settings.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-settings-broker-proof.json'),JSON.stringify({sessionId,boundNativePid,freshPid,failure,old,fresh,afterStale,staleRequests,draft,retained,beforeReturn,final:await context(),captures},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativeSettingsBrokerLoss:true,nativeRetainedDraft:true,resumedPrintSameSession:true,reopenedNativePid:freshPid,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
