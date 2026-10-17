import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('hands one conversation to the native terminal and displays its main and agent status', async ({ app, appPage }, testInfo) => {
  expect(process.env.HOME).toBe(workspace)
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
    return native?.state?.status === 'live' && native?.state?.mainStatus?.includes('AppNativeMain ' + sessionId)
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  await expect(main).toContainText('AppNativeMain ' + sessionId)
  await expect(main).toContainText('Second native status line')
  await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  const nativeText = async () => (await context()).native?.output?.map((chunk: any) => chunk.text).join('') ?? ''
  await input.pressSequentially('DropNativeHistoryFixture', { delay: 1 }); await input.press('Enter')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-drop-observed.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error })).text).toBe('DropNativeHistoryFixture')
  await expect.poll(async () => (await nativeText()).includes('Native history fixture refused'), { timeout: 5000 }).toBe(true)
  await input.press('Control+u')
  await input.pressSequentially('RewriteNativeHistoryFixture', { delay: 1 }); await input.press('Enter')
  const tasks = section.getByRole('list', { name: 'Native Claude agents', exact: true })
  await appPage.waitForTimeout(500)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-terminal-before-agent.png') })
  // This native notice is shown when the worker first selects auto mode on a loopback endpoint.
  // Dismiss only its specific informational screen; keep native permission decisions intact.
  const notice = "We're changing auto mode to no longer charge for classifier requests in Claude Code."
  await expect.poll(async () => (await nativeText()).includes(notice) || await tasks.count() > 0, { timeout: 10000 }).toBe(true)
  if ((await nativeText()).includes(notice)) await input.press('Enter')
  try {
    await expect(tasks).toContainText('AppNativeAgent running', { timeout: 20000 })
  } catch (error) {
    await writeFile(join(workspace!, 'native-terminal-failure.json'), JSON.stringify(await context(), null, 2))
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-terminal-failure.png') })
    throw error
  }
  await expect(tasks).not.toContainText('ForeignMustNotReachApp')
  const running = await context(); expect(running.native.state.sessionId).toBe(sessionId)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-terminal-main-agent.png') })
  await appPage.setViewportSize({ width: 680, height: 900 })
  await expect(main).toBeVisible(); await appPage.screenshot({ path: testInfo.outputPath('apack-native-terminal-narrow.png') })
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  const nativeOwnerId = (await context()).native.state.ownerId
  await app.navigate('host/settings'); await app.navigate('default-setup/threads')
  await expect.poll(async () => (await context()).native?.state?.ownerId).toBe(nativeOwnerId)
  await expect(section.locator('textarea.xterm-helper-textarea')).toBeVisible()
  await expect(main).toContainText('AppNativeMain ' + sessionId)
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Back to conversation', exact: true })).toBeVisible()
  const stopped = await context(); expect(stopped.native.state.mainStatus).toBeUndefined(); expect(stopped.native.state.tasks).toEqual([])
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click(); await expect(card).toBeVisible()
  const projects = join(workspace!, '.claude/projects')
  let journal: any[] = []
  for (const bucket of await readdir(projects)) {
    try { journal = (await readFile(join(projects, bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  const accepted = journal.find(row => row.type === 'user' && row.origin?.kind === 'human' && row.message?.content === 'NativeSubagentParentFixture: run the disposable status worker.')
  expect(accepted?.uuid).toBeTruthy()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === accepted.uuid).length).toBe(1)
  const nativeCost = journal.filter(row => row.type === 'cost-state').at(-1)?.totalCostUSD
  expect(nativeCost).toBeGreaterThan(0)
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  const synchronized = await context()
  expect(synchronized.claude.turns).toBe(stopped.native.state.session.turns)
  expect(synchronized.claude.toolCallCount).toBe(1)
  const nativeUser = synchronized.messages.find((message: any) => message.context?.cliUuid === accepted.uuid)
  expect(nativeUser.text).toBe(accepted.message.content)
  expect(nativeUser.context.claudeNativeUserMessage.origin.kind).toBe('composer')
  expect(synchronized.messages.filter((message: any) => message.sender === 'user')).toHaveLength(2)
  expect(synchronized.messages.some((message: any) => message.text.includes('DropNativeHistoryFixture') || message.text.includes('RewriteNativeHistoryFixture'))).toBe(false)
  expect(synchronized.messages.filter((message: any) => message.context?.claudeTerminalMessage).length).toBeGreaterThanOrEqual(4)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-terminal-returned-history.png') })
  await card.locator('[contenteditable="true"]').fill('Continue after the native interface.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.').length).toBe(2)
  expect((await context()).sessionId).toBe(sessionId)
  let resumedCost = 0
  await expect.poll(async () => {
    const text = await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    const result = text.split('\n').slice(0, -1).map(line => JSON.parse(line)).at(-1)
    if (result?.sessionId !== sessionId || result.totalCostUsd <= nativeCost) return false
    resumedCost = result.totalCostUsd
    return (await context()).claude.totalCostUsd === resumedCost
  }).toBe(true)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, mainStatusDisplayed: true, subagentStatusDisplayed: true, sameSessionResumed: true, ansiColorDisplayed: true, multilineDisplayed: true, nativeTaskCompletion: true, sameOwnerAfterViewRemount: true, returnsToConversation: true, nativeHistorySynchronized: true, nativeRewrittenHistory: true, nativeDroppedNotPersisted: true, nativeCostSynchronized: true, resumedPrintSameSession: true, resumedPrintCostSynchronized: true, resumedCost, nativeTurnsSynchronized: true, acceptedNativeUuid: accepted.uuid, nativeCost, sessionId, threadId: stopped.threadId, nativeOwnerId: stopped.native.state.ownerId, nativePid: stopped.native.state.pid, nativeExit: stopped.native.state.exitCode, browserErrors: errors }, null, 2))
})
