import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-layout-failure.png') }).catch(() => {}) })
test('sizes original desktop Client status contributions at normal and compact widths', async ({ app, appPage }, testInfo) => {
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
  await card.getByRole('button', { name: 'Session tools', exact: true }).click()
  const drafts = 'Review release notes with native workspace status.'
  await composer.fill(drafts)
  const regions = appPage.locator('[data-native-client]')
  const named = (label: string) => regions.filter({ hasText: label }).first()
  const measurements: any[] = []
  for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
    await appPage.setViewportSize(size)
    await expect(named('Workspace connected')).toBeVisible()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-client-layout-regions.json'), 'utf8').catch(() => '[]')).filter((row: any) => row.columns > 0).length).toBeGreaterThan(3)
    const boxes: any = {}
    for (const label of ['Session', 'Ready', 'Workspace connected', 'Context available', 'Height fixed', 'Height percent', 'Height flexible']) {
      boxes[label] = await named(label).evaluate(element => {
        const box = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect(), style = getComputedStyle(element)
        const measure = element.querySelector('span[aria-hidden]')!.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height, parentWidth: parent.width, parentHeight: parent.height, columns: Math.floor((box.width + 1 / 64) / (measure.width / 100)), rows: Math.floor((box.height + 1 / 64) / measure.height), lineHeight: parseFloat(style.lineHeight), cellWidth: measure.width / 100 }
      })
    }
    expect(boxes.Session.width).toBeCloseTo(12 * boxes.Session.cellWidth, 0)
    expect(boxes.Ready.width).toBeCloseTo(5 * boxes.Ready.cellWidth, 0)
    expect(boxes.Ready.columns).toBe(5)
    expect(boxes.Session.columns).toBe(12)
    expect(boxes['Workspace connected'].width).toBeGreaterThan(boxes.Ready.width)
    expect(boxes['Context available'].width).toBeCloseTo(boxes['Context available'].parentWidth / 2, 0)
    expect(boxes['Context available'].height).toBeCloseTo(2 * boxes['Context available'].lineHeight, 0)
    expect(boxes['Height fixed'].height).toBeCloseTo(boxes['Height fixed'].lineHeight, 0)
    expect(boxes['Height percent'].height).toBeCloseTo(boxes['Height percent'].parentHeight / 2, 0)
    expect(boxes['Height flexible'].height).toBeCloseTo(2 * boxes['Height flexible'].lineHeight, 0)
    await expect.poll(async () => {
      const receipts = JSON.parse(await readFile(join(workspace!, 'native-client-layout-regions.json'), 'utf8'))
      return Object.entries(boxes).every(([label, box]: [string, any]) => receipts.some((row: any) => row.label === label && row.columns === box.columns && row.rows === box.rows && row.surface === 'desktop' && row.component === 'AbovePrompt'))
    }).toBe(true)
    await expect(composer).toHaveText(drafts)
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: .99 })
    await appPage.screenshot({ path: testInfo.outputPath(`apack-native-client-layout-${size.width}-${size.height}.png`) })
    measurements.push({ size, boxes })
  }
  expect(measurements[0].boxes['Workspace connected'].width).toBeGreaterThan(measurements[1].boxes['Workspace connected'].width)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!, 'native-client-layout-measurements.json'), JSON.stringify(measurements))
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
  await composer.fill('Continue the same session after workspace status review.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'composer-layout', nativeClientLayout: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
