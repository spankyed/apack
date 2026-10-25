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
test('preserves native LSP recommendation decisions and everyday composing', async ({ app, appPage, electronApp }, testInfo) => {
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




  const { lspRecommendation: decision } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  expect(['yes', 'no', 'never', 'disable', 'timeout']).toContain(decision)
  await composer.fill('Review the owned release file.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(composer).toHaveText('')
  const draft = 'Keep these release notes while reviewing code intelligence.'
  const readApproval = appPage.getByTestId('native-read-approval')
  await expect(readApproval).toBeVisible({ timeout: 15000 })
  await readApproval.getByRole('button', { name: 'Approve', exact: true }).click()
  const notice = section.getByRole('region', { name: 'Claude LSP recommendation', exact: true })
  const closeDiff = appPage.getByRole('button', { name: 'Close Diff', exact: true })
  await expect(closeDiff).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => (await readFile(join(workspace!, 'native-debug.log'), 'utf8')).includes('Found match: recommendation-review for fixture.txt')).toBe(true)
  await closeDiff.click()
  await expect(closeDiff).toHaveCount(0)
  try { await expect(notice).toBeVisible({ timeout: 20000 }) }
  catch (error) {
    await writeFile(join(workspace!, 'native-lsp-recommendation-failure.json'), JSON.stringify({ context: await context(), text: await appPage.locator('body').innerText() }))
    throw error
  }
  await composer.fill(draft)
  const savedSelection = await composer.evaluate(element => (element as any).editor.state.selection.toJSON())
  const savedDocument = await composer.evaluate(element => (element as any).editor.state.doc.toJSON())
  await expect(notice).toBeVisible()
  const shown = (await context()).native.state.notice
  expect(shown.kind).toBe('lsp_recommendation')
  const labels: Record<string, string> = { yes: 'Yes, install', no: 'No, not now', never: 'Never for this plugin', disable: 'Disable all LSP recommendations' }
  expect(shown.choices.map((choice: any) => choice.value)).toEqual(['yes', 'no', 'never', 'disable'])
  const nativeWindow = await electronApp.browserWindow(appPage), captures: string[] = []
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    for (const label of Object.values(labels)) await expect(notice.getByRole('button', { name: label, exact: true })).toBeInViewport()
    await expect(composer).toHaveText(draft)
    if (decision === 'no') {
      await notice.getByRole('button', { name: 'About this plugin', exact: true }).click()
      const details = appPage.getByRole('dialog', { name: 'About this plugin', exact: true })
      await expect(details).toBeVisible()
      const readDetails = () => details.evaluate(element => {
        const viewport = element.getBoundingClientRect()
        return { text: [...element.querySelectorAll('p')].map(p => p.textContent), visible: [...element.querySelectorAll('p')].flatMap((p, index) => { const rect = p.getBoundingClientRect(); return rect.top >= Math.max(0, viewport.top) - 1 && rect.bottom <= Math.min(window.innerHeight, viewport.bottom) + 1 ? [index] : [] }), scrollHeight: element.scrollHeight }
      })
      const initial = await readDetails(); expect(initial.text).toEqual(shown.paragraphs)
      const read = new Set(initial.visible)
      if (read.size < initial.text.length) { await details.hover(); await appPage.mouse.wheel(0, initial.scrollHeight); await expect.poll(async () => { for (const index of (await readDetails()).visible) read.add(index); return read.size }).toBe(initial.text.length) }
      expect(read.size).toBe(shown.paragraphs.length)
    }
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    const image = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height })
    const path = testInfo.outputPath('native-lsp-recommendation-' + (decision === 'no' ? 'details' : decision) + '-' + width + '.png')
    await writeFile(path, Buffer.from(image, 'base64')); captures.push(path)
    const draftVisibility = await composer.evaluate(element => {
      const area = element.closest('[data-testid="composer-editor-area"]')!.getBoundingClientRect()
      const card = element.closest('[data-onboarding-id="agent-chat-input"]')!, bounds = card.getBoundingClientRect()
      const status = card.querySelector('[data-testid="composer-native-status"]')?.getBoundingClientRect()
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), rects: { top: number; bottom: number; left: number; right: number }[] = []
      let node: Node | null
      while ((node = walker.nextNode())) { if (!node.textContent?.trim()) continue; const range = document.createRange(); range.selectNodeContents(node); rects.push(...[...range.getClientRects()].map(rect => ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }))) }
      return { rects, top: Math.max(area.top, bounds.top, status?.bottom ?? 0, 0), bottom: Math.min(area.bottom, bounds.bottom, window.innerHeight), left: Math.max(area.left, bounds.left), right: Math.min(area.right, bounds.right) }
    })
    expect(draftVisibility.rects.length).toBeGreaterThan(0)
    for (const rect of draftVisibility.rects) { expect(rect.top).toBeGreaterThanOrEqual(draftVisibility.top - 1); expect(rect.bottom).toBeLessThanOrEqual(draftVisibility.bottom + 1); expect(rect.left).toBeGreaterThanOrEqual(draftVisibility.left - 1); expect(rect.right).toBeLessThanOrEqual(draftVisibility.right + 1) }
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
    if (decision === 'no') { await appPage.getByRole('dialog', { name: 'About this plugin', exact: true }).getByRole('button', { name: 'Close plugin details', exact: true }).click(); await composer.focus(); await expect(composer).toBeFocused(); expect(await composer.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual(savedSelection) }

  }
  if (decision === 'timeout') {
    await notice.getByRole('button', { name: 'About this plugin', exact: true }).click()
    const details = appPage.getByRole('dialog', { name: 'About this plugin', exact: true })
    await expect(details).toBeVisible()
    // Expiration belongs to the original CLI; removing its notice must also retire the portal.
    await expect(notice).toBeHidden({ timeout: 35000 })
    await expect(details).toHaveCount(0)
    await expect(composer).toHaveText(draft)
    expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
    await composer.focus()
    expect(await composer.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual(savedSelection)
    await writeFile(join(workspace!, 'native-lsp-expired-details-app.json'), JSON.stringify({ originalTimeout: true, portalRetired: true, draftAndSelectionRetained: true, sessionId, boundNativePid }))
  }
  else { await notice.getByRole('button', { name: labels[decision], exact: true }).click(); await expect(notice).toBeHidden() }
  await expect.poll(async () => (await readFile(join(workspace!, 'native-debug.log'), 'utf8')).includes('User response: ' + decision + ' for recommendation-review')).toBe(true)
  if (decision === 'yes') await expect.poll(async () => (await readFile(join(workspace!, 'native-debug.log'), 'utf8')).includes('Plugin installed: recommendation-review@owned-recommendation'), { timeout: 15000 }).toBe(true)
  await expect(composer).toHaveText(draft)
  expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).sessionId).toBe(sessionId)
  await writeFile(join(workspace!, 'native-lsp-recommendation-app.json'), JSON.stringify({ decision, shown, captures, ...(decision === 'no' ? { expandedDetails: true, selectionRetained: true } : {}), draftRetained: true, sessionId, boundNativePid }))
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue reviewing the same release session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  if (decision === 'yes') {
    await expect(appPage.getByText('Owned LSP review phase 1 complete.', { exact: true })).toBeVisible()
    expect(JSON.stringify((await context()).messages)).toContain('definitions.review')
    const toolGroup = appPage.locator('[data-native-tool-activity][data-native-tool-ids~="native_lsp_1"]')
    const navigation = toolGroup.getByText('Defined in definitions.review:1:14', { exact: true })
    try {
      await expect(toolGroup).toBeVisible()
      const toggle = toolGroup.getByRole('button').first()
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
      await expect(navigation).toBeVisible(); await expect(navigation).toContainText('definitions.review')
    } catch (error) {
      await writeFile(join(workspace!, 'native-lsp-installed-result-failure.json'), JSON.stringify({ context: await context(), text: await appPage.locator('body').innerText() }))
      const size = appPage.viewportSize()!, image = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), size)
      await writeFile(testInfo.outputPath('native-lsp-installed-result-failure.png'), Buffer.from(image, 'base64'))
      throw error
    }
    const continuedDraft = 'Keep reviewing this definition.'
    await composer.fill(continuedDraft)
    for (const [width, height] of [[1100, 900], [680, 600]]) {
      await appPage.setViewportSize({ width, height }); await navigation.scrollIntoViewIfNeeded(); await expect(navigation).toBeInViewport()
      await expect(composer).toHaveText(continuedDraft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
      const image = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height })
      const path = testInfo.outputPath('native-lsp-installed-result-' + width + '.png'); await writeFile(path, Buffer.from(image, 'base64')); captures.push(path)
    }

    await writeFile(join(workspace!, 'native-lsp-installed-app.json'), JSON.stringify({ sameSession: true, sessionId, originalNavigationResultInHistory: true }))
  }
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeLspRecommendation: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
