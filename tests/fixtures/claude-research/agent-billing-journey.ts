import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect,type Page,type ElectronApplication,type TestInfo} from '@playwright/test'
import type {AppDriver} from '@apackdev/testing'

/** The same original-native, actual-app journey for fixture and direct Electron execution. */
export async function verifyAgentBilling(
 {app,appPage,electronApp}:{app:Pick<AppDriver,'navigate'|'waitForSurface'>;appPage:Page;electronApp:ElectronApplication},
 testInfo:Pick<TestInfo,'outputPath'>,
 {workspace,launcher,onboarding,project}:{workspace:string;launcher:string;onboarding:string;project:string},
){
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capture(name:string){
    const size=appPage.viewportSize()!
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const result=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},size)
    expect(result.size).toEqual(size);await writeFile(testInfo.outputPath(name),Buffer.from(result.png,'base64'))
  }
  expect(process.env.HOME).toBe(workspace);expect(project).not.toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: project, phase: 'Edit' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  async function command(name: string, args = '') {
    const editor = card.locator('[contenteditable="true"]')
    await editor.fill(''); await editor.pressSequentially('/' + name)
    await appPage.locator('.command-suggestion-popup').getByText('/' + name, { exact: true }).click()
    if (args) await editor.pressSequentially(args)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(editor).toHaveText('')
  }
  await command('cc-set-dir', project)
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, nativeUi: Object.values(state.nativeUiViews).filter((view:any)=>view.threadId===state.currentThread?.id), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  try {
    // The app owns its 30s native initialization clock; first-turn latency starts after init.
    await appPage.waitForFunction(() => {
      const claude=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.context?.claudeCode
      return !!claude?.sessionId || claude?.chatState==='error'
    },null,{timeout:0})
    expect((await context()).claude.chatState).not.toBe('error')
    await expect.poll(async () => (await context()).turns, {timeout:25000,message:'Original initialized seed turn completes before billing verification'}).toBe(1)
  } catch (error) {
    // Keep the original failure while recording what the person could see at the startup boundary.
    await writeFile(testInfo.outputPath('native-agent-billing-startup-failure.json'), JSON.stringify(await context(), null, 2)).catch(() => undefined)
    await capture('native-agent-billing-startup-failure.png').catch(() => undefined)
    throw error
  }
  expect((await context()).claude.cwd).toBe(project)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  let theme = false, security = false, navigated = false, trusted = false, onboardingScreen = ''
  try {
  await expect.poll(async () => {
    const current = await context(), native = current.native
    // The renderer applies cursor-addressed redraws; accumulated PTY bytes are not the current screen.
    onboardingScreen = await section.locator('.xterm-rows').innerText()
    const screen = recognizeOnboardingPrompt(onboardingScreen, project)
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !trusted) { trusted = true; await input.press('Enter') }
    return native?.state?.status === 'live'
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  } catch (error) {
    await writeFile(testInfo.outputPath('native-agent-billing-onboarding-failure.json'), JSON.stringify({theme,security,navigated,trusted,screen:onboardingScreen,context:await context()}, null, 2)).catch(() => undefined)
    await capture('native-agent-billing-onboarding-failure.png').catch(() => undefined)
    throw error
  }
  await expect(card).toBeHidden()
  const boundNativePid=(await context()).native.state.nativePid
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  const composer=card.locator('[contenteditable="true"]')
  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:25000}).toBe(true)
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first()
  const taskId=await row.getAttribute('data-native-agent-id');expect(taskId).toBeTruthy()
  await composer.fill('Keep the parent release-review draft.')
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true})
  const form=focused.getByRole('form',{name:'Agent message',exact:true})
  const draft=form.locator('[contenteditable="true"]')
  const billing=form.getByTestId('claude-billing-status')
  const agentUi=async()=>(await context()).nativeUi.find((view:any)=>view.mountRequest?.nativeView?.taskId===taskId)
  await expect.poll(async()=>(await agentUi())?.state.status,{timeout:15000}).toBe('live')
  await expect(focused.getByText('Loading Agent conversation…',{exact:true})).toHaveCount(0)
  await expect(billing).toContainText('Usage allowed · No usage-credit charge reported · Resets')
  await expect(form.getByTestId('composer-native-status')).toHaveCount(0)
  await expect(form.getByRole('button',{name:'Session tools',exact:true})).toHaveCount(0)
  await draft.fill('Keep this worker draft while reviewing usage.')
  const readings=[]
  for(const size of [{width:1100,height:900},{width:680,height:600}]){
    await appPage.setViewportSize(size)
    await expect(billing).toBeInViewport();await expect(draft).toBeInViewport()
    await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
    const geometry=await billing.evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,text:el.textContent,title:el.getAttribute('title')}})
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
    expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.x+geometry.width).toBeLessThanOrEqual(size.width)
    const ui=await agentUi();expect(ui.state.status).toBe('live');expect(ui.mountRequest.nativeView.kind).toBe('agent')
    readings.push({...size,...geometry,uiStatus:ui.state.status,uiBilling:ui.state.billing,target:ui.mountRequest.nativeView})
    await capture('native-agent-billing-'+size.width+'.png')
  }
  const observation=(await context()).native.state.billing
  expect(observation.sessionId).toBe(sessionId);expect(observation.info.status).toBe('allowed');expect(observation.info.isUsingOverage).toBe(false)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText('Keep the parent release-review draft.')
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  await expect(draft).toHaveText('Keep this worker draft while reviewing usage.')
  await expect(billing).toBeInViewport()
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(focused).toBeHidden()
  await composer.click();await composer.press(process.platform==='darwin'?'Meta+A':'Control+A');await composer.press('Backspace')
  const recovery='Continue the same session after reviewing native usage.'
  await composer.pressSequentially(recovery);await expect(composer).toHaveText(recovery)
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState,{timeout:25000}).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-billing-proof.json'),JSON.stringify({project,sessionId,taskId,boundNativePid,observation,readings,recovery,final:await context()},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:planScenario,nativeAgentBilling:true,nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
}
