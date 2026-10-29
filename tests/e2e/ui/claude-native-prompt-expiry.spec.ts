import { readFile, readdir as _readdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async ({ appPage }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('apack-native-prompt-reconnect-failure.png') }).catch(() => {})
  terminalScreen?.dispose(); terminalScreen = undefined
})
test('retires the original parent lease and refuses its addressed stale action after reconnect', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(125000)
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
  const resize=async()=>{const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;const rows=(await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));const event=rows.map(row=>row.meta?.event).filter(event=>event?.type==='CLAUDE_TERMINAL_RESIZE'&&event.ownerId===ownerId).at(-1);return event?{cols:event.columns,rows:event.rows}:undefined}
  await expect.poll(resize).toBeTruthy()
  const dimensions=(await resize())!
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
  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()
  const controllers: any[] = [], receipts: any[] = []
  await appPage.evaluate(() => {
    const actor = (window as any).applicationState, sockets: WebSocket[] = [], original = WebSocket.prototype.send
    let previous = actor.getSnapshot().context.busSubscribed === true
    const probe: any = { sockets, lost: 0, connected: 0, closes: 0 }
    const subscription = actor.subscribe((state: any) => { const current = state.context.busSubscribed === true; if (previous && !current) probe.lost++; if (!previous && current) probe.connected++; previous = current })
    WebSocket.prototype.send = function (...args) {
      const url = new URL(this.url)
      if (this.protocol === 'apack' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === String((window as any).electronAPI.apiPort) && !sockets.includes(this)) { sockets.push(this); this.addEventListener('close', () => probe.closes++) }
      return Reflect.apply(original, this, args)
    }
    probe.restore = () => { WebSocket.prototype.send = original; subscription.unsubscribe() }
    ;(window as any).__nativePromptReconnectProbe = probe
  })
  async function openTools(container: typeof card) { const button = container.getByRole('button', { name: 'Session tools', exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click() }
  let readSequence = 0
  async function readCurrent(container: typeof card, text: string) {
    await rename(join(workspace!, 'native-prompt-read.json'), join(workspace!, 'native-prompt-read-before-' + (++readSequence) + '.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
    await openTools(container); await container.getByRole('button', { name: 'Read current draft', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-read.json'), 'utf8').catch(() => 'null'))).toMatchObject({ text, cursor: text.length })
  }
  let parentDraft = ''
  try {
    parentDraft='Review #current-parent-complete'
    await composer.fill(parentDraft)
    await readCurrent(card, parentDraft)
    let lease: any
    await expect.poll(async()=>{ lease=await appPage.evaluate(() => {
      const context = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
      const entries = Object.entries(context.nativeUiViews).filter(([, view]: [string, any]) => view.threadId === context.currentThread.id && !view.mountRequest?.nativeView && view.state.status === 'live') as [string, any][]
      if (entries.length !== 1) return undefined
      const [mountId, view] = entries[0]
      const find = (value: any): string | undefined => { if (!value || typeof value !== 'object') return; if (value.kind === 'button' && value.label === 'Use review template' && value.actionId) return value.actionId; for (const child of Object.values(value)) { const found = find(child); if (found) return found } }
      const actionId = find(view.state); if (!actionId || !view.attachmentId) return undefined
      return { mountId, threadId: view.threadId, attachmentId: view.attachmentId, promptRevision: view.promptRevision, actionId }
    });return !!lease }).toBe(true)
    const attachments = async () => (await readFile(join(workspace!, 'native-ui-attachments.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(row => JSON.parse(row))
    const nativeAttachment = (await attachments()).filter(row => row.subtype === 'ui_attach' && row.taskId === null).at(-1)
    expect(nativeAttachment).toBeTruthy()
    const offlineAt = Date.now(), beforeOffline = await appPage.evaluate(() => { const p = (window as any).__nativePromptReconnectProbe; return { sockets: p.sockets.length, lost: p.lost, connected: p.connected, closes: p.closes } })
    try {
      await appPage.context().setOffline(true)
      await appPage.evaluate(index => { const socket = (window as any).__nativePromptReconnectProbe.sockets[index - 1]; if (socket.readyState < 2) socket.close(4002, 'Owned native lease expiry fixture') }, beforeOffline.sockets)
      await expect.poll(async () => appPage.evaluate(before => { const p = (window as any).__nativePromptReconnectProbe; return p.lost > before.lost && (window as any).applicationState.getSnapshot().context.busSubscribed === false }, beforeOffline)).toBe(true)
      // Observe the real lease retirement, without shortening its 30-second production lifetime.
      await expect.poll(async () => (await attachments()).some(row => row.subtype === 'ui_detach' && row.detached && row.clientSha256 === nativeAttachment.clientSha256 && row.at >= offlineAt), { timeout: 35000, intervals: [250] }).toBe(true)
    } finally { await appPage.context().setOffline(false) }
    await expect.poll(async () => appPage.evaluate(before => { const p = (window as any).__nativePromptReconnectProbe; return p.sockets.length > before.sockets && p.connected > before.connected && (window as any).applicationState.getSnapshot().context.busSubscribed === true }, beforeOffline), { timeout: 10000 }).toBe(true)
    await expect.poll(async () => appPage.evaluate(before => Object.entries((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).some(([id, entry]: [string, any]) => entry.threadId === before.threadId && !entry.mountRequest?.nativeView && entry.attachmentId && entry.attachmentId !== before.attachmentId && entry.state.status === 'live' && entry.prompt?.status === 'applied' && entry.prompt.frame.text === 'Review #current-parent-complete' && entry.prompt.revision === entry.promptRevision && (id !== before.mountId || entry.promptRevision > before.promptRevision)), lease)).toBe(true)
    await expect(composer).toHaveText(parentDraft); expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await readCurrent(card, parentDraft)
    const deliveredControls=async()=>{const text=await readFile(join(workspace!,'app-data/apack/logs/app-events.log'),'utf8');return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.meta?.event?.type==='CLAUDE_UI_PRESS')}
    const freshMount=await appPage.evaluate(threadId=>{const views=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews;const rows=Object.entries(views).filter(([,v]:[string,any])=>v.threadId===threadId&&!v.mountRequest?.nativeView&&v.attachmentId&&['live','rendering'].includes(v.state?.status)) as [string,any][];if(rows.length!==1)throw Error('Fresh parent mount unavailable');return {mountId:rows[0][0],attachmentId:rows[0][1].attachmentId}},lease.threadId)
    expect(freshMount.attachmentId).not.toBe(lease.attachmentId)
    const stalePress={mountId:freshMount.mountId,threadId:lease.threadId,actionId:lease.actionId}
    const priorControls=await deliveredControls(),address=priorControls.at(-1)?.meta?.from
    expect(address).toBeTruthy()
    await appPage.evaluate(before => (window as any).applicationState.send({type:'SEND_TO_SURFACE',surface:'default-setup/threads',events:[{ type: 'CLAUDE_UI_PRESS', mountId: before.mountId, threadId: before.threadId, actionId: before.actionId }]}), stalePress)
    await expect.poll(async()=>(await deliveredControls()).slice(priorControls.length).some(row=>row.meta.from===address&&row.meta.event.mountId===stalePress.mountId&&row.meta.event.threadId===stalePress.threadId&&row.meta.event.actionId===stalePress.actionId)).toBe(true)
    await readCurrent(card, parentDraft); await expect(composer).toHaveText(parentDraft)
    await card.getByRole('button', { name: 'Use review template', exact: true }).click()
    await expect(composer).toHaveText('Review release notes before merging.')
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-theme-fill.json'), 'utf8'))).toMatchObject({ before: { text: parentDraft }, result: { isFilled: true } })
    await readCurrent(card, 'Review release notes before merging.')
    receipts.push({ owner: 'parent', kind: 'expired-attachment', offlineAt, recoveredAt: Date.now(), oldAttachmentId: lease.attachmentId, retiredMountId:lease.mountId, addressedMountId:freshMount.mountId, freshAttachmentId:freshMount.attachmentId, originalNativeAttachment: nativeAttachment, retired: (await attachments()).find(row => row.subtype === 'ui_detach' && row.detached && row.clientSha256 === nativeAttachment.clientSha256 && row.at >= offlineAt), replacement: (await attachments()).filter(row => row.subtype === 'ui_attach' && row.taskId === null).at(-1), retainedDraft: parentDraft, staleActionRefused: true, addressedStaleActionDelivered: true, controlAddress: address, freshFill: true })
    const nativeWindow=await _electronApp.browserWindow(appPage)
    for(const [width,height] of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(composer).toHaveText('Review release notes before merging.');await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1});const png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});await writeFile(testInfo.outputPath('native-parent-expiry-'+width+'.png'),Buffer.from(png,'base64'))}
    await writeFile(join(workspace!, 'native-prompt-expiry-receipts.json'), JSON.stringify(receipts))
  } finally {
    await writeFile(join(workspace!, 'native-prompt-reconnect-partial.json'), JSON.stringify(controllers.map(controller => controller.receipts)))
    for (const controller of controllers.reverse()) await controller.close()
    await appPage.evaluate(() => { (window as any).__nativePromptReconnectProbe?.restore(); delete (window as any).__nativePromptReconnectProbe })
  }
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click(); await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue the same session after the worker review.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativePromptExpiry: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
