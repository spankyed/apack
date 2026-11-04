import {measureWorkspaceLayout} from './workspace-layout-measurement.ts'
import {verifySelectionLimit} from './selection-limit-journey.ts'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect,type Page,type ElectronApplication,type TestInfo} from '@playwright/test'
import type {AppDriver} from '@apackdev/testing'

// Interactive billing has a120s allowance; final print recovery needs the SDK30s
// initialization allowance and its existing25s completed-turn check as well.
export const AGENT_BILLING_JOURNEY_TIMEOUT_MS=120000+30000+25000

/** The same original-native, actual-app journey for fixture and direct Electron execution. */
export async function verifyAgentBilling(
 {app,appPage,electronApp}:{app:Pick<AppDriver,'navigate'|'waitForSurface'>;appPage:Page;electronApp:ElectronApplication},
 testInfo:Pick<TestInfo,'outputPath'>,
 {workspace,launcher,onboarding,project}:{workspace:string;launcher:string;onboarding:string;project:string},
){
  const nativeWindow=await electronApp.browserWindow(appPage)
  const presentation=await nativeWindow.evaluate(window=>({visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused()}))
  await writeFile(testInfo.outputPath('native-window-presentation.json'),JSON.stringify(presentation))
  if(process.env.PLAYWRIGHT_VISIBLE==='1')expect(presentation.visible,'Everyday app verification uses a shown window inside the virtual display').toBe(true)
  async function capture(name:string){
    const size=appPage.viewportSize()!
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const result=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},size)
    expect(result.size).toEqual(size);await writeFile(testInfo.outputPath(name),Buffer.from(result.png,'base64'))
  }
  if(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT_ACCEPT==='1')expect(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT).toBe('1')
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, nativeUi: Object.values(state.nativeUiViews).filter((view:any)=>view.threadId===state.currentThread?.id), nativeViews: Object.values(state.nativeTerminalViews).filter((view:any)=>view.threadId===state.currentThread?.id), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  try {
    // The app owns its 30s native initialization clock; first-turn latency starts after init.
    await appPage.waitForFunction(() => {
      const thread=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread
      const claude=thread?.context?.claudeCode
      // Failed admission returns to Idle and finalizes a warning; it has no sessionId.
      return !!claude?.sessionId || claude?.chatState==='error' || thread?.messages?.some((message:any)=>typeof message.text==='string'&&message.text.startsWith('⚠️ '))
    },null,{timeout:0})
    const initialized=await context()
    expect(initialized.claude.chatState).not.toBe('error')
    expect(initialized.sessionId,'Native initialization must succeed; retain the actual app warning on failure').toBeTruthy()
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
  let clientTheme:unknown
  if(process.env.CLAUDE_RESEARCH_CLIENT_THEME==='1'){
    const inputs=JSON.parse(await readFile(join(workspace,'native-client-theme-inputs.json'),'utf8'))
    await card.getByRole('button',{name:'Session tools',exact:true}).click()
    const region=card.locator('[data-native-client]').filter({hasText:'Workspace connected'})
    await expect(region).toHaveCount(1)
    const token=await region.getAttribute('data-native-client'),before=await context(),themeReadings=[]
    const themeDraft='Keep this release-review draft during theme changes.'
    await composer.click();await composer.press(process.platform==='darwin'?'Meta+A':'Control+A');await composer.press('Backspace');await composer.pressSequentially(themeDraft)
    for(const [name,colors] of [['dark',{text:'rgb(226, 232, 240)',success:'rgb(134, 239, 172)',warning:'rgb(251, 191, 36)',background:'rgb(38, 50, 65)'}],['light',{text:'rgb(15, 23, 42)',success:'rgb(22, 101, 52)',warning:'rgb(146, 64, 14)',background:'rgb(243, 244, 246)'}]] as const){
      if(name==='light')await writeFile(inputs.themePath,JSON.stringify(inputs.palettes.light))
      await expect(region.getByText('Workspace connected',{exact:true})).toHaveCSS('color',colors.success,{timeout:15000})
      await expect(region.getByText('Release review ready',{exact:true})).toHaveCSS('color',colors.text)
      await expect(region.getByText('Updates 0',{exact:true})).toHaveCSS('color',colors.warning)
      await expect(region.locator('.native-box').first()).toHaveCSS('background-color',colors.background)
      for(const viewport of [{width:1100,height:900},{width:680,height:600}]){
        await appPage.setViewportSize(viewport)
        await expect(region).toBeInViewport();await expect(composer).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
        await expect(composer).toHaveText(themeDraft);expect(await region.getAttribute('data-native-client')).toBe(token)
        await capture('native-terminal-client-theme-'+name+'-'+viewport.width+'.png')
        const geometry=await region.evaluate(el=>{
          const bounds=(node:Element)=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}}
          const drawing=el.querySelector('.native-box')!;return{...bounds(el),content:bounds(drawing),text:[...drawing.querySelectorAll('.native-text-run')].map(bounds)}
        })
        expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(viewport.width);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);expect(geometry.content.scrollWidth).toBeLessThanOrEqual(geometry.content.clientWidth)
        expect(geometry.content.scrollHeight).toBeLessThanOrEqual(geometry.content.clientHeight)
        // The Client's invisible100ch cell probe contributes to its aggregate scrollWidth.
        // Verify the visible drawing and every text row against the clipping region instead.
        for(const box of [geometry.content,...geometry.text]){
          expect(box.left).toBeGreaterThanOrEqual(geometry.left);expect(box.right).toBeLessThanOrEqual(geometry.right)
          expect(box.top).toBeGreaterThanOrEqual(geometry.top);expect(box.bottom).toBeLessThanOrEqual(geometry.bottom)
        }
        const paint={success:await region.getByText('Workspace connected',{exact:true}).evaluate(el=>getComputedStyle(el).color),text:await region.getByText('Release review ready',{exact:true}).evaluate(el=>getComputedStyle(el).color),warning:await region.getByText('Updates 0',{exact:true}).evaluate(el=>getComputedStyle(el).color),background:await region.locator('.native-box').first().evaluate(el=>getComputedStyle(el).backgroundColor)}
        expect(paint).toEqual(colors)
        themeReadings.push({name,viewport,colors,paint,geometry,token,draft:await composer.textContent(),nativePid:(await context()).native.state.nativePid})
      }
    }
    await card.getByRole('button',{name:'Session tools',exact:true}).click();await expect(region).toBeHidden()
    await card.getByRole('button',{name:'Session tools',exact:true}).click();await expect(region).toBeVisible();expect(await region.getAttribute('data-native-client')).toBe(token)
    await expect(region.getByText('Workspace connected',{exact:true})).toHaveCSS('color','rgb(22, 101, 52)')
    await region.focus();await region.press('u');await expect(region.getByText('Updates 1',{exact:true})).toBeVisible()
    await expect(composer).toHaveText(themeDraft)
    await region.press('r');await expect(region).toHaveCount(0)
    const receipts=JSON.parse(await readFile(join(project,'native-client-theme-events.json'),'utf8'))
    expect(receipts.map((r:any)=>r.key)).toEqual(['u','r']);expect(receipts.map((r:any)=>r.count)).toEqual([1,1]);expect(receipts[1].retired).toBe(true)
    const after=await context();expect(after.native.state.nativePid).toBe(boundNativePid);expect(after.turns).toBe(before.turns);expect(after.claude.totalCostUsd).toBe(before.claude.totalCostUsd);expect(after.messages).toEqual(before.messages)
    clientTheme={sessionId,boundNativePid,token,readings:themeReadings,receipts,before,after,retainedDraft:await composer.textContent()}
    await writeFile(join(workspace,'native-terminal-client-theme-proof.json'),JSON.stringify(clientTheme,null,2))
    await composer.click();await composer.press(process.platform==='darwin'?'Meta+A':'Control+A');await composer.press('Backspace');await expect(composer).toHaveText('')
  }
  if(process.env.CLAUDE_RESEARCH_SELECTION_LIMIT==='1')await verifySelectionLimit({appPage,card,composer,project,context,capture})
  if(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT==='1'&&process.env.CLAUDE_RESEARCH_AGENT_HIT_DIAGNOSTIC!=='1'){
    await composer.fill('Review the latest release notes and suggest the next step.')
    await measureWorkspaceLayout({page:appPage,composer,workspace,phase:'parent',capture})
  }
  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  // Native zln displays completed named/retained Agents as idle.
  try {
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>!task.kind&&['completed','idle'].includes(task.status)),{timeout:25000}).toBe(true)
  } catch(error) {
    await writeFile(testInfo.outputPath('native-agent-billing-task-state-failure.json'),JSON.stringify(await context(),null,2)).catch(()=>undefined)
    throw error
  }
  const taskAdmission=await context()
  await writeFile(join(workspace,'native-agent-billing-task-admission.json'),JSON.stringify({sessionId,boundNativePid,tasks:taskAdmission.native.state.tasks,turns:taskAdmission.turns},null,2))
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first()
  const taskId=await row.getAttribute('data-native-agent-id');expect(taskId).toBeTruthy()
  // Use the editor's actual keyboard selection/replacement path before switching.
  await composer.click();await composer.press(process.platform==='darwin'?'Meta+A':'Control+A');await composer.press('Backspace')
  await composer.pressSequentially('Keep the parent release-review draft.')
  await expect(composer).toHaveText('Keep the parent release-review draft.')
  let taskManagerProof: { readings: any[]; before: any; after: any } | undefined
  if(process.env.CLAUDE_RESEARCH_TASK_MANAGER==='1'){
    const before=await context(),readings:any[]=[]
    const documentBefore=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())
    const selectionBefore=await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())
    for(const size of [{width:1100,height:900},{width:680,height:600}]){
      await appPage.setViewportSize(size)
      const tasks=card.getByRole('button',{name:'Claude tasks',exact:true})
      if(await tasks.isVisible())await tasks.click()
      else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Claude tasks',exact:true}).click()}
      const panel=appPage.getByRole('dialog',{name:'Native /tasks panel',exact:true})
      await expect(panel).toBeVisible({timeout:15000})
      await expect.poll(async()=>(await context()).nativeUi.some((view:any)=>view.state?.agentInput?.status==='panel'&&view.state.agentInput.panel?.commandName==='tasks'),{timeout:15000}).toBe(true)
      await expect(panel.getByRole('button',{name:'Close panel',exact:true})).toBeInViewport({ratio:1})
      await expect.poll(async()=>(await panel.locator('.xterm-rows').innerText()).trim().length,{timeout:15000}).toBeGreaterThan(0)
      const box=await panel.evaluate(element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}})
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);expect(box.y+box.height).toBeLessThanOrEqual(size.height+1)
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth+1)
      await capture('native-task-manager-'+size.width+'.png')
      const text=await panel.locator('.xterm-rows').innerText()
      await panel.getByRole('button',{name:'Close panel',exact:true}).click();await expect(panel).toBeHidden()
      await expect(composer).toHaveText('Keep the parent release-review draft.')
      expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(documentBefore)
      expect(await composer.evaluate(element=>(element as any).editor.state.selection.toJSON())).toEqual(selectionBefore)
      const after=await context();expect(after.sessionId).toBe(sessionId);expect(after.native.state.nativePid).toBe(boundNativePid)
      expect(after.turns).toBe(before.turns);expect(after.claude.totalCostUsd).toBe(before.claude.totalCostUsd)
      readings.push({...size,box,text,panelCommand:'tasks',sessionId,boundNativePid,retainedDraft:true})
      await capture('native-task-manager-return-'+size.width+'.png')
    }
    taskManagerProof={readings,before,after:await context()}
    await writeFile(join(workspace,'native-task-manager-return-proof.json'),JSON.stringify(taskManagerProof,null,2))
  }
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
  if(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT==='1')await measureWorkspaceLayout({page:appPage,composer:draft,workspace,phase:'agent',capture})
  const readings=[]
  for(const size of [{width:1100,height:900},{width:680,height:600}]){
    await appPage.setViewportSize(size)
    await expect(billing).toBeInViewport();await expect(draft).toBeInViewport()
    await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
    const geometry=await billing.evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,text:el.textContent,title:el.getAttribute('title')}})
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
    expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.x+geometry.width).toBeLessThanOrEqual(size.width)
    const current=await context(),ui=current.nativeUi.find((view:any)=>view.mountRequest?.nativeView?.taskId===taskId)
    expect(ui.state.status).toBe('live')
    const selected=current.nativeViews.find((view:any)=>view.state?.ownerId===ui.mountRequest.nativeView.ownerId&&view.state?.view?.kind==='agent'&&view.state.view.taskId===taskId)
    expect(selected).toBeTruthy();expect(selected.state.nativePid).toBe(boundNativePid)
    expect(ui.mountRequest.nativeView).toMatchObject({ownerId:selected.state.ownerId,sessionId,taskId,revision:selected.state.view.revision})
    readings.push({...size,...geometry,uiStatus:ui.state.status,uiBilling:ui.state.billing,target:ui.mountRequest.nativeView,terminalOwner:{ownerId:selected.state.ownerId,sessionId:selected.state.sessionId,nativePid:selected.state.nativePid,view:selected.state.view}})
    await capture('native-agent-billing-'+size.width+'.png')
  }
  const observation=(await context()).native.state.billing
  expect(observation.sessionId).toBe(sessionId);expect(observation.info.status).toBe('allowed');expect(observation.info.isUsingOverage).toBe(false)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer).toHaveText('Keep the parent release-review draft.')
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  await expect(draft).toHaveText('Keep this worker draft while reviewing usage.')
  await expect(billing).toBeInViewport()
  let panelOwnership:undefined|{readings:unknown[];before:unknown;after:unknown}
  if(process.env.CLAUDE_RESEARCH_AGENT_PANEL_OWNERSHIP==='1'){
    const before=await agentUi(),panelReadings=[]
    await form.getByRole('button',{name:'Claude settings',exact:true}).click()
    const dialog=focused.getByRole('dialog',{name:'Claude Code settings',exact:true})
    const hiddenForm=focused.locator('form[aria-label="Agent message"]')
    const hiddenEditor=hiddenForm.locator('.tiptap.ProseMirror')
    await expect(dialog).toBeVisible()
    await expect.poll(async()=>(await agentUi())?.state.agentInput?.status,{timeout:15000}).toBe('panel')
    await expect(hiddenForm).toBeHidden();await expect(hiddenEditor).toHaveAttribute('contenteditable','false')
    await expect.poll(()=>dialog.locator('[data-native-setting]').count()).toBeGreaterThan(0)
    const search=dialog.getByRole('textbox',{name:'Search Claude Code settings',exact:true})
    await search.click();await appPage.keyboard.type('theme')
    await expect(search).toHaveValue('theme')
    await expect(hiddenEditor).toHaveText('Keep this worker draft while reviewing usage.')
    for(const viewport of [{width:1100,height:900},{width:680,height:600}]){
      await appPage.setViewportSize(viewport)
      await expect(dialog.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
      await expect(search).toBeInViewport()
      const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}})
      expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(viewport.width)
      expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(viewport.height)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
      const ui=await agentUi()
      expect(ui.mountRequest.nativeView).toEqual(before.mountRequest.nativeView)
      panelReadings.push({viewport,geometry,search:await search.inputValue(),nativeInput:ui.state.agentInput,target:ui.mountRequest.nativeView,hiddenDraft:await hiddenEditor.textContent(),editable:await hiddenEditor.getAttribute('contenteditable')})
      await capture('native-agent-settings-ownership-'+viewport.width+'.png')
    }
    await dialog.getByRole('button',{name:'Close settings',exact:true}).click()
    await expect(dialog).toHaveCount(0);await expect(draft).toBeVisible()
    await expect(draft).toHaveText('Keep this worker draft while reviewing usage.')
    await expect(draft).toHaveAttribute('contenteditable','true');await expect(billing).toBeInViewport()
    const after=await agentUi();expect(after.mountRequest.nativeView).toEqual(before.mountRequest.nativeView)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    panelOwnership={readings:panelReadings,before,after}
    await writeFile(join(workspace,'native-agent-panel-ownership-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,...panelOwnership},null,2))
  }
  // Preserve completed interaction evidence even when later recovery fails.
  await writeFile(join(workspace,'native-agent-billing-interaction.json'),JSON.stringify({
    project,sessionId,taskId,boundNativePid,observation,readings,
    parentDraftRetained:true,agentDraftRetained:true,
    recoveryVerified:false,context:await context(),
  },null,2))
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  // Both callers bound this journey; a second five-second clock can expire before clean native shutdown.
  const closingOwner=(await context()).native.state.ownerId
  await appPage.waitForFunction((ownerId) => {
    const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
    const owner=Object.values(state.nativeTerminalViews).find((view:any)=>view.threadId===state.currentThread?.id&&view.state?.ownerId===ownerId) as any
    return owner && ['exited','error'].includes(owner.state.status)
  },closingOwner,{timeout:0})
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(focused).toBeHidden()
  await composer.click();await composer.press(process.platform==='darwin'?'Meta+A':'Control+A');await composer.press('Backspace')
  const recovery='Continue the same session after reviewing native usage.'
  await composer.pressSequentially(recovery);await expect(composer).toHaveText(recovery)
  const turnsBeforeRecovery=(await context()).turns
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>{
    const state=await context()
    return state.claude.chatState==='success'&&state.turns>turnsBeforeRecovery
  },{timeout:25000,message:'Same-session recovery completes a new original turn'}).toBe(true)
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-billing-proof.json'),JSON.stringify({project,sessionId,taskId,boundNativePid,observation,readings,recovery,final:await context()},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:planScenario,nativeAgentBilling:true,...(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT_ACCEPT==='1'?{nativeWorkspaceLayout:true}:{}),...(process.env.CLAUDE_RESEARCH_SELECTION_LIMIT==='1'?{nativeSelectionLimit:true}:{}),nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,...(panelOwnership?{nativeAgentPanelOwnership:true}:{}),...(clientTheme?{nativeClientTheme:true}:{}),...(taskManagerProof?{nativeTaskManagerReturn:true,taskManagerReadings:taskManagerProof.readings}:{}),sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
}
