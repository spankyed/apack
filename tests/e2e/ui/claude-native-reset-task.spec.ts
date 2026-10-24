import { readFile, writeFile, readdir } from 'node:fs/promises'
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
test('refuses reset for a live worker and isolates its late response after stopping and resetting', async ({ app, appPage, electronApp }, testInfo) => {
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
  await expect.poll(async () => (await context()).turns, { timeout: 15000 }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const statusLabel='AppNativeMain '+sessionId
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes(statusLabel) === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes(statusLabel))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText(statusLabel)
    await expect(main).toContainText('Second native status line')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText(statusLabel)
  const composer = card.locator('[contenteditable="true"]')





  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[]
  async function capture(stage:string){for(const [width,height] of [[1100,900],[680,600]]){
    await appPage.setViewportSize({width,height});await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    const captured=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},{width,height});expect(captured.size).toEqual({width,height});const name='native-reset-task-'+stage+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(captured.png,'base64'));captures.push(name)
  }}
  async function reset(){await composer.fill('');await composer.pressSequentially('/cc-reset');await appPage.locator('.command-suggestion-popup').getByText('/cc-reset',{exact:true}).click();await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')}
  await composer.fill('Review the release notes in the background.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='running'),{timeout:15000}).toBe(true)
  const task=(await context()).native.state.tasks.find((task:any)=>task.status==='running'),taskId=task.id
  await expect.poll(async()=>(await context()).turns).toBe(2)
  await expect.poll(()=>readFile(join(workspace!,'native-reset-task-provider-started'),'utf8').then(()=>true,()=>false),{timeout:15000}).toBe(true)
  await reset()
  await expect(appPage.getByText('Pause the current Claude turn before resetting its session.',{exact:true})).toBeVisible()
  expect((await context()).sessionId).toBe(sessionId);expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).native.state.tasks.find((row:any)=>row.id===taskId).status).toBe('running')
  const draft='Keep this review draft while the background worker is stopped.';await composer.fill(draft);await capture('refused')
  const tools=appPage.getByRole('button',{name:/^Native tools/}).first();if(await tools.isVisible()&&await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  const row=appPage.locator('[data-native-agent-id="'+taskId+'"]');await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true});await focused.getByRole('button',{name:'Stop Agent',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.find((row:any)=>row.id===taskId)?.status,{timeout:10000}).toBe('killed')
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft)
  await reset();await expect.poll(async()=>(await context()).claude).toBeUndefined();await expect.poll(async()=>(await context()).native?.state.status??'exited').toBe('exited');await expect(card.getByTestId('composer-native-status')).toHaveCount(0)
  const buckets=await readdir(join(workspace!,'.claude/projects'));let priorJournal='';for(const bucket of buckets){try{priorJournal=await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')}catch(error:any){if(error.code!=='ENOENT')throw error}}expect(priorJournal).toBeTruthy()
  const freshText='Start a fresh review after stopping the prior worker.';await composer.fill(freshText);await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect(appPage.getByText('Which project directory should I work in?',{exact:true})).toBeVisible()
  const windowId=await nativeWindow.evaluate(window=>window.id)
  await electronApp.evaluate(({dialog,BrowserWindow},{directory,windowId})=>{
    const fixture=globalThis as any;fixture.resetTaskOpenDialog=dialog.showOpenDialog;fixture.resetTaskFocusedWindow=BrowserWindow.getFocusedWindow
    BrowserWindow.getFocusedWindow=()=>BrowserWindow.fromId(windowId)
    dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[directory]})) as typeof dialog.showOpenDialog
  },{directory:workspace!,windowId})
  try { await appPage.getByRole('button',{name:'Browse Directory',exact:true}).click();await expect.poll(async()=>(await context()).claude?.pendingDirectorySelect).toBeUndefined() }
  finally { await electronApp.evaluate(({dialog,BrowserWindow})=>{const fixture=globalThis as any;dialog.showOpenDialog=fixture.resetTaskOpenDialog;BrowserWindow.getFocusedWindow=fixture.resetTaskFocusedWindow;delete fixture.resetTaskOpenDialog;delete fixture.resetTaskFocusedWindow}) }
  try {
    await expect.poll(async()=>(await context()).turns).toBe(1)
    await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  } catch (error) {
    await writeFile(join(workspace!,'native-reset-task-restart-failure.json'),JSON.stringify({context:await context(),visibleText:await appPage.locator('body').innerText(),browserErrors:errors},null,2))
    throw error
  }
  const replacement=await context();expect(replacement.sessionId).not.toBe(sessionId);expect(replacement.messages.some((message:any)=>message.text==='Review the release notes for this project.')).toBe(true)
  const prints=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(prints.at(-1).sessionId).toBe(replacement.sessionId);expect(replacement.claude.totalCostUsd).toBeCloseTo(prints.at(-1).totalCostUsd,10)
  let freshRows:any[]=[];for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{freshRows=(await readFile(join(workspace!,'.claude/projects',bucket,replacement.sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))}catch(error:any){if(error.code!=='ENOENT')throw error}}
  const humans=freshRows.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true);expect(humans).toHaveLength(1);expect(humans[0].sessionId).toBe(replacement.sessionId)
  const freshPrompt=humans[0].message.content;expect(typeof freshPrompt).toBe('string')
  expect(freshPrompt).toContain('The provider session is new, so use the prior thread transcript below as context.')
  expect(freshPrompt).toContain('Prior thread transcript:')
  expect(freshPrompt).toContain('User:\nReview the release notes in the background.')
  expect(freshPrompt.endsWith('Latest user message:\n'+freshText)).toBe(true)
  expect(freshPrompt).not.toContain(taskId);expect(freshPrompt).not.toContain(sessionId)
  expect(humans[0].parentUuid).toBeNull()
  const baseline={sessionId:replacement.sessionId,turns:replacement.turns,cost:replacement.claude.totalCostUsd,messageIds:replacement.messages.map((message:any)=>message.id)}
  await writeFile(join(workspace!,'native-pending-duration-release'),'release the cancelled old provider after replacement')
  await expect.poll(()=>readFile(join(workspace!,'native-reset-task-provider-released.json'),'utf8').then(text=>JSON.parse(text),()=>undefined)).toMatchObject({heldReleased:true,disconnectedWhenReleased:true})
  const after=await context();expect({sessionId:after.sessionId,turns:after.turns,cost:after.claude.totalCostUsd,messageIds:after.messages.map((message:any)=>message.id)}).toEqual(baseline)
  await composer.fill('Keep the new session draft after old-provider release.');await capture('fresh');expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-reset-task-proof.json'),JSON.stringify({sessionId,finalSessionId:replacement.sessionId,boundNativePid,taskId,busyResetRefused:true,taskStoppedBeforeReset:true,priorJournalPreserved:true,newHumanUuid:humans[0].uuid,newHumanText:freshText,nativePrintCost:prints.at(-1).totalCostUsd,baseline,lateResponseIsolated:true,captures}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'task-controls',nativeResetTask:true,nativeBusyResetRefused:true,nativeResetStateCleared:true,replacementSessionDistinct:true,nativeLateTaskResponseIsolated:true,nativeRetainedDraft:true,sessionId,finalSessionId:replacement.sessionId,boundNativePid,browserErrors:errors}))
})
