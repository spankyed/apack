import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-focus-context-failure.png') }).catch(() => {}) })
test('mirrors native fullscreen focus hidden-message context', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { focusContext } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!focusContext, 'Explicit private native duration Settings profile required')
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await appPage.setViewportSize({ width: 1100, height: 900 })
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
  const dimensions = () => input.evaluate(element => { const root = element.closest('.xterm')!, box = root.querySelector('.xterm-screen')!.getBoundingClientRect(), font = getComputedStyle(root.querySelector('.xterm-char-measure-element')!), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!; context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`; return Math.round(box.width / context.measureText('W').width) })
  await expect.poll(dimensions).toBeGreaterThan(1)
  const terminal = new Terminal({ cols: await dimensions(), rows: 200, allowProposedApi: true })
  let lastSequence = 0, lastScreen = ''
  async function screen() {
    if (await input.isVisible()) { const cols = await dimensions(); if (cols > 1 && cols !== terminal.cols) terminal.resize(cols, 200) }
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
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('Workspace ready') === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    const composer = card.locator('[contenteditable="true"]')
    const source = async () => JSON.parse(await readFile(join(workspace!, 'native-focus-context.json'), 'utf8').catch(() => '{}'))
    async function mirror() { await section.getByRole('button', { name: 'Back to conversation', exact: true }).click(); await expect(composer).toBeVisible() }
    const enterNative = () => section.getByRole('button', { name: 'Use native interface', exact: true }).click()
    await mirror(); await composer.fill('Summarize the release notes in two short paragraphs.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).messages.some((message: any) => message.text === 'Second native text block.')).toBe(true)
    let approved = false
    await expect.poll(async () => { const approval = appPage.getByRole('region', { name: 'Bash approval', exact: true }); if (!approved && await approval.isVisible()) { approved = true; await approval.getByRole('button', { name: 'Allow once', exact: true }).click() } return (await context()).native.state.busy }, { timeout: 15000 }).toBe(false)
    const draft = 'Keep this release-review draft while changing focus view.'
    await composer.fill(draft); await enterNative()
    await input.pressSequentially('/focus'); await input.press('Enter')
    await expect.poll(screen).toContain('Focus view enabled')
    await expect.poll(async () => (await source()).frames?.some((frame: any) => frame.hiddenCount > 0)).toBe(true)
    const focused = await source(); expect(focused.error).toBeUndefined()
    expect(focused.display.active).toBe(true)
    await mirror(); await expect(composer).toHaveText(draft)
    await expect.poll(async () => (await context()).native.state.focus?.active).toBe(true)
    const active = await context(), nativeHidden = new Set(active.native.state.focus.hidden)
    const omitted = active.messages.find((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.' && nativeHidden.has(message.context?.cliUuid))
    expect(omitted).toBeTruthy()
    await expect(appPage.locator(`[data-chat-message="${omitted.id}"]`)).toHaveCount(0)
    await expect(appPage.locator(`[data-native-assistant="${omitted.context.cliUuid}"]`)).toHaveCount(0)
    const nativeGroup = focused.display.selected.find((row: any) => row.type === 'collapsed_read_search')
    expect(nativeGroup).toBeTruthy()
    const group = appPage.locator(`[data-native-tool-group="${nativeGroup.uuid}"]`)
    await expect(group).toBeVisible()
    await group.getByRole('button', { name: 'Expand tool activity', exact: true }).click()
    await expect(group.getByRole('button', { name: 'Collapse tool activity', exact: true })).toBeVisible()
    await group.getByRole('button', { name: 'Collapse tool activity', exact: true }).click()
    await expect(composer).toHaveText(draft)
    const hidden = appPage.locator('[data-native-placement="TurnDuration"]').filter({ hasText: /messages? hidden/ }).last()
    await expect(hidden).toBeVisible()
    for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) { await appPage.setViewportSize(size); await hidden.scrollIntoViewIfNeeded(); await expect(hidden).toBeInViewport(); await expect(composer).toHaveText(draft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport(); await appPage.screenshot({ path: testInfo.outputPath('native-focus-context-' + size.width + '.png') }) }
    await enterNative(); await input.pressSequentially('/focus'); await input.press('Enter')
    await expect.poll(screen).toContain('Focus view disabled')
    await expect.poll(async () => { const s = await source(); return s.frames?.length > 0 && s.frames.every((frame: any) => frame.hiddenCount === 0) }).toBe(true)
    const restored = await source(); await mirror();
    await expect.poll(async () => (await context()).native.state.focus?.active).toBe(false)
    await expect(appPage.locator(`[data-chat-message="${omitted.id}"]`)).toHaveCount(1)
    expect((await context()).messages.find((message: any) => message.id === omitted.id)?.context?.cliUuid).toBe(omitted.context.cliUuid)
    await expect(composer).toHaveText(draft); await expect(appPage.locator('[data-native-placement="TurnDuration"]').filter({ hasText: /messages? hidden/ })).toHaveCount(0)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!, 'native-focus-context-proof.json'), JSON.stringify({ focused, restored, omitted, nativeHidden: [...nativeHidden], originalGroupInteraction: true, nativeGroupId: nativeGroup.uuid }))
    await enterNative(); await section.getByRole('button', { name: 'Stop session', exact: true }).click(); await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
    const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
    await composer.fill('Continue the same session after native focus view.'); await card.getByRole('button', { name: 'Send', exact: true }).click(); await expect.poll(async () => (await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeFocusContext: true, nativeFocusProjection: true, nativeFocusGroup: true, nativeFocusToggle: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
  } finally { await writeFile(join(workspace!, 'native-focus-context-screen.txt'), lastScreen); terminal.dispose() }
})
