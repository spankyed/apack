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
test('reviews original notebook cells and preserves denied content and the everyday draft', async ({ app, appPage, electronApp }, testInfo) => {
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




  const path=join(workspace!,'release-review.ipynb'),draft='Keep my release-review notes while updating the analysis notebook.'
  const before=await context()
  await composer.fill('Update the release notebook, add its reviewed summary, and ask before deleting the original notes.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  const readApproval=appPage.getByTestId('native-read-approval')
  await expect(readApproval).toBeVisible({timeout:15000});await expect(readApproval.getByTestId('native-read-path')).toHaveText(path)
  await composer.fill(draft)
  const originalDocument=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON()),originalSelection=await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())
  await readApproval.getByRole('button',{name:/^(Approve|Allow once|Continue)$/}).click();await expect(readApproval).toBeHidden()
  const notebook=async()=>JSON.parse(await readFile(path,'utf8')),source=(cell:any)=>Array.isArray(cell.source)?cell.source.join(''):cell.source
  const captures:any[]=[],previews:any[]=[],nativeWindow=await electronApp.browserWindow(appPage),approval=appPage.getByTestId('native-notebookedit-approval')
  const stages=[{mode:'replace',cellId:'analysis',before:'print("Review pending")\n',after:'print("Release reviewed")\n'},{mode:'insert',cellId:'analysis',after:'## Release summary\n\nMigration guidance has been reviewed.'},{mode:'delete',cellId:'notes',before:'# Original notes\nKeep the migration checklist.'}]
  for(const stage of stages){
    await expect(approval).toBeVisible({timeout:15000})
    await expect.poll(async()=>(await context()).claude.pendingControlRequest?.nativeTerminal?.review?.notebook?.editMode).toBe(stage.mode)
    const native=(await context()).claude.pendingControlRequest.nativeTerminal.review
    expect(native.notebook.cellId).toBe(stage.cellId);expect(native.before).toBe(stage.before);expect(native.after).toBe(stage.after);expect(native.withheld).toBe(false)
    await expect(approval.getByTestId('native-read-path')).toHaveText(path)
    if(stage.before!==undefined)expect(await approval.getByTestId('native-file-before').textContent()).toBe(stage.before)
    if(stage.after!==undefined)expect(await approval.getByTestId('native-file-after').textContent()).toBe(stage.after)
    else{await expect(approval.getByTestId('native-file-after')).toHaveCount(0);await expect(approval).toContainText('This cell will be removed.')}
    previews.push({mode:stage.mode,review:native})
    for(const width of [1100,680]){
      const size={width,height:width===680?600:900};await appPage.setViewportSize(size)
      await expect(approval.getByRole('button',{name:'Deny',exact:true})).toBeInViewport()
      await expect(approval.getByRole('button',{name:/^(Allow once|Continue)$/})).toBeInViewport()
      await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
      await expect(card.getByTestId('composer-native-status')).toContainText('Session ready')
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const capture=await nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {size:image.getSize(),png:image.toPNG().toString('base64')}},size)
      expect(capture.size).toEqual(size);const file='native-notebook-'+stage.mode+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(capture.png,'base64'));captures.push({file,mode:stage.mode,...size})
    }
    if(stage.mode==='delete'){
      const unchanged=await notebook()
      await approval.getByText('Add a reason for denying',{exact:true}).click();await approval.getByLabel('Reason for denying',{exact:true}).fill('Keep the original migration notes for this release.')
      await approval.getByRole('button',{name:'Deny',exact:true}).click();await expect(approval).toBeHidden();expect(await notebook()).toEqual(unchanged)
    }else{
      await approval.getByRole('button',{name:/^(Allow once|Continue)$/}).click()
      await expect.poll(async()=>stage.mode==='replace'?source((await notebook()).cells.find((cell:any)=>cell.id==='analysis')):(await notebook()).cells.length).toBe(stage.mode==='replace'?stage.after:3)
    }
    expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
    expect(await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())).toEqual(originalSelection)
  }
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='assistant'&&row.text==='Notebook updated; original migration notes retained.')).toBe(true)
  const final=await notebook();expect(source(final.cells.find((cell:any)=>cell.id==='notes'))).toBe('# Original notes\nKeep the migration checklist.')
  const after=await context();expect(after.turns).toBe(before.turns+1);expect(after.native.state.nativePid).toBe(boundNativePid)
  for(const kind of ['replace','insert','delete'])await expect.poll(async()=>readFile(join(workspace!,'native-notebook-result-native_notebook_'+kind+'.json'),'utf8').then(()=>true,()=>false)).toBe(true)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue the saved release review after editing the notebook.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-notebook-edit-proof.json'),JSON.stringify({sessionId,boundNativePid,draft,captures,previews,originalDocument,originalSelection,retainedDraft:true,beforeTurns:before.turns,afterTurns:after.turns},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeNotebookEdit:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
