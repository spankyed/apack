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
test('preserves original model refusal choices and everyday recovery', async ({ app, appPage, electronApp }, testInfo) => {
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


  const { refusalNotice: decision } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  expect(['retry_fallback', 'edit_prompt', 'cancelled']).toContain(decision)
  const nativeWindow = await electronApp.browserWindow(appPage), captures: string[] = []
  await nativeWindow.evaluate(window => { window.show(); window.focus() }); await appPage.bringToFront()
  const prompt = 'Review the migration example.'
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially(prompt)
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const notice = section.getByRole('region', { name: 'Claude model fallback', exact: true })
  await expect(notice).toBeVisible({ timeout: 15000 })
  const shown = (await context()).native.state.notice
  expect(shown.kind).toBe('refusal_fallback_prompt'); expect(shown.originalModel).toBe('claude-opus-5'); expect(shown.fallbackModel).toBe('claude-opus-4-8')
  expect(shown.choices.map((choice: any) => choice.value)).toEqual(['retry_fallback', 'edit_prompt'])
  const original = JSON.parse(await readFile(join(workspace!, 'native-dialog-shapes.json'), 'utf8')).events.flatMap((event: any) => event.value?.open ?? []).find((item: any) => item.id === shown.id && item.kind === shown.kind)
  const retiredIds: string[] = original.payload.retractedMessageUuids
  expect(retiredIds.length).toBeGreaterThan(0)
  const hasRetired = async () => (await context()).messages.some((message: any) => message.context?.claudeTerminalMessage?.sessionId === sessionId && retiredIds.includes(message.context?.cliUuid))
  await expect.poll(hasRetired).toBe(true)
  const emptyDraft = process.env.CLAUDE_RESEARCH_REFUSAL_EMPTY_DRAFT === '1'
  expect(!emptyDraft || decision === 'edit_prompt').toBe(true)
  const draft = emptyDraft ? '' : 'Keep the release review draft.'
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially(draft)
  const editor = () => composer.evaluate(element => ({ document: (element as any).editor.state.doc.toJSON(), selection: (element as any).editor.state.selection.toJSON(), text: (element as any).editor.getText() }))
  const retained = await editor()
  const capture = async (name: string, width: number, height: number) => {
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    const image = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height })
    const file = testInfo.outputPath('native-refusal-' + decision + '-' + name + '-' + width + '.png'); await writeFile(file, Buffer.from(image, 'base64')); captures.push(file)
  }
  const geometry: unknown[] = []
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    await expect(notice.getByRole('heading', { name: shown.title, exact: true })).toBeInViewport({ ratio: 1 })
    for (const choice of shown.choices) await expect(notice.getByRole('button', { name: choice.label, exact: true })).toBeInViewport({ ratio: 1 })
    await expect(notice.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(notice.getByRole('link', { name: 'Learn more', exact: true })).toHaveAttribute('href', shown.helpUrl)
    await expect(notice.getByRole('link', { name: 'Learn more', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(composer).toHaveText(draft); await expect(composer).toBeInViewport({ ratio: 1 })
    expect(await editor()).toEqual(retained)
    geometry.push({ width, height, notice: await notice.boundingBox(), composer: await composer.boundingBox() })
    await capture('pending', width, height)
  }
  const selected = shown.choices.find((choice: any) => choice.value === decision)
  await notice.getByRole('button', { name: decision === 'cancelled' ? 'Cancel' : selected.label, exact: true }).click()
  await expect(notice).toBeHidden(); await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  await expect.poll(hasRetired).toBe(false)
  // Native refusal edit restores only an empty editor; never overwrite the draft typed while deciding.
  if (emptyDraft) await expect(composer).toHaveText(prompt)
  else expect(await editor()).toEqual(retained)
  const afterDecisionContext = await context()
  const afterDecision = await editor(), beforeContinue = (await context()).turns
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially('Summarize the accepted migration scope.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).turns).toBeGreaterThan(beforeContinue)
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  expect((await context()).sessionId).toBe(sessionId); expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).claude.sessionError).toBeUndefined()
  expect((await context()).claude.chatState).toBe('success')
  const recoveryDraft = 'Keep the final migration notes unsent.'
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially(recoveryDraft)
  const recoveryRetained = await editor()
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height }); await expect(composer).toHaveText(recoveryDraft)
    await expect(composer).toBeInViewport({ ratio: 1 }); await capture('settled', width, height)
  }
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  expect((await editor()).document).toEqual(recoveryRetained.document)
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially('Continue the migration review in the same session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  expect(await hasRetired()).toBe(false)
  const persistedRetirements=(await context()).claude.retiredNativeMessages
  expect(persistedRetirements.find((item: any) => item.sessionId === sessionId).uuids).toEqual(expect.arrayContaining(retiredIds))
  await writeFile(join(workspace!, 'native-refusal-app.json'), JSON.stringify({ decision, emptyDraft, afterDecisionContext, shown, prompt, retiredIds, persistedRetirements, captures, geometry, retained, afterDecision, recoveryRetained, sameSessionRecovery: true, sessionId, boundNativePid }, null, 2))
  await writeFile(join(workspace!, 'native-refusal-recovery.json'), JSON.stringify(await context(), null, 2))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeRefusalNotice: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
