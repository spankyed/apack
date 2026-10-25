import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
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
test('preserves native Select none and valid empty values through original callbacks', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
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
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1];return cols?{cols:Number(cols),rows:200}:undefined;
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!;
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

  const select=card.getByRole('combobox',{name:'Release audience',exact:true,includeHidden:true})
  const tools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  const draft='Keep my release notes while choosing an audience.'
  await composer.fill(draft)
  const before=await context(),states:any[]=[]
  const callbacks=async()=>JSON.parse(await readFile(join(workspace!,'native-select-callbacks.json'),'utf8').catch(()=>'[]'))
  const drawing=async()=>JSON.parse(await readFile(join(workspace!,'native-select-drawing.json'),'utf8').catch(()=>'{}'))
  const label=()=>select.locator('span').first().textContent()
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capture(stage:string,expected:string){
    await expect.poll(label).toBe(expected)
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900})
      await expect(select).toBeInViewport({ratio:1})
      await expect(card.getByRole('button',{name:'Clear audience',exact:true})).toBeInViewport({ratio:1})
      await expect(composer).toHaveText(draft)
      const send=card.getByRole('button',{name:'Send',exact:true});await expect(send).toBeEnabled();await expect(send).toBeInViewport({ratio:1})
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const png=await nativeWindow.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      const file=`native-select-${stage}-${width}.png`
      await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'))
      states.push({stage,width,file,label:await label(),drawing:await drawing()})
    }
  }
  await expect.poll(async()=>(await drawing()).hasValue).toBe(false)
  expect(await callbacks()).toEqual([])
  const keyboardCancellation=[]
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  await expect.poll(()=>appPage.evaluate(()=>document.hasFocus())).toBe(true)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    await select.focus();await expect(select).toBeFocused()
    // Opening and highlighting are separate from confirming the native choice.
    const steps=[]
    for(const key of ['Enter','ArrowDown','Escape']){
      if(key==='Enter')await select.press(key)
      else await appPage.keyboard.press(key)
      steps.push({key,label:await label(),callbacks:await callbacks()})
      await writeFile(join(workspace!,'native-select-keyboard-steps.json'),JSON.stringify({width,steps}))
    }
    await expect(select).toBeFocused();await expect.poll(label).toBe('none')
    expect(await callbacks()).toEqual([])
    await expect(composer).toHaveText(draft)
    keyboardCancellation.push({width,callbacks:await callbacks(),label:await label(),focused:await select.evaluate(element=>document.activeElement===element)})
  }
  await capture('unset','none');expect(await callbacks()).toEqual([])
  await select.click();await appPage.getByRole('option',{name:'No audience filter',exact:true}).click()
  await expect.poll(async()=>(await callbacks()).length).toBe(1)
  expect((await callbacks())[0]).toMatchObject({kind:'select',value:''})
  await expect.poll(async()=>await drawing()).toMatchObject({hasValue:true,value:''})
  await capture('empty','No audience filter')
  await select.click();await appPage.getByRole('option',{name:'Developers',exact:true}).click()
  await expect.poll(async()=>(await callbacks()).length).toBe(2)
  expect((await callbacks())[1]).toMatchObject({kind:'select',value:'developers'})
  await expect.poll(async()=>await drawing()).toMatchObject({hasValue:true,value:'developers'})
  await capture('selected','Developers')
  await card.getByRole('button',{name:'Clear audience',exact:true}).click()
  await expect.poll(async()=>(await callbacks()).length).toBe(3)
  expect((await callbacks())[2]).toMatchObject({kind:'clear'})
  await expect.poll(async()=>(await drawing()).hasValue).toBe(false)
  await capture('cleared','none')
  const after=await context();expect(after.messages.map((message:any)=>message.id)).toEqual(before.messages.map((message:any)=>message.id));expect(after.claude.turns).toBe(before.claude.turns);expect(after.native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft)
  await composer.fill('Continue after choosing the release audience.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-select-proof.json'),JSON.stringify({keyboardCancellation,states,callbacks:await callbacks(),sessionId,boundNativePid,noPhantomTurn:true}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeSelectEmpty:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
