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
test('preserves original generic MCP approval choices, withheld previews and the everyday draft', async ({ app, appPage, electronApp }, testInfo) => {
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




  expect(JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8')).genericPermissions).toBe(true)
  const cases: { tool: string; input: Record<string, unknown>; prompt: string; decision: string }[] = JSON.parse(await readFile(join(workspace!, 'native-generic-permission-steps.json'), 'utf8'))
  expect(cases).toHaveLength(5)
  const draft = 'Keep my release-review notes while checking the migration permissions.'
  const steps: unknown[] = [], captures: string[] = [], previewGeometry: unknown[] = [], nativeWindow = await electronApp.browserWindow(appPage)
  async function capture(name: string, width: number, height: number) {
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([nativeWindow.evaluate(async (window, size) => { const image = await window.webContents.capturePage({ x: 0, y: 0, ...size }); return { size: image.getSize(), png: image.toPNG().toString('base64') } }, { width, height }), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Owned capture exceeded 30000ms')), 30000) })]).finally(() => { if (timer) clearTimeout(timer) })
    expect(result.size).toEqual({ width, height }); await writeFile(testInfo.outputPath(name), Buffer.from(result.png, 'base64')); captures.push(name)
  }
  for (const [index, step] of cases.entries()) {
    const phase = index + 1
    await appPage.setViewportSize({ width: 1100, height: 900 })
    await writeFile(join(workspace!, 'native-generic-permission-phase.txt'), String(phase))
    await composer.fill(step.prompt)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => readFile(join(workspace!, 'native-generic-permission-model-ready-' + phase), 'utf8').then(() => true, () => false)).toBe(true)
    await composer.fill(draft)
    const savedDocument = await composer.evaluate(element => (element as any).editor.state.doc.toJSON())
    const selection = await composer.evaluate(element => (element as any).editor.state.selection.toJSON())
    await writeFile(join(workspace!, 'native-generic-permission-model-release-' + phase), 'Draft is ready')
    const approval = appPage.getByTestId('native-' + step.tool.toLowerCase() + '-approval')
    try {
      await expect(approval).toBeVisible({ timeout: 20000 })
      await expect(approval.locator('button.approve')).toBeEnabled({ timeout: 10000 })
    } catch (error) {
      await writeFile(join(workspace!, 'native-generic-permission-failure.json'), JSON.stringify({ phase, context: await context(), text: await appPage.locator('body').innerText() }, null, 2))
      await capture('native-generic-permission-failure.png', 1100, 900)
      throw error
    }
    let original = (await context()).claude.pendingControlRequest
    expect(original.toolName).toBe(step.tool)
    expect(original.nativeTerminal.genericTool.ready).toBe(true)
    expect(original.nativeTerminal.genericTool.details.length).toBeGreaterThan(0)
    const details = original.nativeTerminal.genericTool.details.map((row: { value: string }) => row.value).join('\n')
    expect(details.replace(/\s+/g, ' ')).toContain('Return the submitted notes without reading files or contacting a service.')
    if (step.decision === 'withheld-deny') {
      expect(details).toMatch(/cannot be shown|cannot be rendered|too much to show/)
      expect(original.nativeTerminal.genericTool.choices.map((choice: { value: string }) => choice.value)).toEqual(['yes', 'no'])
      await expect(approval.getByRole('combobox')).toHaveCount(0)
    } else expect(details).toContain(String(step.input.message))
    if (step.decision === 'standing') {
      await expect.poll(async () => (await context()).claude.pendingControlRequest.nativeTerminal.genericTool.choices.some((choice: { value: string }) => choice.value === 'yes-dont-ask-again')).toBe(true)
      original = (await context()).claude.pendingControlRequest
      await approval.getByRole('combobox').selectOption('yes-dont-ask-again')
      const label = original.nativeTerminal.genericTool.choices.find((choice: { value: string }) => choice.value === 'yes-dont-ask-again').label
      await expect(approval.getByTestId('native-tool-permission-choice-description')).toHaveText(label)
    }
    if (['once', 'deny', 'withheld-deny'].includes(step.decision)) {
      await approval.getByText('Add feedback', { exact: true }).click()
      await approval.getByLabel('Feedback for Claude', { exact: true }).fill(step.decision === 'once' ? 'Review the migration checklist first.' : 'Keep the original release notes and skip this tool request.')
    }
    for (const [width, height] of [[1100, 900], [680, 600]]) {
      await appPage.setViewportSize({ width, height })
      await expect(approval.getByRole('button', { name: 'Deny', exact: true })).toBeInViewport()
      await expect(approval.locator('button.approve')).toBeInViewport()
      expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
      expect(await composer.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual(selection)
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      if ([1, 4].includes(phase)) {
        await approval.getByLabel('Feedback for Claude', { exact: true }).focus()
        await capture('native-generic-permission-' + phase + '-' + width + '.png', width, height)
        const needle = phase === 1 ? 'Review the migration notes.' : 'cannot be shown'
        const geometry = await approval.locator('.details').evaluate((element, text) => {
          const details = element as HTMLElement
          details.focus({ preventScroll: true })
          const walker = document.createTreeWalker(details.querySelector('.tool-details')!, NodeFilter.SHOW_TEXT)
          let node: Node | null, range: Range | undefined
          while ((node = walker.nextNode())) {
            const at = (node.textContent ?? '').indexOf(text)
            if (at >= 0) { range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length); break }
          }
          if (!range) throw Error('Original native preview text is not rendered: ' + text)
          const region = details.getBoundingClientRect(), before = range.getBoundingClientRect()
          if (before.top < region.top + 8 || before.bottom > region.bottom - 8) details.scrollTop += before.top - region.top - 8
          const target = range.getBoundingClientRect()
          return { region: { top: region.top, bottom: region.bottom, left: region.left, right: region.right }, target: { top: target.top, bottom: target.bottom, left: target.left, right: target.right }, scrollTop: details.scrollTop }
        }, needle)
        expect(geometry.target.top).toBeGreaterThanOrEqual(geometry.region.top)
        expect(geometry.target.bottom).toBeLessThanOrEqual(geometry.region.bottom)
        expect(geometry.target.left).toBeGreaterThanOrEqual(geometry.region.left)
        expect(geometry.target.right).toBeLessThanOrEqual(geometry.region.right)
        previewGeometry.push({ phase, viewport: { width, height }, needle, ...geometry })
        await capture('native-generic-permission-' + phase + '-' + width + '-preview.png', width, height)
      }
    }
    if (step.decision === 'cancel') await approval.getByRole('button', { name: 'Cancel', exact: true }).click()
    else await approval.locator(['deny', 'withheld-deny'].includes(step.decision) ? 'button.deny' : 'button.approve').click()
    await expect(approval).toBeHidden({ timeout: 10000 })
    try {
      await expect.poll(async () => (await context()).native.state.busy, { timeout: 30000 }).toBe(false)
    } catch (error) {
      await writeFile(join(workspace!, 'native-generic-permission-close-failure.json'), JSON.stringify({ phase, context: await context(), text: await appPage.locator('body').innerText() }, null, 2))
      await capture('native-generic-permission-close-failure.png', 680, 600)
      throw error
    }
    await expect(composer).toHaveText(draft)
    expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(savedDocument)
    steps.push({ phase, tool: step.tool, decision: step.decision, preview: original.nativeTerminal.genericTool, retainedDraft: true })
  }
  await writeFile(join(workspace!, 'native-generic-permission-phase.txt'), '0')
  await writeFile(join(workspace!, 'native-generic-permission-app.json'), JSON.stringify({ steps, captures, previewGeometry, sessionId, boundNativePid, retainedDraft: true }))
  // The final Cancel owns shutdown. Wait for its publication instead of reopening a lagging view.
  expect(cases.at(-1)?.decision).toBe('cancel')
  try {
    await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  } catch (error) {
    await writeFile(join(workspace!, 'native-generic-permission-retirement-failure.json'), JSON.stringify({ context: await context(), text: await appPage.locator('body').innerText() }, null, 2))
    throw error
  }
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue reviewing the same release session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeGenericPermissions: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
