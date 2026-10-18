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
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeWriteCreate: true, nativeWriteOverwrite: true, nativeEdit: true, nativeWriteDeny: true, nativeEditDeny: true, nativeFileCancel: true, nativeFileWithholding: true, nativeFileReview: true, nativeFileCompactControls: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, resumedCost, nativeCost, sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
