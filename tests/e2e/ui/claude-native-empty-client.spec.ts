import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,launcher=process.env.CLAUDE_RESEARCH_LAUNCHER,onboarding=process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace||!launcher||!onboarding||process.env.CLAUDE_RESEARCH_EMPTY_KEYBOARD_CLIENT!=='1','Explicit owned keyboard-only Client fixture required')
test('keeps an empty keyboard Client reachable and retires hidden input without losing composing',async({app,appPage,electronApp},testInfo)=>{
  test.setTimeout(120000)
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capture(name:string){
    const size=appPage.viewportSize()!
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const result=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},size)
    expect(result.size).toEqual(size);await writeFile(testInfo.outputPath(name),Buffer.from(result.png,'base64'))
  }
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, terminalClients } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!terminalClients, 'Explicit private terminal Client fixture required')
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
  const composer=card.getByTestId('composer-editor-area').getByRole('textbox')
  const tools=card.getByRole('button',{name:'Session tools',exact:true})
  const clients=card.locator('[data-native-client]')
  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-empty-client-events.json'),'utf8').catch(()=>'[]'))
  const draft='Keep my release review notes while using the keyboard extension.'
  const readings:any[]=[]
  let count=0,token:string|null=null
  await composer.fill(draft)
  for(const [index,size] of [{width:1100,height:900},{width:680,height:600}].entries()){
    await appPage.setViewportSize(size)
    await expect(tools).toBeVisible();await expect(tools).toHaveAttribute('aria-expanded','false')
    await tools.click();await expect(clients).toHaveCount(1)
    const client=clients.first();await expect(client).toBeVisible()
    await expect(client.locator('[data-native-client-text-input]')).toHaveCount(1)
    expect(await client.evaluate(node=>{const copy=node.cloneNode(true) as HTMLElement;copy.querySelectorAll('[aria-hidden="true"],textarea').forEach(child=>child.remove());return copy.textContent?.trim()})).toBe('')
    const current=await client.getAttribute('data-native-client');if(token)expect(current).toBe(token);else token=current
    const key=index===0?'a':'b'
    await client.focus();await client.press(key);count++
    await expect.poll(async()=>(await receipts()).at(-1)).toMatchObject({count,key,surface:'desktop',component:'AbovePrompt'})
    const held=await client.locator('[data-native-client-text-input]').elementHandle();expect(held).not.toBeNull()
    await held!.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})))
    await tools.click();await expect(tools).toHaveAttribute('aria-expanded','false');await expect(client).toBeHidden()
    await held!.evaluate(node=>{const input=node as HTMLTextAreaElement;input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'hidden'}));input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'h'}));input.value='hidden';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'hidden'}))})
    await expect(composer).toHaveText(draft);await expect(composer).toBeEditable()
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    await capture('apack-empty-client-collapsed-'+size.width+'.png')
    await tools.click();await expect(client).toBeVisible();expect(await client.getAttribute('data-native-client')).toBe(token)
    const freshKey=index===0?'y':'z';await client.focus();await client.press(freshKey);count++
    await expect.poll(async()=>(await receipts()).at(-1)).toMatchObject({count,key:freshKey})
    const geometry=await client.evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,hit:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})
    expect(geometry.width).toBeGreaterThan(32);expect(geometry.height).toBeGreaterThan(24);expect(geometry.hit).toBe(true)
    await expect(composer).toHaveText(draft);expect((await context()).turns).toBe(1);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    readings.push({size,token,count,geometry});await capture('apack-empty-client-reopened-'+size.width+'.png')
    if(index===0)await tools.click()
  }
  await clients.first().press('r');count++
  await expect.poll(async()=>(await receipts()).at(-1)).toMatchObject({count,key:'r',retired:true})
  await expect(clients).toHaveCount(0);await expect(tools).toHaveCount(0)
  await expect(composer).toHaveText(draft);await expect(composer).toBeEditable()
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await capture('apack-empty-client-withdrawn-680.png')
  const beforeRecovery=await context()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue the same session after keyboard extension verification.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  const rows=await receipts();expect(rows.map((row:any)=>row.count)).toEqual([1,2,3,4,5]);expect(rows.map((row:any)=>row.key)).toEqual(['a','y','b','z','r'])
  await writeFile(join(workspace!,'native-empty-client-proof.json'),JSON.stringify({sessionId,boundNativePid,readings,receipts:rows,beforeRecovery,afterRecovery:await context(),browserErrors:errors},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'composer-layout',nativeEmptyKeyboardClient:true,nativeClientEmptyRootReachable:true,nativeClientHiddenInputRefused:true,nativeClientEmptyReopenContinuity:true,nativeClientEmptyWithdrawal:true,nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
})
