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
test('reads native Agent selections and copies excerpts without crossing parent drafts', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia,promptSyntax,uiCopy,uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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

  const parentDraft='Keep the parent release-review draft.', workerDraft='Review the worker release notes 👋.'
  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id')
  expect(taskId).toBeTruthy();await composer.fill(parentDraft)
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true})
  await expect(focused).toBeVisible();await expect(card).toBeHidden()
  const form=focused.getByRole('form',{name:'Agent message',exact:true}),agentComposer=form.locator('[contenteditable="true"]')
  await agentComposer.fill(workerDraft)
  const reads=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-selection-receipts.json'),'utf8').catch(()=>'[]'))
  const copies=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-copy-receipts.json'),'utf8').catch(()=>'[]'))
  async function review(container:typeof card){const tools=container.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click();return container.getByRole('button',{name:'Review selected excerpt',exact:true})}
  async function selectText(target:typeof composer,text:string){await target.evaluate((root,text)=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('[inert],[aria-hidden="true"],button,svg')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let node:Node|null;while(node=walker.nextNode()){const at=node.textContent?.indexOf(text)??-1;if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+text.length);const selected=document.getSelection()!;selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'));return}}throw Error('Selected visible text not found')},text)}
  const agentState=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return Object.values(c.nativeUiViews).map((view:any)=>view.state?.agent).find((agent:any)=>agent?.messages?.length)})
  await expect.poll(async()=>(await agentState())?.messages.some((message:any)=>message.role==='assistant'&&message.text)).toBe(true)
  const message=(await agentState()).messages.filter((message:any)=>message.role==='assistant'&&message.text).at(-1),selectedTranscript=message.text.trim().split('\n')[0]
  const article=focused.locator('[data-native-agent-message="'+message.uuid+'"]')
  const agentReview=await review(form)
  await selectText(article,selectedTranscript);await agentReview.click();await expect.poll(async()=>(await reads()).length).toBe(1)
  expect((await reads())[0]).toMatchObject({before:{text:workerDraft},selected:true,value:{text:selectedTranscript,requestId:message.uuid}})
  const selectedDraft='worker release notes 👋'
  await selectText(agentComposer,selectedDraft);await agentReview.click();await expect.poll(async()=>(await reads()).length).toBe(2)
  expect((await reads())[1]).toMatchObject({before:{text:workerDraft},selected:true,value:{text:selectedDraft}})
  expect((await reads())[1].value.requestId).toBeUndefined()
  const saved=await electronApp.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage().toDataURL(),bookmark:clipboard.readBookmark().title}))
  try{
    await form.getByRole('button',{name:'Copy reviewed excerpt',exact:true}).click();await expect.poll(async()=>(await copies()).length).toBe(1)
    expect((await copies())[0]).toMatchObject({text:selectedDraft,result:{isCopied:true}})
    expect(await electronApp.evaluate(({clipboard})=>clipboard.readText())).toBe(selectedDraft)
  }finally{
    await electronApp.evaluate(({clipboard,nativeImage},{saved,expected})=>{if(clipboard.readText()!==expected)return;const image=nativeImage.createFromDataURL(saved.image);clipboard.write({text:saved.text,html:saved.html,rtf:saved.rtf,...(saved.bookmark?{bookmark:saved.bookmark}:{}),...(!image.isEmpty()?{image}:{})})},{saved,expected:selectedDraft})
  }
  for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(agentComposer).toBeInViewport();await expect(agentComposer).toHaveText(workerDraft);await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-agent-selection-'+width+'.png')})}
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parentDraft)
  const parentReview=await review(card);await parentReview.click();await expect.poll(async()=>(await reads()).length).toBe(3)
  expect((await reads())[2]).toMatchObject({before:{text:parentDraft},selected:false})
  await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect(agentComposer).toHaveText(workerDraft)
  await review(form);await selectText(article,selectedTranscript);await agentReview.click();await expect.poll(async()=>(await reads()).length).toBe(4)
  expect((await reads())[3]).toMatchObject({before:{text:workerDraft},value:{text:selectedTranscript,requestId:message.uuid}})
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parentDraft)
  const parentSelected='parent release-review'
  await review(card);await selectText(composer,parentSelected);await parentReview.click();await expect.poll(async()=>(await reads()).length).toBe(5)
  expect((await reads())[4]).toMatchObject({before:{text:parentDraft},selected:true,value:{text:parentSelected}});expect((await reads())[4].value.requestId).toBeUndefined()
  await expect(composer).toHaveText(parentDraft);expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).native.state.view.kind).toBe('main')
  await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-agent-selection-parent-return.png')})
  const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('');await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await expect.poll(async()=>(await context()).messages.filter((message:any)=>message.sender==='user'&&message.text===parentDraft).length).toBe(1)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue the same session after reviewing Agent excerpts.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-selection-proof.json'),JSON.stringify({taskId,agentMessage:message,selectedTranscript,selectedDraft,parentDraft,workerDraft,receipts:await reads(),copies:await copies(),sessionId,boundNativePid},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentSelection:true,nativeAgentClipboard:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
