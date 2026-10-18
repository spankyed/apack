import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reads MCP connection status through the existing native and print owners', async ({ app, appPage, electronApp }, testInfo) => {
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
  const sourceThreadId = (await context()).threadId
  await composer.fill('NativeForkCheckpointAlpha: remember this source-only marker.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.native?.state.busy === false && c.messages.some((m: any) => m.sender === 'assistant' && m.context?.claudeTerminalMessage && m.text === 'Fixture completed.') }).toBe(true)
  const checkpoint = (await context()).messages.filter((m: any) => m.sender === 'assistant' && m.context?.claudeTerminalMessage && m.text === 'Fixture completed.').at(-1)
  expect(checkpoint.context.cliUuid).toBeTruthy()
  const boundOwnerId = (await context()).native.state.ownerId
  await command('cc-mcp', 'status')
  await expect.poll(async () => (await context()).messages.some((m: any) => m.text.includes('Live MCP connections:') && m.text.includes('research: connected') && m.text.includes('research-fixture') && m.text.includes('echo'))).toBe(true)
  expect((await context()).native.state.ownerId).toBe(boundOwnerId)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await appPage.setViewportSize({width:680,height:900})
  await appPage.getByText(/Live MCP connections:/).last().scrollIntoViewIfNeeded()
  await appPage.screenshot({path:testInfo.outputPath('apack-native-mcp-status.png')})
  async function controlMcp(operation: string, expected: string) {
    const before=(await context()).messages.length
    await command('cc-mcp',operation+' research')
    await expect.poll(async()=>{const rows=(await context()).messages.slice(before);return rows.some((m:any)=>m.text.includes('Live MCP connections:')&&m.text.includes('research: '+expected))},{timeout:15000}).toBe(true)
  }
  if(planScenario==='mcp-controls'){
    await controlMcp('disable','disabled')
    await controlMcp('disable','disabled')
    await appPage.getByText(/Live MCP connections:/).last().scrollIntoViewIfNeeded()
    await appPage.screenshot({path:testInfo.outputPath('apack-native-mcp-disabled.png')})
    await controlMcp('enable','connected')
    await controlMcp('enable','connected')
    await controlMcp('reconnect','connected')
    expect((await context()).native.state.ownerId).toBe(boundOwnerId)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
  }
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
  const back = section.getByRole('button', { name: 'Back to conversation', exact: true })
  if (await back.isVisible()) await back.click()
  await composer.fill('Continue after native MCP status.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.claude.chatState === 'success' && c.messages.filter((m: any) => m.text === 'Fixture completed.').length === 3 }).toBe(true)
  const beforePrintStatus=(await context()).messages.length
  await command('cc-mcp', 'list')
  await expect.poll(async () => (await context()).messages.slice(beforePrintStatus).some((m: any) => m.text.includes('Live MCP connections:') && m.text.includes('research: connected') && m.text.includes('echo'))).toBe(true)
  expect((await context()).sessionId).toBe(sessionId)
  await appPage.getByText(/Live MCP connections:/).last().scrollIntoViewIfNeeded()
  await appPage.screenshot({path:testInfo.outputPath('apack-print-mcp-status.png')})
  if(planScenario==='mcp-controls'){
    await controlMcp('disable','disabled')
    await controlMcp('disable','disabled')
    await controlMcp('enable','connected')
    await controlMcp('enable','connected')
    await controlMcp('reconnect','connected')
    await appPage.getByText(/Live MCP connections:/).last().scrollIntoViewIfNeeded()
    await appPage.screenshot({path:testInfo.outputPath('apack-print-mcp-reconnected.png')})
  }
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({actualAppGui:true,nativePlanScenario:planScenario,...planScenario==='mcp-controls'?{nativeMcpControls:true,printMcpControls:true,mcpIdempotentCommands:true}:{},nativeMcpStatus:true,printMcpStatus:true,nativeMcpToolObserved:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
})
