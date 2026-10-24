import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async ({appPage},testInfo) => { if(testInfo.status!==testInfo.expectedStatus&&!appPage.isClosed())await appPage.screenshot({path:testInfo.outputPath('native-window-agent-failure.png')}).catch(()=>{});terminalScreen?.dispose();terminalScreen=undefined })
test('preserves independent window and Agent drafts through shared native view switching', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(140000)
  expect(process.env.HOME).toBe(workspace)
  const helperPath=join(workspace!,'sub.py')
  const helper=await readFile(helperPath,'utf8')
  expect(helper).toContain('p=json.load(sys.stdin)')
  await writeFile(helperPath,helper.replace('p=json.load(sys.stdin)',`p=json.load(sys.stdin)
import pathlib
control=pathlib.Path(${JSON.stringify(join(workspace!,'agent-status-mode.txt'))})
mode=control.read_text() if control.exists() else 'normal'
if mode=='empty': sys.exit(0)
if mode=='failure':
 print('FailedAgentHelperMustNotBecomeCaption')
 sys.exit(7)`))

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
    if (native?.state?.status === 'live' && native.state.mainStatus?.includes('Session ready')) return true
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

  const threadId=(await context()).threadId
  await composer.fill('Main window release draft.')
  const opened=electronApp.waitForEvent('window')
  await appPage.evaluate(()=>(window as any).electronAPI.surfaces.popout('default-setup/threads','Threads'))
  const popout=await opened
  popout.on('pageerror',error=>errors.push(error.message))
  await popout.waitForLoadState('domcontentloaded')
  await expect.poll(()=>popout.evaluate(()=>!!(window as any).applicationState?.system.get('default-setup/threads'))).toBe(true)
  await popout.evaluate(threadId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId}),threadId)
  const second=popout.locator('[data-onboarding-id="agent-chat-input"]')
  const secondComposer=second.locator('[contenteditable="true"]')
  await expect(secondComposer).toBeVisible()
  await secondComposer.fill('Popout release draft 👋')
  await expect(composer).toHaveText('Main window release draft.')
  await expect(second.getByTestId('composer-native-status')).toContainText('Session ready')
  const secondOwner=await popout.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return Object.values(c.nativeTerminalViews).find((v:any)=>v.threadId===c.currentThread.id) as any})
  expect(secondOwner.state.nativePid).toBe(boundNativePid);expect(secondOwner.state.sessionId).toBe(sessionId)
  const focusWindow=async(page:typeof appPage)=>{const window=await electronApp.browserWindow(page);await window.evaluate(window=>{window.show();window.focus()});await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true)}
  const expand=async(target:ReturnType<typeof appPage.locator>)=>{const tools=target.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()}
  const reads=async()=>JSON.parse(await readFile(join(workspace!,'native-window-agent-receipts.json'),'utf8').catch(()=>'[]'))
  await focusWindow(appPage);await expand(card)
  const old=await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;for(const [mountId,view] of Object.entries(c.nativeUiViews) as any){const queue=[view.state];let count=0;while(queue.length&&++count<20000){const n:any=queue.pop();if(!n||typeof n!=='object')continue;if(n.kind==='button'&&n.label==='Fill active composer'&&n.actionId)return{threadId:view.threadId,mountId,actionId:n.actionId};queue.push(...Object.values(n).filter(v=>v&&typeof v==='object'))}}});expect(old).toBeTruthy()
  await card.getByRole('button',{name:'Session tools',exact:true}).click()
  await composer.fill('Review the release notes with a worker.');await card.getByRole('button',{name:'Send',exact:true}).click()
  const autoNotice=appPage.getByRole('region',{name:'Claude auto mode notice',exact:true})
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed')||await autoNotice.isVisible(),{timeout:20000}).toBe(true)
  if(await autoNotice.isVisible()){
    await expect(autoNotice).toContainText("We're changing auto mode")
    await autoNotice.getByRole('button',{name:'Continue in auto mode',exact:true}).click()
    await expect(autoNotice).toHaveCount(0)
  }
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
  await composer.fill('Main parent draft.')
  const nativeTools=appPage.getByRole('button',{name:/^Native tools/}).first();await nativeTools.scrollIntoViewIfNeeded();await nativeTools.click()
  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id');expect(taskId).toBeTruthy()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),secondFocused=popout.getByRole('region',{name:'Focused Agent conversation',exact:true})
  try { await expect(focused).toBeVisible();await expect(secondFocused).toBeVisible() }
  catch(error){
    const state=async(page:typeof appPage)=>page.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {thread:c.currentThread?.id,terminal:c.nativeTerminalViews,ui:c.nativeUiViews,text:document.body.innerText}})
    await writeFile(join(workspace!,'native-window-agent-opening.json'),JSON.stringify({main:await state(appPage),popout:await state(popout),errors},null,2))
    await appPage.screenshot({path:testInfo.outputPath('native-window-agent-opening-main.png')});await popout.screenshot({path:testInfo.outputPath('native-window-agent-opening-popout.png')});throw error
  }
  const form=focused.getByRole('form',{name:'Agent message',exact:true}),secondForm=secondFocused.getByRole('form',{name:'Agent message',exact:true})
  const worker=form.locator('[contenteditable="true"]'),secondWorker=secondForm.locator('[contenteditable="true"]')
  // Completion withdraws the running decoration; wait for the next original helper refresh.
  const agentCaption='AppNativeAgent completed'
  await expect.poll(async()=>(await context()).native.state.tasks.find((task:any)=>task.id===taskId)?.statusText,{timeout:15000}).toContain(agentCaption)
  await expect(form.getByTestId('composer-native-status')).toContainText(agentCaption)
  await expect(secondForm.getByTestId('composer-native-status')).toContainText(agentCaption)
  await worker.fill('Main Agent draft.')
  await focusWindow(popout);await expect.poll(()=>appPage.evaluate(()=>document.hasFocus())).toBe(false)
  await secondWorker.fill('Popout Agent draft 👋');await expand(secondForm)
  await secondForm.getByRole('button',{name:'Read active composer',exact:true}).click()
  await expect.poll(async()=>(await reads()).length).toBe(1);expect((await reads())[0].box.text).toBe('Popout Agent draft 👋')
  let freshMount:any
  await expect.poll(async()=>{freshMount=await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;const rows=Object.entries(c.nativeUiViews).filter(([,view]:[string,any])=>view.threadId===c.currentThread.id&&view.mountRequest?.nativeView&&view.state.status==='live') as [string,any][];if(rows.length!==1)return;return {threadId:c.currentThread.id,mountId:rows[0][0]}});return !!freshMount}).toBe(true)
  const addressedOldAction={...freshMount,actionId:old!.actionId}
  expect(addressedOldAction.mountId).not.toBe(old!.mountId)
  const deliveredControls=async()=>{const text=await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8');return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.meta?.event?.type==='CLAUDE_UI_PRESS')}
  const beforeReplay=await deliveredControls()
  // Removed parent mounts are intentionally unroutable; deliver the retired native token through the live Agent mount.
  await appPage.evaluate(event=>(window as any).applicationState.send({type:'SEND_TO_SURFACE',surface:'default-setup/threads',events:[{type:'CLAUDE_UI_PRESS',...event}]}),addressedOldAction)
  await expect.poll(async()=>(await deliveredControls()).slice(beforeReplay.length).some(row=>row.meta.from&&row.meta.event.mountId===addressedOldAction.mountId&&row.meta.event.threadId===addressedOldAction.threadId&&row.meta.event.actionId===addressedOldAction.actionId)).toBe(true)
  await expect(worker).toHaveText('Main Agent draft.');await expect(secondWorker).toHaveText('Popout Agent draft 👋')
  await secondForm.getByRole('button',{name:'Fill active composer',exact:true}).click()
  await expect.poll(async()=>(await reads()).length).toBe(2);expect((await reads())[1]).toMatchObject({result:{isFilled:true},box:{text:'Native focused worker draft.'}})
  await expect(worker).toHaveText('Main Agent draft.');await expect(secondWorker).toHaveText('Native focused worker draft.')
  const statusTransitions=[]
  const helperExits=async()=>(await readFile(join(workspace!,'prefix-exits.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  for(const width of [1100,680]){
    await popout.setViewportSize({width,height:width===680?600:900})
    for(const mode of ['empty','normal','failure','normal']){
      const before=(await helperExits()).length
      await writeFile(join(workspace!,'agent-status-mode.txt'),mode)
      await expect.poll(async()=>(await helperExits()).slice(before).some(row=>row.args?.at(-1)===`/usr/bin/python3 '${helperPath}'`&&row.code===(mode==='failure'?7:0)),{timeout:15000}).toBe(true)
      const caption=secondForm.getByTestId('composer-native-status')
      if(mode==='normal')await expect(caption).toContainText(agentCaption,{timeout:15000})
      else await expect(caption).toHaveCount(0,{timeout:15000})
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      await expect(worker).toHaveText('Main Agent draft.')
      await expect(secondWorker).toHaveText('Native focused worker draft.')
      await expect(secondForm).not.toContainText('FailedAgentHelperMustNotBecomeCaption')
      await expect(secondForm.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
      const window=await electronApp.browserWindow(popout)
      const png=await window.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      const file=`native-agent-status-${mode}-${width}-${statusTransitions.length}.png`
      await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'))
      statusTransitions.push({width,mode,file,taskId,helperExits:(await helperExits()).slice(before),status:(await context()).native.state.tasks.find((task:any)=>task.id===taskId)?.statusText??null})
    }
  }
  for(const width of [1100,680]){
    await popout.setViewportSize({width,height:width===680?600:900})
    const tools=secondForm.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
    await expect(secondForm.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
    await expect(secondForm.getByTestId('composer-native-status')).toContainText(agentCaption)
    await expect(secondForm.getByTestId('composer-native-status')).toBeInViewport()
    await popout.screenshot({caret:'initial',path:testInfo.outputPath('native-window-agent-'+width+'.png')})
  }
  await secondFocused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText('Main parent draft.');await expect(secondComposer).toHaveText('Popout release draft 👋')
  await focusWindow(appPage)
  const open=row.getByRole('button',{name:'Open Agent',exact:true});if(!await open.isVisible())await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  await open.click();await expect(worker).toHaveText('Main Agent draft.');await expect(secondWorker).toHaveText('Native focused worker draft.')
  await popout.close();await focusWindow(appPage);await expand(form)
  await form.getByRole('button',{name:'Read active composer',exact:true}).click()
  await expect.poll(async()=>(await reads()).length).toBe(3);expect((await reads())[2].box.text).toBe('Main Agent draft.')
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText('Main parent draft.')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
  await composer.fill('Continue after closing the popout.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Resume the Agent review after window cleanup.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-window-agent-proof.json'),JSON.stringify({statusTransitions,taskId,old,addressedOldAction,backendDelivered:true,receipts:await reads(),sessionId,boundNativePid}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeWindowAgentSwitch:true,nativeWindowAgentDrafts:true,nativeWindowAgentPrompt:true,nativeWindowAgentParentRefused:true,nativeWindowAgentDetach:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
