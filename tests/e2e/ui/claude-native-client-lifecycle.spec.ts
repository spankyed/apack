import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-lifecycle-failure.png') }).catch(() => {}) })
test('retires replaced, pending and failed original Client modules while preserving composing', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, terminalClients } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!terminalClients, 'Explicit private terminal Client fixture required')
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
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
  const composer = card.locator('[contenteditable="true"]')
  await appPage.setViewportSize({ width: 1100, height: 900 })
  await card.getByRole('button', { name: 'Session tools', exact: true }).click()
  const draft = 'Review release notes while workspace extensions recover.'
  await composer.fill(draft)
  const extension = (text: string) => appPage.locator('[data-native-client]').filter({ hasText: text }).first()
  const receipts = async () => JSON.parse(await readFile(join(workspace!, 'native-client-lifecycle-receipts.json'), 'utf8').catch(() => '[]'))
  const mode = async (value: string) => { await writeFile(join(workspace!, 'native-client-mode.txt'), value); await expect.poll(async () => (await receipts()).filter((row: any) => row.operation === 'mode').at(-1)?.mode).toBe(value) }
  await expect(extension('Extension A count=0')).toBeVisible()
  const oldToken = await extension('Extension A count=0').getAttribute('data-native-client')
  await extension('Extension A').getByRole('button', { name: 'Refresh workspace extension', exact: true }).click()
  await expect.poll(async () => (await receipts()).some((row: any) => row.operation === 'held-start')).toBe(true)
  await mode('b')
  const fresh = extension('Extension B')
  await expect(fresh).toContainText('Extension B count=0')
  expect(await fresh.getAttribute('data-native-client')).not.toBe(oldToken)
  const replacementAt = Date.now()
  await fresh.getByRole('button', { name: 'Apply workspace extension', exact: true }).click()
  await expect(fresh).toContainText('Extension B count=1')
  await expect.poll(async () => (await receipts()).some((row: any) => row.operation === 'held-finished')).toBe(true)
  expect((await receipts()).find((row: any) => row.operation === 'held-finished').at).toBeGreaterThan(replacementAt)
  await expect(fresh).toContainText('Extension B count=1'); await expect(card).not.toContainText('Retired extension reply')
  await fresh.getByRole('button', { name: 'Apply workspace extension', exact: true }).click()
  await expect(fresh).toContainText('Extension B count=2')
  await expect.poll(async () => (await receipts()).some((row: any) => row.operation === 'applied' && row.name === 'Extension B' && row.count === 2)).toBe(true)
  await appPage.evaluate(token => { const actor = (window as any).applicationState.system.get('default-setup/threads'), c = actor.getSnapshot().context; const [mountId] = Object.entries(c.nativeUiViews).find(([, v]: any) => v.threadId === c.currentThread.id)!; actor.send({ type: 'CLAUDE_UI_CLIENT', threadId: c.currentThread.id, mountId, id: token, sequence: 1000000, event: { kind: 'key', key: 'old' } }) }, oldToken)
  await expect(composer).toHaveText(draft)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-replacement-1100-900.png') })

  await appPage.setViewportSize({ width: 680, height: 600 })
  for (const failure of [{ mode: 'failure', text: 'Intentional workspace extension failure' }, { mode: 'load-failure', text: 'Intentional workspace module load failure' }]) {
    await mode(failure.mode)
    await expect(extension(failure.text)).toBeVisible()
    await expect(composer).toHaveText(draft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: .99 })
    await appPage.screenshot({ path: testInfo.outputPath(`apack-native-client-${failure.mode}-680-600.png`) })
    await mode('b'); await expect(fresh).toContainText('Extension B count=0')
    await fresh.getByRole('button', { name: 'Apply workspace extension', exact: true }).click(); await expect(fresh).toContainText('Extension B count=1')
  }

  await mode('pending')
  const pending = extension('Loading native module…')
  await expect(pending).toBeVisible()
  const pendingToken = await pending.getAttribute('data-native-client')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-client-load-delay.json'), 'utf8').catch(() => 'null'))?.evaluatedAt).toBeTruthy()
  await mode('closed'); await expect(pending).toHaveCount(0)
  const closedAt = Date.now()
  await writeFile(join(workspace!, 'native-client-load.release'), 'release')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-client-load-delay.json'), 'utf8')).deliveredAt).toBeGreaterThanOrEqual(closedAt)
  expect(JSON.parse(await readFile(join(workspace!, 'native-client-load-delay.json'), 'utf8')).reason).toBe('explicit')
  await expect.poll(async () => (await readFile(join(workspace!, 'native-debug.log'), 'utf8')).includes('surface environment of pending-client-fixture')).toBe(true)
  expect((await readFile(join(workspace!, 'native-debug.log'), 'utf8')).includes('ResearchPendingClientMounted')).toBe(false)
  await expect(extension('Loaded workspace extension')).toHaveCount(0)
  await mode('pending')
  const loaded = extension('Loaded workspace extension')
  await expect(loaded).toContainText('Loaded workspace extension count=0')
  expect(await loaded.getAttribute('data-native-client')).not.toBe(pendingToken)
  await loaded.getByRole('button', { name: 'Use loaded workspace extension', exact: true }).click()
  await expect(loaded).toContainText('Loaded workspace extension count=1')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-client-pending-action.json'), 'utf8').catch(() => 'null'))).toMatchObject({ pendingExtension: true, count: 1, surface: 'desktop', component: 'AbovePrompt' })
  await expect(composer).toHaveText(draft); expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-recovered-680-600.png') })
  await writeFile(join(workspace!, 'native-client-lifecycle-acceptance.json'), JSON.stringify({ replacementAt, oldToken, pendingToken, receipts: await receipts(), releaseBeforeSuccessfulLoad: true, closedAt, load: JSON.parse(await readFile(join(workspace!, 'native-client-load-delay.json'), 'utf8')) }))

  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  await composer.fill('Continue the same session after extension recovery.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'composer-layout', nativeClientLifecycle: true, nativeClientReplacement: true, nativeClientReleaseBeforeLoad: true, nativeClientFailureRecovery: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
