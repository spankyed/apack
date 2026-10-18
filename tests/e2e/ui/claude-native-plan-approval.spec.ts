import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reviews native plans and preserves original mode, context and session choices', async ({ app, appPage, electronApp }, testInfo) => {
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
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: workspace!, phase: ['enter', 'auto-enter'].includes(planScenario) ? 'Edit' : 'Plan' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
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
  const ownerId = (await context()).native.state.ownerId
  await composer.fill('NativePlanFixtureSeedAlpha: Create the synthetic plan and request approval.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const panel = appPage.getByTestId('native-plan-panel')
  let initialPending: any
  const edited = '# Synthetic native plan\n\nReviewed in apack. Keep the checks.\n'
  const approves = ['enter', 'keep', 'keep-auto', 'accept-edits', 'clear-accept-edits', 'clear', 'managed-clear', 'empty'].includes(planScenario)
  const clears = ['clear', 'managed-clear', 'clear-accept-edits'].includes(planScenario)
  const choice = planScenario === 'enter' || planScenario === 'empty' ? 'yes' : clears ? planScenario === 'clear-accept-edits' ? 'yes-accept-edits' : 'yes-auto-clear-context' : planScenario === 'accept-edits' ? 'yes-accept-edits-keep-context' : planScenario === 'keep-auto' ? 'yes-resume-auto-mode' : 'yes-default-keep-context'
  let button = ''
  if (planScenario !== 'auto-enter') {
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect.poll(async () => (await context()).claude.pendingControlRequest?.toolName).toBe(planScenario === 'enter' ? 'EnterPlanMode' : 'ExitPlanMode')
    initialPending = (await context()).claude.pendingControlRequest
    if (!['enter', 'empty', 'withheld'].includes(planScenario)) await expect(panel.getByTestId('native-plan-preview')).toContainText('Synthetic native plan')
    if (planScenario === 'withheld') { await expect(panel.getByTestId('native-plan-withheld')).toBeVisible(); await expect(panel.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0) }
    if (planScenario === 'empty') await expect(panel).toContainText('No plan was provided')
    if (['keep', 'clear', 'managed-clear', 'clear-accept-edits'].includes(planScenario)) {
      await panel.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await panel.getByRole('textbox', { name: 'Edit proposed plan', exact: true }).fill(edited)
      await panel.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(panel.getByTestId('native-plan-preview')).toContainText('Reviewed in apack')
    }
    if (planScenario !== 'enter') await panel.getByRole('textbox', { name: 'Plan feedback', exact: true }).fill('Keep the checks')
    if (approves) await panel.locator('input[value="' + choice + '"]').check()
    await appPage.setViewportSize({ width: 680, height: 900 })
    await panel.locator('.body').evaluate(element => { element.scrollTop = 0 })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-plan-' + planScenario + '-review.png') })
    await appPage.setViewportSize({ width: 680, height: 600 })
    if (approves) await panel.locator('input[value="' + choice + '"]').scrollIntoViewIfNeeded()
    else await panel.getByRole('textbox', { name: 'Plan feedback', exact: true }).scrollIntoViewIfNeeded()
    await expect.poll(() => panel.evaluate(element => Array.from(element.querySelectorAll('footer button')).every(button => { const r = button.getBoundingClientRect(); return r.height >= 28 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }))).toBe(true)
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-plan-' + planScenario + '-compact.png') })
    button = planScenario === 'cancel' ? 'Cancel' : approves ? planScenario === 'enter' ? 'Enter plan mode' : 'Approve plan' : 'Keep planning'
    await panel.getByRole('button', { name: button, exact: true }).click()
    await expect(panel).toBeHidden()
    if (planScenario === 'cancel') await expect.poll(async () => (await context()).native?.state.status).toMatch(/^(exited|error)$/)
    else {
      if (clears) {
        await expect.poll(async () => (await context()).sessionId, { timeout: 15000 }).not.toBe(sessionId)
        expect((await context()).claude.previousSessionIds).toContain(sessionId)
      }
      const mode = planScenario === 'enter' ? 'plan' : approves ? planScenario === 'clear-accept-edits' ? 'acceptEdits' : clears || planScenario === 'keep-auto' ? 'auto' : planScenario === 'accept-edits' ? 'acceptEdits' : 'default' : 'plan'
      await expect.poll(async () => { const c = await context(); return [c.claude.permissionMode, c.native?.state.session?.permissionMode, c.native?.state.busy] }, { timeout: 15000 }).toEqual([mode, mode, false])
      expect((await context()).native.state.ownerId).toBe(ownerId)
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      if (approves) await expect.poll(async () => (await context()).phase).toBe(planScenario === 'enter' ? 'Plan' : 'Edit')
      await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
      await section.getByRole('button', { name: 'Stop session', exact: true }).click()
      await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
    }
  } else {
    await expect.poll(async () => { const c = await context(); return [c.claude.permissionMode, c.phase, c.native?.state.busy] }, { timeout: 15000 }).toEqual(['plan', 'Plan', false])
    await expect(panel).toBeHidden()
    expect((await context()).native.state.ownerId).toBe(ownerId)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-plan-auto-enter.png') })
    await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
    await section.getByRole('button', { name: 'Stop session', exact: true }).click()
    await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  }
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true })
  if (await back.isVisible()) await back.click()
  const finalSessionId = (await context()).sessionId
  const journals: Record<string, any[]> = {}
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    for (const id of [...new Set([sessionId, finalSessionId])]) {
      try { journals[id] = (await readFile(join(workspace!, '.claude/projects', bucket, id + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
  }
  const original = journals[sessionId].find(row => row.type === 'user' && row.message?.content === 'NativePlanFixtureSeedAlpha: Create the synthetic plan and request approval.')
  expect(original?.uuid).toBeTruthy()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original.uuid).length).toBe(1)
  if (clears) {
    const continuation = journals[finalSessionId].find(row => row.type === 'user' && typeof row.message?.content === 'string' && row.message.content.startsWith('Implement the following plan:'))
    expect(continuation?.message.content).toContain('Reviewed in apack')
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === continuation.uuid).length).toBe(1)
  }
  if (['keep', 'clear', 'managed-clear', 'clear-accept-edits'].includes(planScenario)) expect(await readFile(initialPending.nativeTerminal.plan.planFilePath, 'utf8')).toBe(edited)
  const nativeCost = journals[finalSessionId].filter(row => row.type === 'cost-state').at(-1).totalCostUSD
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await expect(card).toBeVisible()
  const beforeResume = (await context()).messages.filter((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.').length
  await composer.fill('Continue after native plan decisions.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.').length).toBe(beforeResume + 1)
  expect((await context()).sessionId).toBe(finalSessionId)
  const resumedCost = (await context()).claude.totalCostUsd; expect(resumedCost).toBeGreaterThan(nativeCost)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: planScenario, nativePlanReview: planScenario !== 'auto-enter', nativePlanWithoutDialog: planScenario === 'auto-enter', nativePlanChoice: planScenario === 'auto-enter' ? 'automatic' : approves ? choice : planScenario === 'cancel' ? 'cancel' : 'no', nativePlanDecision: button, nativePlanCompactControls: planScenario !== 'auto-enter', nativePlanContextTransition: clears, nativePlanModeSynchronized: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, sessionId, finalSessionId, boundNativePid, nativeCost, resumedCost, browserErrors: errors }, null, 2))
})
