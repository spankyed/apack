import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reviews original native image PDF and notebook results', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const clientLifetime = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8')).clientLifetime === true
  const lifetime = async (): Promise<any> => {
    try { return JSON.parse(await readFile(join(workspace!, 'native-client-lifetime.json'), 'utf8')) }
    catch (error: any) { if (error instanceof SyntaxError || error.code === 'ENOENT') return {}; throw error }
  }
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
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
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
  await appPage.setViewportSize({ width: 680, height: 600 })
  const composer = card.locator('[contenteditable="true"]')
  const receipts:any[]=[]
  for(const[index,name]of ['release-cover.png','release-notes.pdf','release-analysis.ipynb'].entries()){
    const turn=index+1,id='native_media_'+turn
    await composer.fill('ResearchMediaTurn'+turn+' Review '+name+' for release.');await card.getByRole('button',{name:'Send',exact:true}).click()
    const approval=appPage.getByTestId('native-read-approval');await expect(approval).toBeVisible({timeout:15000});await expect(approval.getByTestId('native-read-path')).toHaveText(join(workspace!,name));await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toBeHidden();await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    const draft='Keep my release notes while reviewing '+name;await composer.fill(draft)
    const tools=appPage.locator('[data-native-tool-activity][data-native-tool-ids~="'+id+'"]');await expect(tools).toHaveCount(1)
    const toggle=tools.getByRole('button').first();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
    const result=tools.locator('[data-native-tool-result="'+id+'"] [data-native-tool-format]');await expect(result).toBeVisible();await expect(result).not.toContainText('controls unavailable')
    const readReceipt=async()=>JSON.parse(await readFile(join(workspace!,'native-media-result-'+id+'.json'),'utf8').catch(()=>'{}'))
    await expect.poll(async()=>(await readReceipt()).props?.output?.type).toBe(['image','pdf','notebook'][index]);const receipt=await readReceipt();expect(receipt.props.tool).toBe('Read');expect(receipt.props.isErrored).toBe(false)
    let original:any,originalCall:any
    for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);original=rows.find((row:any)=>row.type==='user'&&row.message?.content?.some?.((block:any)=>block.type==='tool_result'&&block.tool_use_id===id));originalCall=rows.find((row:any)=>row.type==='assistant'&&row.message?.content?.some?.((block:any)=>block.type==='tool_use'&&block.id===id));if(original)break}catch(error:any){if(error.code!=='ENOENT')throw error}}
    expect(original?.uuid).toBeTruthy();expect(receipt.props.output).toEqual(original.toolUseResult)
    const frames=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).flatMap((view:any)=>view.state?.transcriptMessages??[]));expect(frames.find((frame:any)=>frame.component==='ToolResult'&&frame.uuid===id)).toMatchObject({resultUuid:original.uuid,assistantUuid:originalCall.uuid})
    receipts.push({id,name,type:receipt.props.output.type,formatted:await result.innerText(),nativeResultUuid:original.uuid,nativeAssistantUuid:originalCall.uuid,output:receipt.props.output})
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await result.scrollIntoViewIfNeeded();await expect(result).toBeInViewport();await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport();expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.screenshot({path:testInfo.outputPath('native-media-'+turn+'-'+size.width+'.png')})}
    if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();expect((await context()).native.state.nativePid).toBe(boundNativePid)
  }
  await writeFile(join(workspace!,'native-media-app-proof.json'),JSON.stringify(receipts))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue this saved media review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns).toBe(5);expect((await context()).sessionId).toBe(sessionId)
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeReadMedia:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
