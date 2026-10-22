import { readFile, writeFile } from 'node:fs/promises'
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
test('collects native MCP form and URL input with retained drafts and interruption recovery', async ({ app, appPage, electronApp }, testInfo) => {
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




  // Stop the native view before exercising the distinct print-owner MCP input channel.
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const cases: { phase: number; scenario: string; prompt: string }[] = JSON.parse(await readFile(join(workspace!, 'mcp-elicitation-steps.json'), 'utf8'))
  const nativeWindow = await electronApp.browserWindow(appPage), steps: unknown[] = [], captures: string[] = []
  const draft = 'Keep my migration notes while I confirm reviewer details.'
  for (const step of cases) {
    await appPage.setViewportSize({ width: 1100, height: 900 })
    await writeFile(join(workspace!, 'mcp-elicitation-phase.txt'), String(step.phase))
    await composer.fill(step.prompt); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => readFile(join(workspace!, 'mcp-elicitation-model-ready-' + step.phase), 'utf8').then(() => true, () => false)).toBe(true)
    await composer.fill(draft)
    const savedDocument = await composer.evaluate(element => (element as any).editor.state.doc.toJSON())
    const savedSelection = await composer.evaluate(element => (element as any).editor.state.selection.toJSON())
    await writeFile(join(workspace!, 'mcp-elicitation-model-release-' + step.phase), 'Draft is ready')
    await expect.poll(async () => (await context()).claude.pendingControlRequest?.toolName).toBe('mcp__research__echo')
    await appPage.locator('.approval-buttons').getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await context()).claude.pendingElicitation?.requestId).toBeTruthy()
    const pending = (await context()).claude.pendingElicitation
    expect(pending.mode).toBe(step.scenario.startsWith('url-') ? 'url' : 'form')
    // The original schema is exposed as a normal app input; fixture-only controls are absent.
    const form = appPage.locator('form').filter({ has: appPage.getByLabel('Reviewer email') })
    if (pending.mode === 'form') {
      await expect(form).toBeVisible()
      if (step.scenario === 'form-accept') {
        await form.getByLabel('Reviewer email').fill('invalid')
        await form.getByRole('button', { name: 'Submit', exact: true }).click()
        await expect(form.getByRole('alert')).toBeVisible()
        expect((await context()).claude.pendingElicitation.requestId).toBe(pending.requestId)
        await form.getByLabel('Reviewer email').fill('reviewer@example.invalid')
      }
    }
    if (['form-accept', 'url-accept'].includes(step.scenario)) {
      for (const [width, height] of [[1100, 900], [680, 600]]) {
        await appPage.setViewportSize({ width, height })
        const button = pending.mode === 'form' ? form.getByRole('button', { name: 'Submit', exact: true }) : appPage.getByRole('button', { name: 'Completed', exact: true })
        await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport()
        expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
        const name = 'mcp-input-' + pending.mode + '-' + width + '.png'
        await appPage.evaluate(() => document.fonts.ready)
        const captured = await nativeWindow.evaluate(async (window, size) => { const image = await window.webContents.capturePage({ x: 0, y: 0, ...size }); return image.toPNG().toString('base64') }, { width, height })
        await writeFile(testInfo.outputPath(name), Buffer.from(captured, 'base64')); captures.push(name)
      }
    }
    if (step.scenario === 'form-interrupt') {
      const priorPid = pending.ownerPid
      await card.getByTitle('Pause agent work', { exact: true }).click()
      await expect.poll(async () => (await context()).claude.pendingElicitation).toBeFalsy()
      await expect.poll(() => readFile(join(workspace!, 'native-exits.jsonl'), 'utf8').then(text => text.trim().split('\n').map(line => JSON.parse(line)).some(row => row.pid === priorPid)), { timeout: 15000 }).toBe(true)
    } else if (pending.mode === 'form') {
      await form.getByRole('button', { name: step.scenario === 'form-accept' ? 'Submit' : step.scenario === 'form-decline' ? 'Decline' : 'Cancel', exact: true }).click()
    } else {
      await appPage.getByRole('button', { name: step.scenario === 'url-accept' ? 'Completed' : step.scenario === 'url-decline' ? 'Decline' : 'Cancel', exact: true }).click()
    }
    await expect.poll(async () => (await context()).claude.pendingElicitation, { timeout: 15000 }).toBeFalsy()
    if (step.scenario !== 'form-interrupt') await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
    await expect(composer).toHaveText(draft)
    expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
    expect(await composer.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual(savedSelection)
    expect((await context()).sessionId).toBe(sessionId)
    steps.push({ phase: step.phase, scenario: step.scenario, requestId: pending.requestId, ownerPid: pending.ownerPid, retainedDraft: true })
  }
  await writeFile(join(workspace!, 'mcp-elicitation-phase.txt'), '0')
  await composer.fill('Continue after cancelling the release input.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'mcp-elicitation-app-proof.json'), JSON.stringify({ steps, captures, retainedDraft: true, recoveredSameSession: true, sessionId }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', mcpElicitationApp: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
