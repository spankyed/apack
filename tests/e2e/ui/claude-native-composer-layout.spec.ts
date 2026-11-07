import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('keeps long native status and model catalog usable in compact windows', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: workspace!, phase: 'Edit' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  async function command(name: string, args = '') {
    const editor = card.locator('[contenteditable="true"]')
    await editor.fill(''); await editor.pressSequentially('/' + name)
    await appPage.locator('.command-suggestion-popup').getByText('/' + name, { exact: true }).click()
    if (args) await editor.pressSequentially(args)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(editor).toHaveText('')
  }
  await command('cc-set-dir', workspace!)
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })
  const composer = card.locator('[contenteditable="true"]')
  if (planScenario === 'accept-edits') {
    await composer.pressSequentially('/cc-model')
    await appPage.locator('.command-suggestion-popup').getByText('/cc-model', { exact: true }).click()
    await composer.pressSequentially('haiku')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.modelOverride).toBe('haiku')
  }
  const everydayGeometry: any[] = []
  await composer.fill('Explain the current changes and suggest the next step.')
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await expect(composer).toBeInViewport({ ratio: 0.99 })
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 0.99 })
    await expect(status).toBeInViewport({ ratio: 0.99 })
    const sizes = await card.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, width: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.height + 1)
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1)
    everydayGeometry.push({ height, card: sizes })
    await appPage.screenshot({ path: testInfo.outputPath('apack-everyday-native-composer-' + height + '.png') })
  }
  await writeFile(join(workspace!,'status-mode.txt'),'long')
  await expect(status).toContainText('NativeLongStatusEnd',{timeout:10000})
  await expect(status.locator('[style*="color"]').first()).toHaveCSS('color','rgb(74, 222, 128)')
  const geometry: any[]=[]
  for(const height of [600,900]){
    await appPage.setViewportSize({width:680,height})
    await status.focus()
    await expect(status).toBeFocused()
    const sizes=await status.evaluate(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth,height:element.clientHeight,scrollHeight:element.scrollHeight}))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width+1)
    expect(sizes.height).toBeLessThanOrEqual(96)
    expect(sizes.scrollHeight).toBeGreaterThan(sizes.height)
    const cardSize=await card.evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight}))
    expect(cardSize.scrollHeight).toBeLessThanOrEqual(cardSize.height+1)
    geometry.push({viewportHeight:height,status:sizes,card:cardSize})
    await appPage.screenshot({path:testInfo.outputPath('apack-long-native-status-start-'+height+'.png')})
    await status.press('Control+End')
    await expect.poll(()=>status.evaluate(element=>element.scrollTop+element.clientHeight>=element.scrollHeight-2)).toBe(true)
    await status.press('Escape')
    await expect(composer).toBeFocused()
    const toolbar=card.locator('[data-composer-toolbar]')
    const box=await toolbar.boundingBox();expect(box).toBeTruthy();expect(box!.y+box!.height).toBeLessThanOrEqual(height)
    await appPage.screenshot({path:testInfo.outputPath('apack-long-native-status-'+height+'.png')})
  }
  await command('cc-models')
  await expect.poll(async()=> (await context()).messages.some((m:any)=>m.text.includes('NativeCatalogLabelStart')&&m.text.includes('NativeCatalogDescriptionEnd'))).toBe(true)
  const catalog=appPage.getByText(/NativeCatalogLabelStart/).last()
  await catalog.evaluate(element=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null
    while((node=walker.nextNode())){
      const index=node.textContent?.indexOf('NativeCatalogLabelStart')??-1
      if(index<0)continue
      const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+23)
      for(let parent=element.parentElement;parent;parent=parent.parentElement){
        if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){parent.scrollTop+=range.getBoundingClientRect().top-parent.getBoundingClientRect().top-8;break}
      }
      break
    }
  })
  const content=await catalog.evaluate(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth}))
  expect(content.scrollWidth).toBeLessThanOrEqual(content.width+1)
  await appPage.screenshot({path:testInfo.outputPath('apack-long-native-catalog.png')})
  await composer.fill('Continue after compact layout checks.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>{const c=await context();return c.native?.state.busy===false&&c.messages.some((m:any)=>m.context?.claudeTerminalMessage&&m.text==='Fixture completed.')}).toBe(true)
  const defaultNotice=appPage.locator('[data-native-placement="InfoNotice"]').filter({hasText:'Debug mode enabled'}).first(),defaultDuration=appPage.locator('[data-native-placement="TurnDuration"]').last()
  await expect(defaultNotice).toContainText('Debug mode enabled')
  await expect(defaultDuration).toContainText(/for \d/)
  await expect(defaultNotice.getByRole('button')).toHaveCount(0)
  await expect(defaultDuration.getByRole('button')).toHaveCount(0)
  for(const height of [900,600]){await appPage.setViewportSize({width:680,height});await defaultDuration.scrollIntoViewIfNeeded();await expect(composer).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('apack-native-default-duration-'+height+'.png')})}
  await defaultNotice.evaluate(element=>element.scrollIntoView({block:'start'}))
  await expect(defaultNotice).toBeInViewport({ratio:0.99})
  await appPage.screenshot({path:testInfo.outputPath('apack-native-default-notice-600.png')})
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=> (await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue the same session after layout verification.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=> (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativeTerminalDefaults:true,nativePlanScenario:'composer-layout',nativeEverydayComposer:true,everydayGeometry,nativeLongStatus:true,nativeKeyboardStatusScroll:true,nativeCompactComposerControls:true,nativeLongModelCatalog:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,geometry,browserErrors:errors},null,2))
})
