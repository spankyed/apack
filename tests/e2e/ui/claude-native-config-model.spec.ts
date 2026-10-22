import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('retains composing through original Config search and model callback', async ({ app, appPage, electronApp }, testInfo) => {
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1], rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('AppNativeMain') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain')
    await expect(main).toContainText('Second native status line')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain')
  const composer = card.locator('[contenteditable="true"]')

  const receipts: unknown[]=[], captures: unknown[]=[]
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capture(label:string){
    await appPage.evaluate(()=>document.fonts.ready.then(()=>undefined))
    for(const width of [1100,680]){
      const height=width===680?600:900, previousSize=await resize(), previousSequence=(await context()).native.output.at(-1)?.sequence??0
      await appPage.setViewportSize({width,height})
      if(await panel.isVisible()){
        await expect.poll(async()=>(await resize())?.cols).not.toBe(previousSize?.cols)
        await expect.poll(async()=>(await context()).native.output.at(-1)?.sequence??0).toBeGreaterThan(previousSequence)
        await screen()
      }
      await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
      let captureTimer:ReturnType<typeof setTimeout>|undefined
      const image=await Promise.race([nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {pixels:image.getSize(),png:image.toPNG().toString('base64')}},{width,height}),new Promise<never>((_resolve,reject)=>{captureTimer=setTimeout(()=>reject(new Error('Owned Electron capture exceeded 30000ms')),30000)})]).finally(()=>{if(captureTimer)clearTimeout(captureTimer)})
      expect(image.pixels).toEqual({width,height});const file='config-'+label+'-'+width+'.png'
      await writeFile(testInfo.outputPath(file),Buffer.from(image.png,'base64'));captures.push({file,width,height,pixels:image.pixels})
    }
  }
  const panel=appPage.getByRole('dialog',{name:'Native /config panel',exact:true})
  async function screen(){
    const size=await resize();if(size&&(terminalScreen!.cols!==size.cols||terminalScreen!.rows!==size.rows))terminalScreen!.resize(size.cols,size.rows)
    const chunks=(await context()).native?.output?.filter((chunk:any)=>chunk.sequence>lastSequence)??[]
    if(chunks.length){await new Promise<void>(resolve=>terminalScreen!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));lastSequence=chunks.at(-1).sequence}
    const buffer=terminalScreen!.buffer.active
    const text=Array.from({length:terminalScreen!.rows},(_,row)=>buffer.getLine(buffer.baseY+row)?.translateToString(true)??'').join('\n')
    await writeFile(join(workspace!,'native-config-screen.txt'),text);return text
  }
  const draft='Keep this release review while configuring Claude.'
  await composer.fill(draft)
  const before=await context()
  async function open(){
    const direct=card.getByRole('button',{name:'Claude settings',exact:true})
    if(await direct.isVisible())await direct.click()
    else {await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Claude settings',exact:true}).click()}
    await expect(panel).toBeVisible();await expect.poll(screen).toContain('Search settings')
  }
  await open()
  const keyboard=panel.locator('textarea.xterm-helper-textarea')
  await keyboard.pressSequentially('no-such-setting-claude-parity')
  await expect.poll(screen).toContain('no-such-setting-claude-parity')
  await keyboard.press('Escape')
  await expect.poll(screen).not.toContain('no-such-setting-claude-parity')
  await keyboard.pressSequentially('Model')
  await expect.poll(screen).toMatch(/⌕ Model\s+│/)
  async function chooseModelRow(){
    if(!/❯ Model\s/.test(await screen())){
      await keyboard.press('ArrowDown')
      await expect.poll(screen).toMatch(/❯ (?:Switch models|Model\s)/)
      if(!/❯ Model\s/.test(await screen()))await keyboard.press('ArrowDown')
    }
    await expect.poll(screen).toMatch(/❯ Model\s/);await keyboard.press('Enter')
  }
  await chooseModelRow()
  await expect.poll(screen).toMatch(/Select model/)
  await keyboard.press('Escape')
  await expect.poll(screen).toMatch(/❯ Model\s/)
  await expect.poll(screen).not.toContain('Select model')
  const userSettings=async()=>JSON.parse(await readFile(join(workspace!,'.claude/settings.json'),'utf8').catch(()=>'{}'))
  const initialSettings=await userSettings()
  await chooseModelRow()
  await expect.poll(screen).toMatch(/Select model/)
  await capture('model-picker')
  // Original wze calls ole with canEnter=false: this Config picker has no text-search entry.
  for(let index=0;index<6&&!/^\s*❯.*Sonnet/m.test(await screen());index++){
    const selected=(await screen()).match(/^\s*❯.*$/m)?.[0]
    await keyboard.press('ArrowDown')
    await expect.poll(async()=>(await screen()).match(/^\s*❯.*$/m)?.[0]).not.toBe(selected)
  }
  await expect.poll(screen).toMatch(/^\s*❯.*Sonnet/m)
  await keyboard.press('Enter')
  await expect.poll(async()=>(await userSettings()).model).toMatch(/sonnet/i)
  await expect.poll(async()=>(await context()).native.state.session?.model).toMatch(/sonnet/i)
  const selectedSettings=await userSettings()
  receipts.push({initialSettings,selectedSettings,screen:await screen(),native:(await context()).native.state,claude:(await context()).claude})
  await writeFile(join(workspace!,'native-config-model-callback.json'),JSON.stringify(receipts,null,2))
  await panel.getByRole('button',{name:'Close panel',exact:true}).click()
  await expect(panel).toBeHidden();await expect(composer).toHaveText(draft);await expect(composer).toBeFocused()
  const after=await context()
  expect(after.turns).toBe(before.turns);expect(after.messages).toEqual(before.messages)
  await open();expect((await userSettings()).model).toBe(selectedSettings.model)
  await panel.getByRole('button',{name:'Close panel',exact:true}).click()
  await expect(composer).toHaveText(draft)
  await capture('retained-draft')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue the same session after configuring the release review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-config-model-proof.json'),JSON.stringify({receipts,captures,sessionId,boundNativePid},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeConfigModel:true,nativeConfigCallbacks:true,nativeConfigPersistence:true,nativeConfigReturn:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
