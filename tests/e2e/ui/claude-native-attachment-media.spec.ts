import { readFile, readdir, writeFile } from 'node:fs/promises'
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
test('attaches real files through the composer and verifies original native Read media delivery', async ({ app, appPage, electronApp }, testInfo) => {
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

  const receipts:any[]=[],attachments:any[]=[]
  const nativeWindow=await electronApp.browserWindow(appPage)
  const windowId=await nativeWindow.evaluate(win=>win.id)
  const pdfPages=process.env.CLAUDE_RESEARCH_PDF_PAGES==='1'
  const cases=pdfPages?[{turn:4,name:'release-notes.pdf'},{turn:5,name:'release-notes.pdf'},{turn:6,name:'empty-release.pdf'}]:['release-cover.png','release-notes.pdf','release-analysis.ipynb'].map((name,index)=>({turn:index+1,name}))
  for(const{turn,name}of cases){
    const id='native_media_'+turn
    const file=join(workspace!,name)
    await appPage.setViewportSize({width:1100,height:900})
    await electronApp.evaluate(({dialog,BrowserWindow},{file,windowId})=>{
      const fixture=globalThis as any;fixture.attachmentMediaDialog=dialog.showOpenDialog;fixture.attachmentMediaFocus=BrowserWindow.getFocusedWindow
      BrowserWindow.getFocusedWindow=()=>BrowserWindow.fromId(windowId)
      dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[file]})) as typeof dialog.showOpenDialog
    },{file,windowId})
    try{
      const attach=card.getByRole('button',{name:'Attach file',exact:true})
      if(await attach.isVisible())await attach.click()
      else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Attach file',exact:true}).click()}
      await expect(card.getByText(name,{exact:true})).toBeVisible()
    }finally{
      await electronApp.evaluate(({dialog,BrowserWindow})=>{const fixture=globalThis as any;dialog.showOpenDialog=fixture.attachmentMediaDialog;BrowserWindow.getFocusedWindow=fixture.attachmentMediaFocus;delete fixture.attachmentMediaDialog;delete fixture.attachmentMediaFocus})
    }
    attachments.push({name,file,route:'actual Attach file button and Electron selectPath; only OS chooser response supplied'})
    await composer.fill('ResearchMediaTurn'+turn+' Review '+name+' for release.');await card.getByRole('button',{name:'Send',exact:true}).click()
    const approval=appPage.getByTestId('native-read-approval');if(turn!==5){await expect(approval).toBeVisible({timeout:15000});await expect(approval.getByTestId('native-read-path')).toHaveText(join(workspace!,name));await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toBeHidden()}await expect.poll(async()=>(await context()).turns).toBe((pdfPages?turn-3:turn)+1);await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    const draft='Keep my release notes while reviewing '+name;await composer.fill(draft)
    const tools=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="'+id+'"]');await expect(tools).toHaveCount(1)
    const toggle=tools.getByRole('button').first();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
    const result=tools.locator('[data-native-tool-result="'+id+'"] [data-native-tool-format]');await expect(result).toBeVisible();await expect(result).not.toContainText('controls unavailable')
    const readReceipt=async()=>JSON.parse(await readFile(join(workspace!,'native-media-result-'+id+'.json'),'utf8').catch(()=>'{}'))
    await expect.poll(async()=>(await readReceipt()).props?.tool_use_id).toBe(id);const receipt=await readReceipt();expect(receipt.props.tool).toBe('Read');expect(receipt.props.isErrored).toBe(pdfPages);if(pdfPages)await expect(result).toContainText(turn===4?'pdftoppm is not installed':turn===5?'Invalid pages parameter':'PDF file is empty');else expect(receipt.props.output.type).toBe(['image','pdf','notebook'][turn-1])
    let original:any,originalCall:any
    for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));original=rows.find((row:any)=>row.type==='user'&&row.message?.content?.some?.((block:any)=>block.type==='tool_result'&&block.tool_use_id===id));originalCall=rows.find((row:any)=>row.type==='assistant'&&row.message?.content?.some?.((block:any)=>block.type==='tool_use'&&block.id===id));if(original)break}catch(error:any){if(error.code!=='ENOENT')throw error}}
    expect(original?.uuid).toBeTruthy();expect(receipt.props.output).toEqual(original.toolUseResult)
    const frames=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).flatMap((view:any)=>view.state?.transcriptMessages??[]));expect(frames.find((frame:any)=>frame.component==='ToolResult'&&frame.uuid===id)).toMatchObject({resultUuid:original.uuid,assistantUuid:originalCall.uuid})
    receipts.push({id,name,type:pdfPages?'error':receipt.props.output.type,formatted:await result.innerText(),nativeResultUuid:original.uuid,nativeAssistantUuid:originalCall.uuid,output:receipt.props.output})
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await expect(async()=>{await result.scrollIntoViewIfNeeded();await expect(result).toBeInViewport()}).toPass({timeout:5000});await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport();expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.evaluate(()=>document.fonts.ready.then(()=>undefined));let timer:ReturnType<typeof setTimeout>|undefined;const captured=await Promise.race([nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {size:image.getSize(),png:image.toPNG().toString('base64')}},size),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Owned Electron capture exceeded 30000ms')),30000)})]).finally(()=>{if(timer)clearTimeout(timer)});expect(captured.size).toEqual(size);await writeFile(testInfo.outputPath('native-media-'+turn+'-'+size.width+'.png'),Buffer.from(captured.png,'base64'))}
    if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();expect((await context()).native.state.nativePid).toBe(boundNativePid)
  }
  await writeFile(join(workspace!,'native-attachment-media-proof.json'),JSON.stringify({attachments,receipts}))
  await writeFile(join(workspace!,'native-media-app-proof.json'),JSON.stringify(receipts))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue this saved media review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns).toBe(5);expect((await context()).sessionId).toBe(sessionId)
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAttachmentMedia:true,nativeReadMedia:true,...(pdfPages?{nativePdfPageFailures:true,pdfExtractionAvailable:false}:{}),nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
