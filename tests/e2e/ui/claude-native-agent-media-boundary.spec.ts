import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async ({appPage}, testInfo) => {
  if(testInfo.status!==testInfo.expectedStatus){
    await appPage.screenshot({path:testInfo.outputPath('native-agent-source-layout-failure.png')}).catch(()=>{})
    const layout=await appPage.evaluate(()=>Array.from(document.querySelectorAll('[aria-label="Focused Agent conversation"], [aria-label="Agent message"], [data-testid="composer-native-status"], [data-native-agent-draft-viewport]')).map(element=>({label:element.getAttribute('aria-label')??element.getAttribute('data-testid')??'draft viewport',bounds:element.getBoundingClientRect().toJSON(),height:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop}))).catch(error=>({captureError:String(error)}))
    await writeFile(join(workspace!,'native-agent-source-layout-failure.json'),JSON.stringify(layout))
  }
  terminalScreen?.dispose();terminalScreen=undefined
})
test('observes original selected-Agent terminal image delivery without app media adaptation', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(120000)
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
  await expect.poll(async () => (await context()).turns, {timeout:20000}).toBe(1)
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
    if (native?.state?.status === 'live' && native.state.mainStatus?.includes('Session ready')) return true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 40000, intervals: [250] }).toBe(true)
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



  await composer.fill('Review the release notes with a worker.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id');expect(taskId).toBeTruthy()
  const parentDraft='Keep the parent release draft while checking native Agent media.';await composer.fill(parentDraft)
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true});await expect(focused).toBeVisible()
  const agentComposer=focused.getByRole('form',{name:'Agent message',exact:true}).locator('[contenteditable="true"]'),agentDraft='Keep the independent app Agent draft.';await agentComposer.fill(agentDraft)
  const observed=()=>readFile(join(workspace!,'native-agent-media-observation.json'),'utf8').then(text=>JSON.parse(text),()=>undefined)
  await expect.poll(async()=>(await observed())?.selected).toBe(taskId)
  const before=await observed();expect(before.draft.text).toBe('')
  const attachment=await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;const entry=(Object.entries(c.nativeTerminalViews) as [string,any][]).filter(([,v])=>v.threadId===c.currentThread?.id&&v.state?.status==='live'&&v.state.view?.kind==='agent').at(-1);if(!entry)return;return {threadId:c.currentThread.id,mountId:entry[0],ownerId:entry[1].state.ownerId}})
  expect(attachment).toBeTruthy()
  const terminalInput=async(text:string)=>appPage.evaluate(({attachment,text})=>(window as any).applicationState.system.get('default-setup/threads').send({type:'CLAUDE_TERMINAL_INPUT',...attachment,text}),{attachment:attachment!,text})
  await terminalInput('NativeAgentMediaBoundary review this image ')
  await terminalInput('\x1b[200~'+join(workspace!,'native-app-image.png')+'\x1b[201~')
  await expect.poll(async()=>(await observed())?.draft.text,{timeout:15000}).toMatch(/NativeAgentMediaBoundary[\s\S]*\[Image\s*#\d+\]/i)
  const prepared=await observed();expect(prepared.selected).toBe(taskId)
  await terminalInput('\r')
  await expect.poll(async()=>(await observed())?.observed.length,{timeout:20000}).toBeGreaterThan(0)
  const delivered=await observed();expect(delivered.taskId).toBe(taskId)
  await expect.poll(async()=>(await context()).native.state.tasks.find((task:any)=>task.id===taskId)?.status,{timeout:20000}).toBe('completed')
  await expect(agentComposer).toHaveText(agentDraft)
  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[]
  for(const [width,height] of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});const png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});const name='native-agent-media-boundary-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(png,'base64'));captures.push(name)}
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parentDraft)
  expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).sessionId).toBe(sessionId)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after checking the native Agent media boundary.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-media-boundary-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,attachment,before,prepared,delivered,captures,parentDraftRetained:true,agentDraftRetained:true,sameSessionRecovery:true,qualification:'Original terminal paste/Enter through the addressed live app-owned terminal attachment; no app Agent image picker or image-send implementation is claimed.'},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentMediaBoundary:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
