import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('edits and remembers native Bash permission prefixes from the app', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
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
  const panel = appPage.getByTestId('native-bash-approval')
  const target = join(workspace!, 'fixture.txt')
  async function requestBash(turn: number) {
    await composer.fill('ResearchPermissionTurn' + turn)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect(panel.getByTestId('native-bash-cwd')).toHaveText(workspace!)
    await expect(panel.getByTestId('native-bash-command')).toContainText(target)
    await expect(panel.getByTestId('native-bash-command')).toContainText(' -e ')
    await expect.poll(() => panel.evaluate(element => Array.from(element.querySelectorAll('footer button')).every(button => { const r = button.getBoundingClientRect(); return r.height >= 28 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }))).toBe(true)
  }
  await requestBash(1)
  await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  expect(await readFile(target, 'utf8')).toBe('synthetic protocol fixture\n')
  await writeFile(target, 'Preserved after denial')
  await requestBash(2)
  await panel.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  expect(await readFile(target, 'utf8')).toBe('Preserved after denial')
  await requestBash(3)
  await expect(panel.getByText('Remember permission or change mode', { exact: true })).toBeVisible()
  await panel.getByText('Remember permission or change mode', { exact: true }).click()
  const choices = panel.getByRole('combobox', { name: 'Bash approval choice', exact: true })
  await choices.selectOption('yes-prefix-edited')
  const prefix = panel.getByRole('textbox', { name: 'Remembered command prefix', exact: true })
  const originalPrefix = await prefix.inputValue(), editedPrefix = originalPrefix.replace(/ \*$/, ' -e *')
  expect(editedPrefix).not.toBe(originalPrefix)
  await prefix.fill(editedPrefix)
  const originalCommand = await panel.getByTestId('native-bash-command').textContent()
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport()
    await expect(prefix).toHaveValue(editedPrefix)
    await expect(prefix).toBeFocused()
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-bash-prefix-before-geometry-' + height + '.png') })
    await writeFile(join(workspace!, 'bash-prefix-geometry-' + height + '.json'), JSON.stringify(await prefix.evaluate(element => ({ field: element.getBoundingClientRect().toJSON(), details: element.closest('.details')!.getBoundingClientRect().toJSON(), scrollTop: element.closest('.details')!.scrollTop, scrollHeight: element.closest('.details')!.scrollHeight, clientHeight: element.closest('.details')!.clientHeight }))))
    await expect.poll(() => prefix.evaluate(element => { const field = element.getBoundingClientRect(), details = element.closest('.details')!.getBoundingClientRect(); return field.top >= details.top && field.bottom <= details.bottom })).toBe(true)
    await expect(prefix).toBeInViewport()
    await expect(choices).toBeInViewport()
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-bash-prefix-' + height + '.png') })
  }
  await panel.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  const settings = JSON.parse(await readFile(join(workspace!, '.claude/settings.local.json'), 'utf8'))
  expect(settings.permissions.allow).toContain('Bash(' + editedPrefix + ')')
  await writeFile(target, 'Replace after remembered approval')
  await composer.fill('ResearchPermissionTurn4')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => await readFile(target, 'utf8')).toBe('synthetic protocol fixture\n')
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  await expect(panel).toBeHidden()
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).sessionId).toBe(sessionId)
  let journal: any[] = []
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  for (const turn of [1, 2, 3, 4]) {
    const original = journal.find(row => row.type === 'user' && row.message?.content === 'ResearchPermissionTurn' + turn)
    expect(original?.uuid).toBeTruthy()
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original.uuid).length).toBe(1)
  }
  const blocks = journal.flatMap(row => Array.isArray(row.message?.content) ? row.message.content : [])
  expect(blocks.find(block => block.type === 'tool_use' && block.id === 'toolu_research_fixture_3')?.input.command).toBe(originalCommand)
  for (const turn of [3, 4]) expect(blocks.find(block => block.type === 'tool_result' && block.tool_use_id === 'toolu_research_fixture_' + turn)?.is_error).toBe(false)
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  const nativeCost = journal.filter(row => row.type === 'cost-state').at(-1).totalCostUSD
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const printResults = async () => (await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8')).split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line))
  const prior = (await printResults()).length
  await composer.fill('Continue after remembered Bash approval.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await printResults()).length).toBe(prior + 1)
  expect((await printResults()).at(-1)).toMatchObject({ sessionId, subtype: 'success' })
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeBashStanding: true, nativeBashAllow: true, nativeBashDeny: true, nativeBashPrefixEdited: true, nativeBashRulePersisted: true, nativeBashNextCommandAllowed: true, nativeBashCommandPreserved: true, nativeBashCompactControls: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, sessionId, boundNativePid, nativeCost, originalCommand, editedPrefix, browserErrors: errors }, null, 2))
})
