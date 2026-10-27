import { readFile, readdir, writeFile } from 'node:fs/promises'
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
test('resumes a paused native Workflow through its original command without an added settlement wait', async ({ app, appPage, electronApp }, testInfo) => {
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

  const nativeWindow=await electronApp.browserWindow(appPage),captures:{stage:string;width:number;file:string}[]=[]
  await nativeWindow.evaluate(win=>{win.show();win.focus()});await appPage.bringToFront()
  const replace=async(text:string)=>{await composer.focus();await composer.press('Control+a');await composer.pressSequentially(text);await expect(composer).toHaveText(text)}
  const snapshot=()=>composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  const tasks=async()=>JSON.parse(await readFile(join(workspace!,'native-workflow-state.json'),'utf8'))
  await replace('Use a workflow to review the release notes.');await card.getByRole('button',{name:'Send',exact:true}).click()
  const approval=appPage.getByRole('region',{name:'Workflow approval',exact:true})
  await expect(approval).toBeVisible();await expect(approval).toContainText('Review release notes');await approval.getByRole('button',{name:'Yes, run it',exact:true}).click()
  let before:any
  await expect.poll(async()=>{before=(await tasks()).find((task:any)=>task.status==='running'&&task.workflowProgress?.some((event:any)=>event.type==='workflow_agent'&&event.index===1&&event.state==='done')&&task.workflowProgress?.some((event:any)=>event.type==='workflow_agent'&&event.index===2&&event.state==='start'));return !!before},{timeout:20000}).toBe(true)
  const taskId=before.id,cachedWorker=before.workflowProgress.find((event:any)=>event.type==='workflow_agent'&&event.index===1),region=appPage.getByRole('region',{name:'Native Claude workflows',exact:true}),row=region.locator('[data-native-workflow-id="'+taskId+'"]')
  const draft='Keep the release notes while the reviewer resumes.';await replace(draft);const retained=await snapshot()
  await appPage.evaluate(id=>{const actor=(window as any).applicationState.system.get('default-setup/threads'),samples:any[]=[];const subscription=actor.subscribe((state:any)=>{for(const view of Object.values(state.context.nativeTerminalViews) as any[])for(const task of view.state?.tasks??[])if(task.id===id)samples.push({at:Date.now(),task:{...task}})});(window as any).__workflowResumeObservation={samples,stop:()=>subscription.unsubscribe()}},taskId)
  await row.getByRole('button',{name:'Pause Workflow',exact:true}).click()
  const resume=row.getByRole('button',{name:'Resume Workflow',exact:true});await expect(resume).toBeEnabled()
  const paused=(await tasks()).find((task:any)=>task.id===taskId);expect(paused.status).toBe('paused')
  // Resume uses the original paused-task gate; do not insert a settlement wait here.
  const appAtResume=(await context()).native.state.tasks.find((task:any)=>task.id===taskId);expect(appAtResume.canResume).toBe(true)
  await resume.click();await expect(approval).toBeVisible({timeout:15000});await expect(approval.getByTestId('native-workflow-summary')).toContainText('CachedStageFixture');await approval.getByRole('button',{name:'Yes, run it',exact:true}).click()
  let resumed:any
  await expect.poll(async()=>{resumed=(await tasks()).find((task:any)=>task.id!==taskId&&task.workflowRunId===paused.workflowRunId);return !!resumed},{timeout:15000}).toBe(true)
  await expect.poll(async()=>(await tasks()).find((task:any)=>task.id===resumed.id)?.workflowProgress?.some((event:any)=>event.type==='workflow_agent'&&event.index===1&&event.cached===true)).toBe(true)
  await writeFile(join(workspace!,'native-pending-duration-release'),'release')
  await expect.poll(async()=>(await tasks()).find((task:any)=>task.id===resumed.id)?.status,{timeout:20000}).toBe('completed')
  const completed=(await tasks()).find((task:any)=>task.id===resumed.id);expect(completed.workflowProgress.find((event:any)=>event.type==='workflow_agent'&&event.index===1).agentId).toBe(cachedWorker.agentId)
  expect(await snapshot()).toEqual(retained)
  const resumedRow=region.locator('[data-native-workflow-id="'+resumed.id+'"]');await resumedRow.getByRole('button',{name:'Workflow details',exact:true}).click()
  const details=appPage.getByRole('dialog',{name:'Workflow details',exact:true}),result=details.getByRole('region',{name:'Workflow result',exact:true})
  await expect(result).toContainText('CachedStageComplete');await expect(result).toContainText('ResumeStageComplete')
  for(const width of [1100,680]){
    const size={width,height:width===680?600:900};await appPage.setViewportSize(size);await result.scrollIntoViewIfNeeded()
    for(const control of [details.getByRole('button',{name:'Close Workflow details',exact:true}),composer,card.getByRole('button',{name:'Send',exact:true})])await expect(control).toBeInViewport({ratio:1})
    expect(await snapshot()).toEqual(retained)
    const file='native-workflow-resume-eligibility-result-'+width+'.png',png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({stage:'result',width,file})
  }
  await details.getByRole('button',{name:'Close Workflow details',exact:true}).click()
  const appSamples=await appPage.evaluate(()=>{const observer=(window as any).__workflowResumeObservation;observer.stop();return observer.samples})
  const originalHistory=(await readFile(join(workspace!,'native-workflow-state-history.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click();expect(await snapshot()).toEqual(retained)
  await replace('Continue after resuming the paused review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success')
  const final=await context();expect(final.sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-workflow-resume-proof.json'),JSON.stringify({sessionId,boundNativePid,before,paused,resumed,completed,cachedWorker,draft,retained,appAtResume,appSamples,originalHistory,captures,final,sameNativeOwner:true,noAddedSettlementWait:true}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'task-controls',nativeWorkflowPausedResumed:true,nativeWorkflowResumeEligibility:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
