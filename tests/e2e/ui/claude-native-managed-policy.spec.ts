import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('keeps native status, submissions and history available under managed-only hooks', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
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
    return native?.state?.status === 'live' && native?.state?.mainStatus?.includes('AppNativeMain ' + sessionId)
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  await expect(main).toContainText('AppNativeMain ' + sessionId)
  await expect(main).toContainText('Second native status line')
  await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  await expect(status).toContainText('AppNativeMain ' + sessionId)
  await appPage.setViewportSize({ width: 680, height: 600 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })
  const composer = card.locator('[contenteditable="true"]')
  await composer.fill('NativeManagedParentFixture')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(composer).toHaveText('', { timeout: 15000 })
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.statusText?.startsWith('AppNativeAgent running')), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const nativeAgentId = (await context()).native.state.tasks.find((task: any) => task.status === 'running').id
  const agentRow = appPage.locator(`[data-native-agent-id="${nativeAgentId}"]`)
  await expect(agentRow).toContainText('AppNativeAgent running')
  await appPage.setViewportSize({ width: 680, height: 900 })
  await agentRow.scrollIntoViewIfNeeded()
  await expect(agentRow).toBeInViewport()
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-agent-status.png') })
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  await expect(agentRow).toContainText('AppNativeAgent completed')
  await composer.fill('NativePauseFixture')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(composer).toHaveText('', { timeout: 15000 })
  await expect.poll(async () => readFile(join(workspace!, 'native-pause-ready.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })).toBe(JSON.stringify({ ready: true }))
  await card.getByTitle('Pause agent work', { exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  const stopped = await context()
  expect(stopped.native.state.mainStatus).toBeUndefined(); expect(stopped.native.state.tasks).toEqual([])
  let journal: any[] = []
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  const accepted = journal.find(row => row.type === 'user' && row.message?.content === 'NativeManagedParentFixture')
  expect(accepted?.uuid).toBeTruthy()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === accepted.uuid).length).toBe(1)
  const nativeCost = journal.filter(row => row.type === 'cost-state').at(-1).totalCostUSD
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await composer.fill('Continue after managed native work.')
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
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeManagedPolicy: true, normalComposerNativeStatus: true, nativeAgentToolRowStatus: true, normalComposerReceipt: true, nativePausedWhileWorking: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, resumedPrintCostSynchronized: true, resumedCost, nativeCost, sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
