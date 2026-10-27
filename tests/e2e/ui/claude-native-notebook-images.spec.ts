import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('reviews original image-bearing notebook output and resumes its exact media', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
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
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const themed=true
  const statusLabel=themed?'Session ready':'AppNativeMain '+sessionId
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes(statusLabel) === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes(statusLabel))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText(statusLabel)
    await expect(main).toContainText(themed?'Reviewing release notes':'Second native status line')
    if(!themed)await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText(statusLabel)
  await appPage.setViewportSize({ width: 680, height: 600 })
  const nativeWindow=await electronApp.browserWindow(appPage)
  const composer = card.locator('[contenteditable="true"]')
  const receipts:any[]=[]
  const cases=[{turn:3,name:'release-analysis.ipynb'}]
  for(const{turn,name}of cases){
    const id='native_media_'+turn
    await composer.focus();await composer.press('Control+a');await composer.pressSequentially('ResearchMediaTurn'+turn+' Review '+name+' for release.');await card.getByRole('button',{name:'Send',exact:true}).click()
    const approval=appPage.getByTestId('native-read-approval')
    await expect(approval).toBeVisible({timeout:15000});await expect(approval.getByTestId('native-read-path')).toHaveText(join(workspace!,name));await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toBeHidden()
    await expect.poll(async()=>(await context()).turns).toBe(2);await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    const draft='Keep my release notes while reviewing '+name;await composer.focus();await composer.press('Control+a');await composer.pressSequentially(draft)
    const tools=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="'+id+'"]');await expect(tools).toHaveCount(1)
    const toggle=tools.getByRole('button').first();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
    const result=tools.locator('[data-native-tool-result="'+id+'"] [data-native-tool-format]');await expect(result).toBeVisible();await expect(result).not.toContainText('controls unavailable')
    const readReceipt=async()=>JSON.parse(await readFile(join(workspace!,'native-media-result-'+id+'.json'),'utf8').catch(()=>'{}'))
    await expect.poll(async()=>(await readReceipt()).props?.tool_use_id).toBe(id);const receipt=await readReceipt();expect(receipt.props.tool).toBe('Read');expect(receipt.props.isErrored).toBe(false);expect(receipt.props.output.type).toBe('notebook');await expect(result).toContainText('Read 2 cells')
    let original:any,originalCall:any
    for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line => JSON.parse(line));original=rows.find((row:any)=>row.type==='user'&&row.message?.content?.some?.((block:any)=>block.type==='tool_result'&&block.tool_use_id===id));originalCall=rows.find((row:any)=>row.type==='assistant'&&row.message?.content?.some?.((block:any)=>block.type==='tool_use'&&block.id===id));if(original)break}catch(error:any){if(error.code!=='ENOENT')throw error}}
    expect(original?.uuid).toBeTruthy();expect(receipt.props.output).toEqual(original.toolUseResult)
    const frames=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).flatMap((view:any)=>view.state?.transcriptMessages??[]));expect(frames.find((frame:any)=>frame.component==='ToolResult'&&frame.uuid===id)).toMatchObject({resultUuid:original.uuid,assistantUuid:originalCall.uuid})
    receipts.push({id,name,type:receipt.props.output.type,formatted:await result.innerText(),nativeResultUuid:original.uuid,nativeAssistantUuid:originalCall.uuid,output:receipt.props.output})
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await expect(async()=>{await result.scrollIntoViewIfNeeded();await expect(result).toBeInViewport({ratio:1})}).toPass({timeout:8000});await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport({ratio:1});expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));const captured=await nativeWindow.evaluate(async(window,dimensions)=>{const image=await window.webContents.capturePage({x:0,y:0,...dimensions});return{size:image.getSize(),png:image.toPNG().toString('base64')}},size);expect(captured.size).toEqual(size);await writeFile(testInfo.outputPath('native-media-'+turn+'-'+size.width+'.png'),Buffer.from(captured.png,'base64'))}
    if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();expect((await context()).native.state.nativePid).toBe(boundNativePid)
  }
  const retained=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())
  await writeFile(join(workspace!,'native-media-app-proof.json'),JSON.stringify(receipts))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(retained);await composer.focus();await composer.press('Control+a');await composer.pressSequentially('Continue this saved notebook image review.');await expect(composer).toHaveText('Continue this saved notebook image review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns).toBe(3);expect((await context()).sessionId).toBe(sessionId)
  expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeReadMedia:true,nativeNotebookImages:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
