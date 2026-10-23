import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('uses original session file permissions and denial feedback in the everyday app', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
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
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const text = native?.output?.map((chunk: any) => chunk.text).join('') ?? ''
    const screen = recognizeOnboardingPrompt(text, workspace)
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && navigated && !trusted && Date.now() - trustSelectedAt > 1200) { trusted = true; await input.press('Enter') }
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
  const composer = card.locator('[contenteditable="true"]')
  const panel = appPage.locator('[data-testid="native-write-approval"], [data-testid="native-edit-approval"]')
  const target = join(workspace!, 'file-fixture.txt')
  async function defaultPermissions() {
    const details = appPage.locator('summary').filter({ hasText: 'Details' })
    await details.click()
    await appPage.getByTitle('Approve every edit (safe default)', { exact: true }).click()
    await expect.poll(async () => { const c = await context(); return [c.claude.permissionMode, c.native.state.session.permissionMode] }).toEqual(['default', 'default'])
    await details.click()
  }
  async function begin(turn: number, draft: string) {
    await composer.fill('ResearchFileTurn' + turn)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')
    await composer.fill(draft)
  }
  async function finished(expected: string) {
    await expect.poll(async () => { try { return await readFile(target, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error } }).toBe(expected)
    await expect.poll(async () => (await context()).native.state.busy).toBe(false)
    await expect(panel).toBeHidden()
  }
  await defaultPermissions()
  await begin(1, 'Keep this draft during the permission decision.')
  await expect(panel).toBeVisible({ timeout: 15000 })
  const choices = panel.getByRole('combobox', { name: 'Write approval choice', exact: true })
  await expect(choices).toBeEnabled()
  await choices.focus()
  await choices.selectOption('yes-session')
  const scope = panel.getByTestId('native-file-permission-choice-description')
  await expect(scope).toContainText('session')
  await expect(scope).toContainText('accept edits')
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-session-before-check-' + height + '.png') })
    await writeFile(join(workspace!, 'file-scope-geometry-' + height + '.json'), JSON.stringify(await scope.evaluate(element => ({ scope: element.getBoundingClientRect().toJSON(), panel: element.closest('.native-tool-approval')!.getBoundingClientRect().toJSON(), details: element.closest('.details')!.getBoundingClientRect().toJSON(), scrollTop: element.closest('.details')!.scrollTop, viewport: { width: innerWidth, height: innerHeight } }))))
    await expect(scope).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport()
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-session-' + height + '.png') })
  }
  await panel.getByRole('button', { name: 'Continue', exact: true }).click()
  await finished('created\n')
  await expect(composer).toHaveText('Keep this draft during the permission decision.')
  await expect.poll(async () => { const c = await context(); return [c.claude.permissionMode, c.native.state.session.permissionMode] }).toEqual(['acceptEdits', 'acceptEdits'])
  await begin(2, 'Keep the next draft.')
  await finished('overwrite\n')
  await begin(3, 'Keep the edited draft.')
  await finished('edited\n')
  await defaultPermissions()
  await begin(4, 'Keep this draft after denial.')
  await expect(panel).toBeVisible({ timeout: 15000 })
  const reason = panel.locator('textarea')
  await panel.getByText('Add a reason for denying', { exact: true }).click()
  await reason.fill('Keep the existing file unchanged.')
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(reason).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Deny', exact: true })).toBeInViewport()
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-feedback-' + height + '.png') })
  }
  await panel.getByRole('button', { name: 'Deny', exact: true }).click()
  await finished('edited\n')
  await expect(composer).toHaveText('Keep this draft after denial.')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).sessionId).toBe(sessionId)
  const shapes = JSON.parse(await readFile(join(workspace!, 'native-dialog-shapes.json'), 'utf8'))
  await writeFile(join(workspace!, 'native-file-standing-dialog-evidence.json'), JSON.stringify(shapes))
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const printResults = async () => (await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  const prior = (await printResults()).length
  await composer.fill('Continue after the native file permission decisions.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await printResults()).length).toBe(prior + 1)
  expect((await printResults()).at(-1)).toMatchObject({ sessionId, subtype: 'success' })
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeFileStanding: true, nativeFileMatchingRepeat: true, nativeFileFeedback: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
