import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reviews native file creation, overwrite and edit before one-time decisions', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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
  let theme = false, security = false, navigated = false, trusted = false
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const text = native?.output?.map((chunk: any) => chunk.text).join('') ?? ''
    const screen = recognizeOnboardingPrompt(text, workspace)
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && navigated && !trusted) { trusted = true; await input.press('Enter') }
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
  await appPage.setViewportSize({ width: 680, height: 600 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })
  const composer = card.locator('[contenteditable="true"]')
  const target = join(workspace!, 'file-fixture.txt')
  for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
    const isEdit = [3, 5, 7].includes(turn)
    await composer.fill('ResearchFileTurn' + turn)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const panel = appPage.getByTestId(isEdit ? 'native-edit-approval' : 'native-write-approval')
    await expect(panel).toBeVisible({ timeout: 15000 })
    const after = turn === 1 ? 'created\n' : turn === 2 ? 'overwrite\n' : turn === 3 ? 'edited\n' : 'Must not be applied\n'
    await expect(panel.getByTestId('native-read-path')).toHaveText(target)
    if (turn === 6) {
      await expect(panel.getByTestId('native-file-review')).toContainText('too large to show')
      await expect(panel.getByTestId('native-file-before')).toHaveCount(0)
      await expect(panel.getByTestId('native-file-after')).toHaveCount(0)
      await panel.getByTestId('native-file-review').scrollIntoViewIfNeeded()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-withheld.png') })
    } else {
      await expect(panel.getByTestId('native-file-after')).toHaveText(after)
      if (turn === 1) await expect(panel.getByTestId('native-file-before')).toHaveCount(0)
      else await expect(panel.getByTestId('native-file-before')).toHaveText(turn === 2 ? 'created\n' : turn === 3 ? 'overwrite\n' : 'edited\n')
    }
    await expect.poll(() => panel.evaluate(element => Array.from(element.querySelectorAll('footer button')).every(button => { const r = button.getBoundingClientRect(); return r.height >= 28 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }))).toBe(true)
    if (turn <= 3) {
      await appPage.setViewportSize({ width: 680, height: 900 })
      await panel.getByTestId('native-file-after').scrollIntoViewIfNeeded()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-review-' + turn + '.png') })
      await appPage.setViewportSize({ width: 680, height: 600 })
      await panel.getByTestId('native-file-after').scrollIntoViewIfNeeded()
      await expect(panel.getByTestId('native-file-after')).toBeInViewport()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-compact-' + turn + '.png') })
    }
    await panel.getByRole('button', { name: turn <= 3 ? 'Allow once' : turn === 7 ? 'Cancel' : 'Deny', exact: true }).click()
    await expect(panel).toBeHidden()
    if (turn === 7) await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
    else await expect.poll(async () => (await context()).native.state.busy).toBe(false)
    const expected = turn === 1 ? 'created\n' : turn === 2 ? 'overwrite\n' : 'edited\n'
    await expect.poll(async () => readFile(target, 'utf8').catch(() => '')).toBe(expected)
    if (turn === 1) {
      const savedSplit = await appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes)
      expect(savedSplit.chatMaximized ?? false).toBe(false)
      const tools = appPage.locator('[data-native-tool-activity]').last()
      await tools.getByRole('button').first().click()
      const result = tools.locator('[data-native-tool-result]')
      await expect(result).toContainText('Rewritten native tool result')
      const id = await result.getAttribute('data-native-tool-result')
      await composer.fill('Keep my draft while inspecting a native tool result')
      await result.getByRole('button', { name: 'Inspect native tool result', exact: true }).click()
      await expect.poll(async () => { try { return JSON.parse(await readFile(join(workspace!, 'native-tool-result-hook.json'), 'utf8')).requestId } catch { return undefined } }).toBe(id)
      const hook = JSON.parse(await readFile(join(workspace!, 'native-tool-result-hook.json'), 'utf8'))
      expect(hook.props).toMatchObject({ tool_use_id: id, tool: 'Write', isErrored: false })
      expect(hook.props.output).toBeTruthy(); expect(typeof hook.props.output).toBe('object')
      let originalResult: any, originalCall: any
      for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
        try { const rows = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); originalCall = rows.find((row: any) => row.type === 'assistant' && Array.isArray(row.message?.content) && row.message.content.some((block: any) => block.type === 'tool_use' && block.id === id)); originalResult = rows.find((row: any) => row.type === 'user' && Array.isArray(row.message?.content) && row.message.content.some((block: any) => block.type === 'tool_result' && block.tool_use_id === id)); if (originalResult) break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
      }
      expect(originalResult?.uuid).toBeTruthy()
      expect(hook.props.output).toEqual(originalResult.toolUseResult)
      const frames = await appPage.evaluate(() => { const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return Object.values(c.nativeUiViews).flatMap((view: any) => view.state?.transcriptMessages ?? []) })
      expect(frames.find((frame: any) => frame.component === 'ToolResult' && frame.uuid === id)).toMatchObject({ resultUuid: originalResult.uuid, assistantUuid: originalCall.uuid })

      expect(hook.box.text).toBe('Keep my draft while inspecting a native tool result')
      expect(await readFile(target, 'utf8')).toBe('created\n')
      await result.scrollIntoViewIfNeeded()
      await expect(result).toBeInViewport({ ratio: 0.99 })
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      const resultBox = await result.boundingBox(), composerBox = await card.boundingBox()
      expect(resultBox!.height).toBeGreaterThan(40)
      expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(composerBox!.y)
      const transcriptBox = (await appPage.locator('[data-testid="chat-transcript"]').boundingBox())!
      expect(resultBox!.y).toBeGreaterThanOrEqual(transcriptBox.y - 1)
      expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(transcriptBox.y + transcriptBox.height + 1)
      const chatBox = await appPage.locator('[data-onboarding-id="chat-area"]').boundingBox()
      expect(chatBox!.height).toBeGreaterThanOrEqual(400)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-split.png') })
      await appPage.setViewportSize({ width: 680, height: 900 })
      await writeFile(join(workspace!, 'native-default-split-debug.json'), JSON.stringify(await appPage.evaluate(() => { const nodes = [document.querySelector('[data-onboarding-id="canvas-area"]'), document.querySelector('[data-onboarding-id="chat-area"]')]; return { height: innerHeight, split: (window as any).applicationState.getSnapshot().context.panelSizes, nodes: nodes.map(node => { const e = node as HTMLElement; return { box: e.getBoundingClientRect().toJSON(), style: e.getAttribute('style'), descendants: [e, ...Array.from(e.querySelectorAll('div')).slice(0, 9)].map(el => { const c = getComputedStyle(el); return { classes: el.className, style: el.getAttribute('style'), height: el.getBoundingClientRect().height, cssHeight: c.height, minHeight: c.minHeight, maxHeight: c.maxHeight, flex: c.flex, overflow: c.overflow } }) } }) } }), null, 2))
      await expect.poll(async () => (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeGreaterThan(300)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-tall.png') })
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      await appPage.setViewportSize({ width: 680, height: 600 })
      await result.scrollIntoViewIfNeeded(); await expect(result).toBeInViewport({ ratio: 0.99 })
      expect(await appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes)).toEqual(savedSplit)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-restored.png') })
      const divider = appPage.locator('.cursor-row-resize').first()
      await divider.click()
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.canvasHeight)).toBe(95)
      expect((await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeGreaterThan(500)
      await divider.click()
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.canvasHeight)).toBe(50)
      await result.scrollIntoViewIfNeeded(); await expect(result).toBeInViewport({ ratio: 0.99 })

      await divider.click({ button: 'right' })
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.chatMaximized)).toBe(true)
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      await divider.click({ button: 'right' })
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.chatMaximized)).toBe(false)
      const beforeDrag = (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height
      const handle = (await divider.boundingBox())!
      await appPage.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await appPage.mouse.down(); await appPage.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 32, { steps: 4 }); await appPage.mouse.up()
      await expect.poll(async () => (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeLessThan(beforeDrag - 20)
      await writeFile(join(workspace!, 'native-default-split-geometry.json'), JSON.stringify({ compact: { chat: chatBox, result: resultBox, composer: composerBox }, savedSplit, canvasBeforeDrag: beforeDrag, canvasAfterDrag: (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height, viewport: { width: 680, height: 600 }, maximizeRestore: true, collapseRestore: true, resizePreservedPreferences: true }, null, 2))
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')


      await tools.getByRole('button').first().click()
      await expect(result).toHaveCount(0)
      await expect.poll(async () => appPage.evaluate((toolId: string | null) => { const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return Object.values(c.nativeUiViews).some((view: any) => view.state?.transcriptMessages?.some((frame: any) => frame.component === 'ToolResult' && frame.uuid === toolId)) }, id)).toBe(false)
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')
    }

  }
  let journal: any[] = []
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
    const original = journal.find(row => row.type === 'user' && row.message?.content === 'ResearchFileTurn' + turn)
    expect(original?.uuid).toBeTruthy()
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original.uuid).length).toBe(1)
  }
  const nativeCost = journal.filter(row => row.type === 'cost-state').at(-1).totalCostUSD
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await composer.fill('Continue after file decisions.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.').length).toBe(2)
  expect((await context()).sessionId).toBe(sessionId)
  const resumedCost = (await context()).claude.totalCostUsd
  expect(resumedCost).toBeGreaterThan(nativeCost)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeWriteCreate: true, nativeWriteOverwrite: true, nativeEdit: true, nativeWriteDeny: true, nativeEditDeny: true, nativeFileCancel: true, nativeFileWithholding: true, nativeFileReview: true, nativeFileCompactControls: true, nativeToolResult: true, nativeDefaultSplit: true, toolResultLayout: 'default split with native chat minimum; resized 600/900/600 without changing saved split', nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, resumedCost, nativeCost, sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
