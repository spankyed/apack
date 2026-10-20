import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-pending-duration-failure.png') }).catch(() => {}) })
test('renders original notification-only focus groups', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { focusSummary } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!focusSummary, 'Explicit private native pending-duration profile required')
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await appPage.setViewportSize({ width: 1100, height: 900 })
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: Object.values(state.nativeUiViews).find((view: any) => view.threadId === state.currentThread?.id && view.state?.status === 'live'), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
  const dimensions = () => input.evaluate(element => { const root = element.closest('.xterm')!, box = root.querySelector('.xterm-screen')!.getBoundingClientRect(), font = getComputedStyle(root.querySelector('.xterm-char-measure-element')!), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!; context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`; return Math.round(box.width / context.measureText('W').width) })
  await expect.poll(dimensions).toBeGreaterThan(1)
  const terminal = new Terminal({ cols: await dimensions(), rows: 200, allowProposedApi: true })
  let lastSequence = 0, lastScreen = ''
  async function screen() {
    if (await input.isVisible()) { const cols = await dimensions(); if (cols > 1 && cols !== terminal.cols) terminal.resize(cols, 200) }
    const native = (await context()).native, chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminal.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminal.buffer.active
    lastScreen = Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    return lastScreen
  }
  try {
    let theme = false, security = false, navigated = false, trustAt = 0, attempts = 0
    await expect.poll(async () => {
      const current = await context(), kind = recognizeOnboardingPrompt(await screen(), workspace)
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('Workspace ready') === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    const composer = card.locator('[contenteditable="true"]')

    const source=async()=>JSON.parse(await readFile(join(workspace!,'native-focus-context.json'),'utf8').catch(()=>'{}'))
    await input.pressSequentially('/focus');await input.press('Enter');await expect.poll(screen).toContain('Focus view enabled')
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
    await composer.fill('Review the release notes in the background.');await card.getByRole('button',{name:'Send',exact:true}).click()
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='running'),{timeout:15000}).toBe(true)
    await writeFile(join(workspace!,'native-pending-duration-release'),'release')
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
    await composer.fill('Continue the release review after the worker finishes.');await card.getByRole('button',{name:'Send',exact:true}).click()
    const isNotification=(row:any)=>row.type==='collapsed_read_search'&&row.agentCount>0&&row.members?.every((member:any)=>member.type==='user')
    await expect.poll(async()=>(await source()).display?.selected?.some(isNotification),{timeout:15000}).toBe(true)
    const focused=await source(),originalGroup=focused.display.selected.find(isNotification)
    const group=appPage.locator('[data-native-tool-group="'+originalGroup.uuid+'"]')
    await expect(group).toBeVisible();await expect(group).not.toContainText('Used 0 tools');await expect(group).toContainText(/agent/i)
    const draft='Keep this release-review draft while inspecting completed work.';await composer.fill(draft)
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await group.scrollIntoViewIfNeeded();await expect(group).toBeInViewport();await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-notification-group-'+size.width+'.png')})}
    const collapsedText=await group.textContent();await group.getByRole('button',{name:'Expand tool activity',exact:true}).click();await expect(group.getByRole('button',{name:'Collapse tool activity',exact:true})).toBeVisible();await expect.poll(async()=>(await group.textContent())?.replace('Collapse tool activity','')).not.toBe(collapsedText?.replace('Expand tool activity',''));await group.getByRole('button',{name:'Collapse tool activity',exact:true}).click()
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await input.pressSequentially('/focus');await input.press('Enter');await expect.poll(screen).toContain('Focus view disabled')
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(group).toHaveCount(0);await expect(composer).toHaveText(draft)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!,'native-focus-summary-proof.json'),JSON.stringify({originalGroup,focused,originalGroupInteraction:true}))
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
    const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
    await composer.fill('Continue the same session after reviewing completed work.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeFocusThoughtDiscovery:true,nativeNotificationGroup:true,nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
  } finally { await writeFile(join(workspace!, 'native-pending-duration-screen.txt'), lastScreen); terminal.dispose() }
})
