import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},info) => { if(info.status!==info.expectedStatus)await appPage.screenshot({caret:'initial',path:info.outputPath('native-status-startup-failure.png')}).catch(()=>{}) })
test('renders original initial helper output in the ordinary composer without another turn', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const startedAt=Date.now();let initialLive:any
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
  let theme=false,security=false,navigated=false,trusted=false
  await expect.poll(async()=>{
    const native=(await context()).native
    const text=native?.output?.map((chunk:any)=>chunk.text).join('')??''
    const screen=recognizeOnboardingPrompt(text,workspace)
    if(screen==='theme'&&!theme){theme=true;await input.press('Enter')}
    else if(screen==='security-notes'&&theme&&!security){security=true;await input.press('Enter')}
    else if(screen==='workspace-trust'&&!navigated){navigated=true;await input.press('ArrowDown')}
    else if(screen==='workspace-trust-selected'&&navigated&&!trusted){trusted=true;await input.press('Enter')}
    if(native?.state?.status==='live'&&!initialLive)initialLive={at:Date.now(),state:native.state}
    return native?.state?.status==='live'&&native.state.mainStatus?.includes('Session ready')
  },{timeout:25000,intervals:[250]}).toBe(true)
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
  const composer = card.locator('[contenteditable="true"]'), draft='Review release notes and confirm the migration checklist.'
  await composer.fill(draft);const before=await context(),samples=[]
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await expect(composer).toHaveText(draft)
    await expect(status).toHaveText('Session ready\nReviewing release notes')
    await expect(status).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.count())expect(await tools.getAttribute('aria-expanded')).toBe('false')
    samples.push({width,status:(await context()).native.state.mainStatus,at:Date.now()})
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-status-startup-'+width+'.png')})
  }
  const lines=async(name:string)=>(await readFile(join(workspace!,name),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  await expect.poll(async()=>(await lines('status-startup-posts.jsonl')).some(row=>row.kind==='main'&&row.code===0&&row.httpStatus===200&&row.parentPid===boundNativePid&&row.stdout.includes('Session ready'))).toBe(true)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-status-startup-proof.json'),JSON.stringify({startedAt,initialLive,sessionId,boundNativePid,samples,helper:await lines('status-startup-helper.jsonl'),posts:await lines('status-startup-posts.jsonl'),noPhantomTurn:true}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft)
  await composer.fill('Continue after checking session status.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeStatusStartup:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
