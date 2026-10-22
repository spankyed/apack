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
test('authenticates original MCP with cancellation and stale callback refusal while preserving the draft', async ({ app, appPage, electronApp }, testInfo) => {
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
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')




  const draft='Keep my release review while signing in to the project tools.'
  await composer.fill(draft)
  const originalDocument=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON()),originalSelection=await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())
  const before=await context(),panel=appPage.getByRole('dialog',{name:'Native /mcp panel',exact:true}),captures:any[]=[],nativeWindow=await electronApp.browserWindow(appPage)
  async function screen(){
    const size=await resize();if(size&&(terminalScreen!.cols!==size.cols||terminalScreen!.rows!==size.rows))terminalScreen!.resize(size.cols,size.rows)
    const chunks=(await context()).native.output.filter((chunk:any)=>chunk.sequence>lastSequence)
    if(chunks.length){await new Promise<void>(resolve=>terminalScreen!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));lastSequence=chunks.at(-1).sequence}
    const b=terminalScreen!.buffer.active,text=Array.from({length:terminalScreen!.rows},(_,row)=>b.getLine(b.baseY+row)?.translateToString(true)??'').join('\n')
    await writeFile(join(workspace!,'native-mcp-oauth-screen.txt'),text);return text
  }
  const events=async()=> (await readFile(join(workspace!,'owned-mcp-oauth-events.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>JSON.parse(line))
  const urls=async()=> (await readFile(join(workspace!,'owned-browser-urls.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>JSON.parse(line).url as string)
  async function openPanel(){
    const open=card.getByRole('button',{name:'Claude MCP servers',exact:true})
    if(await open.isVisible())await open.click()
    else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Claude MCP servers',exact:true}).click()}
    await expect(panel).toBeVisible();await expect.poll(screen).toContain('research')
  }
  async function capture(stage:string,width:number,expected:RegExp){
    const size={width,height:width===680?600:900};await appPage.setViewportSize(size)
    await expect(panel.locator('.xterm-rows')).toContainText(expected)
    if(stage==='stale-refused'&&width===680){
      await keyboard.press('PageDown')
      await expect.poll(screen).toContain('opened.')
      await expect(panel.locator('.xterm-rows')).toContainText('opened.')
      await expect(panel.locator('.xterm-rows')).toContainText(/Esc.*go back/i)
    }
    await expect(panel.getByRole('button',{name:'Close panel',exact:true})).toBeInViewport()
    const paint=await panel.locator('.xterm-rows').innerText(),native=await screen()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>undefined))
    const result=await nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {size:image.getSize(),png:image.toPNG().toString('base64')}},size)
    expect(result.size).toEqual(size);const file='native-mcp-oauth-'+stage+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(result.png,'base64'));captures.push({file,stage,...size,paint,native})
  }
  await appPage.setViewportSize({width:1100,height:900});await openPanel()
  const keyboard=panel.locator('textarea.xterm-helper-textarea')
  await keyboard.press('Enter');await expect.poll(screen).toContain('Research MCP Server')
  await expect.poll(screen).toContain('Authenticate')
  await keyboard.press('Enter');await expect.poll(async()=>(await urls()).length,{timeout:15000}).toBe(1)
  const first=(await urls())[0]
  await capture('sign-in',1100,/Authenticating with research/)
  const oldAuthorization=await fetch(first,{redirect:'manual'});expect(oldAuthorization.status).toBe(302)
  const staleCallback=oldAuthorization.headers.get('location')!;expect(new URL(staleCallback).searchParams.get('state')).toBe(new URL(first).searchParams.get('state'))
  await keyboard.press('Escape');await expect.poll(screen).toContain('Research MCP Server')
  expect((await events()).filter(row=>row.kind==='token')).toHaveLength(0)
  await keyboard.press('Enter');await expect.poll(async()=>(await urls()).length,{timeout:15000}).toBe(2)
  const second=(await urls())[1];expect(new URL(second).searchParams.get('state')).not.toBe(new URL(first).searchParams.get('state'))
  await keyboard.pressSequentially(staleCallback);await keyboard.press('Enter')
  await expect.poll(screen).toContain("That isn't this sign-in's redirect URL")
  expect((await events()).filter(row=>row.kind==='token')).toHaveLength(0)
  await capture('stale-refused',680,/That isn't this sign-in/)
  const authorized=await fetch(second,{redirect:'manual'});expect(authorized.status).toBe(302)
  const callback=authorized.headers.get('location')!
  await keyboard.pressSequentially(callback);await keyboard.press('Enter')
  await expect.poll(async()=>(await events()).filter(row=>row.kind==='token'&&row.pkceVerified).length,{timeout:15000}).toBe(1)
  await expect.poll(async()=>(await events()).some(row=>row.kind==='rpc'&&row.method==='tools/list'&&row.authorized),{timeout:15000}).toBe(true)
  // Original successful authentication may close its local-JSX command. Reopen through the same app action.
  await expect(panel).toBeHidden({timeout:15000});await expect(composer).toHaveText(draft)
  await openPanel();await keyboard.press('Enter');await expect.poll(screen).toContain('Research MCP Server');await expect.poll(screen).toMatch(/connected/i)
  for(const width of [1100,680])await capture('connected',width,/connected/i)
  await panel.getByRole('button',{name:'Close panel',exact:true}).click();await expect(panel).toBeHidden()
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
  expect(await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())).toEqual(originalSelection)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue this saved review after signing in to the project tools.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-mcp-oauth-proof.json'),JSON.stringify({sessionId,boundNativePid,draft,captures,originalDocument,originalSelection,originalStateRefusal:true,firstState:new URL(first).searchParams.get('state'),secondState:new URL(second).searchParams.get('state'),cancelledBeforeToken:true,authenticated:true,noPhantomTurn:true,beforeTurns:before.turns,afterTurns:after.turns},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeMcpOAuth:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
