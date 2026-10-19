import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('completes an everyday native review across Agent, approval, question and interruption recovery', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(110000)
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
  await card.locator('[contenteditable="true"]').fill('Help me review the release notes and checklist.')
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Release review') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Release review'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Release review')
    await expect(main).toContainText('Workspace notes and checklist')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Release review')
  const composer = card.locator('[contenteditable="true"]')
  const checkpoint = expect.configure({ soft: true })
  const screenshots: string[] = []
  const geometry: unknown[] = []
  async function capture(stage: string, editor: import('@playwright/test').Locator, controls: import('@playwright/test').Locator[], reading?: import('@playwright/test').Locator) {
    for (const [width, height] of [[1100, 900], [680, 600]] as const) {
      await appPage.setViewportSize({ width, height })
      const beforeFile = 'apack-native-everyday-' + stage + '-' + width + '-' + height + '-before-check.png'
      await appPage.screenshot({ path: testInfo.outputPath(beforeFile) })
      await writeFile(join(workspace!, 'native-everyday-progress.json'), JSON.stringify({ stage, width, height, readingHeight: reading ? await reading.evaluate(element => element.clientHeight) : undefined }))
      await checkpoint.poll(async () => {
        const rectangles = await Promise.all([editor, ...controls].map((control, index) => control.evaluate((element, primary) => { const r = element.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, inside: r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0 && r.height > 0 && (primary || r.height >= 20) } }, index === 0)))
        return rectangles.every(rect => rect.inside)
      }, { timeout: 1500, intervals: [100, 250] }).toBe(true)
      if (reading) await checkpoint.poll(() => reading.evaluate(element => element.clientHeight), { timeout: 1500, intervals: [100, 250] }).toBeGreaterThanOrEqual(stage === 'approval' ? 48 : 80)
      const file = 'apack-native-everyday-' + stage + '-' + width + '-' + height + '.png'
      await appPage.screenshot({ path: testInfo.outputPath(file) }); screenshots.push(file)
      geometry.push({ stage, width, height, readingHeight: reading ? await reading.evaluate(element => element.clientHeight) : undefined })
      await writeFile(join(workspace!, 'native-everyday-progress.json'), JSON.stringify({ geometry, screenshots }))
    }
  }
  const send = card.getByRole('button', { name: 'Send', exact: true })
  const mainDraft = 'Keep the release checklist wording unchanged.'
  await appPage.setViewportSize({ width: 1100, height: 900 })
  await composer.fill('Review the release notes with a worker.')
  await send.click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'running'), { timeout: 15000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  await expect(row.getByTestId('native-agent-status-text')).toContainText('Reviewing release notes')
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()
  await composer.fill(mainDraft)
  await row.getByRole('button', { name: 'Open Agent', exact: true }).click()
  const focused = appPage.getByRole('region', { name: 'Focused Agent conversation', exact: true })
  const agentForm = focused.getByRole('form', { name: 'Agent message', exact: true })
  const agentEditor = agentForm.locator('[contenteditable="true"]')
  const agentDraft = 'Please also note the migration steps.'
  await agentEditor.fill(agentDraft)
  await capture('agent', agentEditor, [agentForm.getByRole('button', { name: 'Send to Agent', exact: true }), focused.getByRole('button', { name: 'Back to conversation', exact: true })], focused.getByRole('region', { name: 'Agent transcript', exact: true }))
  await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await expect(composer).toHaveText(mainDraft)
  const toolsButton = appPage.getByRole('button', { name: /^Native tools/ }).first()
  if (!await row.isVisible()) await toolsButton.click()
  await row.getByRole('button', { name: 'Open Agent', exact: true }).click()
  await expect(agentEditor).toHaveText(agentDraft)
  await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await expect(composer).toHaveText(mainDraft)
  await expect.poll(async () => (await context()).native.state.busy, { timeout: 20000 }).toBe(false)
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('The release review is ready.'))).toBe(true)
  await capture('composer', composer, [send], appPage.getByTestId('chat-transcript'))
  const reference = JSON.parse(await readFile(join(workspace!, 'reference-fixture.json'), 'utf8'))
  await composer.fill('Read the release checklist before proposing changes.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'everyday-read-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  await composer.fill('Keep my review draft while I approve this read.')
  await writeFile(join(workspace!, 'everyday-read-release'), 'release')
  const approval = appPage.getByTestId('native-read-approval')
  await expect(approval).toBeVisible(); await expect(approval.getByTestId('native-read-path')).toHaveText(reference.file)
  await expect(composer).toBeHidden(); await expect(composer).toHaveText('Keep my review draft while I approve this read.')
  await capture('approval', approval.getByTestId('native-read-path'), [approval.getByRole('button', { name: 'Approve', exact: true })], approval.locator('.details'))
  await approval.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(approval).toBeHidden()
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('The release checklist is available.')), { timeout: 15000 }).toBe(true)
  await expect(composer).toHaveText('Keep my review draft while I approve this read.')
  await composer.fill('Ask me which release audience to target.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'everyday-question-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  await composer.fill('Use a direct, concise tone in the summary.')
  await writeFile(join(workspace!, 'everyday-question-release'), 'release')
  const question = appPage.getByTestId('native-question-panel')
  await expect(question).toBeVisible(); await expect(question).toContainText('Who should the release summary address?')
  await expect(composer).toBeHidden(); await expect(composer).toHaveText('Use a direct, concise tone in the summary.')
  await capture('question', question.locator('h2'), [question.getByRole('button', { name: 'Submit answers', exact: true })], question.getByLabel('Question details', { exact: true }))
  await question.getByRole('radio', { name: 'Developers People integrating the updated behavior', exact: true }).check()
  await question.getByRole('button', { name: 'Submit answers', exact: true }).click()
  await expect(question).toBeHidden()
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('for developers.')), { timeout: 15000 }).toBe(true)
  await expect(composer).toHaveText('Use a direct, concise tone in the summary.')
  await composer.fill('Draft the release summary while I review the checklist.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-pause-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  await composer.fill('Keep this note after interruption.')
  await card.getByTitle('Pause agent work', { exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  await expect(composer).toHaveText('Keep this note after interruption.')
  const ledger = async () => {
    for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
      try { return (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
    throw Error('Original session journal missing')
  }
  const users = (await ledger()).filter((row: any) => row.type === 'user' && row.origin?.kind === 'human')
  for (const text of ['Review the release notes with a worker.', 'Read the release checklist before proposing changes.', 'Ask me which release audience to target.', 'Draft the release summary while I review the checklist.']) {
    const original = users.filter((row: any) => row.message?.content === text); expect(original).toHaveLength(1)
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original[0].uuid).length).toBe(1)
  }
  const nativeCost = (await ledger()).filter((row: any) => row.type === 'cost-state').at(-1)?.totalCostUSD
  expect(nativeCost).toBeGreaterThan(0); await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await composer.fill('Continue the same release review after the interruption.')
  await send.click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  let resumedCost = 0
  await expect.poll(async () => {
    const text = await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8').catch(() => '')
    const result = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).at(-1)
    if (result?.sessionId !== sessionId || result.totalCostUsd <= nativeCost) return false
    resumedCost = result.totalCostUsd
    return (await context()).claude.totalCostUsd === resumedCost
  }).toBe(true)
  await expect.poll(async () => (await ledger()).filter((row: any) => row.type === 'cost-state').at(-1)?.totalCostUSD).toBe(resumedCost)
  await composer.fill('Ready for the next release-review step.')
  await capture('recovered', composer, [send], appPage.getByTestId('chat-transcript'))
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-everyday-app.json'), JSON.stringify({ taskId, sessionId, nativeCost, resumedCost, geometry, screenshots }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeEverydayCombined: testInfo.errors.length === 0, nativeAgentReturn: true, nativePausedWhileWorking: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
