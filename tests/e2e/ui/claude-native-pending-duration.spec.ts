import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-pending-duration-failure.png') }).catch(() => {}) })
test('mirrors original pending background Agent duration and completion', async ({ app, appPage }, testInfo) => {
  test.setTimeout(120000)
  expect(process.env.HOME).toBe(workspace)
  const { pendingDuration } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!pendingDuration, 'Explicit private native pending-duration profile required')
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await appPage.setViewportSize({ width: 1100, height: 900 })
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: workspace!, phase: 'Edit' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  async function command(name: string, args = '') {
    const editor = card.locator('[contenteditable="true"]')
    await editor.fill(''); await editor.pressSequentially('/' + name)
    await appPage.locator('.command-suggestion-popup').getByText('/' + name, { exact: true }).click()
    if (args) await editor.pressSequentially(args)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(editor).toHaveText('')
  }
  await command('cc-set-dir', workspace!)
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: Object.values(state.nativeUiViews).find((view: any) => view.threadId === state.currentThread?.id && view.state?.status === 'live'), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return
    const rows=(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
    const event=rows.map(row=>row.meta?.event).filter(event=>event?.type==='CLAUDE_TERMINAL_RESIZE'&&event.ownerId===ownerId).at(-1)
    return event?{cols:event.columns,rows:event.rows}:undefined
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!;
  expect(dimensions.cols).toBeGreaterThan(1); expect(dimensions.cols).toBeLessThanOrEqual(500)
  const terminal = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
  let lastSequence = 0, lastScreen = ''
  async function screen() {
    if (await input.isVisible()) { const size=await resize(); if(size&&size.cols>1&&(size.cols!==terminal.cols||size.rows!==terminal.rows))terminal.resize(size.cols,Math.max(2,size.rows)) }
    const native = (await context()).native, chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminal.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminal.buffer.active
    lastScreen = Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    return lastScreen
  }
  try {
    let theme = false, security = false, navigated = false, trustAt = 0, attempts = 0
    await expect.poll(async () => {
      const current = await context(), kind = recognizeOnboardingPrompt(await screen(), workspace)
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('AppNativeMain ' + sessionId) === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    const composer = card.locator('[contenteditable="true"]')
    const frames = async () => ((await context()).ui?.state.transcriptMessages ?? []).filter((frame: any) => frame.component === 'TurnDuration' && frame.body.status === 'live')
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    await composer.fill('Review the release notes in the background.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'running'), { timeout: 15000 }).toBe(true)
    await expect.poll(async () => (await frames()).some((frame: any) => /Waiting for.*background agent/.test(frame.engineOutput ?? '')), { timeout: 15000 }).toBe(true)
    const pendingFrame = (await frames()).findLast((frame: any) => /Waiting for.*background agent/.test(frame.engineOutput ?? ''))
    const waitingRow = appPage.locator('[data-native-placement="TurnDuration"]').filter({ hasText: /Waiting for.*background agent/ }).last()
    await expect(waitingRow).toBeVisible()
    const journalPath = async () => { const dirs = await readdir(join(workspace!, '.claude/projects')); for (const dir of dirs) { const path = join(workspace!, '.claude/projects', dir, sessionId + '.jsonl'); try { await readFile(path); return path } catch {} } throw Error('Original native journal missing') }
    const journal = async () => (await readFile(await journalPath(), 'utf8')).trim().split(String.fromCharCode(10)).map(line => JSON.parse(line))
    await expect.poll(async () => (await journal()).some(row => row.type === 'system' && row.subtype === 'turn_duration' && row.pendingBackgroundAgentCount === 1)).toBe(true)
    const pendingNativeRows = (await journal()).filter(row => row.type === 'system' && row.subtype === 'turn_duration')
    const launched=(await journal()).filter(row=>row.type==='user'&&row.toolUseResult?.status==='async_launched')
    expect(launched).toHaveLength(1)
    const launch=launched[0],agentId=launch.toolUseResult.agentId
    expect(typeof agentId).toBe('string')
    const launchResults=launch.message.content.filter((block:any)=>block.type==='tool_result')
    expect(launchResults).toHaveLength(1)
    const toolUseId=launchResults[0].tool_use_id
    expect((await journal()).some(row=>row.type==='assistant'&&row.message.content.some((block:any)=>block.type==='tool_use'&&block.id===toolUseId&&block.name==='Agent'&&block.input.run_in_background===true))).toBe(true)
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.id===agentId&&task.status==='running')).toBe(true)
    const draft = 'Keep this release-review draft while the worker finishes.'
    await composer.fill(draft)
    const nativeTools=appPage.getByRole('button',{name:/^Native tools/}).first()
    if(await nativeTools.getAttribute('aria-expanded')!=='true')await nativeTools.click()
    const agentRow=appPage.locator(`[data-native-agent-id="${agentId}"]`)
    await expect(agentRow).toHaveAttribute('data-native-tool-use-id',toolUseId)
    await agentRow.getByRole('button',{name:'View Agent conversation',exact:true}).click()
    await expect(agentRow.getByRole('region',{name:'Agent conversation',exact:true})).toContainText('Return the synthetic worker marker only.')
    await agentRow.getByRole('button',{name:'Hide Agent conversation',exact:true}).click()
    await agentRow.getByRole('button',{name:'Open Agent',exact:true}).click()
    const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true})
    await expect(focused).toBeVisible()
    await focused.getByRole('form',{name:'Agent message',exact:true}).locator('[contenteditable="true"]').fill('Keep this independent background worker draft.')
    await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
    await expect(composer).toHaveText(draft)
    for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
      await appPage.setViewportSize(size); await waitingRow.scrollIntoViewIfNeeded(); await expect(waitingRow).toBeInViewport(); await expect(composer).toHaveText(draft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
      await appPage.screenshot({ path: testInfo.outputPath('native-pending-agent-' + size.width + '.png') })
    }
    await writeFile(join(workspace!, 'native-pending-duration-release'), 'release')
    await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 15000 }).toBe(true)
    await expect(composer).toHaveText(draft)
    // Observe original completed-task eviction; never synthesize removal or extend native retention.
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.id===agentId),{timeout:40000}).toBe(false)
    await expect(appPage.locator(`[data-native-agent-id="${agentId}"]`)).toHaveCount(0)
    const savedResult=appPage.locator(`[data-native-tool-use-id="${toolUseId}"]`).locator('[data-native-tool-format]').last()
    await expect(savedResult).toBeVisible()
    await expect(composer).toHaveText(draft)
    const retiredControl=await appPage.evaluate(agentId=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;const entry=Object.entries(c.nativeTerminalViews).find(([,v]:[string,any])=>v.threadId===c.currentThread.id) as [string,any];const [mountId,v]=entry;return {threadId:c.currentThread.id,mountId,ownerId:v.state.ownerId,taskId:agentId,revision:(v.task?.revision??0)+1,operation:'input',text:'RetiredAgentMustNotReceiveThis'}},agentId)
    const taskBefore=JSON.stringify((await context()).native.task)
    const taskEvents=async()=>{const rows=(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return rows.filter(row=>row.meta?.event?.type==='CLAUDE_TERMINAL_TASK')}
    const deliveredBefore=(await taskEvents()).length
    await appPage.evaluate(event=>(window as any).applicationState.send({type:'SEND_TO_SURFACE',surface:'default-setup/threads',events:[{type:'CLAUDE_TERMINAL_TASK',...event}]}),retiredControl)
    await expect.poll(async()=>(await taskEvents()).slice(deliveredBefore).some(row=>row.meta.from&&row.meta.event.mountId===retiredControl.mountId&&row.meta.event.taskId===agentId&&row.meta.event.revision===retiredControl.revision)).toBe(true)
    expect(JSON.stringify((await context()).native.task)).toBe(taskBefore)
    await expect(composer).toHaveText(draft)
    const before = new Set((await frames()).map((frame: any) => frame.uuid))
    await composer.fill('Continue the release review after the worker finishes.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await frames()).some((frame: any) => !before.has(frame.uuid) && /for \d/.test(frame.engineOutput ?? '') && !/Waiting for/.test(frame.engineOutput ?? '')), { timeout: 15000 }).toBe(true)
    const completedFrame = (await frames()).findLast((frame: any) => !before.has(frame.uuid) && /for \d/.test(frame.engineOutput ?? '') && !/Waiting for/.test(frame.engineOutput ?? ''))
    await expect(appPage.locator('[data-native-placement="TurnDuration"]').last()).toContainText(/for \d/)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    expect(JSON.stringify((await context()).native.task)).toBe(taskBefore)
    expect(JSON.stringify(await journal())).not.toContain('RetiredAgentMustNotReceiveThis')
    await writeFile(join(workspace!, 'native-pending-duration-proof.json'), JSON.stringify({ waiting: pendingFrame.engineOutput, completed: completedFrame.engineOutput, pendingFrame, completedFrame, pendingNativeRows, asyncLaunch:{agentId,toolUseId,resultUuid:launch.uuid},retiredControl,retiredControlBackendDelivered:true,retiredControlTaskStateUnchanged:JSON.stringify((await context()).native.task)===taskBefore }))
    await section.getByRole('button', { name: 'Use native interface', exact: true }).click(); await section.getByRole('button', { name: 'Stop session', exact: true }).click()
    await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
    const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
    await composer.fill('Continue the same session after the pending worker review.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'task-controls', nativePendingDuration: true, nativePendingAgent: true, nativePendingCompletion: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
  } finally { await writeFile(join(workspace!, 'native-pending-duration-screen.txt'), lastScreen); terminal.dispose() }
})
