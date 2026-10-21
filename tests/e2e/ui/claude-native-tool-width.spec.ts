import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},testInfo)=>{if(testInfo.status!==testInfo.expectedStatus)await appPage.screenshot({path:testInfo.outputPath('native-tool-width-failure.png')}).catch(()=>{})})
test('formats the original tool result at its mounted row width through resize', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { restriction } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  const resizeErrors:string[]=[];appPage.on('console',message=>{if(message.type()==='error'&&message.text().includes('ResizeObserver loop'))resizeErrors.push(message.text())})
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns,{timeout:20000,message:'Original cold CLI seed completes before held-policy acceptance'}).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  let theme = false, security = false, navigated = false, trusted = false
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const text = native?.output?.map((chunk: any) => chunk.text).join('') ?? ''
    const screen = recognizeOnboardingPrompt(text, workspace)
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && navigated && !trusted) { trusted = true; await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain ' + sessionId)
    await expect(main).toContainText('Second native status line')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain ' + sessionId)
  const composer=card.locator('[contenteditable="true"]')
  await composer.fill('ResearchFileTurn1');await card.getByRole('button',{name:'Send',exact:true}).click()
  const approval=appPage.getByTestId('native-write-approval')
  await expect(approval).toBeVisible({timeout:15000})
  await approval.getByRole('button',{name:'Allow once',exact:true}).click();await expect(approval).toBeHidden()
  await expect.poll(async()=>readFile(join(workspace!,'file-fixture.txt'),'utf8').catch(()=>null)).toBe('created\n')
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await expect.poll(async()=>(await context()).messages.some((message:any)=>message.text==='File fixture completed.')).toBe(true)
  const diff=appPage.getByRole('button',{name:'Close Diff',exact:true});if(await diff.isVisible())await diff.click();await expect(diff).toHaveCount(0)
  const before=await context(),draft='Keep these release review notes while inspecting the file result.'
  await composer.fill(draft)
  const source=JSON.parse(await readFile(join(workspace!,'native-tool-width-source.json'),'utf8')).source
  const block=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="file_fixture_1"]').first()
  const result=block.locator('[data-native-tool-result="file_fixture_1"]'),formatted=result.locator('[data-native-tool-format]')
  if(!await formatted.isVisible()){const disclosure=block.locator('button[aria-expanded]').first();await expect(disclosure).toBeVisible();if(await disclosure.getAttribute('aria-expanded')!=='true')await disclosure.click()}
  await expect(formatted).toBeVisible()
  const cdp=await appPage.context().newCDPSession(appPage),reports:any[]=[]
  await cdp.send('Network.enable')
  cdp.on('Network.webSocketFrameSent',event=>{
    try{const frame=JSON.parse(event.response.payloadData);for(const item of Array.isArray(frame)?frame:[frame]){const input=item.params?.input;if(input?.event?.type==='CLAUDE_UI_TRANSCRIPT_LAYOUT'&&input.event.component==='ToolResult'&&input.event.uuid==='file_fixture_1'){reports.push({at:Date.now(),...input.event});void writeFile(join(workspace!,'native-tool-width-reports.json'),JSON.stringify(reports))}}}catch{}
  })
  const samples:any[]=[]
  // Begin at a different width so every retained sample has an independently observed layout report.
  await appPage.setViewportSize({width:1000,height:900})
  for(const width of [1100,680,1100]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    await result.scrollIntoViewIfNeeded()
    const columns=await result.evaluate(element=>{const cell=element.querySelector('span.invisible')!.getBoundingClientRect().width,style=getComputedStyle(element);return Math.max(20,Math.min(240,Math.floor((element.clientWidth-parseFloat(style.paddingLeft||'0')-parseFloat(style.paddingRight||'0'))/cell)))})
    await expect.poll(()=>reports.at(-1)?.columns).toBe(columns)
    await expect.poll(async()=>{const text=(await formatted.innerText()).replace(/^[ \t]*[0-9]+[ \t]+/gm,'').replace(/\s+/g,'');return text.includes(source.replace(/\s+/g,''))}).toBe(true)
    const engine=async()=>appPage.evaluate(()=>{const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return Object.values(state.nativeUiViews).flatMap((v:any)=>v.state.transcriptMessages??[]).find((f:any)=>f.component==='ToolResult'&&f.uuid==='file_fixture_1') as any})
    // Keep the actual native formatting and the measured transport together, not CSS wrap alone.
    await expect.poll(async()=>(await engine())?.body.status).toBe('live')
    const frame=await engine(),text=await formatted.innerText()
    await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    await expect(status).toContainText('AppNativeMain')
    await expect(status).toBeInViewport({ratio:1});await expect(formatted).toBeInViewport({ratio:1})
    const sample={width,columns,text,engineOutput:frame.engineOutput,report:reports.at(-1)};samples.push(sample)
    await writeFile(join(workspace!,'native-tool-width-partial.json'),JSON.stringify({samples,reports}))
    if(samples.length<=2)await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-tool-width-'+width+'.png')})
  }
  expect(samples[0].columns).toBeGreaterThan(samples[1].columns);expect(samples[2].columns).toBe(samples[0].columns)
  expect(samples[0].engineOutput).not.toBe(samples[1].engineOutput);expect(samples[2].engineOutput).toBe(samples[0].engineOutput)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-tool-width-proof.json'),JSON.stringify({sessionId,boundNativePid,source,draft,samples,reports,noPhantomTurn:true}))
  await cdp.detach()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft);await composer.fill('Continue after inspecting this file result.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);expect(resizeErrors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativeToolRowWidth:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors,resizeErrors}))
})
