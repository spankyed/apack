import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('apack-native-print-client-failure.png') }).catch(() => {}) })
test('delivers a neighbouring native callback once across Client status redraws', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, printClients, snapshotActions } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!printClients || !snapshotActions, 'Explicit private print Client fixture required')
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
  const composer = card.locator('[contenteditable="true"]')
  await card.getByRole('button', { name: 'Session tools', exact: true }).click()
  let draft = 'Review the release notes before sending.'
  await composer.fill(draft)
  const region = card.locator('[data-native-client]').filter({ hasText: 'Workspace connected' }).first()
  await expect(region).toContainText('Workspace connected')
  const firstToken = await region.getAttribute('data-native-client')
  const refresh = async () => Number((await region.innerText()).match(/Refresh (\d+)/)?.[1])
  const action = () => appPage.evaluate(() => {
    const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
    const find = (node: any): any => node?.kind === 'button' && node.label === 'Use review template' ? node.actionId : node?.children?.map(find).find(Boolean)
    for (const [mountId, view] of Object.entries(state.nativeUiViews) as [string, any][]) if (view.threadId === state.currentThread?.id && view.state.status === 'live') { const actionId = find(view.state.tree); if (actionId) return { mountId, actionId } }
  })
  const beforeAction = await action(); expect(beforeAction?.actionId).toBeTruthy()
  const beforeTick = await refresh()
  await expect.poll(refresh).toBeGreaterThan(beforeTick + 1)
  const afterAction = await action(); expect(afterAction).toEqual(beforeAction)
  const afterTick = await refresh()
  await card.getByRole('button', { name: 'Use review template', exact: true }).click()
  draft = 'Review release notes before merging.'
  await expect(composer).toHaveText(draft)
  const receipt = async () => JSON.parse(await readFile(join(workspace!, 'native-print-theme-fill.json'), 'utf8').catch(() => '{}'))
  await expect.poll(receipt).toMatchObject({ call: 1, result: { isFilled: true }, before: { text: 'Review the release notes before sending.' }, after: { text: draft } })
  await writeFile(join(workspace!, 'native-snapshot-action-app.json'), JSON.stringify({ beforeAction, afterAction, beforeTick, afterTick, originalCallbackCount: (await receipt()).call }))
  const painted = composer.locator('.claude-prompt-decoration').first()
  await expect(painted).toHaveCSS('color', 'rgb(171, 205, 239)')
  await composer.click(); await composer.press('Home'); await composer.press('Shift+ArrowRight'); await composer.press('Shift+ArrowRight')
  await expect.poll(async () => appPage.evaluate(() => window.getSelection()?.toString())).toBe('Re')
  await appPage.waitForTimeout(300)
  const edits = async () => JSON.parse(await readFile(join(workspace!, 'native-print-theme-edits.json'), 'utf8'))
  const editCount = (await edits()).length
  const beforeInvalidationAction = await action(); expect(beforeInvalidationAction?.actionId).toBeTruthy()
  const beforeReloadTick = await refresh()
  await writeFile(join(workspace!, '.claude/themes/research.json'), JSON.stringify({ name: 'Research', base: 'dark', overrides: { text: '#d0e0f0', inverseText: '#112233', warning: '#fedcba', success: '#91c9e1' } }))
  await expect(painted).toHaveCSS('color', 'rgb(254, 220, 186)')
  await expect(card.getByText('Release review', { exact: true })).toHaveCSS('color', 'rgb(254, 220, 186)')
  const afterInvalidationAction = await action(); expect(afterInvalidationAction?.actionId).toBeTruthy(); expect(afterInvalidationAction).not.toEqual(beforeInvalidationAction)
  await writeFile(join(workspace!, 'native-snapshot-invalidation-app.json'), JSON.stringify({ beforeInvalidationAction, afterInvalidationAction }))
  expect(await region.getAttribute('data-native-client')).toBe(firstToken)
  expect(await refresh()).toBeGreaterThanOrEqual(beforeReloadTick)
  expect((await edits()).length).toBe(editCount)
  expect(await appPage.evaluate(() => window.getSelection()?.toString())).toBe('Re')
  expect((await context()).turns).toBe(1)
  for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
    await appPage.setViewportSize(size)
    await expect(card.getByRole('button', { name: 'Use review template', exact: true })).toBeInViewport({ ratio: .99 })
    await expect(composer).toHaveText(draft)
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: .99 })
    await appPage.screenshot({ path: testInfo.outputPath(`apack-native-snapshot-actions-${size.width}-${size.height}.png`) })
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
  await expect(region).toContainText('Workspace connected')
  expect(await region.getAttribute('data-native-client')).not.toBe(firstToken)
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  await composer.fill('Continue the same session after workspace status review.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  await expect(region).toContainText('Workspace connected')
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'composer-layout', nativeStableSnapshotActions: true, nativeInvalidationRetirement: true, nativePromptCanonicalFill: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
