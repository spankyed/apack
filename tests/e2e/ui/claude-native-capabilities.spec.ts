import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
// Playwright injects FORCE_COLOR=1 for its reporter; set the intended parent environment before Electron starts.
if (process.env.CLAUDE_RESEARCH_TERMINAL_CAPABILITIES === 'disabled') process.env.FORCE_COLOR = '0'
else if (['default', 'no-color'].includes(process.env.CLAUDE_RESEARCH_TERMINAL_CAPABILITIES ?? '')) delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('honors explicit native color and hyperlink capabilities in the composer', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
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
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
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
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
  const dimensions = await input.evaluate(element => { const root = element.closest('.xterm')!, screen = root.querySelector('.xterm-screen')!.getBoundingClientRect(), style = getComputedStyle(root.querySelector('.xterm-char-measure-element')!); const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!; context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; return { cols: Math.round(screen.width / context.measureText('W').width), rows: 200 } })
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('AppNativeMain ' + sessionId) === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain ' + sessionId)
    await expect(main).toContainText('Second native status line')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain ' + sessionId)
  const { capabilityProfile } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const disabled = capabilityProfile === 'disabled', colorDisabled = disabled || capabilityProfile === 'no-color'
  const composer = card.locator('[contenteditable="true"]')
  const tools = card.getByRole('button', { name: 'Session tools', exact: true })
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
  const markdown = card.locator('[data-native-markdown-ansi]').filter({ hasText: 'Review' })
  await expect(markdown).toContainText('current session')
  await composer.fill('Keep this draft while reviewing session details.')
  const nativeMarkdown = async () => appPage.evaluate(() => {
    const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
    const pending = Object.values(state.nativeUiViews).filter((view: any) => view.threadId === state.currentThread?.id && view.state?.status === 'live').map((view: any) => view.state.tree)
    while (pending.length) { const node: any = pending.pop(); if (!node) continue; if (node.kind === 'markdown' && node.text.includes('current session')) return node; if (Array.isArray(node.children)) pending.push(...node.children) }
  })
  await expect.poll(async () => (await nativeMarkdown())?.nativeAnsi).toBeTruthy()
  const original = await nativeMarkdown()
  await writeFile(join(workspace!, 'native-capabilities-render.json'), JSON.stringify({ capabilityProfile, original }))
  expect(original.nativeAnsi.includes('\x1b]8;')).toBe(!disabled)
  // Native terminal rendering may retain emphasis when color is disabled; inspect paint codes separately.
  // eslint-disable-next-line no-control-regex -- Match or reject native terminal control sequences explicitly.
  const paint = Array.from(original.nativeAnsi.matchAll(/\x1b\[([0-9;]*)m/g) as Iterable<RegExpMatchArray>).some(match => match[1].split(';').map(Number).some(code => code >= 30 && code <= 38 || code >= 40 && code <= 48 || code >= 90 && code <= 97 || code >= 100 && code <= 107))
  expect(paint).toBe(!colorDisabled)
  expect(await markdown.textContent()).toBe(stripVTControlCharacters(original.nativeAnsi))
  const link = markdown.getByRole('link', { name: 'session details', exact: true })
  if (disabled) await expect(link).toHaveCount(0)
  else {
    await expect(link).toBeVisible(); await link.click()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-capability-link.json'), 'utf8').catch(() => '{}'))).toMatchObject({ href: 'https://example.com/native-session-details' })
  }
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(markdown).toBeInViewport()
    await expect(composer).toHaveText('Keep this draft while reviewing session details.')
    await expect(composer).toBeInViewport()
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-capabilities-' + capabilityProfile + '-' + height + '.png') })
  }
  const priorReplies = (await context()).messages.filter((message: any) => message.text?.includes('Fixture completed.')).length
  await composer.fill('Continue the original native session after reviewing details.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.text?.includes('Fixture completed.')).length).toBeGreaterThan(priorReplies)
  expect((await context()).sessionId).toBe(sessionId)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const results = async () => (await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  const prior = (await results()).length
  await composer.fill('Continue after the native capability review.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await results()).length).toBe(prior + 1)
  expect((await results()).at(-1)).toMatchObject({ sessionId, subtype: 'success' })
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-capabilities-app.json'), JSON.stringify({ capabilityProfile, original, disabled, sessionId, boundNativePid }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeCapabilityOverrides: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
