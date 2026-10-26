import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const brokerFailure=process.env.CLAUDE_RESEARCH_PROMPT_BROKER_FAILURE==='1'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},testInfo)=>{if(testInfo.status!==testInfo.expectedStatus)await appPage.screenshot({path:testInfo.outputPath('native-prompt-timeout-failure.png')}).catch(()=>{})})
test('retires an expired reverse read without letting its late reply satisfy a fresh read', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(brokerFailure?150000:90000)
  expect(process.env.HOME).toBe(workspace)
  const { restriction, transition } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  expect(transition).toBe(true)
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  const resizeErrors:string[]=[];appPage.on('console',message=>{if(message.type()==='error'&&message.text().includes('ResizeObserver loop'))resizeErrors.push(message.text())})
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
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
  const before=await context(),composer=card.locator('[contenteditable="true"]')
  const tools=card.getByRole('button',{name:'Session tools',exact:true})
  if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  const read=card.getByRole('button',{name:'Read current draft',exact:true})
  const {holdOwnedPromptReplies}=await import(pathToFileURL(process.env.CLAUDE_RESEARCH_PROMPT_REPLY_HOLD!).href)
  const hold=await holdOwnedPromptReplies(appPage)
  const receipt=async(call:number)=>JSON.parse(await readFile(join(workspace!,'native-timeout-read-'+call+'.json'),'utf8').catch(()=>'null'))
  const old={text:'Keep the earlier release review draft.',cursor:9}
  const current={text:'Keep the newer release review draft.',cursor:9}
  async function draft(value:typeof old){
    await composer.fill(value.text);await composer.press(process.platform==='darwin'?'Meta+ArrowLeft':'Home')
    for(let i=0;i<value.cursor;i++)await composer.press('ArrowRight')
  }
  try{
    await draft(old);await hold.arm();await read.click()
    await expect.poll(async()=>(await hold.receipts()).length).toBe(1)
    expect((await hold.receipts())[0].box).toEqual(old)
    if(brokerFailure){
      const live=(await context()).native.state,history=before.messages.map((message:any)=>({id:message.id,uuid:message.context?.cliUuid,text:message.text}))
      const failure={kind:'broker',brokerPid:live.pid,nativePid:live.nativePid,at:Date.now(),retiredAt:0}
      expect(failure.nativePid).toBe(boundNativePid);expect(failure.brokerPid).toBeGreaterThan(1);expect(failure.brokerPid).not.toBe(process.pid)
      process.kill(failure.brokerPid,'SIGKILL')
      await expect.poll(async()=>(await context()).native.state.status).toBe('error')
      await expect.poll(()=>{try{process.kill(boundNativePid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true)
      failure.retiredAt=Date.now();await expect(composer).toHaveText(old.text)
      await expect(section.getByRole('status')).toContainText('disconnected unexpectedly')
      const capture=async(file:string)=>{const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!;const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'))}
      for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(composer).toHaveText(old.text);await expect(section.getByRole('button',{name:'Use native interface',exact:true})).toBeInViewport();await capture('native-prompt-broker-disconnected-'+width+'.png')}
      await section.getByRole('button',{name:'Use native interface',exact:true}).click()
      await expect.poll(async()=>(await context()).native.state.status,{timeout:20000}).toBe('live')
      const freshPid=(await context()).native.state.nativePid;expect(freshPid).not.toBe(boundNativePid)
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(old.text)
      await unlink(join(workspace!,'native-timeout-read-1.json')).catch(error=>{if(error.code!=='ENOENT')throw error})
      await draft(current);await hold.arm();if(await tools.getAttribute('aria-expanded')!=='true')await tools.click();await read.click()
      await expect.poll(async()=>(await hold.receipts()).length).toBe(2)
      const pending=await hold.receipts();expect(pending[1].requestId).not.toBe(pending[0].requestId);expect(pending[1].mountId).not.toBe(pending[0].mountId);expect(pending[1].box).toEqual(current)
      await hold.release(0);await appPage.waitForTimeout(250);expect(await receipt(1)).toBeNull();await expect(composer).toHaveText(current.text)
      await hold.release(1);await expect.poll(async()=>await receipt(1)).toMatchObject({result:current})
      const fresh=await receipt(1),after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((message:any)=>({id:message.id,uuid:message.context?.cliUuid,text:message.text}))).toEqual(history)
      for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(composer).toHaveText(current.text);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(read).toBeInViewport();await capture('native-prompt-broker-recovered-'+width+'.png')}
      await writeFile(join(workspace!,'native-prompt-broker-failure-proof.json'),JSON.stringify({sessionId,boundNativePid,freshPid,failure,old,current,fresh,replies:await hold.receipts(),history,oldDidNotSettleFresh:true,noPhantomTurn:true}))
      await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
      const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
      await expect(composer).toHaveText(current.text);await composer.fill('Continue after recovering the interrupted native draft read.');await card.getByRole('button',{name:'Send',exact:true}).click()
      await expect.poll(async()=>(await context()).claude.chatState,{timeout:20000}).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);expect(resizeErrors).toEqual([])
      await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePromptBrokerFailure:true,reopenedNativePid:freshPid,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors,resizeErrors}))
      return
    }

    await expect.poll(async()=>await receipt(1),{timeout:6500,message:'Original per-request deadline retires the addressed read'}).toMatchObject({result:{text:'',cursor:0}})
    const expired=await receipt(1);expect(expired.finished-expired.started).toBeGreaterThanOrEqual(3500)
    await expect(composer).toHaveText(old.text)
    await draft(current);await hold.arm();await read.click()
    await expect.poll(async()=>(await hold.receipts()).length).toBe(2)
    const pending=await hold.receipts();expect(pending[1].requestId).not.toBe(pending[0].requestId);expect(pending[1].box).toEqual(current)
    await hold.release(0)
    // Give the original transport time to deliver the stale frame while the fresh frame is still withheld.
    await appPage.waitForTimeout(250)
    expect(await receipt(2)).toBeNull();await expect(composer).toHaveText(current.text)
    await hold.release(1)
    await expect.poll(async()=>await receipt(2)).toMatchObject({result:current})
    const fresh=await receipt(2),after=await context(),replies=await hold.receipts()
    expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!,'native-prompt-timeout-proof.json'),JSON.stringify({sessionId,boundNativePid,old,current,expired,fresh,replies,oldDidNotSettleFresh:true,noPhantomTurn:true}))
  }finally{await hold.close()}
  await composer.focus()
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    await expect(composer).toHaveText(current.text)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    await expect(read).toBeInViewport({ratio:1})
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-prompt-timeout-recovered-'+width+'.png')})
  }
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(current.text)
  await composer.fill('Continue after reviewing this request timeout.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);expect(resizeErrors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePromptRequestTimeout:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors,resizeErrors}))
})
