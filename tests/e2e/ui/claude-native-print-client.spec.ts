import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('apack-native-print-client-failure.png') }).catch(() => {}) })
test('runs original print Client controls and retires them across native handoff', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, printClients, printTheme } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!printClients, 'Explicit private print Client fixture required')
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
  const composer = card.locator('[contenteditable="true"]')
  await card.getByRole('button', { name: 'Session tools', exact: true }).click()
  let draft = 'Review the release changes before sending.'
  await composer.fill(draft)
  const region = card.locator('[data-native-client]').filter({ hasText: 'Workspace' }).first()
  await expect(region).toContainText('Workspace connected · 0 updates')
  if (printTheme) {
    await expect(composer.locator('.claude-prompt-decoration').first()).toHaveCSS('color', 'rgb(171, 205, 239)')
    await expect(card.getByText('Release review', { exact: true })).toHaveCSS('color', 'rgb(171, 205, 239)')
    await expect(region.getByText('Workspace connected · 0 updates', { exact: true })).toHaveCSS('color', 'rgb(131, 201, 161)')
    await expect(region.getByRole('textbox', { name: 'Review note' })).toHaveCSS('color', 'rgb(224, 224, 224)')
  }
  const initialToken = await region.getAttribute('data-native-client')
  await region.getByRole('button', { name: 'Refresh workspace', exact: true }).click()
  await expect(region).toContainText('1 updates')
  await region.getByRole('textbox', { name: 'Review note' }).fill('rewrite')
  await expect(region.getByRole('textbox', { name: 'Review note' })).toHaveValue('Release notes')
  await region.getByRole('combobox', { name: 'Review scope' }).selectOption('b')
  await expect(region.getByRole('combobox', { name: 'Review scope' })).toHaveValue('b')
  await region.focus(); await region.press('x')
  await expect(region).toContainText('Workspace synchronized · 1 updates')
  await expect(region).toContainText('Key x')
  const refresh = async () => Number((await region.innerText()).match(/Refresh (\d+)/)?.[1])
  const clock = await refresh()
  await expect.poll(refresh).toBeGreaterThan(clock)
  expect((await context()).turns).toBe(1)
  if (printTheme) {
    const template = card.getByRole('button', { name: 'Use review template', exact: true })
    await template.scrollIntoViewIfNeeded(); await template.click()
    draft = 'Review release notes before merging.'
    await expect(composer).toHaveText(draft)
    const painted = composer.locator('.claude-prompt-decoration').first()
    await expect(painted).toHaveCSS('color', 'rgb(171, 205, 239)')
    await expect(painted).toHaveCSS('background-color', 'rgb(38, 50, 65)')
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-print-theme-fill.json'), 'utf8').catch(() => '{}')).result?.isFilled).toBe(true)
    const edits = async () => JSON.parse(await readFile(join(workspace!, 'native-print-theme-edits.json'), 'utf8'))
    await composer.click(); await composer.press('Home'); await composer.press('Shift+ArrowRight'); await composer.press('Shift+ArrowRight')
    await expect.poll(async () => appPage.evaluate(() => window.getSelection()?.toString())).toBe('Re')
    await appPage.waitForTimeout(300)
    const before = (await edits()).length
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-print-theme-original.png') })
    await writeFile(join(workspace!, '.claude/themes/research.json'), JSON.stringify({ name: 'Research', base: 'dark', overrides: { text: '#d0e0f0', inverseText: '#112233', warning: '#fedcba', success: '#91c9e1' } }))
    await expect(painted).toHaveCSS('color', 'rgb(254, 220, 186)')
    await expect(painted).toHaveCSS('background-color', 'rgb(17, 34, 51)')
    await expect(card.getByText('Release review', { exact: true })).toHaveCSS('color', 'rgb(254, 220, 186)')
    await expect(region.getByText('Workspace synchronized · 1 updates', { exact: true })).toHaveCSS('color', 'rgb(145, 201, 225)')
    await expect(region.getByRole('textbox', { name: 'Review note' })).toHaveCSS('color', 'rgb(208, 224, 240)')
    expect((await edits()).length).toBe(before)
    expect(await appPage.evaluate(() => window.getSelection()?.toString())).toBe('Re')
    await expect(composer).toHaveText(draft)
    await expect(region.getByRole('textbox', { name: 'Review note' })).toHaveValue('Release notes')
  }
  for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
    await appPage.setViewportSize(size)
    await region.getByRole('button', { name: 'Refresh workspace', exact: true }).scrollIntoViewIfNeeded()
    await expect(region.getByRole('button', { name: 'Refresh workspace', exact: true })).toBeInViewport()
    await region.getByRole('combobox', { name: 'Review scope' }).scrollIntoViewIfNeeded()
    await expect(region.getByRole('combobox', { name: 'Review scope' })).toBeInViewport({ ratio: .99 })
    await expect(composer).toHaveText(draft)
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: .99 })
    await appPage.screenshot({ path: testInfo.outputPath(`apack-native-print-client-${size.width}-${size.height}.png`) })
  }
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
  await expect(composer).toHaveText(draft)
  await expect(region).toContainText('Workspace connected · 0 updates')
  expect(await region.getAttribute('data-native-client')).not.toBe(initialToken)
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  await composer.fill('Continue the same session after workspace status review.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  await expect(region).toContainText('Workspace connected · 0 updates')
  await region.getByRole('button', { name: 'Refresh workspace', exact: true }).click()
  await expect(region).toContainText('1 updates')
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'composer-layout', nativePrintTheme: printTheme === true, nativePrintClient: true, nativePrintClientControls: true, nativePrintClientClock: true, nativePrintClientRetirement: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
