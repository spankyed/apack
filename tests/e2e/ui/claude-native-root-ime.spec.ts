import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-pending-duration-failure.png') }).catch(() => {}) })
test('commits root Client IME text once across original native redraws', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { rootIme } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!rootIme, 'Explicit private native pending-duration profile required')
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
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('AppNativeMain '+sessionId) === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    const composer = card.locator('[contenteditable="true"]')


    await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
    const draft='Keep the release-review draft while typing in the Client.';await composer.fill(draft)
    const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
    const region=card.locator('[data-native-client]').filter({hasText:'Client input:'}),proxy=region.locator('[data-native-client-text-input]')
    await expect(region).toBeVisible();await region.click();await expect(proxy).toBeFocused()
    const native=async()=>JSON.parse(await readFile(join(workspace!,'native-root-ime-state.json'),'utf8').catch(()=>'{}'))
    const cdp=await appPage.context().newCDPSession(appPage)
    const startingTurns=(await context()).native.state.session.turns;expect(typeof startingTurns).toBe('number')
    await cdp.send('Input.imeSetComposition',{text:'にほん',selectionStart:3,selectionEnd:3})
    await expect(proxy).toHaveValue('にほん');await expect(region.locator('[data-native-client-composition]')).toHaveText('にほん')
    const beforeRedraw=await native();await expect.poll(async()=>(await native()).ticks).toBeGreaterThan(beforeRedraw.ticks+2)
    const afterRedraw=await native();expect(afterRedraw.text).toBe('');expect(afterRedraw.keys).toEqual([]);await expect(proxy).toHaveValue('にほん');await expect(composer).toHaveText(draft)
    await appPage.screenshot({path:testInfo.outputPath('native-root-ime-preview.png')})
    await cdp.send('Input.insertText',{text:'日本語'})
    await expect.poll(async()=>(await native()).text).toBe('日本語')
    const committed=await native();expect(committed.keys).toEqual(['日','本','語']);await expect(proxy).toHaveValue('');await expect(region.locator('[data-native-client-composition]')).toHaveCount(0);await expect(composer).toHaveText(draft)
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await region.scrollIntoViewIfNeeded();await expect(region).toBeInViewport();await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-root-ime-'+size.width+'.png')})}
    expect((await context()).native.state.session.turns).toBe(startingTurns)
    await cdp.detach();expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!,'native-root-ime-proof.json'),JSON.stringify({beforeRedraw,afterRedraw,committed}))
    await tools.click();await composer.focus();await expect(composer).toHaveText(draft);await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).messages.some((message:any)=>message.sender==='user'&&message.text===draft)).toBe(true)
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
    const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
    await composer.fill('Continue after the Client composition review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeRootClientIme:true,nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
  }finally{await writeFile(join(workspace!,'native-root-ime-screen.txt'),lastScreen);terminal.dispose()}
})
