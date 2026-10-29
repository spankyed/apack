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
test('preserves rich drafts while original native prompt decorations reset fonts', async ({ app, appPage, electronApp }, testInfo) => {
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

  const visible='Review notes and rollout',canonical='***Review notes and rollout***'
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText(visible)
  await composer.press('ControlOrMeta+A');await composer.press('ControlOrMeta+B');await composer.press('ControlOrMeta+I');await composer.press('ArrowRight')
  await expect(composer.locator('strong em, em strong')).toHaveCount(1)
  await expect(composer.locator('strong em, em strong')).toContainText(visible)
  const paint=composer.locator('.claude-prompt-decoration')
  await expect(paint).toHaveText('Review notes')
  await expect(paint).toHaveCSS('font-weight','400');await expect(paint).toHaveCSS('font-style','normal');await expect(paint).toHaveCSS('opacity','1')
  const controls=async()=>(await readFile(join(workspace!,'native-font-reset-controls.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  await expect.poll(async()=>(await controls()).some((row:any)=>row.reply?.result?.text===canonical&&row.reply.result.decorations?.some((run:any)=>run.bold===false&&run.italic===false&&run.dimColor===false))).toBe(true)
  const selection=()=>composer.evaluate(el=>{const selected=document.getSelection();return {anchor:selected?.anchorNode?.textContent,anchorOffset:selected?.anchorOffset,focus:selected?.focusNode?.textContent,focusOffset:selected?.focusOffset,collapsed:selected?.isCollapsed}})
  const beforeSelection=await selection();expect(beforeSelection.collapsed).toBe(true)
  const status=card.getByTestId('composer-native-status');await expect(status).toBeVisible()
  const win=await electronApp.browserWindow(appPage),captures:any[]=[]
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await paint.scrollIntoViewIfNeeded()
    for(const control of [paint,composer,status,card.getByRole('button',{name:'Send',exact:true})])await expect(control).toBeInViewport({ratio:1})
    await expect(composer).toHaveText(visible);await expect(paint).toHaveText('Review notes')
    const style=await paint.evaluate(el=>{const s=getComputedStyle(el);return {fontWeight:s.fontWeight,fontStyle:s.fontStyle,opacity:s.opacity}})
    const sibling=await composer.evaluate(el=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){if(node.textContent?.includes(' and rollout')){const s=getComputedStyle(node.parentElement!);return {fontWeight:s.fontWeight,fontStyle:s.fontStyle}}}throw Error('Missing adjacent rich text')})
    expect(style).toEqual({fontWeight:'400',fontStyle:'normal',opacity:'1'});expect(sibling.fontStyle).toBe('italic');expect(Number(sibling.fontWeight)).toBeGreaterThanOrEqual(600)
    expect(await selection()).toEqual(beforeSelection)
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const file='native-prompt-font-resets-'+width+'.png',png=await win.evaluate(async window=>(await window.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({width,file,style,sibling,selection:await selection()})
  }
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.busy,{timeout:20000}).toBe(false)
  await expect.poll(async()=>(await context()).messages.find((row:any)=>row.sender==='user'&&row.text===canonical)?.context?.cliUuid).toBeTruthy()
  const sent=(await context()).messages.find((row:any)=>row.sender==='user'&&row.text===canonical)
  expect((await context()).sessionId).toBe(sessionId);expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  const continuation='Continue after reviewing the native font reset.'
  await composer.click();await composer.press('ControlOrMeta+A');await appPage.keyboard.insertText(continuation)
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-font-reset-proof.json'),JSON.stringify({sessionId,boundNativePid,canonical,selection:beforeSelection,captures,sentUuid:sent.context.cliUuid}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativePromptFontResets:true,nativeStructuredPrompt:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
