import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},testInfo)=>{if(testInfo.status!==testInfo.expectedStatus)await appPage.screenshot({path:testInfo.outputPath('native-policy-held-failure.png')}).catch(()=>{})})
test('retires a focused held Client press across native policy restriction and restoration', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { restriction, transition, heldPolicyClient } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  expect(transition).toBe(true);expect(heldPolicyClient).toBe(true)
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
  await appPage.setViewportSize({ width: 680, height: 600 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })

  const policyFile=join(workspace!,'policy/managed-settings.json'),policy=JSON.parse(await readFile(policyFile,'utf8'))
  const before=await context(),composer=card.locator('[contenteditable="true"]')
  const parent={text:'Keep policy review notes while this extension refreshes.',cursor:9}
  await composer.fill(parent.text);await composer.press(process.platform==='darwin'?'Meta+ArrowLeft':'Home')
  for(let i=0;i<9;i++)await composer.press('ArrowRight')
  const client=card.locator('[data-native-client]').first(),tools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await expect(client).toContainText('Policy action count=0')
  await client.focus();await client.press('p')
  const readClient=async()=>JSON.parse(await readFile(join(workspace!,'native-policy-client.json'),'utf8').catch(()=>'null'))
  const receipt=async(name:string)=>JSON.parse(await readFile(join(workspace!,name),'utf8').catch(()=>'null'))
  await expect.poll(async()=>(await readClient())?.key).toBe('p')
  const oldToken=await client.getAttribute('data-native-client'),nonce='original-client-policy-hold'
  await writeFile(join(workspace!,'native-policy-held-arm.txt'),nonce)
  await client.getByRole('button',{name:'Apply policy action',exact:true}).click()
  await expect.poll(async()=>(await receipt('native-policy-held-start.json'))?.nonce,{message:'Original managed observer enters the native Client ui.press chain'}).toBe(nonce)
  const heldStarted=await receipt('native-policy-held-start.json')
  expect(heldStarted.draft).toEqual(parent)
  await writeFile(policyFile,JSON.stringify({...policy,allowManagedHooksOnly:true}))
  await expect(client).toHaveCount(0,{timeout:10000})
  await expect(composer).toHaveText(parent.text)
  await writeFile(policyFile,JSON.stringify({...policy,allowManagedHooksOnly:false}))
  await expect(client).toContainText('Policy action count=0',{timeout:10000})
  const freshToken=await client.getAttribute('data-native-client');expect(freshToken).not.toBe(oldToken)
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await client.focus();await client.press('r');await expect.poll(async()=>(await readClient())?.key).toBe('r')
  await writeFile(join(workspace!,'native-policy-held-arm.txt'),'')
  await writeFile(join(workspace!,'native-policy-held-release.txt'),nonce)
  await expect.poll(async()=>(await receipt('native-policy-held-settled.json'))?.nonce,{timeout:10000,message:'Original held middleware finishes after restoration; native cancellation/HTTP timeout must not be relabeled as successful stale acknowledgement'}).toBe(nonce)
  const heldSettled=await receipt('native-policy-held-settled.json'),afterHeld=await readClient()
  expect(heldSettled.result.element).toBe('held-policy-action');expect(afterHeld.pressed).toBe(0)
  await client.getByRole('button',{name:'Apply policy action',exact:true}).click()
  await expect.poll(async()=>(await readClient())?.pressed).toBe(1)
  const freshDraft=await receipt('native-policy-fresh-draft.json');expect(freshDraft).toEqual(parent)
  const afterFresh=await readClient(),after=await context()
  expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-policy-held-proof.json'),JSON.stringify({sessionId,boundNativePid,parent,oldToken,freshToken,heldStarted,heldSettled,afterHeld,afterFresh,freshDraft,noPhantomTurn:true}))
  await composer.focus()
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    await expect(composer).toHaveText(parent.text)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    await expect(client.getByRole('button',{name:'Apply policy action',exact:true})).toBeInViewport({ratio:1})
    const layout = await card.evaluate(card => {
      const measure=(element:Element|null)=>{if(!element)return null;const box=element.getBoundingClientRect();return {top:box.top,bottom:box.bottom,height:box.height,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop}}
      return {width:innerWidth,height:innerHeight,card:measure(card),strip:measure(card.querySelector('[data-testid="composer-session-strip"]')),site:measure(card.querySelector('.native-extension-surface')),client:measure(card.querySelector('[data-native-client]')),action:measure(card.querySelector('[aria-label="Apply policy action"]')),send:measure(card.querySelector('[aria-label="Send"]')),transcript:measure(document.querySelector('[data-testid="chat-transcript"]')),reserve:getComputedStyle(card).getPropertyValue('--composer-history-reserve')}
    })
    await writeFile(join(workspace!,'native-policy-held-layout-'+width+'.json'),JSON.stringify(layout))
    await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-policy-held-restored-'+width+'.png')})
  }
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(parent.text)
  await composer.fill('Continue after reviewing this extension policy.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);expect(resizeErrors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePolicyHeldClient:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors,resizeErrors}))
})
