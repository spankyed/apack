import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@app/claude-terminal-xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('admits an explicitly selected bypass launch and restores it after native Plan', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  const before=await context(),threadId=before.threadId,initialMode=before.claude.permissionMode
  const planText='Plan the release review with the acknowledged permission baseline.',editText='Continue the review after restoring the chosen permission baseline.'
  const pick=async(phase:string)=>{await card.getByRole('button',{name:/^(Plan|Edit)$/}).click();await appPage.getByRole('menuitem',{name:phase,exact:true}).click()}
  const humans=async()=>(await context()).messages.filter((row:any)=>row.sender==='user'||row.sender==='person').map((row:any)=>({id:row.id,text:row.text,uuid:row.context?.cliUuid}))
  const historyBefore=await humans()
  await composer.fill(planText);await pick('Plan')
  const staged=await appPage.evaluate(threadId=>localStorage.getItem('default-setup/threads:claude-composer-phase:'+JSON.stringify([['main'],threadId])),threadId)
  expect(JSON.parse(staged!).phase).toBe('Plan')
  const stop=async()=>{
    await section.getByRole('button',{name:'Use native interface',exact:true}).click()
    await section.getByRole('button',{name:'Stop session',exact:true}).click()
    await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
    const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  }
  await stop()
  const details=appPage.locator('summary').filter({hasText:'Details'}).first()
  const chooser=async()=>{await details.click();await appPage.getByRole('button',{name:/^Permissions:/}).click()}
  await chooser();await appPage.getByRole('button',{name:'Bypass',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.permissionMode).toBe('bypassPermissions')
  await expect(appPage.getByRole('button',{name:'Bypass',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(composer).toHaveText(planText);expect(await humans()).toEqual(historyBefore)
  await appPage.keyboard.press('Escape');await details.click()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await expect.poll(async()=>{const pid=(await context()).native?.state.nativePid;return pid&&pid!==boundNativePid?pid:undefined}).toBeTruthy()
  await expect.poll(resize).toBeTruthy();Object.assign(dimensions,(await resize())!)
  terminalScreen?.dispose();terminalScreen=new Terminal({cols:dimensions.cols,rows:Math.max(2,dimensions.rows),allowProposedApi:true})
  lastSequence=0;theme=false;security=false;navigated=false;trusted=false;trustSelectedAt=0;trustAttempts=0
  let bypassConsentNavigated=false,bypassConsentAcknowledged=false
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Session ready') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    const compact=text.replace(/\s/g,'')
    const bypassWarning=compact.includes('WARNING:ClaudeCoderunninginBypassPermissionsmode')&&compact.includes('Byproceeding,youacceptallresponsibility')&&compact.includes('No,exit')&&compact.includes('Yes,Iaccept')&&compact.includes('Entertoconfirm')
    if(bypassWarning&&!bypassConsentNavigated&&compact.includes('❯No,exit')){
      await writeFile(join(workspace!,'native-bypass-consent.json'),JSON.stringify({nativePid:native.state.nativePid,sessionId,text,defaultChoice:'No, exit'}))
      await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-permission-consent-1100.png')})
      bypassConsentNavigated=true;await input.press('ArrowDown')
    }else if(bypassWarning&&bypassConsentNavigated&&!bypassConsentAcknowledged&&compact.includes('❯Yes,Iaccept')){
      bypassConsentAcknowledged=true;await input.press('Enter')
    }else if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  expect(bypassConsentNavigated).toBe(true);expect(bypassConsentAcknowledged).toBe(true)
  const admitted=await context(),reopenedNativePid=admitted.native.state.nativePid
  expect(admitted.native.state.session.permissionMode).toBe('bypassPermissions')
  expect(admitted.sessionId).toBe(sessionId)
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await chooser()
  await appPage.getByRole('button',{name:'Ask',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.session.permissionMode).toBe('default')
  await appPage.getByRole('button',{name:'Bypass',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.session.permissionMode).toBe('bypassPermissions')
  await expect(appPage.getByRole('button',{name:'Bypass',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(appPage.getByRole('alert')).toHaveCount(0)
  expect(await humans()).toEqual(historyBefore);await expect(composer).toHaveText(planText)
  expect(await appPage.evaluate(threadId=>localStorage.getItem('default-setup/threads:claude-composer-phase:'+JSON.stringify([['main'],threadId])),threadId)).toBe(staged)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await appPage.keyboard.press('Escape')
    const trigger=appPage.getByRole('button',{name:/^Permissions:/});await trigger.scrollIntoViewIfNeeded();await trigger.click()
    await expect(appPage.getByRole('button',{name:'Bypass',exact:true})).toBeInViewport({ratio:0.999})
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-permission-admission-'+width+'.png')})
  }
  await appPage.keyboard.press('Escape');await details.click()
  const send=async(text:string,mode:string)=>{await composer.fill(text);await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('');await expect.poll(async()=>(await context()).claude.permissionMode).toBe(mode);await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await expect.poll(async()=>(await context()).messages.filter((row:any)=>row.text===text).length).toBe(1)}
  await send(planText,'plan');const planned=await context()
  expect(planned.native.state.session.prePlanMode).toBe('bypassPermissions')
  await pick('Edit');await send(editText,'bypassPermissions');const edited=await context()
  expect(edited.native.state.nativePid).toBe(reopenedNativePid)
  const retained='Keep this draft after restoring bypass permissions.';await composer.fill(retained)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await composer.scrollIntoViewIfNeeded()
    await expect(status).toContainText('Session ready');await expect(composer).toHaveText(retained)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-permission-admission-recovery-'+width+'.png')})
  }
  await stop();await composer.fill('Continue after verifying the explicitly chosen permission baseline.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-composer-phase-proof.json'),JSON.stringify({sessionId,boundNativePid,reopenedNativePid,threadId,initialMode,bypassConsentAcknowledged,originalMode:'bypassPermissions',admittedMode:admitted.native.state.session.permissionMode,plannedPrePlanMode:planned.native.state.session.prePlanMode,planText,editText,staged,historyBefore,plannedMode:planned.claude.permissionMode,editedMode:edited.claude.permissionMode,history:await humans()}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeComposerPhase:true,nativePermissionAdmission:true,nativeComposerPhaseOnSend:true,nativeComposerPhaseRestore:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,browserErrors:errors}))
})
