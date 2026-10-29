import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('keeps delayed native read and suggestion requests bound to their retired owner', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
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
  const directory = brokerRows.at(-1).directory, controllers: any[] = []
  const focused = appPage.getByRole('region', { name: 'Focused Agent conversation', exact: true })
  const form = focused.getByRole('form', { name: 'Agent message', exact: true }), agentComposer = form.locator('[contenteditable="true"]')
  const proposal = 'Review the remaining release checklist.'
  async function openAgent() { await row.getByRole('button', { name: 'Open Agent', exact: true }).click(); await expect(focused).toBeVisible(); await expect(agentComposer).toBeEditable() }
  async function returnParent() { await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click(); await expect(card).toBeVisible() }
  async function openTools(container: typeof card) { const button = container.getByRole('button', { name: 'Session tools', exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click() }
  async function clearDraft(editor: typeof composer) {
    if ((await editor.textContent())?.trim()) {
      await editor.press('Meta+a'); await editor.press('Backspace'); await expect(editor).toHaveText('')
      await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-theme-edits.json'), 'utf8')).at(-1)?.result).toMatchObject({ text: '', cursor: 0 })
    }
  }
  async function readRefused(controller: any) {
    await expect.poll(async () => (await controller.refresh()).respondedAt).toBeTruthy()
    expect(controller.receipts.at(-1)).toMatchObject({ reason: 'explicit', status: 200, result: { text: '', cursor: 0 } })
  }
  async function suggestRefused(controller: any) {
    await expect.poll(async () => (await controller.refresh()).respondedAt).toBeTruthy()
    expect(controller.receipts.at(-1)).toMatchObject({ reason: 'explicit', status: 200, result: { shown: false } })
  }
  try {
    const read = await delayOwnedUiHost({ directory, sessionId, workspace, kind: 'read', holdText: 'read current draft' }); controllers.push(read)
    await composer.fill('Keep the private parent review wording.'); await openTools(card)
    await card.getByRole('button', { name: 'Read current draft', exact: true }).click(); await read.waitHeld()
    await openAgent(); await agentComposer.fill('Keep the private worker review wording.')
    expect(await read.release()).toBe(true); await readRefused(read)
    await expect(agentComposer).toHaveText('Keep the private worker review wording.')
    await read.arm('read worker draft'); await openTools(form)
    await form.getByRole('button', { name: 'Read current draft', exact: true }).click(); await read.waitHeld()
    await returnParent(); await expect(composer).toHaveText('Keep the private parent review wording.')
    await composer.fill('Keep the newer private parent wording.')
    expect(await read.release()).toBe(true); await readRefused(read)
    await expect(composer).toHaveText('Keep the newer private parent wording.'); await read.close()

    await clearDraft(composer)
    const suggest = await delayOwnedUiHost({ directory, sessionId, workspace, kind: 'suggest', holdText: proposal }); controllers.push(suggest)
    await openTools(card); await card.getByRole('button', { name: 'Suggest next step', exact: true }).click(); await suggest.waitHeld()
    await openAgent(); await expect(agentComposer).toHaveText('Keep the private worker review wording.'); await clearDraft(agentComposer)
    expect(await suggest.release()).toBe(true); await suggestRefused(suggest)
    await expect(agentComposer).toHaveText(''); await expect(agentComposer.locator('.claude-prompt-suggestion')).toHaveCount(0)
    await suggest.arm(proposal); await openTools(form)
    await form.getByRole('button', { name: 'Suggest next step', exact: true }).click(); await suggest.waitHeld()
    await returnParent(); await expect(composer).toHaveText('')
    expect(await suggest.release()).toBe(true); await suggestRefused(suggest)
    await expect(composer.locator('.claude-prompt-suggestion')).toHaveCount(0); await suggest.close()

    await openAgent(); await openTools(form)
    await expect(form.getByRole('button', { name: 'Send to Agent', exact: true })).toBeDisabled()
    await form.getByRole('button', { name: 'Suggest next step', exact: true }).click()
    await expect(agentComposer.locator('.claude-prompt-suggestion')).toHaveText(proposal)
    await agentComposer.focus(); await agentComposer.press('Tab'); await expect(agentComposer).toHaveText(proposal)
    await form.getByRole('button', { name: 'Read current draft', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-read.json'), 'utf8').catch(() => 'null'))).toMatchObject({ text: proposal, cursor: proposal.length })
    await appPage.setViewportSize({ width: 1100, height: 900 })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-fresh-agent-reverse-1100-900.png') })
    await returnParent(); await expect(composer).toHaveText(''); await openTools(card)
    await card.getByRole('button', { name: 'Suggest next step', exact: true }).click()
    await expect(composer.locator('.claude-prompt-suggestion')).toHaveText(proposal)
    await composer.focus(); await composer.press('Tab'); await expect(composer).toHaveText(proposal)
    await card.getByRole('button', { name: 'Read current draft', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-read.json'), 'utf8').catch(() => 'null'))).toMatchObject({ text: proposal, cursor: proposal.length })
    await appPage.setViewportSize({ width: 680, height: 600 })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-fresh-parent-reverse-680-600.png') })
    await writeFile(join(workspace!, 'native-prompt-reverse-receipts.json'), JSON.stringify({ read: read.receipts, suggest: suggest.receipts }))
  } finally { await writeFile(join(workspace!, 'native-prompt-reverse-partial.json'), JSON.stringify(controllers.map(controller => controller.receipts))); for (const controller of controllers.reverse()) await controller.close() }
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue the same session after the worker review.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativePromptReverseLifetime: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
