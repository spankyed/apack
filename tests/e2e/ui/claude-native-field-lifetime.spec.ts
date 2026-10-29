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
test('keeps native review fields usable after obsolete edits fail', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
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
    if (native?.state?.status === 'live') return true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live'
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const composer = card.locator('[contenteditable="true"]')

  const note=appPage.getByRole('textbox',{name:'Review note',exact:true})
  const scope=appPage.getByRole('combobox',{name:'Review scope',exact:true})
  const reset=appPage.getByRole('button',{name:'Reset review preferences',exact:true})
  await expect(note).toBeVisible();await expect(scope).toBeVisible()
  const draft='Keep my pending review while updating these preferences.'
  await composer.fill(draft)
  const before=await context(),cases:any[]=[],captures:any[]=[]
  const fieldEvents=async()=>[...(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8')).matchAll(/Incoming: "CLAUDE_UI_FIELD" \{[\s\S]*?\n\}/g)].map(match=>match[0])
  const receipt=async(name:string)=>JSON.parse(await readFile(join(workspace!,name),'utf8').catch(()=>'null'))
  const choose=async(value:string)=>{await scope.click();await appPage.getByRole('option',{name:value==='files'?'Changed files':'Whole project',exact:true}).click()}
  const nativeWindow=await electronApp.browserWindow(appPage)
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  for(const kind of ['input','select'])for(const replacement of ['edit','reset']){
    await reset.click();await expect(note).toHaveValue('');await expect(scope).toContainText('Summary')
    const nonce=kind+'-'+replacement,old=kind==='input'?'Held review':'files'
    await writeFile(join(workspace!,'native-form-arm-'+kind+'.json'),JSON.stringify({[old]:nonce}))
    if(kind==='input')await note.fill(old);else await choose(old)
    await expect.poll(()=>receipt('native-form-'+nonce+'-started.json')).toMatchObject({kind,value:old,nonce})
    if(replacement==='reset'){
      await reset.click();await expect.poll(()=>receipt('native-form-reset.json')).toMatchObject({input:'',select:'summary'})
    }else{
      const count=(await fieldEvents()).length
      if(kind==='input')await note.fill('Current review');else await choose('project')
      // Original Claude serializes Input callbacks per plugin, and Select callbacks separately.
      // Prove the later app event arrived before releasing the earlier native callback.
      await expect.poll(async()=>(await fieldEvents()).length).toBeGreaterThan(count)
      expect((await fieldEvents()).at(-1)).toContain(kind==='input'?"value: 'Current review'":"value: 'project'")
    }
    await writeFile(join(workspace!,'native-form-'+nonce+'-release.txt'),nonce)
    await expect.poll(()=>receipt('native-form-'+nonce+'-rejected.json')).toMatchObject({nonce,kind})
    if(replacement==='edit')await expect.poll(()=>receipt('native-form-'+kind+'-value.json')).toMatchObject({kind,value:kind==='input'?'Current review':'project'})
    // The owner must process the error and still accept a later real interaction.
    // Waiting for this fresh callback is stronger than a screenshot taken before the error arrives.
    await note.fill('Confirmed '+nonce)
    await expect.poll(()=>receipt('native-form-input-value.json')).toMatchObject({value:'Confirmed '+nonce})
    await choose('project');await expect.poll(()=>receipt('native-form-select-value.json')).toMatchObject({value:'project'})
    await expect(note).toHaveValue('Confirmed '+nonce);await expect(scope).toContainText('Whole project')
    await expect(composer).toHaveText(draft)
    const current=await context();expect(current.sessionId).toBe(sessionId);expect(current.turns).toBe(before.turns);expect(current.native.state.nativePid).toBe(boundNativePid)
    const started=await receipt('native-form-'+nonce+'-started.json'),rejected=await receipt('native-form-'+nonce+'-rejected.json')
    expect(rejected.id).toBe(started.id)
    cases.push({kind,replacement,started,rejected,freshInput:await receipt('native-form-input-value.json'),freshSelect:await receipt('native-form-select-value.json')})
    await writeFile(join(workspace!,'native-form-arm-'+kind+'.json'),'{}')
  }
  await writeFile(join(workspace!,'native-field-lifetime-cases.json'),JSON.stringify({sessionId,boundNativePid,cases}))
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    // A transcript taller than the compact viewport is ordinary scrollable content.
    // Reveal each control fully; do not require the entire message to fit at once.
    for(const part of ['fields','reset']){
      const target=part==='fields'?note:reset
      await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest'}))
      await expect(target).toBeInViewport({ratio:1})
      if(part==='fields')await expect(scope).toBeInViewport({ratio:1})
      await expect(composer).toHaveText(draft)
      await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const file='native-field-lifetime-'+width+'-'+part+'.png'
      const png=await nativeWindow.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({width,part,file,note:await note.inputValue(),scope:await scope.textContent()})
    }
  }
  const after=await context()
  const oldIds=new Set(before.messages.map((message:any)=>message.id))
  const added=after.messages.filter((message:any)=>!oldIds.has(message.id))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText(draft)
  const continuation='Continue after reviewing these preferences.'
  await composer.click();await appPage.keyboard.press('ControlOrMeta+A');await appPage.keyboard.type(continuation)
  await expect(composer).toHaveText(continuation)
  const send=card.getByRole('button',{name:'Send',exact:true});await expect(send).toBeEnabled();await send.click()
  await expect.poll(async()=>(await context()).turns,{timeout:20000}).toBe(2)
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-field-lifetime-proof.json'),JSON.stringify({sessionId,boundNativePid,cases,captures,addedMessages:added,seed:'Review the release notes for this project.',continuation,retainedDraft:draft}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativeFieldLifetime:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
