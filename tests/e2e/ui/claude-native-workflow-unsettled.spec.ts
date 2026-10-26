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
test('retires completed but unsettled Workflow controls after stopping native work', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
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
    if (native?.state?.status === 'live') return true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live'
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const composer = card.locator('[contenteditable="true"]')

  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText('Use a workflow to review the release notes.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  const approval=appPage.getByRole('region',{name:'Workflow approval',exact:true})
  await expect(approval).toBeVisible();await expect(approval).toContainText('Review release notes')
  await approval.getByRole('button',{name:'Yes, run it',exact:true}).click();await expect(approval).toHaveCount(0)
  const tasks=async()=>JSON.parse(await readFile(join(workspace!,'native-workflow-state.json'),'utf8').catch(()=>'[]'))
  const original=async()=>(await tasks()).find((task:any)=>task.type==='local_workflow'&&task.status==='completed'&&task.settled===false)
  let before:any
  await expect.poll(async()=>{const value=await original();if(value)before=value;return !!value},{timeout:15000,message:'Original Workflow completion precedes native settlement'}).toBe(true)
  const taskId=before.id
  const currentTask=async()=>(await context()).native.state.tasks.find((task:any)=>task.id===taskId)
  await expect.poll(currentTask).toMatchObject({kind:'workflow',status:'completed',settled:false,canStop:true})
  const region=appPage.getByRole('region',{name:'Native Claude workflows',exact:true}),row=region.locator('[data-native-workflow-id="'+taskId+'"]')
  const stop=row.getByRole('button',{name:'Stop Workflow',exact:true})
  await expect(stop).toBeEnabled();await expect(row.getByRole('button',{name:'Pause Workflow',exact:true})).toHaveCount(0);await expect(row.getByRole('button',{name:'Resume Workflow',exact:true})).toHaveCount(0)
  const draft='Keep the release notes while the reviewer settles.'
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText(draft);await expect(composer).toHaveText(draft)
  const win=await electronApp.browserWindow(appPage),captures:any[]=[]
  async function capture(stage:string){
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});await row.scrollIntoViewIfNeeded()
      for(const control of [stop,composer,card.getByRole('button',{name:'Send',exact:true})])await expect(control).toBeInViewport({ratio:1})
      await expect(composer).toHaveText(draft)
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const file='native-workflow-unsettled-'+stage+'-'+width+'.png',png=await win.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({stage,width,file,task:await currentTask()})
    }
  }
  await capture('completed-unsettled')
  await stop.click()
  await expect.poll(async()=>(await tasks()).find((task:any)=>task.id===taskId)?.settled,{timeout:15000}).toBe(true)
  await expect.poll(currentTask).toMatchObject({settled:true,canStop:false})
  await expect(stop).toBeDisabled()
  await writeFile(join(workspace!,'native-pending-duration-release'),'release')
  await capture('settled')
  const after=(await tasks()).find((task:any)=>task.id===taskId)
  expect((await context()).sessionId).toBe(sessionId);expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft)
  const continuation='Continue after stopping the unsettled release review.'
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText(continuation);await expect(composer).toHaveText(continuation)
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-workflow-unsettled-proof.json'),JSON.stringify({sessionId,boundNativePid,taskId,before,after,captures,draft,continuation}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'task-controls',nativeWorkflowUnsettled:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
