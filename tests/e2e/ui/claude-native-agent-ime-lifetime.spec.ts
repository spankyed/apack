import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async({appPage},info) => { terminalScreen?.dispose(); terminalScreen = undefined; if(info.status!==info.expectedStatus)await appPage.screenshot({caret:'initial',path:info.outputPath('agent-ime-lifetime-failure.png')}).catch(()=>{}) })
test('keeps committed Agent input when native return interrupts genuine Chromium preedit', async ({ app, appPage, electronApp }, testInfo) => {
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
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
  const dimensions = await input.evaluate(element => { const root = element.closest('.xterm')!, screen = root.querySelector('.xterm-screen')!.getBoundingClientRect(), style = getComputedStyle(root.querySelector('.xterm-char-measure-element')!); const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!; context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; return { cols: Math.round(screen.width / context.measureText('W').width), rows: 200 } })
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
  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()

  const parent='Keep the parent review notes unchanged.',base='Review release changes carefully.',preview='未確定'
  await composer.fill(parent)
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),agentComposer=form.locator('[contenteditable="true"]')
  await expect(agentComposer).toBeEditable();await agentComposer.fill(base);await agentComposer.press(process.platform==='darwin'?'Meta+ArrowLeft':'Home')
  for(let i=0;i<9;i++)await agentComposer.press('ArrowRight')
  const state=()=>agentComposer.evaluate(element=>{const editor=(element as any).editor;return {doc:editor.getJSON(),selection:editor.state.selection.toJSON(),storedMarks:editor.state.storedMarks?.map((mark:any)=>mark.toJSON())??null,markdown:editor.storage.markdown.getMarkdown(),composing:editor.view.composing}})
  await expect.poll(async()=>appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).some((view:any)=>view.state?.agent&&view.prompt?.status==='applied'&&view.prompt.frame?.text==='Review release changes carefully.'&&view.prompt.frame.cursor===9))).toBe(true)
  await agentComposer.press(process.platform==='darwin'?'Meta+b':'Control+b')
  await expect.poll(async()=>(await state()).storedMarks).toEqual([{type:'bold'}])
  const committed=await state(),before=await context(),cdp=await appPage.context().newCDPSession(appPage)
  const edits=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-ime-edits.json'),'utf8').catch(()=>'[]'))
  await cdp.send('Input.imeSetComposition',{text:preview,selectionStart:preview.length,selectionEnd:preview.length})
  await expect(agentComposer).toContainText(preview)
  const beforeInterrupt=await state();expect(beforeInterrupt.composing).toBe(true)
  expect((await edits()).some((edit:any)=>edit.text.includes(preview))).toBe(false)
  const old=await agentComposer.elementHandle()
  // Activate the actual return handler without pointer focus transfer committing the candidate first.
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).evaluate((button:HTMLButtonElement)=>button.click())
  await expect(focused).toHaveCount(0);await expect(composer).toHaveText(parent)
  expect(await old!.evaluate(element=>element.isConnected)).toBe(false)
  await expect.poll(async()=>(await context()).native.state.view.kind).toBe('main')
  await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect(agentComposer).toBeEditable()
  const restored=await state()
  await writeFile(join(workspace!,'native-agent-ime-lifetime-partial.json'),JSON.stringify({committed,beforeInterrupt,restored,edits:await edits()}))
  expect(restored.doc).toEqual(committed.doc);expect(restored.selection).toEqual(committed.selection);expect(restored.storedMarks).toEqual(committed.storedMarks)
  await expect(agentComposer).toHaveText(base)
  const afterReturn=await context();expect(afterReturn.turns).toBe(before.turns);expect(afterReturn.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(afterReturn.native.state.nativePid).toBe(boundNativePid)
  await agentComposer.focus();await appPage.keyboard.insertText('checked')
  await expect(agentComposer.locator('strong')).toHaveText('checked')
  const finalText=(await state()).markdown
  const tools=form.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await form.getByRole('button',{name:'Read current draft',exact:true}).click()
  await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8').catch(()=>'{}')).text).toBe(finalText)
  if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
  expect((await edits()).some((edit:any)=>edit.text.includes(preview))).toBe(false)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await agentComposer.focus()
    await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport({ratio:1})
    await expect(agentComposer.locator('strong')).toHaveText('checked')
    await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('agent-ime-lifetime-restored-'+width+'.png')})
  }
  await cdp.detach()
  await form.getByRole('button',{name:'Send to Agent',exact:true}).click();await expect(agentComposer).toHaveText('')
  const files=await readdir(join(workspace!,'.claude/projects'),{recursive:true});let nativeReceipt:any
  await expect.poll(async()=>{for(const file of files.filter(file=>file.endsWith('.jsonl')&&file.includes('agent-'+taskId))){const rows=(await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').map(line=>JSON.parse(line));nativeReceipt=rows.find(row=>row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human'&&typeof row.message?.content==='string'&&row.message.content.includes(finalText)&&row.message.content.split(finalText).length===2);if(nativeReceipt)return true}return false}).toBe(true)
  const allEdits=await edits();expect(allEdits.some((edit:any)=>edit.text.includes(preview))).toBe(false)
  await writeFile(join(workspace!,'native-agent-ime-lifetime-proof.json'),JSON.stringify({sessionId,taskId,preview,committed,beforeInterrupt,restored,finalText,nativeUuid:nativeReceipt.uuid,edits:allEdits,activation:'actual Back handler via DOM click without pointer focus transfer',oldEditorRemoved:true,parentDraft:parent}))
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parent)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after reviewing the Agent draft.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentImeLifetime:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
