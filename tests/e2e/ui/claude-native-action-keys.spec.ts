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
test.afterEach(async ({appPage}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await appPage.screenshot({path:testInfo.outputPath('native-action-keys-failure.png')}).catch(() => {})
    const views=await appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).catch(error=>({error:String(error)}))
    await writeFile(join(workspace!,'native-action-app-failure.json'),JSON.stringify(views))
  }
  terminalScreen?.dispose();terminalScreen=undefined
})
test('routes live native Button actions through the retained main and Agent app drafts', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
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
  // A cold native owner loads its original plugins before the first result.
  await expect.poll(async () => (await context()).turns, { timeout: 20000, message: 'Initial original-native seed turn completes before field acceptance starts' }).toBe(1)
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
    const screen = recognizeOnboardingPrompt(text, workspace)
    const ready = native?.state?.status === 'live' && native.state.mainStatus?.includes('Session ready') === true
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ checkedAt:Date.now(), ready, screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text, state: native?.state }))
    // A cold runner can publish its first original helper at the prior 25-second boundary.
    if (ready) return true
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 40000, intervals: [250] }).toBe(true)
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



  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-action-app-receipts.json'),'utf8').catch(()=>'[]'))
  const inspect=async()=>JSON.parse(await readFile(join(workspace!,'native-action-app-inspection.json'),'utf8').catch(()=>'null'))
  const ui=()=>appPage.evaluate(()=>{
    const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
    const entries=Object.entries(state.nativeUiViews) as [string,any][]
    const entry=entries.find(([,view])=>view.threadId===state.currentThread?.id&&view.attachmentId&&view.state.actionKeys?.bindings.length)
    return entry?{mountId:entry[0],...entry[1]}:undefined
  })
  const prepare=async(editor:typeof composer,text:string)=>{
    await editor.fill(text);await editor.press('Home')
    for(let i=0;i<9;i++)await editor.press('ArrowRight')
    return {text,cursor:9}
  }
  const readWithKey=async(editor:typeof composer,expected:{text:string;cursor:number},chord='Control+Alt+u')=>{
    const count=(await receipts()).length
    await editor.focus();await editor.press(chord)
    await expect.poll(async()=>(await receipts()).length,{message:'Original desktop Button callback reads the actual app draft'}).toBe(count+1)
    expect((await receipts()).at(-1).value).toEqual(expected)
    return (await receipts()).at(-1)
  }
  const before=await context()
  const parent=await prepare(composer,'Keep release guidance while reviewing the current changes.')
  await expect.poll(async()=>(await ui())?.state.actionKeys?.bindings.some((chord:any)=>chord[0]?.key==='u')).toBe(true)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    await readWithKey(composer,parent)
    await expect(composer).toHaveText(parent.text)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    await expect(status).toBeInViewport({ratio:1})
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-action-main-'+width+'.png')})
  }
  // Engine-owned registration wins over the competing native Button callback.
  await expect.poll(async()=>(await inspect())?.nativePid).toBe(boundNativePid)
  const priorView=(await inspect()).samples.at(-1).expandedView
  await composer.press('Control+Alt+p')
  await expect.poll(async()=>(await inspect())?.samples.at(-1)?.expandedView).not.toBe(priorView)
  expect(await readFile(join(workspace!,'native-action-app-wrong-engine-fallback.json'),'utf8').catch(()=>'missing')).toBe('missing')
  await composer.press('Control+Alt+p')
  await expect.poll(async()=>(await inspect())?.samples.at(-1)?.expandedView).toBe(priorView)

  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id')
  expect(taskId).toBeTruthy()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),agentComposer=form.locator('[contenteditable="true"]')
  await expect(focused).toBeVisible()
  const agent=await prepare(agentComposer,'Check the worker release notes without losing this Agent draft.')
  await expect.poll(async()=>(await ui())?.state.actionKeys?.bindings.length??0).toBeGreaterThan(0)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    const receipt=await readWithKey(agentComposer,agent);expect(receipt.view.agentId).toBe(taskId)
    await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport({ratio:1})
    await expect(focused.getByRole('button',{name:'Back to conversation',exact:true})).toBeInViewport({ratio:1})
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-action-agent-'+width+'.png')})
  }
  // Queue a complete chord without waiting between its prefix and final key.
  const count=(await receipts()).length
  await agentComposer.press('Control+Alt+k');await agentComposer.press('u')
  await expect.poll(async()=>(await receipts()).length).toBe(count+1)
  expect((await receipts()).at(-1).value).toEqual(agent)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText(parent.text)
  await readWithKey(composer,parent)

  await writeFile(join(workspace!,'.claude/keybindings.json'),JSON.stringify([{context:'Global',bindings:{'ctrl+alt+u':null,'ctrl+alt+r':'app:cycleDiffBase','ctrl+alt+k u':'app:cycleDiffBase','ctrl+alt+p':'app:toggleTodos'}}]))
  await expect.poll(async()=>{
    const bindings=(await ui())?.state.actionKeys?.bindings??[]
    return bindings.some((chord:any)=>chord.length===1&&chord[0].key==='r')&&!bindings.some((chord:any)=>chord.length===1&&chord[0].key==='u')
  },{message:'Original user keybinding watch withdraws the old shortcut and exposes its replacement'}).toBe(true)
  const reboundCount=(await receipts()).length
  await composer.press('Control+Alt+u')
  expect((await receipts()).length).toBe(reboundCount)
  await readWithKey(composer,parent,'Control+Alt+r')
  const old=await ui()
  const tools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await card.getByRole('button',{name:'Finish review shortcuts',exact:true}).click()
  await expect(card.getByText('Review shortcuts finished',{exact:true})).toBeVisible()
  await expect.poll(async()=>appPage.evaluate(mountId=>{
    const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
    return state.nativeUiViews[mountId]?.state.actionKeys?.bindings.length??0
  },old.mountId)).toBe(0)
  const staleSequence=(old.actionKeyResult?.sequence??0)+1,retiredCount=(await receipts()).length
  await appPage.evaluate(({mountId,revision,sequence})=>{
    const actor=(window as any).applicationState.system.get('default-setup/threads')
    actor.send({type:'CLAUDE_UI_KEY',threadId:actor.getSnapshot().context.currentThread.id,mountId,revision,sequence,event:{key:'r',ctrl:true,alt:true,super:false,shift:false,from_composer:true}})
  },{mountId:old.mountId,revision:old.state.actionKeys.revision,sequence:staleSequence})
  await expect.poll(async()=>appPage.evaluate(({mountId,sequence})=>{
    const result=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews[mountId]?.actionKeyResult
    return result?.sequence===sequence?result.handled:undefined
  },{mountId:old.mountId,sequence:staleSequence})).toBe(false)
  expect((await receipts()).length).toBe(retiredCount)
  await tools.click()
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((row:any)=>row.id)).toEqual(before.messages.map((row:any)=>row.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(parent.text);await composer.fill('Continue after reviewing the release shortcuts.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-action-app-proof.json'),JSON.stringify({sessionId,boundNativePid,taskId,parent,agent,receipts:await receipts(),enginePriority:true,rebound:true,staleHandled:false,noPhantomTurn:true,originalTurnCount:before.turns}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeDesktopActionKeys:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
