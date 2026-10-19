import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('completes native extended questions, follow-up, refusal retry and cancellation recovery', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, documentTheme } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
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
    await writeFile(join(workspace!, 'question-onboarding-output.txt'), text.slice(-100000))
    const screen = recognizeOnboardingPrompt(text, workspace)
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && navigated && !trusted) { trusted = true; await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true).catch(async error => { await appPage.screenshot({ path: testInfo.outputPath('apack-question-onboarding-failure.png') }); throw error })
  await expect(card).toBeHidden()
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const composer = card.locator('[contenteditable="true"]'), panel = appPage.getByTestId('native-question-panel')
  async function begin(round: number, draft: string) {
    await composer.fill('ResearchQuestionTurn' + round + ': help configure this project.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')
    await composer.fill(draft)
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Which language should the examples use?', { exact: true })).toBeVisible()
  }
  async function done() { await expect(panel).toBeHidden(); await expect.poll(async () => (await context()).native?.state.busy).toBe(false) }
  await begin(1, 'Draft retained during project setup')
  await panel.getByRole('radio', { name: 'TypeScript', exact: true }).check()
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await panel.getByRole('textbox', { name: 'Your answer', exact: true }).fill('Notebook')
  await panel.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(panel.getByRole('radio', { name: 'TypeScript', exact: true })).toBeChecked()
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(panel.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveValue('Notebook')
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(panel.getByRole('button', { name: 'Next', exact: true })).toBeInViewport({ ratio: 0.99 })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-project-question-' + height + '.png') })
  }
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(panel.getByRole('spinbutton')).toHaveValue('3')
  await panel.getByRole('spinbutton').fill('6')
  await panel.getByText('Add a general response', { exact: true }).click()
  await panel.getByRole('textbox', { name: 'General response', exact: true }).fill('X'.repeat(32768))
  await panel.getByRole('button', { name: 'Submit answers', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByRole('spinbutton')).toHaveValue('6')
  await panel.getByRole('textbox', { name: 'General response', exact: true }).fill('Keep the examples short.')
  await panel.getByRole('button', { name: 'Ask again', exact: true }).click()
  await expect(panel.getByText('What should the first example demonstrate?', { exact: true })).toBeVisible()
  await panel.getByRole('textbox', { name: 'Your answer', exact: true }).fill('A typed greeting.')
  await panel.getByRole('button', { name: 'Submit answers', exact: true }).click()
  await done()
  await expect(composer).toHaveText('Draft retained during project setup')
  await begin(2, 'Draft retained after cancelling questions')
  await panel.getByRole('radio', { name: 'Python', exact: true }).check()
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await panel.getByRole('textbox', { name: 'Your answer', exact: true }).fill('Unsubmitted project')
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  await done()
  await expect(composer).toHaveText('Draft retained after cancelling questions')
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(composer).toBeInViewport({ ratio: 0.99 })
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 0.99 })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-question-cancelled-draft-' + height + '.png') })
  }
  await composer.fill('Continue the same session after question verification.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui:true,nativePlanScenario:'question-forms',nativeQuestionExtended:true,nativeQuestionFollowUp:true,nativeQuestionRefusalRetry:true,nativeQuestionCancellation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors }, null, 2))
})
