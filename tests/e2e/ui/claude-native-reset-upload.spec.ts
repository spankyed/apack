import { readFile, writeFile, readdir } from 'node:fs/promises'
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
test('retires a held image upload when another window resets the native session', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
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
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns, { timeout: 15000 }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const statusLabel='AppNativeMain '+sessionId
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
    await expect(main).toContainText('Second native status line')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText(statusLabel)
  const composer = card.locator('[contenteditable="true"]')





  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[]
  async function capture(stage:string){for(const [width,height] of [[1100,900],[680,600]]){
    await appPage.setViewportSize({width,height});await expect(composer).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1});if(stage==='fresh')await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
    const captured=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},{width,height});expect(captured.size).toEqual({width,height});const name='native-reset-task-'+stage+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(captured.png,'base64'));captures.push(name)
  }}
  const threadId=(await context()).threadId
  const heldDraft='Keep this image draft until I explicitly send it after reset.'
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  await composer.fill(heldDraft);await composer.focus()
  await electronApp.evaluate(({clipboard,nativeImage},file)=>{const image=nativeImage.createFromPath(file);if(image.isEmpty())throw Error('Owned PNG failed to decode');clipboard.writeImage(image)},join(workspace!,'native-app-image.png'))
  await composer.press('Control+v')
  const thumbnail=card.locator('img[src^="data:image/"]')
  await expect(thumbnail).toHaveCount(1)
  await electronApp.evaluate(async(_electron,{threadId,workspace})=>{
    const fs=(await import('node:fs/promises')).default
    const original=fs.writeFile
    const state={started:false,completed:false,path:'',release:()=>{},restore:()=>{fs.writeFile=original}}; (globalThis as any).heldResetUpload=state
    fs.writeFile=(async(...args:Parameters<typeof fs.writeFile>)=>{
      const path=String(args[0])
      if(!state.started&&path.startsWith(workspace+'/')&&path.includes('/media/'+threadId+'/')){
        state.started=true;state.path=path
        await new Promise<void>(resolve=>{state.release=resolve})
      }
      const result=await original(...args)
      if(path===state.path)state.completed=true
      return result
    }) as typeof fs.writeFile
  },{threadId,workspace:workspace!})
  let popout:import('@playwright/test').Page|undefined
  try{
    await card.getByRole('button',{name:'Send',exact:true}).click()
    await expect.poll(()=>electronApp.evaluate(()=>(globalThis as any).heldResetUpload.started)).toBe(true)
    const opened=electronApp.waitForEvent('window')
    await appPage.evaluate(()=>(window as any).electronAPI.surfaces.popout('default-setup/threads','Threads'))
    popout=await opened;await popout.waitForLoadState('domcontentloaded')
    await expect.poll(()=>popout!.evaluate(()=>!!(window as any).applicationState?.system.get('default-setup/threads'))).toBe(true)
    await popout.evaluate(threadId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId}),threadId)
    const other=popout.locator('[data-onboarding-id="agent-chat-input"]'),otherComposer=other.locator('[contenteditable="true"]')
    await otherComposer.fill('');await otherComposer.pressSequentially('/cc-reset')
    await popout.locator('.command-suggestion-popup').getByText('/cc-reset',{exact:true}).click()
    await other.getByRole('button',{name:'Send',exact:true}).click()
    await expect.poll(async()=>(await context()).claude).toBeUndefined()
    await electronApp.evaluate(()=>(globalThis as any).heldResetUpload.release())
    await expect.poll(()=>electronApp.evaluate(()=>(globalThis as any).heldResetUpload.completed)).toBe(true)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
    await expect(composer).toHaveText(heldDraft);await expect(thumbnail).toHaveCount(1)
    expect((await context()).claude).toBeUndefined()
    await capture('held-upload-retired')
    await thumbnail.locator('..').hover();await thumbnail.locator('..').getByRole('button').click()
    await expect(thumbnail).toHaveCount(0)
  }finally{
    await electronApp.evaluate(()=>{const state=(globalThis as any).heldResetUpload;if(state){state.release();state.restore();delete (globalThis as any).heldResetUpload}})
    if(popout&&!popout.isClosed())await popout.close()
  }
  const freshText='Start a fresh review after cancelling the old image upload.'
  await composer.fill(freshText);await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect(appPage.getByText('Which project directory should I work in?',{exact:true})).toBeVisible()
  const windowId=await nativeWindow.evaluate(window=>window.id)
  await electronApp.evaluate(({dialog,BrowserWindow},{directory,windowId})=>{const fixture=globalThis as any;fixture.uploadResetDialog=dialog.showOpenDialog;fixture.uploadResetFocus=BrowserWindow.getFocusedWindow;BrowserWindow.getFocusedWindow=()=>BrowserWindow.fromId(windowId);dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[directory]})) as typeof dialog.showOpenDialog},{directory:workspace!,windowId})
  try{await appPage.getByRole('button',{name:'Browse Directory',exact:true}).click()}
  finally{await electronApp.evaluate(({dialog,BrowserWindow})=>{const fixture=globalThis as any;dialog.showOpenDialog=fixture.uploadResetDialog;BrowserWindow.getFocusedWindow=fixture.uploadResetFocus;delete fixture.uploadResetDialog;delete fixture.uploadResetFocus})}
  await expect.poll(async()=>(await context()).turns).toBe(1)
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  const replacement=await context();expect(replacement.sessionId).not.toBe(sessionId)
  let humans:any[]=[]
  for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{humans=(await readFile(join(workspace!,'.claude/projects',bucket,replacement.sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true)}catch(error:any){if(error.code!=='ENOENT')throw error}}
  expect(humans).toHaveLength(1);expect(typeof humans[0].message.content).toBe('string');expect(humans[0].message.content).not.toContain(heldDraft);expect(humans[0].message.content.endsWith('Latest user message:\n'+freshText)).toBe(true)
  await composer.fill('Keep working in the fresh session.');await capture('fresh')
  await writeFile(join(workspace!,'native-reset-upload-proof.json'),JSON.stringify({sessionId,finalSessionId:replacement.sessionId,boundNativePid,heldDraft,freshText,newHumanUuid:humans[0].uuid,uploadHeld:true,uploadCompleted:true,resetFromOtherWindow:true,oldSendRetired:true,draftAndImageRetained:true,explicitImageRemoval:true,replacementImageBlocks:0,captures}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'task-controls',nativeResetUpload:true,nativeRetainedDraft:true,sessionId,finalSessionId:replacement.sessionId,boundNativePid,browserErrors:errors}))
})
