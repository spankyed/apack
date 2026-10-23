import { readFile, writeFile, rename } from 'node:fs/promises'
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
test.afterEach(async ({ appPage, electronApp }, testInfo) => {
  if (!workspace || testInfo.status === testInfo.expectedStatus) return
  try {
    const context = await appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, claude: state.currentThread?.context?.claudeCode, native: state.nativeTerminalViews } })
    await writeFile(join(workspace, 'native-mcp-url-final-failure.json'), JSON.stringify({ context, text: await appPage.locator('body').innerText() }, null, 2))
    const window = await electronApp.browserWindow(appPage), size = appPage.viewportSize() ?? { width: 1100, height: 900 }
    const png = await window.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), size)
    await writeFile(testInfo.outputPath('native-mcp-url-final-failure.png'), Buffer.from(png, 'base64'))
  } catch { /* Keep the original assertion/trace if teardown has already disconnected the app. */ }
})
test('uses original terminal URL decisions, waiting and completion with cancellation recovery', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(180000)
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




  const modern = process.env.CLAUDE_RESEARCH_MCP_MODERN === '1'
  const retry = process.env.CLAUDE_RESEARCH_NATIVE_MCP_URL_RETRY === '1'
  const draft = 'Keep my release notes while I confirm browser input.'
  const steps: unknown[] = [], captures: string[] = [], geometry: unknown[] = []
  const nativeWindow = await electronApp.browserWindow(appPage)
  const panel = appPage.getByTestId('native-mcp-url')
  const frame = async () => (await context()).native?.state?.mcpUrl
  async function capturePhase(phase: 'prompt' | 'waiting' | 'opened') {
    for (const [width, height] of [[1100, 900], [680, 600]]) {
      await appPage.setViewportSize({ width, height })
      for (const control of [panel.locator('h3'), panel.locator('code'), ...await panel.getByRole('button').all(), card.getByRole('button', { name: 'Send', exact: true })]) await expect(control).toBeInViewport({ ratio: 1 })
      const bounds = await panel.boundingBox(); expect(bounds).toBeTruthy(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); geometry.push({ phase, width, height, bounds })
      await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
      const captured = await nativeWindow.evaluate(async (window, size) => { const image = await window.webContents.capturePage({ x: 0, y: 0, ...size }); return { size: image.getSize(), png: image.toPNG().toString('base64') } }, { width, height })
      expect(captured.size).toEqual({ width, height }); const name = 'native-mcp-url-' + width + '-' + phase + '.png'; await writeFile(testInfo.outputPath(name), Buffer.from(captured.png, 'base64')); captures.push(name)
      await expect(composer).toHaveText(draft)
    }
  }
  const cases = (modern ? ['modern-confirm', 'modern-decline', 'modern-cancel', 'modern-open-cancel', 'modern-pause'] : retry ? ['url-retry', 'url-retry-decline', 'url-retry-cancel', 'url-retry-waiting-cancel', 'url-retry-pause'] : ['url-decline', 'url-cancel', 'url-skip', 'url-waiting-cancel', 'url-complete', 'url-pause']).map((scenario, index) => ({ phase: index + (modern ? 19 : retry ? 14 : 8), scenario }))
  for (const step of cases) {
    await appPage.setViewportSize({ width: 1100, height: 900 })
    await writeFile(join(workspace!, 'mcp-elicitation-phase.txt'), String(step.phase))
    await composer.fill('Review release input ' + step.phase + '.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => readFile(join(workspace!, 'mcp-elicitation-model-ready-' + step.phase), 'utf8').then(() => true, () => false)).toBe(true)
    await composer.fill(draft)
    const savedDocument = await composer.evaluate(element => (element as any).editor.state.doc.toJSON())
    const savedSelection = await composer.evaluate(element => (element as any).editor.state.selection.toJSON())
    await writeFile(join(workspace!, 'mcp-elicitation-model-release-' + step.phase), 'Draft retained before original MCP URL request')
    const approval = appPage.getByTestId('native-mcp__research__echo-approval')
    await expect(approval).toBeVisible({ timeout: 20000 }); await expect(approval.locator('button.approve')).toBeEnabled(); await approval.locator('button.approve').click(); await expect(approval).toBeHidden()
    await expect(panel).toBeVisible({ timeout: 15000 }); await expect(panel.getByRole('button', { name: modern ? "I'm done, continue" : 'Accept', exact: true })).toBeEnabled()
    const original = await frame(); expect(original.serverName).toBe('research'); expect(original.phase).toBe('prompt'); expect(original.userConfirmsCompletion).toBe(modern); await expect(panel.locator('code')).toHaveText('https://example.invalid/release-review'); expect(await panel.locator('a').count()).toBe(0)
    if (modern) {
      expect(original.kind).toBe('mcp_elicitation')
      if (step.scenario === 'modern-decline') await panel.getByRole('button', { name: 'Decline', exact: true }).click()
      else if (step.scenario === 'modern-cancel') await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      else if (step.scenario === 'modern-pause') await card.getByTitle('Pause agent work', { exact: true }).click()
      else {
        if (step.scenario === 'modern-confirm') await capturePhase('prompt')
        await panel.getByRole('button', { name: 'Open in browser', exact: true }).click()
        await expect(panel.getByRole('button', { name: 'Open again', exact: true })).toBeEnabled()
        expect((await frame())?.phase).toBe('prompt'); expect((await frame())?.id).toBe(original.id)
        if (step.scenario === 'modern-confirm') {
          await panel.getByRole('button', { name: 'Open again', exact: true }).click()
          await expect.poll(() => readFile(join(workspace!, 'native-mcp-url-browser.jsonl'), 'utf8').then(text => text.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.phase === step.phase).length)).toBe(2)
          const receipts = (await readFile(join(workspace!, 'mcp-elicitation-receipts.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); const pending = receipts.filter(row => row.method === 'tools/call' && row.params.arguments.phase === step.phase)
          expect(pending).toHaveLength(1); expect(pending[0].params.inputResponses).toBeUndefined()
          await expect(panel.getByRole('button', { name: "I'm done, continue", exact: true })).toBeEnabled(); await capturePhase('opened')
          await panel.getByRole('button', { name: "I'm done, continue", exact: true }).click()
        } else await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    } else if (retry) {
      expect(original.kind).toBe('mcp_url_elicitation')
      if (step.scenario === 'url-retry-decline') await panel.getByRole('button', { name: 'Decline', exact: true }).click()
      else if (step.scenario === 'url-retry-cancel') await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      else if (step.scenario === 'url-retry-pause') await card.getByTitle('Pause agent work', { exact: true }).click()
      else {
        if (step.scenario === 'url-retry') await capturePhase('prompt')
        await panel.getByRole('button', { name: 'Accept', exact: true }).click()
        await expect.poll(async () => (await frame())?.phase).toBe('waiting')
        expect((await frame())?.id).toBe(original.id); expect((await frame())?.kind).toBe('mcp_url_elicitation')
        await expect(panel.getByRole('button', { name: 'Retry now', exact: true })).toBeEnabled()
        if (step.scenario === 'url-retry') { await capturePhase('waiting'); await panel.getByRole('button', { name: 'Retry now', exact: true }).click() }
        else await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    } else if (step.scenario === 'url-decline') await panel.getByRole('button', { name: 'Decline', exact: true }).click()
    else if (step.scenario === 'url-cancel') await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    else if (step.scenario === 'url-pause') await card.getByTitle('Pause agent work', { exact: true }).click()
    else {
      if (step.scenario === 'url-skip') await capturePhase('prompt')
      await panel.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect.poll(async () => (await frame())?.kind).toBe('mcp_elicitation_waiting')
      await expect(panel.getByRole('button', { name: 'Skip confirmation', exact: true })).toBeEnabled()
      const waiting = await frame(); expect(waiting.phase).toBe('waiting'); expect(waiting.id).not.toBe(original.id)
      if (step.scenario === 'url-skip') {
        await capturePhase('waiting')
        await panel.getByRole('button', { name: 'Reopen URL', exact: true }).click()
        await expect.poll(() => readFile(join(workspace!, 'native-mcp-url-browser.jsonl'), 'utf8').then(text => text.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.phase === step.phase).length)).toBe(2)
        await expect(panel.getByRole('button', { name: 'Skip confirmation', exact: true })).toBeEnabled()
        await panel.getByRole('button', { name: 'Skip confirmation', exact: true }).click()
      } else if (step.scenario === 'url-waiting-cancel') await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      else {
        const completionPath = join(workspace!, 'mcp-url-completion-' + step.phase)
        await writeFile(completionPath + '.next', 'release-review-foreign'); await rename(completionPath + '.next', completionPath)
        await expect.poll(() => readFile(join(workspace!, 'native-debug.log'), 'utf8').then(text => text.includes('Received elicitation completion notification: release-review-foreign'))).toBe(true)
        expect((await frame())?.id).toBe(waiting.id); await expect(panel).toBeVisible()
        await writeFile(completionPath + '.next', 'release-review-' + step.phase); await rename(completionPath + '.next', completionPath)
      }
    }
    await expect(panel).toBeHidden({ timeout: 15000 }); await expect.poll(async () => (await context()).native?.state?.busy, { timeout: 15000 }).toBe(false)
    expect((await context()).native.state.nativePid).toBe(boundNativePid); expect((await context()).native.state.status).toBe('live')
    await expect(composer).toHaveText(draft); expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument); expect(await composer.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual(savedSelection)
    if (step.scenario.endsWith('-pause')) expect((await context()).native.state.lastTurn?.reason).toBe('aborted')
    steps.push({ ...step, nativeInterrupted: step.scenario.endsWith('-pause') ? (await context()).native.state.lastTurn?.reason === 'aborted' : undefined, id: original.id, revision: original.revision, retainedDraft: true, nativePid: boundNativePid })
  }
  await writeFile(join(workspace!, 'mcp-elicitation-phase.txt'), '0')
  const turnsBeforeRecovery = (await context()).turns
  await composer.fill('Continue after cancelling the release input.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.busy, { timeout: 15000 }).toBe(false)
  await expect.poll(async () => (await context()).turns, { timeout: 15000 }).toBeGreaterThan(turnsBeforeRecovery)
  expect((await context()).native.state.nativePid).toBe(boundNativePid); expect((await context()).sessionId).toBe(sessionId)
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue reviewing the same release session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-mcp-url-app-proof.json'), JSON.stringify({ steps, captures, geometry, originalModern: modern, openedWithoutAnswer: modern ? true : undefined, originalRetry: retry, wrongCompletionIgnored: !retry && !modern, sessionId, boundNativePid, retainedDraft: true, originalNativeRecovery: true, recoveredSameSession: true }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeMcpUrlApp: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
