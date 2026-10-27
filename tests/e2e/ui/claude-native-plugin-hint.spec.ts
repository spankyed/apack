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
test('preserves original plugin recommendation choices and everyday composing', async ({ app, appPage, electronApp }, testInfo) => {
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


  const { pluginHint: decision } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  expect(['yes', 'no', 'disable', 'timeout']).toContain(decision)
  const nativeWindow = await electronApp.browserWindow(appPage), captures: string[] = []
  await nativeWindow.evaluate(window => { window.show(); window.focus() }); await appPage.bringToFront()
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially('Run the release check and report its result.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const approval = appPage.getByTestId('native-bash-approval')
  await expect(approval).toBeVisible({ timeout: 15000 })
  await expect(approval.getByTestId('native-bash-command')).toContainText('document-skills@anthropic-agent-skills')
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click(); await expect(approval).toBeHidden()
  const notice = section.getByRole('region', { name: 'Claude plugin recommendation', exact: true })
  await expect(notice).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  const shown = (await context()).native.state.notice
  expect(shown.kind).toBe('plugin_hint'); expect(shown.pluginName).toBe('document-skills'); expect(shown.marketplaceName).toBe('anthropic-agent-skills')
  expect(shown.choices.map((choice: any) => choice.value)).toEqual(['yes', 'no', 'disable'])
  const draft = 'Keep the release review draft.'
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially(draft)
  const retained = await composer.evaluate(element => ({ document: (element as any).editor.state.doc.toJSON(), selection: (element as any).editor.state.selection.toJSON() }))
  const capture = async (name: string, width: number, height: number) => {
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    const image = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height })
    const file = testInfo.outputPath('native-plugin-hint-' + name + '-' + width + '.png'); await writeFile(file, Buffer.from(image, 'base64')); captures.push(file)
  }
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    for (const choice of shown.choices) await expect(notice.getByRole('button', { name: choice.label, exact: true })).toBeInViewport({ ratio: 1 })
    await expect(composer).toHaveText(draft); await expect(composer).toBeInViewport({ ratio: 1 })
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 })
    const visibility = await composer.evaluate(element => {
      const area = element.closest('[data-testid="composer-editor-area"]')!.getBoundingClientRect(), card = element.closest('[data-onboarding-id="agent-chat-input"]')!.getBoundingClientRect()
      const status = element.closest('[data-onboarding-id="agent-chat-input"]')!.querySelector('[data-testid="composer-native-status"]')?.getBoundingClientRect()
      const range = document.createRange(); range.selectNodeContents(element)
      return { rects: [...range.getClientRects()].map(rect => ({ top: rect.top, bottom: rect.bottom })), top: Math.max(area.top, card.top, status?.bottom ?? 0, 0), bottom: Math.min(area.bottom, card.bottom, innerHeight) }
    })
    expect(visibility.rects.length).toBeGreaterThan(0)
    for (const rect of visibility.rects) { expect(rect.top).toBeGreaterThanOrEqual(visibility.top - 1); expect(rect.bottom).toBeLessThanOrEqual(visibility.bottom + 1) }
    await capture('choices', width, height)
    await notice.getByRole('button', { name: 'About this plugin', exact: true }).click()
    const details = appPage.getByRole('dialog', { name: 'About this plugin', exact: true }); await expect(details).toBeVisible()
    const reading = () => details.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return { text: [...element.querySelectorAll('p')].map(p => p.textContent), visible: [...element.querySelectorAll('p')].flatMap((p, index) => { const rect = p.getBoundingClientRect(); return rect.top >= Math.max(0, bounds.top) - 1 && rect.bottom <= Math.min(innerHeight, bounds.bottom) + 1 ? [index] : [] }), scrollHeight: element.scrollHeight }
    })
    const first = await reading(); expect(first.text).toEqual(shown.paragraphs); const read = new Set(first.visible)
    if (read.size < first.text.length) { await details.hover(); await appPage.mouse.wheel(0, first.scrollHeight); await expect.poll(async () => { for (const index of (await reading()).visible) read.add(index); return read.size }).toBe(first.text.length) }
    expect(read.size).toBe(shown.paragraphs.length)
    await expect(details.getByRole('button', { name: 'Close plugin details', exact: true })).toBeInViewport({ ratio: 1 })
    await capture('details', width, height)
    await details.getByRole('button', { name: 'Close plugin details', exact: true }).click()
    await composer.focus()
    expect(await composer.evaluate(element => ({ document: (element as any).editor.state.doc.toJSON(), selection: (element as any).editor.state.selection.toJSON() }))).toEqual(retained)
  }
  const selected = shown.choices.find((choice: any) => choice.value === decision)
  if (decision === 'timeout') { await notice.getByRole('button', { name: 'About this plugin', exact: true }).click(); await expect(appPage.getByRole('dialog', { name: 'About this plugin', exact: true })).toBeVisible(); await expect(notice).toBeHidden({ timeout: 40000 }) }
  else if (decision === 'no') { const button = notice.getByRole('button', { name: selected.label, exact: true }); await button.focus(); await button.press('Escape') }
  else await notice.getByRole('button', { name: selected.label, exact: true }).click()
  await expect(notice).toBeHidden(); await expect(appPage.getByRole('dialog', { name: 'About this plugin', exact: true })).toHaveCount(0)
  if (decision === 'timeout') for (const [width, height] of [[1100, 900], [680, 600]]) { await appPage.setViewportSize({ width, height }); await expect(composer).toHaveText(draft); await expect(composer).toBeInViewport({ ratio: 1 }); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 }); await capture('expired', width, height) }
  const settings = () => readFile(join(workspace!, '.claude/settings.json'), 'utf8').then(JSON.parse)
  if (decision === 'yes') await expect.poll(async () => (await settings()).enabledPlugins?.['document-skills@anthropic-agent-skills'], { timeout: 15000 }).toBe(true)
  await composer.focus()
  expect(await composer.evaluate(element => ({ document: (element as any).editor.state.doc.toJSON(), selection: (element as any).editor.state.selection.toJSON() }))).toEqual(retained)
  expect((await context()).native.state.nativePid).toBe(boundNativePid); expect((await context()).sessionId).toBe(sessionId)
  await writeFile(join(workspace!, 'native-plugin-hint-app.json'), JSON.stringify({ decision, shown, captures, retained, draftRetained: true, selectionRetained: true, sessionId, boundNativePid, originalEscapeDefer: decision === 'no', originalTimeout: decision === 'timeout' }, null, 2))
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(retained.document)
  await composer.focus(); await composer.press('Control+a'); await composer.pressSequentially('Continue the release review in the same session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-plugin-hint-recovery.json'), JSON.stringify(await context(), null, 2))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativePluginHint: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
