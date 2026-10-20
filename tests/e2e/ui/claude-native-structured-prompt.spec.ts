import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@app/claude-terminal-xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('round-trips decorated structured replace append and cursor insertion through original native APIs', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia,promptSyntax,uiCopy}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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

  const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await composer.fill('Review the pending release notes.')
  if(promptMedia){
    const image=(await readFile(join(workspace!,'native-app-image.png'))).toString('base64')
    await card.evaluate((element,data)=>{const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0)),clipboard=new DataTransfer();clipboard.items.add(new File([bytes],'release-marker.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}))},image)
    await expect(card.getByTitle('release-marker 1.png',{exact:true})).toBeVisible()
    await composer.press('End');await composer.pressSequentially(' #')
    const popup=appPage.locator('.reference-suggestion-popup');await popup.getByText('Threads',{exact:true}).click()
    await popup.locator('.reference-suggestion-item').filter({has:appPage.getByText((await context()).topic,{exact:true})}).click();await expect(popup).toBeHidden()
  }

  if(uiCopy){
    const original=await electronApp.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage().toDataURL(),bookmark:clipboard.readBookmark().title}));
    const copies=async()=>JSON.parse(await readFile(join(workspace!,'native-copy-receipts.json'),'utf8').catch(()=>'[]'));
    const button=card.getByRole('button',{name:'Copy release checklist',exact:true});
    try{
      await button.click();await expect.poll(async()=>(await copies()).length).toBe(1);
      expect((await copies())[0].result).toEqual({isCopied:true});
      expect(await electronApp.evaluate(({clipboard})=>clipboard.readText())).toBe('Release checklist 0\nVerify behavior 👋');
      for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(button).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(composer).toHaveText('Review the pending release notes.');await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-clipboard-'+width+'.png')});}
      await appPage.setViewportSize({width:1400,height:900});
      await appPage.evaluate(()=>{const clipboard=navigator.clipboard;(window as any).__nativeCopyWrite=clipboard.writeText;clipboard.writeText=async()=>{throw new DOMException('Platform clipboard unavailable','NotAllowedError')}});
      await button.click();await expect.poll(async()=>(await copies()).length).toBe(2);
      expect((await copies())[1].result).toEqual({isCopied:false,reason:'no-clipboard'});
      expect(await electronApp.evaluate(({clipboard})=>clipboard.readText())).toBe('Release checklist 0\nVerify behavior 👋');
      await appPage.evaluate(()=>{navigator.clipboard.writeText=(window as any).__nativeCopyWrite;delete (window as any).__nativeCopyWrite});
      await button.click();await expect.poll(async()=>(await copies()).length).toBe(3);expect((await copies())[2].result).toEqual({isCopied:true});
      expect(await electronApp.evaluate(({clipboard})=>clipboard.readText())).toBe('Release checklist 2\nVerify behavior 👋');
      await button.click();await expect.poll(async()=>(await copies()).length).toBe(4);
      expect((await copies())[3]).toEqual({textLength:1000001,result:{isCopied:false,reason:'no-clipboard'}});
      expect(await electronApp.evaluate(({clipboard})=>clipboard.readText())).toBe('Release checklist 2\nVerify behavior 👋');
      await expect(composer).toHaveText('Review the pending release notes.');
    }finally{
      await appPage.evaluate(()=>{if((window as any).__nativeCopyWrite){navigator.clipboard.writeText=(window as any).__nativeCopyWrite;delete (window as any).__nativeCopyWrite}});
      await electronApp.evaluate(({clipboard,nativeImage},saved)=>{const image=nativeImage.createFromDataURL(saved.image);clipboard.write({text:saved.text,html:saved.html,rtf:saved.rtf,...(saved.bookmark?{bookmark:saved.bookmark}:{}),...(!image.isEmpty()?{image}:{})})},original);
    }
  }

  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-structured-prompt-receipts.json'),'utf8').catch(()=>'[]'))
  await card.getByRole('button',{name:'Use review outline',exact:true}).click()
  await expect.poll(async()=>(await receipts()).length).toBe(1)
  expect((await receipts())[0].result.isFilled).toBe(true)
  await expect(composer.locator('h1')).toHaveText('Release review');await expect(composer.locator('pre')).toContainText('const ready = true')
  await expect(composer.locator('.claude-prompt-decoration')).toHaveText('Review changes.')
  await card.getByRole('button',{name:'Add release checklist',exact:true}).click()
  await expect.poll(async()=>(await receipts()).length).toBe(2)
  expect((await receipts())[1].result.isFilled).toBe(true)
  await expect(composer.locator('li')).toHaveText(['Verify behavior','Document migration'])
  await expect(composer.locator('.claude-prompt-decoration')).toHaveText('Verify behavior')
  if(promptSyntax){
    const paint=composer.locator('.claude-prompt-decoration');await expect(composer.locator('li strong')).toHaveText('Verify behavior');await expect(paint).toHaveCSS('text-decoration-line','underline');
    const raw=(await receipts())[1].input;expect(raw.text).toContain('*   __Verify behavior__');expect(raw.decorations[0].start).toBe(raw.text.indexOf('*')+1);expect(raw.decorations[0].end).toBe(raw.text.indexOf('Verify behavior')+'Verify behavior'.length+1);
    expect((await receipts())[1].after.text).toContain('- **Verify behavior**');
    // Screenshot caret hiding mutates contenteditable styles and can trigger a DOM-observer selection edit.
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      await paint.scrollIntoViewIfNeeded();await expect(paint).toBeInViewport();
      await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
      await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-prompt-syntax-'+width+'.png')});
      await expect(paint).toHaveText('Verify behavior');
    }
    await appPage.setViewportSize({width:1400,height:900});
  }

  await composer.locator('p').filter({hasText:'Review changes.'}).click({position:{x:8,y:8}})
  await expect.poll(()=>composer.evaluate(element=>(element as any).editor.state.selection.$head.parent.textContent)).toBe('Review changes.')
  await composer.press('Control+a')
  await card.getByRole('button',{name:'Add review note',exact:true}).click()
  await expect.poll(async()=>(await receipts()).length).toBe(3)
  const proof=await receipts();expect(proof[2].result.isFilled).toBe(true)
  if(promptMedia){await expect(card.getByTitle('release-marker 1.png',{exact:true})).toBeVisible();expect(proof[2].after.text).toContain((await context()).topic)}
  expect(proof[2].before.cursor).toBe(proof[2].before.text.indexOf('Review changes.'))
  await expect(composer.locator('.claude-prompt-decoration')).toHaveText('Please')
  expect(proof[2].after.text).toContain('Please Review changes.')
  expect(proof[2].after.text).toContain(promptSyntax?'- **Verify behavior**':'- Verify behavior')
  expect(proof[2].after.text).not.toContain('apackNativeOffset')
  if(await tools.isVisible()&&await tools.getAttribute('aria-expanded')==='true')await tools.click()
  for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(composer.locator('h1')).toBeVisible();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-structured-prompt-'+size.width+'.png')});if(size.width===680){const last=composer.locator('li').last();await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-structured-prompt-compact-checklist.png')})}}
  const before=(await context()).messages.length
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')
  await expect.poll(async()=>(await context()).messages.slice(before).some((message:any)=>message.sender==='user'&&(promptMedia?message.text.includes(proof[2].after.text):message.text===proof[2].after.text))).toBe(true)
  if(promptMedia){const sent=(await context()).messages.slice(before).find((message:any)=>message.sender==='user'&&(promptMedia?message.text.includes(proof[2].after.text):message.text===proof[2].after.text));expect(sent.references.images).toHaveLength(1);expect(sent.references.context).toEqual(expect.arrayContaining([expect.objectContaining({refType:'thread',refId:(await context()).threadId})]));await expect(card.getByTitle('release-marker 1.png',{exact:true})).toHaveCount(0)}
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-structured-prompt-proof.json'),JSON.stringify({receipts:proof,canonical:proof[2].after.text}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue reviewing the release after the outline.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeStructuredPrompt:true,nativeStructuredMedia:promptMedia===true,nativeSyntaxDecorations:promptSyntax===true,nativeClipboard:uiCopy===true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
