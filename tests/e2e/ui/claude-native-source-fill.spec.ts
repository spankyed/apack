import { readFile, writeFile } from 'node:fs/promises'
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
test('round trips native source fills with line breaks and explicit context withdrawal', async ({ app, appPage, electronApp }, testInfo) => {
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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

  const threadId=(await context()).threadId,referenceHref='apack-ref://thread/'+threadId
  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-source-fill-receipts.json'),'utf8').catch(()=>'[]'))
  const addReference=async(text:string)=>{
    await composer.fill(text);await composer.press('End');await composer.pressSequentially(' #')
    const popup=appPage.locator('.reference-suggestion-popup');await popup.getByText('Threads',{exact:true}).click()
    await popup.locator('.reference-suggestion-item').filter({has:appPage.getByText((await context()).topic,{exact:true})}).click();await expect(popup).toBeHidden()
    await expect(composer.locator('.reference-pill')).toHaveCount(1)
  }
  const useAction=async(label:string,count:number)=>{
    const tools=card.getByRole('button',{name:'Session tools',exact:true})
    if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
    await card.getByRole('button',{name:label,exact:true}).click()
    await expect.poll(async()=>(await receipts()).length).toBe(count)
    if(await tools.isVisible()&&await tools.getAttribute('aria-expanded')==='true')await tools.click()
  }
  await addReference('Use release context')
  await composer.press('End');await composer.press('Shift+Enter');await composer.pressSequentially('Keep this line while preparing the review.')
  await composer.press('Control+a')
  await useAction('Prepare release review',2)
  const first=(await receipts()).slice(0,2),firstText=first[1].after.text
  expect(first[0].before.cursor).toBeLessThan(first[0].before.text.length)
  expect(first[0].before.text).toContain(referenceHref);expect(first[0].before.text).toContain('\n')
  expect(first[0].result.isFilled).toBe(true);expect(first[1].result.isFilled).toBe(true)
  expect(first[0].after.text).toBe(first[0].before.text+first[0].input.text)
  expect(first[1].after.text).toBe(first[1].before.text.slice(0,first[1].before.cursor)+first[1].input.text+first[1].before.text.slice(first[1].before.cursor))
  const literal=composer.locator('[data-claude-prompt-source]');await expect(literal).toHaveText(firstText)
  await expect.poll(()=>composer.locator('.claude-prompt-decoration').allTextContents().then(parts=>parts.join(''))).toBe('Review linked notes.')
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await composer.locator('.claude-prompt-decoration').last().scrollIntoViewIfNeeded()
    await expect(composer.locator('.claude-prompt-decoration').last()).toBeInViewport();await expect(status).toContainText('Session ready')
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-source-fill-linked-'+width+'.png')})
  }
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')
  await expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='user'&&row.text.includes(firstText))).toBe(true)
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  const firstSent=(await context()).messages.find((row:any)=>row.sender==='user'&&row.text.includes(firstText))
  expect(firstSent.references.context).toEqual(expect.arrayContaining([expect.objectContaining({refType:'thread',refId:threadId})]))
  await addReference('Replace this linked draft')
  await useAction('Start fresh review',4)
  const second=(await receipts()).slice(2),secondText=second[1].after.text
  expect(second[0].before.text).toContain(referenceHref);expect(second[0].input.mode).toBe('replace')
  expect(second[0].after.text).toBe(second[0].input.text);expect(second[1].after.text).toBe(second[1].before.text+second[1].input.text)
  expect(second.every((row:any)=>row.result.isFilled)).toBe(true);expect(secondText).not.toContain(referenceHref)
  await expect(literal).toHaveText(secondText)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await literal.scrollIntoViewIfNeeded()
    await expect(status).toContainText('Session ready');await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-source-fill-fresh-'+width+'.png')})
  }
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('')
  await expect.poll(async()=>(await context()).messages.some((row:any)=>row.sender==='user'&&row.text===secondText)).toBe(true)
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  const secondSent=(await context()).messages.find((row:any)=>row.sender==='user'&&row.text===secondText)
  expect(secondSent.references?.context??[]).toEqual([])
  const submits=JSON.parse(await readFile(join(workspace!,'native-source-fill-submits.json'),'utf8'))
  expect(submits).toHaveLength(2);expect(submits[0].text).toContain(firstText);expect(submits[1].text).toBe(secondText)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after verifying native source fills.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-source-fill-proof.json'),JSON.stringify({sessionId,boundNativePid,threadId,referenceHref,operations:await receipts(),submits,firstText,secondText,firstUuid:firstSent.context.cliUuid,secondUuid:secondSent.context.cliUuid,retainedReferences:firstSent.references.context,withdrawnReferences:secondSent.references?.context??[]}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeSourceFill:true,nativeStructuredPrompt:true,sameNativeOwner:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
