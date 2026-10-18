import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('restores original native file checkpoint bytes through the app history menu', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
  if (planScenario === 'accept-edits') {
    await composer.pressSequentially('/cc-model')
    await appPage.locator('.command-suggestion-popup').getByText('/cc-model', { exact: true }).click()
    await composer.pressSequentially('haiku')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.modelOverride).toBe('haiku')
  }
  const target = join(workspace!, 'file-fixture.txt')
  for (const turn of [1, 2]) {
    await composer.fill('ResearchFileTurn' + turn)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const panel = appPage.getByTestId('native-write-approval')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect.poll(async () => readFile(target, 'utf8').catch((error: any) => { if (error.code === 'ENOENT') return ''; throw error })).toBe(turn === 1 ? 'created\n' : 'overwrite\n')
    await expect.poll(async () => { const c = await context(); return [c.native.state.busy, c.claude.turns, c.messages.filter((m: any) => m.sender === 'assistant' && m.text === 'File fixture completed.').length] }).toEqual([false, turn + 1, turn])
  }
  const before = await context()
  const pivot = before.messages.findIndex((m: any) => m.sender === 'user' && m.text === 'ResearchFileTurn2')
  expect(pivot).toBeGreaterThan(0)
  const userCheckpoint = before.messages[pivot].context.cliUuid
  expect(userCheckpoint).toBeTruthy()
  const priorCheckpoint = before.messages.slice(0, pivot).filter((m: any) => m.sender === 'assistant' && m.context?.cliUuid).at(-1)
  expect(priorCheckpoint?.context.cliUuid).toBeTruthy()
  await composer.fill(''); await composer.press('Escape'); await composer.press('Escape')
  const popup = appPage.locator('.revert-history-popup')
  await popup.getByText('ResearchFileTurn2', { exact: true }).click()
  await popup.getByText('Revert and rewind code', { exact: true }).click()
  const confirmation = appPage.getByRole('button', { name: 'Revert', exact: true })
  if (await confirmation.isVisible()) await confirmation.click()
  try { await expect.poll(async () => (await context()).claude.revertTo?.cliUuid).toBe(priorCheckpoint.context.cliUuid) } catch (error) { await writeFile(join(workspace!, 'revert-failure-context.json'), JSON.stringify(await context(), null, 2)); throw error }
  expect((await context()).messages.some((m: any) => m.text === 'ResearchFileTurn2')).toBe(false)
  await expect.poll(async () => readFile(target, 'utf8'), { timeout: 15000 }).toBe('created\n')
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-session-rewind.png') })
  await composer.fill('NativeRevertContinuationBeta: continue from the earlier checkpoint.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.sessionId && c.sessionId !== sessionId && c.claude.chatState === 'success' }).toBeTruthy()
  const reverted = await context()
  expect(reverted.claude.historyError).toBeUndefined();expect(reverted.claude.revertTo).toBeUndefined()
  const journal = [] as any[]
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal.push(...(await readFile(join(workspace!, '.claude/projects', bucket, reverted.sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  expect(journal.some(row => row.uuid === priorCheckpoint.context.cliUuid)).toBe(true)
  expect(journal.some(row => row.type === 'user' && String(row.message?.content).includes('ResearchFileTurn2'))).toBe(false)
  expect(journal.some(row => row.type === 'user' && String(row.message?.content).includes('NativeRevertContinuationBeta'))).toBe(true)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'rewind', nativeSessionRewind: true, originalFileBytes: 'created\n', overwrittenFileBytes: 'overwrite\n', fileCheckpointRestored: true, userFileCheckpoint: userCheckpoint, priorNativeCheckpoint: priorCheckpoint.context.cliUuid, revertedNativeHistory: true, revertedAppHistory: true, sessionId, finalSessionId: reverted.sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
