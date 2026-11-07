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
test('retains newer selected-Agent drafts across delayed original replies and API reconnect', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
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
  const brokerRows = (await readFile(join(workspace!, 'native-owned-broker.jsonl'), 'utf8')).trim().split('\n').map(row => JSON.parse(row))
  const { delayOwnedUiHost } = await import(pathToFileURL(process.env.CLAUDE_RESEARCH_UI_DELAY!).href)
  const directory = brokerRows.at(-1).directory, controllers: any[] = [], receipts: any[] = []
  const focused = appPage.getByRole('region', { name: 'Focused Agent conversation', exact: true })
  const form = focused.getByRole('form', { name: 'Agent message', exact: true }), agentComposer = form.locator('[contenteditable="true"]')
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
  async function reconnect() {
    const before = await appPage.evaluate(() => { const p = (window as any).__nativePromptReconnectProbe, socket = p.sockets.at(-1); if (!socket || socket.readyState !== 1) throw Error('Owned API socket was not observed'); const result = { sockets: p.sockets.length, lost: p.lost, connected: p.connected, closes: p.closes }; socket.close(4001, 'Owned native prompt reconnect fixture'); return result })
    await expect.poll(async () => appPage.evaluate(before => { const p = (window as any).__nativePromptReconnectProbe; return p.sockets.length > before.sockets && p.lost > before.lost && p.connected > before.connected && p.closes > before.closes && p.sockets.at(-1)?.readyState === 1 && (window as any).applicationState.getSnapshot().context.busSubscribed === true }, before), { timeout: 2500, intervals: [20] }).toBe(true)
    return before
  }
  let parentDraft = 'Keep the parent release draft during Agent reconnect.'
  await composer.fill(parentDraft)
  try {
    for (const owner of ['agent']) {
      if (owner === 'agent') {
        if (!await row.isVisible()) await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
        await appPage.evaluate(()=>{
          const rows:any[]=[]
          const record=()=>{
            const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
            rows.push({at:Date.now(),
              agents:Array.from(document.querySelectorAll('[data-native-agent-id]')).map(node=>({id:node.getAttribute('data-native-agent-id'),messageId:node.closest('[data-chat-message]')?.getAttribute('data-chat-message'),rect:node.getBoundingClientRect().toJSON()})),
              messages:Array.from(document.querySelectorAll('[data-chat-message]')).map(node=>({id:node.getAttribute('data-chat-message'),activities:Array.from(node.querySelectorAll('[data-native-tool-activity]')).map(block=>({tools:block.getAttribute('data-native-tool-ids'),expanded:block.querySelector('button')?.getAttribute('aria-expanded')}))})),
              views:Object.entries(c.nativeTerminalViews).map(([mountId,v]:[string,any])=>({mountId,view:v.state?.view,focus:v.state?.focus,task:v.task})),
              drawings:Object.values(c.nativeUiViews).map((v:any)=>({status:v.state?.status,frames:v.state?.transcriptMessages?.map((f:any)=>({component:f.component,uuid:f.uuid,messageId:f.messageId,status:f.body?.status,isExpanded:f.isExpanded,groupExpanded:f.groupExpanded,tools:f.tools?.map((t:any)=>t.id)}))})),
            });if(rows.length>30)rows.shift()
          }
          record();let frame:number|undefined
          const observer=new MutationObserver(()=>{if(frame===undefined)frame=requestAnimationFrame(()=>{frame=undefined;record()})})
          observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded']})
          ;(window as any).__agentHandoffDiagnostic={rows,stop:()=>{observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame)}}
        })
        try {
          await row.getByRole('button', { name: 'Open Agent', exact: true }).click()
          await expect(focused).toBeVisible()
        } catch(error) {
          const state=await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {nativeTerminalViews:c.nativeTerminalViews,nativeUiViews:c.nativeUiViews,threadId:c.currentThread?.id,domTransitions:(window as any).__agentHandoffDiagnostic?.rows}})
          await writeFile(join(workspace!,'native-prompt-reconnect-agent-handoff-failure.json'),JSON.stringify(state))
          const nativeWindow=await _electronApp.browserWindow(appPage)
          const png=await nativeWindow.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
          await writeFile(join(workspace!,'native-prompt-reconnect-agent-handoff-failure.png'),Buffer.from(png,'base64'))
          throw error
        } finally { await appPage.evaluate(()=>{(window as any).__agentHandoffDiagnostic?.stop();delete (window as any).__agentHandoffDiagnostic}) }
      }
      const editor = owner === 'parent' ? composer : agentComposer, container = owner === 'parent' ? card : form
      for (const kind of ['edit', 'completion']) {
        const text = kind === 'edit' ? `Review the older ${owner} edit draft.` : `Review #${owner}-reconnect`
        const current = `Review the newer ${owner} ${kind} draft.`
        const controller = await delayOwnedUiHost({ directory, sessionId, workspace, kind, holdText: text }); controllers.push(controller)
        await editor.focus(); await editor.press('ControlOrMeta+a'); await appPage.keyboard.insertText(text); await expect(editor).toHaveText(text); const held = await controller.waitHeld()
        if (kind === 'edit') expect(held.result.frame.text).toBe(text)
        else expect(held.result.suggestions).toContainEqual(expect.objectContaining({ text: `#${owner}-reconnect-complete` }))
        const connection = await reconnect()
        await expect(editor).toBeEditable(); await expect(editor).toHaveText(text)
        // Exercise actual selection/replacement in Tiptap after attachment recovery.
        await editor.focus(); await editor.press('ControlOrMeta+a'); await appPage.keyboard.insertText(current)
        await expect(editor).toHaveText(current)
        expect(await controller.release()).toBe(true)
        await expect.poll(async () => (await controller.refresh()).deliveredAt).toBeTruthy()
        expect(held.reason).toBe('explicit')
        await expect.poll(async () => appPage.evaluate(text => Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).some((view: any) => view.prompt?.frame?.text === text && view.prompt?.status === 'applied'), current)).toBe(true)
        await expect(editor).toHaveText(current)
        await expect(container.getByRole('button', { name: `Complete #${owner}-reconnect`, exact: true })).toHaveCount(0)
        await readCurrent(container, current)
        expect((await context()).native.state.nativePid).toBe(boundNativePid); expect((await context()).sessionId).toBe(sessionId)
        receipts.push({ owner, kind, connection, native: controller.receipts }); await controller.close()
      }
      await openTools(container); await container.getByRole('button', { name: 'Use review template', exact: true }).click()
      await expect(editor).toHaveText('Review release notes before merging.'); await readCurrent(container, 'Review release notes before merging.')
      await editor.press('ControlOrMeta+a'); await editor.press('Backspace'); await expect(editor).toHaveText('')
      await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-theme-edits.json'), 'utf8')).at(-1)?.result).toMatchObject({ text: '', cursor: 0 })
      await container.getByRole('button', { name: 'Suggest next step', exact: true }).click()
      await expect(editor.locator('.claude-prompt-suggestion')).toHaveText('Review the remaining release checklist.')
      await editor.focus(); await editor.press('Tab'); await expect(editor).toHaveText('Review the remaining release checklist.')
      await editor.focus(); await editor.press('ControlOrMeta+a'); await appPage.keyboard.insertText(`Review #current-${owner}`)
      await container.getByRole('button', { name: `Complete #current-${owner}`, exact: true }).click()
      await expect(editor).toHaveText(`Review #current-${owner}-complete`)
      const tools = container.getByRole('button', { name: 'Session tools', exact: true }); if (await tools.getAttribute('aria-expanded') === 'true') await tools.click()
      const nativeWindow=await _electronApp.browserWindow(appPage)
      for(const [width,height] of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(editor).toHaveText('Review #current-agent-complete');await expect(container.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport({ratio:1});const png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});await writeFile(testInfo.outputPath('native-agent-reconnect-'+width+'.png'),Buffer.from(png,'base64'))}
      if (owner === 'parent') parentDraft = `Review #current-${owner}-complete`
      else { await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click(); await expect(composer).toHaveText(parentDraft) }
    }
    await expect(composer).toHaveText(parentDraft)
    await readCurrent(card,parentDraft)
    await writeFile(join(workspace!,'native-agent-reconnect-receipts.json'),JSON.stringify(receipts))
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
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeAgentPromptReconnect: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
