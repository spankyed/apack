import { readFile, writeFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('honors OS-managed policy before user settings in the everyday composer', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
  const unreadable=process.env.CLAUDE_RESEARCH_SYSTEM_POLICY_UNREADABLE==='1'
  expect(process.env.HOME).toBe(workspace)
  const darwinPolicy = process.env.CLAUDE_RESEARCH_DARWIN_SYSTEM_POLICY === '1'
  expect(process.platform === 'darwin').toBe(darwinPolicy)
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/code').getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  const composer = card.locator('[contenteditable="true"]')
  async function replaceDraft(text: string) {
    await composer.click()
    await composer.press('ControlOrMeta+A')
    await appPage.keyboard.insertText(text)
    await expect(composer).toHaveText(text)
  }
  await replaceDraft('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  // A cold hosted print launch must finish before the native-policy checkpoints begin.
  await expect.poll(async () => (await context()).turns, { timeout: 30000 }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator("textarea[aria-label=\"Terminal input\"]")
  const terminalRows = section.locator('[data-terminal-text]')
  let settingsConsent = false, settingsChoice = 0
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const native = (await context()).native
    const text = await terminalRows.innerText({ timeout: 500 }).catch(() => '')
    if (native?.state?.status === 'live') return unreadable||native.state.mainStatus?.includes('Managed OS policy ready') === true
    if(unreadable&&text.includes('Settings Error')&&text.includes('/etc/claude-code/managed-settings.json')&&text.includes('Continue without these settings')){
      if(/❯\s*1\. Fix with Claude/.test(text)&&settingsChoice===0){settingsChoice=1;await input.press('ArrowDown')}
      else if(/❯\s*2\. Exit and fix manually/.test(text)&&settingsChoice===1){settingsChoice=2;await input.press('ArrowDown')}
      else if(/❯\s*3\. Continue without these settings/.test(text)&&!settingsConsent){settingsConsent=true;await input.press('Enter')}
      return false
    }
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (unreadable || native.state.mainStatus?.includes('Managed OS policy ready') === true)
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  if(unreadable)expect(settingsConsent).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (unreadable) { /* Native helper eligibility is not inferred from an unreadable policy. */ }
  else {
    await expect(main).toContainText('Managed OS policy ready')
    await expect(main).toContainText('Managed source has priority')
    if (darwinPolicy) await expect(main).not.toContainText('Device policy fallback')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (unreadable) { /* Warning display and continuation are separate from helper acceptance. */ }
  else await expect(status).toContainText('Managed OS policy ready')
  const warning=appPage.locator('[data-native-managed-settings]')
  if(unreadable){await expect(warning).toBeVisible({timeout:15000});await warning.locator('summary').click();await expect(warning).toContainText('/etc/claude-code/managed-settings.json');await expect(warning).toContainText('EACCES')}





  const nativeWindow=await electronApp.browserWindow(appPage)
  const draft='Keep my policy review draft while checking managed settings.'
  await replaceDraft(draft)
  const originalDocument=await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())
  const captures:string[]=[]
  for(const [width,height] of [[1100,900],[680,600]]){
    await appPage.setViewportSize({width,height});await expect(composer).toHaveText(draft)
    for(const item of [composer,...(unreadable?[warning]:[status]),card.getByRole('button',{name:'Send',exact:true})])await expect(item).toBeInViewport({ratio:1})
    if (!unreadable) {
      await expect(status).toContainText('Managed OS policy ready')
      await expect(status).toContainText('Managed source has priority')
      await expect(status).not.toContainText('Session ready')
      if (darwinPolicy) await expect(status).not.toContainText('Device policy fallback')
    }
    if(!unreadable){await expect(card.getByRole('button',{name:'Session tools',exact:true})).toHaveCount(0);await expect(card.getByRole('button',{name:'Read current draft',exact:true})).toHaveCount(0)}
    expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).native.state.status).toBe('live');expect((await context()).turns).toBe(1)
    const captured=await nativeWindow.evaluate(async(window,size)=>{const image=await window.webContents.capturePage({x:0,y:0,...size});return{size:image.getSize(),png:image.toPNG().toString('base64')}},{width,height});expect(captured.size).toEqual({width,height})
    const name='native-system-policy-'+(unreadable?'unreadable-':'')+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(captured.png,'base64'));captures.push(name)
  }
  let darwinTransitions: Array<{ mode: number; caption: string; diagnostic?: string; screenshots: string[] }> | undefined
  if (process.env.CLAUDE_RESEARCH_DARWIN_POLICY_LIVE === '1') {
    expect(darwinPolicy).toBe(true)
    const control = process.env.CLAUDE_RESEARCH_DARWIN_POLICY_CONTROL!
    expect(control).toMatch(/\/claude-research-darwin-system-policy-live-app\/managed-policy-control$/)
    const initial = await context()
    darwinTransitions = []
    for (const [sequence, mode, caption] of [
      [1, 0o000, 'Device policy fallback'],
      [2, 0o644, 'Managed OS policy ready'],
    ] as const) {
      await writeFile(join(control, 'request-' + sequence), '', { flag: 'wx' })
      await expect.poll(async () => {
        try {
          return JSON.parse(await readFile(join(control, 'receipt-' + sequence + '.json'), 'utf8'))
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error
        }
      }).toMatchObject({ sequence, mode })
      await expect(status).toContainText(caption, { timeout: 15000 })
      await expect(status).not.toContainText(mode === 0o000 ? 'Managed OS policy ready' : 'Device policy fallback')
      let diagnostic: string | undefined
      if (mode === 0o000) {
        await expect(warning).toBeVisible({ timeout: 15000 })
        await warning.locator('summary').click()
        const details = warning.getByRole('region', { name: 'Settings warning details' })
        await expect(details).toContainText('per-user managed preferences')
        await expect(details).toContainText('EACCES')
        diagnostic = await details.innerText()
      } else {
        await expect(warning).toBeHidden({ timeout: 15000 })
      }
      const screenshots: string[] = []
      for (const [width, height] of [[1100,900], [680,600]]) {
        await appPage.setViewportSize({ width, height })
        await expect(composer).toHaveText(draft)
        expect(await composer.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
        await expect(status).toBeInViewport({ ratio: 1 })
        await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 })
        await expect(card.getByRole('button', { name: 'Session tools', exact: true })).toHaveCount(0)
        const current = await context()
        expect(current.sessionId).toBe(sessionId)
        expect(current.turns).toBe(initial.turns)
        expect(current.native.state.ownerId).toBe(initial.native.state.ownerId)
        expect(current.native.state.nativePid).toBe(boundNativePid)
        const png = await nativeWindow.evaluate(async (window, size) =>
          (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), { width, height })
        const name = 'native-darwin-policy-' + sequence + '-' + width + '.png'
        await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
        screenshots.push(name)
      }
      darwinTransitions.push({ mode, caption, diagnostic, screenshots })
    }
  }
  let liveTransitions:any
  if(process.env.CLAUDE_RESEARCH_SYSTEM_POLICY_TRANSITIONS==='1'){
    expect(unreadable).toBe(false)
    const control=process.env.CLAUDE_RESEARCH_SYSTEM_POLICY_CONTROL!
    expect(control).toMatch(/^\/work\/\.claude-research\/policy-transition-[^/]+$/)
    const ready=JSON.parse(await readFile(join(control,'ready.json'),'utf8'));expect(ready.path).toBe('/etc/claude-code/managed-settings.json')
    const ownerId=(await context()).native.state.ownerId,receipts:any[]=[],phases:any[]=[]
    for(const [sequence,mode] of [[1,'private'],[2,'managed']] as const){
      const request=join(control,'request-'+sequence+'.json');await writeFile(request+'.tmp',JSON.stringify({sequence,mode}));await rename(request+'.tmp',request)
      await expect.poll(()=>readFile(join(control,'receipt-'+sequence+'.json'),'utf8').then(text=>{const receipt=JSON.parse(text);expect(receipt.mode).toBe(mode);return receipt},()=>undefined)).toBeTruthy()
      receipts.push(JSON.parse(await readFile(join(control,'receipt-'+sequence+'.json'),'utf8')))
      const tools=card.getByRole('button',{name:'Session tools',exact:true})
      if(mode==='private'){await expect(status).toContainText('Session ready',{timeout:15000});await expect(status).not.toContainText('Managed OS policy ready');await expect(tools).toBeVisible({timeout:15000})}
      else{await expect(status).toContainText('Managed OS policy ready',{timeout:15000});await expect(status).not.toContainText('Session ready');await expect(tools).toHaveCount(0,{timeout:15000})}
      const state=await context();expect(state.native.state.ownerId).toBe(ownerId);expect(state.native.state.nativePid).toBe(boundNativePid);expect(state.sessionId).toBe(sessionId);expect(state.turns).toBe(1)
      expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
      phases.push({mode,ownerId:state.native.state.ownerId,nativePid:state.native.state.nativePid,sessionId:state.sessionId,turns:state.turns,status:await status.innerText(),privateControls:await tools.count()})
      for(const [width,height] of [[1100,900],[680,600]]){
        await appPage.setViewportSize({width,height});for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})])await expect(item).toBeInViewport({ratio:1})
        const png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});const name='native-system-policy-'+mode+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(png,'base64'));captures.push(name)
      }
    }
    liveTransitions={sameNativeOwner:true,noPhantomTurn:true,draftRetained:true,privateControlsRestored:true,managedControlsRetired:true,receipts,phases}
    await writeFile(join(workspace!,'native-system-policy-transition-proof.json'),JSON.stringify(liveTransitions,null,2))
  }
  expect(await composer.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
  const sent='Review this managed policy session without running tools.'
  await replaceDraft(sent);await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).turns).toBe(2);await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  async function originalInput(text: string) {
    let uuid: string | undefined
    await expect.poll(async () => {
      for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
        try {
          const path = join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl')
          const rows = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
          const matches = rows.filter(row => row.type === 'user' && row.isMeta !== true &&
            (row.message?.content === text || row.message?.content?.some?.((block: any) => block.type === 'text' && block.text === text)))
          if (matches.length) {
            expect(matches).toHaveLength(1)
            uuid = matches[0].uuid
            return uuid
          }
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error
        }
      }
    }).toBeTruthy()
    return uuid!
  }
  const nativeHumanUuid = await originalInput(sent)
  await replaceDraft(draft);if(!unreadable)await expect(status).toContainText('Managed OS policy ready')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft)
  const continuation = 'Continue this saved policy review.'
  const send = card.getByRole('button', { name: 'Send', exact: true })
  await send.focus()
  await expect(send).toBeFocused()
  // Selecting the retained draft before focus must survive the composer focus handler.
  await composer.fill(continuation)
  await expect(composer).toHaveText(continuation)
  await send.click()
  await expect.poll(async () => (await context()).turns).toBe(3)
  expect((await context()).sessionId).toBe(sessionId)
  const nativeResumeHumanUuid = await originalInput(continuation)
  expect(nativeResumeHumanUuid).not.toBe(nativeHumanUuid)
  expect(errors).toEqual([])
  if(unreadable){await expect(warning).toBeVisible();await expect(warning).toContainText('EACCES')}
  await writeFile(join(workspace!, 'native-system-policy-app-proof.json'), JSON.stringify({
    sessionId, boundNativePid, captures, liveTransitions, darwinTransitions, draftRetained: true,
    privateControlsSuppressed: !unreadable, userStatusOverridden: !unreadable,
    managedPreferencePriority: darwinPolicy, nativeManagedWarning: unreadable,
    originalSettingsConsent: settingsConsent, successfulContinuation: unreadable,
    warningText: unreadable ? await warning.innerText() : undefined,
    nativeHumanUuid, sent, nativeResumeHumanUuid, continuation,
  }))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeSystemPolicy:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
