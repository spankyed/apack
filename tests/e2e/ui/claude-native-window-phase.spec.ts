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
test('keeps independent staged Plan and Edit across simultaneous app windows and renderer reload', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia,promptSyntax,uiCopy,uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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

  const originalMode=(await context()).claude.permissionMode,threadId=(await context()).threadId
  expect(originalMode).toBe('acceptEdits')
  const planText='Plan the release review from the main window.',editText='Continue the release review in Edit from the popout.',mainFollowText='Review remaining release notes from the main window.'
  const snapshot=(page:typeof appPage)=>page.evaluate(()=>{
    const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context,q=new URLSearchParams(location.search),scope=q.get('popout')==='plugin'?['plugin',q.get('pluginId')]:['main'];
    const key='apack.claude-composer-phase:'+JSON.stringify([scope,c.currentThread?.id]);
    return {phase:c.phase,mode:c.mode,stage:JSON.parse(localStorage.getItem(key)??'null'),native:Object.values(c.nativeTerminalViews).find((v:any)=>v.threadId===c.currentThread?.id),claude:c.currentThread?.context?.claudeCode,messages:c.currentThread?.messages,threadId:c.currentThread?.id} as any;
  })
  const humanRows=async()=>{const c=await context();return c.messages.filter((row:any)=>row.sender==='user').map((row:any)=>({id:row.id,text:row.text,uuid:row.context?.cliUuid}))}
  const pick=async(page:typeof appPage,target:typeof card,phase:string)=>{await target.getByRole('button',{name:/^(Plan|Edit)$/}).click();await page.getByRole('menuitem',{name:phase,exact:true}).click();await expect(target.getByRole('button',{name:phase,exact:true})).toBeVisible()}
  const focus=async(page:typeof appPage)=>{const window=await electronApp.browserWindow(page);await window.evaluate(window=>{window.show();window.focus()});await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true)}
  await focus(appPage);await composer.fill(planText);await pick(appPage,card,'Plan')
  const historyBefore=await humanRows(),mainInitial=await snapshot(appPage)
  const opened=electronApp.waitForEvent('window')
  await appPage.evaluate(()=>(window as any).electronAPI.plugins.popout('default-setup/threads','Threads'))
  const popout=await opened;popout.on('pageerror',e=>errors.push(e.message));await popout.waitForLoadState('domcontentloaded')
  await expect.poll(()=>popout.evaluate(()=>!!(window as any).applicationState?.system.get('default-setup/threads'))).toBe(true)
  await popout.evaluate(threadId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId}),threadId)
  const second=popout.locator('[data-onboarding-id="agent-chat-input"]'),secondComposer=second.locator('[contenteditable="true"]')
  await expect(secondComposer).toBeVisible();await focus(popout);await expect.poll(()=>appPage.evaluate(()=>document.hasFocus())).toBe(false)
  await secondComposer.fill(editText);await pick(popout,second,'Edit')
  const popoutInitial=await snapshot(popout)
  expect(popoutInitial.native.state.nativePid).toBe(boundNativePid);expect(popoutInitial.native.state.sessionId).toBe(sessionId)
  expect(popoutInitial.stage.phase).toBe('Edit');expect(mainInitial.stage.phase).toBe('Plan');expect(popoutInitial.stage.revision).not.toBe(mainInitial.stage.revision)
  expect((await context()).claude.permissionMode).toBe(originalMode);expect(await humanRows()).toEqual(historyBefore)
  const send=async(page:typeof appPage,target:typeof card,text:string,mode:string)=>{await focus(page);await target.locator('[contenteditable="true"]').fill(text);await target.getByRole('button',{name:'Send',exact:true}).click();await expect(target.locator('[contenteditable="true"]')).toHaveText('');await expect.poll(async()=>(await snapshot(page)).claude.permissionMode).toBe(mode);await expect.poll(async()=>(await snapshot(page)).native.state.busy).toBe(false);await expect.poll(async()=>(await snapshot(page)).messages.filter((row:any)=>row.text===text).length).toBe(1)}
  await send(appPage,card,planText,'plan')
  await expect(secondComposer).toHaveText(editText);await expect(second.getByRole('button',{name:'Edit',exact:true})).toBeVisible()
  const popoutAfterMain=await snapshot(popout),planned=await snapshot(appPage)
  expect(popoutAfterMain.stage).toEqual(popoutInitial.stage);expect(planned.stage).toBeNull()
  await composer.fill(mainFollowText);await pick(appPage,card,'Plan');const mainPending=await snapshot(appPage)
  await focus(popout);await popout.reload();await expect.poll(()=>popout.evaluate(()=>!!(window as any).applicationState?.system.get('default-setup/threads'))).toBe(true)
  await popout.evaluate(threadId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId}),threadId)
  await expect(secondComposer).toHaveText(editText);await expect(second.getByRole('button',{name:'Edit',exact:true})).toBeVisible()
  await expect.poll(async()=>(await snapshot(popout)).native?.state.nativePid).toBe(boundNativePid)
  const popoutReloaded=await snapshot(popout);expect(popoutReloaded.stage).toEqual(popoutInitial.stage);expect((await snapshot(appPage)).stage).toEqual(mainPending.stage)
  expect(await humanRows()).toHaveLength(historyBefore.length+1)
  for(const [page,target,draft,label] of [[appPage,card,mainFollowText,'main'],[popout,second,editText,'popout']] as const){
    await focus(page)
    for(const width of [1100,680]){await page.setViewportSize({width,height:width===680?600:900});await expect(target.getByTestId('composer-native-status')).toContainText('Session ready');await expect(target.locator('[contenteditable="true"]')).toHaveText(draft);await expect(target.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await page.screenshot({caret:'initial',path:testInfo.outputPath('native-window-phase-'+label+'-'+width+'.png')})}
  }
  await send(popout,second,editText,originalMode)
  await expect(composer).toHaveText(mainFollowText);await expect(card.getByRole('button',{name:'Plan',exact:true})).toBeVisible()
  const mainAfterPopout=await snapshot(appPage),edited=await snapshot(popout)
  expect(mainAfterPopout.stage).toEqual(mainPending.stage);expect(edited.stage).toBeNull();expect(edited.native.state.nativePid).toBe(boundNativePid)
  const focusProof={main:await appPage.evaluate(()=>document.hasFocus()),popout:await popout.evaluate(()=>document.hasFocus())};expect(focusProof).toEqual({main:false,popout:true})
  await popout.close();await focus(appPage);await expect(composer).toHaveText(mainFollowText);expect((await snapshot(appPage)).stage).toEqual(mainPending.stage)
  await pick(appPage,card,'Edit');await send(appPage,card,mainFollowText,originalMode)
  expect((await snapshot(appPage)).stage).toBeNull();expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after reviewing independent window phases.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-composer-phase-proof.json'),JSON.stringify({sessionId,boundNativePid,threadId,originalMode,planText,editText,mainFollowText,historyBefore,plannedMode:planned.claude.permissionMode,editedMode:edited.claude.permissionMode,history:await humanRows(),mainInitial:mainInitial.stage,popoutInitial:popoutInitial.stage,popoutAfterMain:popoutAfterMain.stage,popoutReloaded:popoutReloaded.stage,mainPending:mainPending.stage,mainAfterPopout:mainAfterPopout.stage,focus:focusProof}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeComposerPhase:true,nativeWindowPhase:true,nativeComposerPhaseReload:true,nativeComposerPhaseOnSend:true,nativeComposerPhaseRestore:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
