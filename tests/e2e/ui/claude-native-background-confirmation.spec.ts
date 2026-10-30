import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, info) => { if (info.status !== info.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: info.outputPath('background-confirmation-failure.png') }).catch(() => {}) })
test('task-backed confirmation: hands an original native conversation to a separate background session from the everyday composer', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(120000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
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
    return native?.state?.status === 'live' && native.state.session?.turns >= 1
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const original = await context()
  const nativeWindow = await electronApp.browserWindow(appPage)
  async function capture(name: string) {
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    const size = appPage.viewportSize()!
    const png = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), size)
    await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
  }
  const run = promisify(execFile)
  const cli = async (args: string[]) => (await run(launcher!, args, { cwd: workspace, timeout: 20000, maxBuffer: 2 * 1024 * 1024 })).stdout
  const list = async () => JSON.parse(await cli(['agents', '--json', '--all', '--cwd', workspace!])) as any[]
  const before = await list()
  let job: any
  const observations: any = { parentSessionId: sessionId, parentNativePid: original.native.state.nativePid, before, errors }
  try {
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    const composer = card.locator('[contenteditable="true"]')
    await expect(composer).toBeVisible()
    await expect(composer).toBeEditable()
    await composer.fill('Start the owned review task before backgrounding this conversation.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const approval = appPage.getByRole('region', { name: 'Workflow approval', exact: true })
    await expect(approval).toBeVisible({ timeout: 15000 })
    await approval.getByRole('button', { name: 'Yes, run it', exact: true }).click()
    await expect(approval).toHaveCount(0)
    await expect.poll(async () => (await context()).native?.state?.activity?.pendingWorkflows ?? 0).toBe(1)
    await composer.fill('Keep these notes while reviewing the background session.')
    const draft = await composer.textContent()
    async function review() {
      const action = card.getByRole('button', { name: 'Run session in background', exact: true })
      if (await action.isVisible()) await action.click()
      else { await card.getByRole('button', { name: 'More actions', exact: true }).click(); await appPage.getByRole('menuitem', { name: 'Run session in background', exact: true }).click() }
      const dialog = appPage.getByRole('dialog', { name: 'Background this session?', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('1 running workflow subagent restarts from the beginning.')
      return dialog
    }
    let dialog = await review()
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await expect(dialog.getByRole('button', { name: 'Stay', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(dialog.getByRole('button', { name: 'Background anyway (1 subagent restarts)', exact: true })).toBeInViewport({ ratio: 1 })
      await capture('apack-native-background-review-' + name + '.png')
    }
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(composer).toHaveText(draft!)
    expect((await context()).native.state.nativePid).toBe(original.native.state.nativePid)
    await appPage.setViewportSize({ width: 1100, height: 900 })
    dialog = await review()
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(composer).toHaveText(draft!)
    dialog = await review()
    await dialog.getByRole('button', { name: 'Background anyway (1 subagent restarts)', exact: true }).click()
    await expect.poll(async () => {
      observations.current = await context()
      observations.jobs = await list()
      job = observations.jobs.find((row: any) => row.kind === 'background' && row.id && !before.some((old: any) => old.id === row.id))
      return Number.isSafeInteger(job?.pid) && job.pid > 1
    }, { timeout: 25000, intervals: [500] }).toBe(true)
    observations.job = job
    expect(job.sessionId).not.toBe(sessionId)
    expect(job.pid).toBeGreaterThan(1)
    await expect.poll(async () => (await context()).native?.state?.status, { timeout: 10000 }).toBe('exited')
    await expect.poll(async () => (await context()).claude.nativeContinuation).toMatchObject({ sessionId, continuedInSessionId: job.sessionId })
    const widget = appPage.getByRole('region', { name: 'Background Claude session', exact: true })
    await widget.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toBeEnabled({ timeout: 15000 })
    await composer.click(); await composer.press('Control+A'); await composer.pressSequentially('Keep these notes while the background session runs.')
    const retainedDraft = await composer.textContent()
    await widget.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled()
    await expect(composer).toHaveText(retainedDraft!)
    observations.running = await context()
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 })
      await capture('apack-native-background-running-' + name + '.png')
    }
    await widget.getByRole('button', { name: 'Stop background session', exact: true }).click()
    await expect(widget.getByRole('status')).toHaveText('Last reported: stopped', { timeout: 20000 })
    await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toHaveCount(0)
    await expect(composer).toHaveText(retainedDraft!)
    observations.uiStop = true
    observations.stopped = await context()
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await capture('apack-native-background-stopped-' + name + '.png')
    }
    observations.current = await context()
    observations.retainedDraft = retainedDraft
    expect(observations.current.sessionId).toBe(sessionId)
    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ sessionId, backgroundSessionId: job.sessionId, jobId: job.id, nativeBackgroundHandoff: true, nativeBackgroundConfirmation: true, nativeBackgroundControls: true, appHandoffAccepted: false }))
  } finally {
    if (!job) job = (await list()).find((row: any) => row.kind === 'background' && row.id && !before.some((old: any) => old.id === row.id))
    if (job) {
      observations.after = await list()
      if (observations.after.find((row: any) => row.id === job.id)?.state !== 'stopped') { observations.cleanupStop = await cli(['stop', job.id]); observations.after = await list() }
      expect(observations.after.find((row: any) => row.id === job.id)?.state).toBe('stopped')
    }
    observations.current = await context()
    await writeFile(join(workspace!, 'native-background-app-observation.json'), JSON.stringify(observations, null, 2))
  }
})
