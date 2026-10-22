import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('preserves declared native Text wrapping at actual width and through resize', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const restingHover = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8')).restingHover === true
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
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  // Initialization owns 10s in host-controls; reserve the usual 5s response observation after it.
  await expect.poll(async () => (await context()).turns, { timeout: 15000, message: 'Original native initialization and seed response complete before link checks' }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'))
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1)
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!
  expect(dimensions.cols).toBeGreaterThan(1); expect(dimensions.cols).toBeLessThanOrEqual(500)
  terminalScreen = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
  let lastSequence = 0
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Session ready') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Session ready')
    await expect(main).toContainText('Reviewing release notes')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')
  await composer.fill('Review the release summary before merging.')
  const tools = card.getByRole('button', { name: 'Session tools', exact: true })
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
  const full = 'Release notes: /workspace/projects/desktop/integrations/claude-code/research/release-candidates/2026/october/verified/release-summary.md'
  const modes = ['wrap', 'end', 'middle', 'truncate', 'truncate-start', 'truncate-middle', 'truncate-end']
  const row = (mode: string) => card.locator('[data-native-text-wrap="' + mode + '"]')
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capturePage(file:string,width:number,height:number){
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    let timer:ReturnType<typeof setTimeout>|undefined
    const image=await Promise.race([nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {size:image.getSize(),png:image.toPNG().toString('base64')}},{width,height}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Owned Electron capture exceeded 30000ms')),30000)})]).finally(()=>{if(timer)clearTimeout(timer)})
    expect(image.size).toEqual({width,height});await writeFile(testInfo.outputPath(file),Buffer.from(image.png,'base64'))
  }
  const evidence: unknown[] = []
  if (!restingHover) {
  for (const [width, height] of [[680, 900], [1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    await expect(row('wrap')).toHaveText(full)
    for (const mode of modes.slice(1)) {
      await expect(row(mode)).toContainText('…')
      await expect.poll(async () => row(mode).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    }
    await writeFile(join(workspace!, 'native-text-layout-resize.json'), JSON.stringify(await Promise.all(modes.map(mode => row(mode).evaluate((element, mode) => ({ mode, width: element.getBoundingClientRect().width, text: element.textContent }), mode)))))
    // ResizeObserver and original-font measurement settle independently for each row.
    await expect.poll(async () => (await row('end').textContent()) === (await row('truncate').textContent())).toBe(true)
    await expect.poll(async () => (await row('end').textContent()) === (await row('truncate-end').textContent())).toBe(true)
    await expect.poll(async () => (await row('middle').textContent()) === (await row('truncate-middle').textContent())).toBe(true)
    expect(await row('end').textContent()).toMatch(/^Release notes: .*…$/)
    expect(await row('truncate-start').textContent()).toMatch(/^….*release-summary.md$/)
    expect(await row('middle').textContent()).toMatch(/^Release notes: .*….*release-summary.md$/)
    await expect(row('middle').locator('a')).toHaveAttribute('href', 'https://example.test/releases')
    await expect(row('middle').locator('.font-semibold').first()).toHaveText('Release notes: ')
    await expect(composer).toHaveText('Review the release summary before merging.')
    await expect(composer).toBeInViewport(); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    evidence.push(await row('middle').evaluate(element => ({ width: element.clientWidth, text: element.textContent, link: element.querySelector('a')?.textContent })))
    await capturePage('apack-native-text-wrap-' + width + '-' + height + '.png', width, height)
  }
  // Keep the original admitted href and real browser navigation, with an owned deterministic page.
  await electronApp.evaluate(({ session }) => {
    ;(globalThis as any).__nativeLinkRequests = []
    session.fromPartition('persist:browser').protocol.handle('https', request => {
      if (request.url !== 'https://example.test/releases') return new Response('Unowned fixture target', { status: 404 })
      ;(globalThis as any).__nativeLinkRequests.push(request.url)
      return new Response('<!doctype html><title>Release notes</title><h1>Release notes</h1><p>Review the migration guidance.</p>', { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } })
    })
  })
  const styleResets: unknown[] = [], crossSiteGroups: unknown[] = []
  const styledRun = (text: string) => card.locator('.native-text-run').filter({ hasText: new RegExp('^' + text + '$') })
  const readStyle = (text: string) => styledRun(text).evaluate(element => {
    const style = getComputedStyle(element)
    const ancestors: { opacity: string; decoration: string }[] = []
    for (let parent = element.parentElement; parent && !parent.classList.contains('native-extension-surface'); parent = parent.parentElement) {
      const paint = getComputedStyle(parent); ancestors.push({ opacity: paint.opacity, decoration: paint.textDecorationLine })
    }
    return { weight: style.fontWeight, italic: style.fontStyle, decoration: style.textDecorationLine, opacity: style.opacity, ancestors }
  })
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    await composer.hover()
    const parent = await readStyle('Checks pending '), plain = await readStyle('Release ready'), inherited = await readStyle('Inherited review')
    expect(parent).toMatchObject({ weight: '600', italic: 'italic', decoration: 'underline line-through', opacity: '0.6' })
    expect(plain).toMatchObject({ weight: '400', italic: 'normal', decoration: 'none', opacity: '1' })
    expect(plain.ancestors.every(style => style.opacity === '1' && style.decoration === 'none')).toBe(true)
    expect(inherited).toMatchObject({ weight: '600', italic: 'italic', decoration: 'underline line-through', opacity: '0.6' })
    await styledRun('Review detail trigger').hover()
    await expect.poll(() => readStyle('Review detail').then(style => ({ weight: style.weight, italic: style.italic, decoration: style.decoration, opacity: style.opacity }))).toEqual({ weight: '400', italic: 'normal', decoration: 'none', opacity: '1' })
    await expect(composer).toHaveText('Review the release summary before merging.')
    styleResets.push({ width, height, parent, plain, inherited, hovered: await readStyle('Review detail') })
    await capturePage(`apack-native-style-reset-${width}-${height}.png`, width, height)
    await composer.hover()
    await expect.poll(() => readStyle('Review detail').then(style => style.opacity)).toBe('0.6')
    const hint = card.locator('[data-native-placement="PromptHint"] .native-inline-text').filter({ hasText: /^Release review ready$/ })
    await expect(hint).toBeVisible()
    const trigger = styledRun('Review detail trigger')
    const color = (element: import('@playwright/test').Locator) => element.evaluate(node => getComputedStyle(node).color)
    const resting = await color(hint)
    await trigger.hover()
    await expect.poll(() => color(hint)).not.toBe(resting)
    const active = await color(hint)
    expect(active).toBe(await color(trigger))
    await composer.hover()
    await expect.poll(() => color(hint)).toBe(resting)
    await hint.hover()
    await expect.poll(() => color(trigger)).toBe(active)
    await expect(composer).toHaveText('Review the release summary before merging.')
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    expect((await context()).turns).toBe(1)
    crossSiteGroups.push({ width, height, resting, active, bothDirections: true, draftRetained: true })
    await capturePage(`apack-native-cross-site-hover-${width}-${height}.png`, width, height)
    await composer.hover()
    await expect.poll(() => color(hint)).toBe(resting)

  }
  await writeFile(join(workspace!, 'native-text-style-resets.json'), JSON.stringify({ styleResets, crossSiteGroups, sessionId, boundNativePid }))
  const linkActivations: unknown[] = []
  try {
  for (const [width, height] of [[1100, 900], [680, 600]]) {
    await appPage.setViewportSize({ width, height })
    for (const activation of ['primary', 'modified', 'middle'] as const) {
      const tabCount = () => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/browser')?.getSnapshot().context.tabs.filter((tab: any) => tab.url === 'https://example.test/releases').length ?? 0)
      const before = await tabCount()
      const link = row('wrap').locator('a')
      await link.click(activation === 'middle' ? { button: 'middle' } : activation === 'modified' ? { modifiers: ['Control'] } : {})
      await app.waitForSurface('default-setup/browser')
      await expect.poll(tabCount).toBe(before + 1)
      await app.navigate('default-setup/threads')
      await expect(composer).toHaveText('Review the release summary before merging.')
      expect((await context()).turns).toBe(1)
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      linkActivations.push({ width, height, activation, openedTabs: before + 1, draftRetained: true })
    }
    await capturePage(`apack-native-links-${width}-${height}.png`, width, height)
  }
  const requests = await electronApp.evaluate(() => (globalThis as any).__nativeLinkRequests as string[])
  expect(requests).toHaveLength(6)
  expect(requests.every(url => url === 'https://example.test/releases')).toBe(true)
  await writeFile(join(workspace!, 'native-link-activations.json'), JSON.stringify({ linkActivations, requests, sessionId, boundNativePid }))
  } finally {
    await electronApp.evaluate(({ session }) => { session.fromPartition('persist:browser').protocol.unhandle('https'); delete (globalThis as any).__nativeLinkRequests })
  }
  } else {
    const samples: { phase: number; width: number; height: number; active: boolean; pointerMoves: number; color: string }[] = []
    const trigger = card.locator('.native-inline-text').filter({ hasText: /^Review detail trigger$/ })
    const hint = card.locator('[data-native-placement="PromptHint"] .native-inline-text').filter({ hasText: /^Release review ready$/ })
    let phase = 0
    for (const [width, height] of [[1100, 900], [680, 600]]) {
      await appPage.setViewportSize({ width, height })
      await composer.hover()
      await expect(hint).toBeVisible()
      const resting = await hint.evaluate(node => getComputedStyle(node).color)
      await trigger.hover()
      await expect.poll(() => hint.evaluate(node => getComputedStyle(node).color)).not.toBe(resting)
      const active = await hint.evaluate(node => getComputedStyle(node).color)
      const point = await trigger.boundingBox(); expect(point).not.toBeNull()
      await appPage.evaluate(() => {
        const state = window as any
        state.__restingHoverMoves = 0
        state.__restingHoverMove = () => { state.__restingHoverMoves++ }
        window.addEventListener('pointermove', state.__restingHoverMove)
      })
      try {
        for (let redraw = 0; redraw < 12; redraw++) {
          phase++
          const requestPath = join(workspace!, 'native-resting-hover-request.txt')
          await writeFile(requestPath + '.next', String(phase))
          await rename(requestPath + '.next', requestPath)
          await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-resting-hover-drawn.json'), 'utf8')).phase).toBe(phase)
          await expect(card.locator('.native-text-run').filter({ hasText: new RegExp('^Review update ' + phase + '$') })).toBeVisible()
          await expect.poll(() => hint.evaluate(node => getComputedStyle(node).color)).toBe(phase % 2 ? resting : active)
          const pointerMoves = await appPage.evaluate(() => (window as any).__restingHoverMoves as number)
          expect(pointerMoves).toBe(0)
          await expect(composer).toHaveText('Review the release summary before merging.')
          expect((await context()).native.state.nativePid).toBe(boundNativePid)
          expect((await context()).turns).toBe(1)
          samples.push({ phase, width, height, active: phase % 2 === 0, pointerMoves, color: await hint.evaluate(node => getComputedStyle(node).color) })
        }
        await capturePage(`apack-native-resting-hover-${width}-${height}.png`, width, height)
      } finally {
        await appPage.evaluate(() => { const state = window as any; window.removeEventListener('pointermove', state.__restingHoverMove); delete state.__restingHoverMove; delete state.__restingHoverMoves })
      }
      await composer.hover()
      await expect.poll(() => hint.evaluate(node => getComputedStyle(node).color)).toBe(resting)
    }
    await writeFile(join(workspace!, 'native-resting-hover-app.json'), JSON.stringify({ samples, sessionId, boundNativePid }))
  }
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await section.getByRole('button', { name: 'Stop session', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
  if (await section.getByRole('button', { name: 'Back to conversation', exact: true }).isVisible()) await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await composer.fill('Continue the release review in the same session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-text-wrap-app.json'), JSON.stringify({ evidence, sessionId, boundNativePid }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeTextWrap: !restingHover, nativeRestingHover: restingHover, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
})
