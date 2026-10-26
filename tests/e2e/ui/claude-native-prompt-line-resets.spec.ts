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
test('preserves underline, wrapping and input through original native line resets', async ({ app, appPage, electronApp }, testInfo) => {
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

  const base='Review notes and rollout across the complete desktop release checklist with the team'
  const texts=[base,base+' before publishing.',base+' before publishing. Confirmed.'],names=['reset','strike','retired']
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText(base)
  await composer.press('ControlOrMeta+A')
  const underlineButton=appPage.getByTitle('Underline',{exact:true})
  await expect(underlineButton).toBeVisible();await underlineButton.click();await expect(composer.locator('u')).toHaveText(base)
  await composer.press('ArrowRight')
  const controls=async()=>(await readFile(join(workspace!,'native-font-reset-controls.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  const selected=()=>composer.evaluate(el=>{const selection=document.getSelection();return {anchor:selection?.anchorNode?.textContent,anchorOffset:selection?.anchorOffset,focus:selection?.focusNode?.textContent,focusOffset:selection?.focusOffset,collapsed:selection?.isCollapsed}})
  const status=card.getByTestId('composer-native-status');await expect(status).toBeVisible()
  const win=await electronApp.browserWindow(appPage),captures:any[]=[],stages:any[]=[]
  for(let index=0;index<names.length;index++){
    const stage=names[index],text=texts[index]
    if(index)await appPage.keyboard.insertText(index===1?' before publishing.':' Confirmed.')
    const control=async()=>(await controls()).filter((row:any)=>row.reply?.result?.text===text&&row.reply.result.cursor===text.length&&(stage==='retired'?(row.reply.result.decorations??[]).length===0:row.reply.result.decorations?.some((run:any)=>run.underline===false&&run.strikethrough===(stage==='strike')))).at(-1)
    await expect.poll(control).toBeTruthy()
    const parent=composer.locator('u'),paint=composer.locator('.claude-prompt-decoration'),inherited=composer.locator('.claude-prompt-line-inherit')
    await expect(parent).toHaveText(text)
    if(stage==='retired'){await expect(composer.locator('.claude-prompt-line-paint')).toHaveCount(0);await expect(parent).toHaveCSS('text-decoration-line','underline')}
    else {await expect(paint).toHaveText('Review notes');await expect(paint).toHaveCSS('text-decoration-line',stage==='reset'?'none':'line-through');await expect(parent).toHaveCSS('text-decoration-line','none');await expect(inherited).toHaveCSS('text-decoration-line','underline')}
    const selection=await selected();expect(selection.collapsed).toBe(true)
    const native=await control();stages.push({stage,text,selection,nativeReplyId:native.reply.id,nativeClientId:native.request.request.client_id})
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});await parent.scrollIntoViewIfNeeded()
      for(const target of [parent,composer,status,card.getByRole('button',{name:'Send',exact:true})])await expect(target).toBeInViewport({ratio:1})
      const observation=await composer.evaluate(el=>{
        const parent=el.querySelector('u')!,paint=el.querySelector<HTMLElement>('.claude-prompt-decoration'),inherited=el.querySelector<HTMLElement>('.claude-prompt-line-inherit'),range=document.createRange();range.selectNodeContents(parent)
        return {parentText:parent.textContent,parentLine:getComputedStyle(parent).textDecorationLine,paintCount:el.querySelectorAll('.claude-prompt-line-paint').length,nativeLine:paint?getComputedStyle(paint).textDecorationLine:undefined,inheritedLine:inherited?getComputedStyle(inherited).textDecorationLine:undefined,nativeDisplay:paint?getComputedStyle(paint).display:undefined,inheritedDisplay:inherited?getComputedStyle(inherited).display:undefined,lineRects:new Set([...range.getClientRects()].filter(rect=>rect.width>0).map(rect=>Math.round(rect.top))).size,horizontalFits:el.scrollWidth<=el.clientWidth+1}
      })
      expect(observation.horizontalFits).toBe(true);expect(await selected()).toEqual(selection)
      if(stage==='retired'){expect(observation.paintCount).toBe(0);expect(observation.parentLine).toBe('underline')}
      else {expect(observation.parentLine).toBe('none');expect(observation.nativeLine).toBe(stage==='reset'?'none':'line-through');expect(observation.inheritedLine).toBe('underline');expect(observation.nativeDisplay).toBe('inline');expect(observation.inheritedDisplay).toBe('inline')}
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const file='native-prompt-line-resets-'+stage+'-'+width+'.png',png=await win.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({stage,width,file,...observation,selection:await selected()})
    }
  }
  expect(captures.some(row=>row.width===680&&row.lineRects>1)).toBe(true)
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.busy,{timeout:20000}).toBe(false)
  await expect.poll(async()=>(await context()).messages.find((row:any)=>row.sender==='user'&&row.text===texts[2])?.context?.cliUuid).toBeTruthy()
  const sent=(await context()).messages.find((row:any)=>row.sender==='user'&&row.text===texts[2])
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText('Continue after reviewing native line styles.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-line-reset-proof.json'),JSON.stringify({sessionId,boundNativePid,nativeClientId:stages[0].nativeClientId,stages,captures,sentUuid:sent.context.cliUuid}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativePromptLineResets:true,nativeStructuredPrompt:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
