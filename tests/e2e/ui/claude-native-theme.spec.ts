import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('renders the original saved custom theme and live reload without replacing native controls', async ({ app, appPage, electronApp }, testInfo) => {
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
  const boundNativePid = (await context()).native.state.nativePid
  await input.pressSequentially('/theme')
  await input.press('Enter')
  await expect.poll(async () => (await context()).native.output.map((chunk: any) => chunk.text).join('')).toContain('Research')
  // Original picker order: auto, six builtins, then user themes. Onboarding saved dark.
  for (let index = 0; index < 6; index++) await input.press('ArrowDown')
  await input.press('Enter')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, '.claude.json'), 'utf8')).theme).toBe('custom:research')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await appPage.setViewportSize({ width: 680, height: 900 })
  await card.getByRole('button', { name: 'Session tools', exact: true }).click()
  const label = card.getByText('Native themed label', { exact: true })
  await expect(label).toHaveCSS('color', 'rgb(17, 34, 51)')
  const themedBox = label.locator('..')
  await expect(themedBox).toHaveCSS('border-top-color', 'rgb(171, 205, 239)')
  const composer = card.locator('[contenteditable="true"]')
  await composer.fill('Draft retained during native theme reload')
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme.png') })
  await writeFile(join(workspace!, '.claude/themes/research.json'), JSON.stringify({ name: 'Research', base: 'dark', overrides: { text: '#abcdef', success: '#998877', warning: '#123456' } }))
  await expect(label).toHaveCSS('color', 'rgb(153, 136, 119)', { timeout: 10000 })
  await expect(themedBox).toHaveCSS('border-top-color', 'rgb(18, 52, 86)')
  await expect(composer).toHaveText('Draft retained during native theme reload')
  await card.getByRole('button', { name: 'Native theme action', exact: true }).click()
  await expect.poll(async () => readFile(join(workspace!, 'native-theme-action.txt'), 'utf8').catch(() => '')).toBe('pressed')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).sessionId).toBe(sessionId)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme-reloaded.png') })
  await composer.fill('Continue after native theme verification.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.native?.state.busy === false && c.messages.some((m: any) => m.context?.claudeTerminalMessage && m.text === 'Fixture completed.') }).toBe(true)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=> (await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue the same session after layout verification.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=> (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeCustomTheme:true,nativeThemeReload:true,nativeRetainedDraft:true,nativeThemeAction:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
})
