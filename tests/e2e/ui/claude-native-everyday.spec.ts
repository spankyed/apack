import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('completes an everyday native review across Agent, approval, question and interruption recovery', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
  expect(process.env.HOME).toBe(workspace)
  const combinedAcceptance=process.env.CLAUDE_RESEARCH_COMBINED_ACCEPTANCE==='1'
  const restriction = false
  async function replaceDraft(editor:import('@playwright/test').Locator,text:string){
    if(combinedAcceptance){await editor.click();await editor.press('ControlOrMeta+A');await appPage.keyboard.insertText(text);await expect(editor).toHaveText(text)}
    else await editor.fill(text)
  }
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await replaceDraft(card.locator('[contenteditable="true"]'),'Help me review the release notes and checklist.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
  const channelDialog=appPage.getByRole('dialog',{name:'Claude channels',exact:true})
  const channelWindow=await electronApp.browserWindow(appPage),channelCaptures:string[]=[]
  const openChannels=async()=>{const button=card.getByRole('button',{name:'Claude channels',exact:true});if(await button.isVisible())await button.click();else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Claude channels',exact:true}).click()}await expect(channelDialog).toBeVisible()}
  const selectedChannels=()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.context?.claudeCode?.channelSelection)
  const captureChannels=async(label:string,width:number,height:number)=>{await appPage.setViewportSize({width,height});for(const control of [channelDialog.getByRole('textbox'),channelDialog.getByRole('button',{name:'Cancel',exact:true}),channelDialog.getByRole('button',{name:'Save channels',exact:true})])await expect(control).toBeInViewport({ratio:1});const png=await channelWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});const name='native-channels-'+label+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(png,'base64'));channelCaptures.push(name)}
  if(!combinedAcceptance){
  await replaceDraft(card.locator('[contenteditable="true"]'),'Help me review the release notes and checklist.')
  await openChannels();await channelDialog.getByRole('textbox').fill('server:');await channelDialog.getByRole('button',{name:'Save channels',exact:true}).click()
  await expect(channelDialog.getByRole('alert')).toContainText('server:<name>');await expect(channelDialog.getByRole('textbox')).toHaveValue('server:')
  for(const [width,height] of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(channelDialog.getByRole('alert')).toBeInViewport({ratio:1});await expect(channelDialog.locator('#claude-channel-help')).toBeInViewport({ratio:1});await captureChannels('invalid',width,height)}
  await channelDialog.getByRole('textbox').fill('server:review\nplugin:notes@owned');await channelDialog.getByRole('button',{name:'Save channels',exact:true}).click()
  await expect.poll(selectedChannels).toEqual(['server:review','plugin:notes@owned'])
  for(const [width,height] of [[1100,900],[680,600]]){await openChannels();await expect(channelDialog.getByRole('textbox')).toHaveValue('server:review\nplugin:notes@owned');await captureChannels('saved',width,height);await channelDialog.getByRole('button',{name:'Cancel',exact:true}).click()}
  await openChannels();await channelDialog.getByRole('textbox').fill('');await channelDialog.getByRole('button',{name:'Save channels',exact:true}).click();await expect.poll(selectedChannels).toEqual([])
  await expect(card.locator('[contenteditable="true"]')).toHaveText('Help me review the release notes and checklist.');await appPage.setViewportSize({width:1100,height:900})
  }
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'))
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1)
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!
  expect(dimensions.cols).toBeGreaterThan(1); expect(dimensions.cols).toBeLessThanOrEqual(500)
  terminalScreen = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
  let lastSequence = 0
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Release review') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Release review'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Release review')
    await expect(main).toContainText('Workspace notes and checklist')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Release review')
  const composer = card.locator('[contenteditable="true"]')
  if(!combinedAcceptance){
  for(const [width,height] of [[1100,900],[680,600]]){await openChannels();await expect(channelDialog.getByRole('textbox')).toBeDisabled();await expect(channelDialog.getByRole('button',{name:'Save channels',exact:true})).toBeDisabled();await captureChannels('locked',width,height);await channelDialog.getByRole('button',{name:'Cancel',exact:true}).click()}
  await writeFile(join(workspace!,'native-channel-settings-app-proof.json'),JSON.stringify({savedSelection:['server:review','plugin:notes@owned'],invalidSelectorRefused:true,clearedBeforeLaunch:true,liveSelectionLocked:true,draftRetained:true,captures:channelCaptures}))
  await appPage.setViewportSize({width:1100,height:900})
  }
  const checkpoint = expect.configure({ soft: true })
  const nativeWindow=await electronApp.browserWindow(appPage)
  async function capturePage(file:string,width:number,height:number){
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    let timer:ReturnType<typeof setTimeout>|undefined
    const image=await Promise.race([nativeWindow.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {size:image.getSize(),png:image.toPNG().toString('base64')}},{width,height}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Owned Electron capture exceeded 30000ms')),30000)})]).finally(()=>{if(timer)clearTimeout(timer)})
    expect(image.size).toEqual({width,height});await writeFile(testInfo.outputPath(file),Buffer.from(image.png,'base64'))
  }
  const screenshots: string[] = []
  const geometry: unknown[] = []
  async function capture(stage: string, editor: import('@playwright/test').Locator, controls: import('@playwright/test').Locator[], reading?: import('@playwright/test').Locator) {
    for (const [width, height] of [[1100, 900], [680, 600]] as const) {
      await appPage.setViewportSize({ width, height })
      const beforeFile = 'apack-native-everyday-' + stage + '-' + width + '-' + height + '-before-check.png'
      if(!combinedAcceptance)await capturePage(beforeFile,width,height)
      await writeFile(join(workspace!, 'native-everyday-progress.json'), JSON.stringify({ stage, width, height, readingHeight: reading ? await reading.evaluate(element => element.clientHeight) : undefined }))
      await checkpoint.poll(async () => {
        const rectangles = await Promise.all([editor, ...controls].map((control, index) => control.evaluate((element, primary) => { const r = element.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, inside: r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0 && r.height > 0 && (primary || r.height >= 20) } }, index === 0)))
        return rectangles.every(rect => rect.inside)
      }, { timeout: 1500, intervals: [100, 250] }).toBe(true)
      if (reading) await checkpoint.poll(() => reading.evaluate(element => element.clientHeight), { timeout: 1500, intervals: [100, 250] }).toBeGreaterThanOrEqual(stage === 'approval' ? 48 : 80)
      let sendPaint: unknown
      if(combinedAcceptance&&['composer','recovered'].includes(stage)) {
        const send = card.getByRole('button',{name:'Send',exact:true})
        await expect(send).toBeEnabled()
        // Enabled state precedes the shared button's colour transition; capture its settled paint.
        sendPaint = await send.evaluate(async element => {
          const before = getComputedStyle(element).backgroundColor
          const animations = element.getAnimations()
          await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
          return { before, transitions: animations.length, backgroundColor: getComputedStyle(element).backgroundColor, disabled: (element as HTMLButtonElement).disabled, activeAnimations: element.getAnimations().filter(animation => animation.playState === 'running').length }
        })
        expect(sendPaint).toMatchObject({disabled:false,activeAnimations:0})
        expect((sendPaint as {backgroundColor:string}).backgroundColor).toMatch(/^rgb\((37, 99, 235|29, 78, 216)\)$/)
      }
      const file = 'apack-native-everyday-' + stage + '-' + width + '-' + height + '.png'
      await capturePage(file,width,height); screenshots.push(file)
      geometry.push({ stage, width, height, sendPaint, sessionId:(await context()).sessionId, nativePid:(await context()).native?.state?.nativePid, sendDisabled:['composer','recovered'].includes(stage)?await card.getByRole('button',{name:'Send',exact:true}).isDisabled():null, readingHeight: reading ? await reading.evaluate(element => element.clientHeight) : undefined })
      await writeFile(join(workspace!, 'native-everyday-progress.json'), JSON.stringify({ geometry, screenshots }))
    }
  }
  const send = card.getByRole('button', { name: 'Send', exact: true })
  const mainDraft = 'Keep the release checklist wording unchanged.'
  const commandScreens: { stage: string; width: number; height: number; file: string }[] = []
  if(!combinedAcceptance){
  const beforeCommands = await context()
  for (const [width, height] of [[1100, 900], [680, 600]] as const) {
    await appPage.setViewportSize({ width, height })
    await replaceDraft(composer,''); await replaceDraft(composer,'/cc-')
    const popup = appPage.locator('.command-suggestion-popup')
    await expect(popup).toBeVisible()
    for (const name of ['cc-plan', 'cc-models', 'cc-reset']) await expect(popup.getByText('/' + name, { exact: true })).toHaveCount(1)
    const selected = popup.locator('.command-suggestion-item.is-selected')
    await expect(selected).toHaveCount(1)
    const first = await selected.innerText()
    await composer.press('ArrowDown'); await expect(selected).not.toHaveText(first)
    const file = `apack-command-picker-${width}-${height}.png`
    await capturePage(file, width, height)
    const bounds = await popup.boundingBox(); expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1)
    await expect(selected).toBeInViewport({ ratio: 1 })
    await composer.press('Escape'); await expect(popup).toBeHidden(); await expect(composer).toHaveText('/cc-')
    commandScreens.push({ stage: 'main', width, height, file })
  }
  expect((await context()).turns).toBe(beforeCommands.turns)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!, 'native-command-ui-verification.json'), JSON.stringify({ commandScreens, noSubmittedTurn: true, boundNativePid }))
  await appPage.setViewportSize({ width: 1100, height: 900 })
  }
  if(combinedAcceptance) {
    const beforeModels = await context()
    const settingsPath = join(workspace!, '.claude/settings.json')
    const settingsBefore = await readFile(settingsPath, 'utf8')
    const modelPolicyNotice = process.env.CLAUDE_RESEARCH_MODEL_POLICY_NOTICE === '1'
    const retainedDraft = 'Keep my model-review draft while I read the complete notice.'
    const notices: {selection:string;text:string;screenshots:string[];reading:unknown[]}[] = []
    for(const selection of ['haiku','default']) {
      await replaceDraft(composer,'')
      await composer.pressSequentially('/cc-model')
      await appPage.locator('.command-suggestion-popup').getByText('/cc-model',{exact:true}).click()
      await composer.pressSequentially(selection)
      await send.click()
      await expect(composer).toHaveText('')
      const acknowledgement = `Model selection accepted: ${selection}. The next turn will report the effective model.`
      await expect.poll(async () => (await context()).messages.some((message:any) => message.sender==='assistant' && message.text.includes(acknowledgement) && message.text.includes('for this session only'))).toBe(true)
      const current = await context()
      expect(current.claude.modelOverride).toBe(selection)
      expect(current.sessionId).toBe(beforeModels.sessionId)
      expect(current.turns).toBe(beforeModels.turns)
      expect(current.native.state.nativePid).toBe(boundNativePid)
      const message = current.messages.findLast((message:any) => message.sender==='assistant' && message.text.includes(acknowledgement))
      expect(message.text).not.toContain('\u001b')
      if(modelPolicyNotice) {
        expect(message.text).toContain('Managed settings pins')
        expect(message.text).toContain('that applies on restart')
      }
      await replaceDraft(composer,retainedDraft)
      const selectionBeforeReading = await composer.evaluate(element => {
        const range = getSelection()
        return range && element.contains(range.anchorNode) ? {anchor:range.anchorOffset,focus:range.focusOffset,text:range.toString()} : null
      })
      expect(selectionBeforeReading).not.toBeNull()
      const files:string[] = [], reading:unknown[] = []
      const bubble = appPage.locator(`[data-message-id="${message.id}"]`)
      const viewport = appPage.getByTestId('chat-transcript').locator(':scope > div').first()
      for(const [width,height] of [[1100,900],[680,600]]) {
        await appPage.setViewportSize({width,height})
        await viewport.hover()
        await appPage.mouse.wheel(0,1200)
        const originalNotice = bubble.getByText('for this session only',{exact:false}).last()
        const acknowledgementText = bubble.getByText(acknowledgement,{exact:false}).last()
        await writeFile(join(workspace!,`native-model-reading-${selection}-${width}.json`),JSON.stringify(await bubble.evaluate(element => {
          const viewport=element.closest('[data-testid="chat-transcript"]')!.firstElementChild! as HTMLElement
          const card=document.querySelector('[data-onboarding-id="agent-chat-input"]')!
          const rect=(node:Element)=>{const b=node.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}}
          return {bubble:rect(element),viewport:rect(viewport),composer:rect(card),scrollTop:viewport.scrollTop,scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight,paragraphs:Array.from(element.querySelectorAll('p')).map(p=>({text:p.textContent,...rect(p)}))}
        })))
        if(width===680) await capturePage(`apack-native-model-${selection}-${width}-${height}-before-check.png`,width,height)
        await expect(originalNotice).toBeInViewport({ratio:1})
        await expect(acknowledgementText).toBeInViewport({ratio:1})
        if(modelPolicyNotice) await expect(bubble.getByText('that applies on restart',{exact:false}).last()).toBeInViewport({ratio:1})
        await expect(composer).toHaveText(retainedDraft)
        const selectionAfterReading = await composer.evaluate(element => {
          const range = getSelection()
          return range && element.contains(range.anchorNode) ? {anchor:range.anchorOffset,focus:range.focusOffset,text:range.toString()} : null
        })
        expect(selectionAfterReading).toEqual(selectionBeforeReading)
        const geometry = await bubble.evaluate(element => {
          const viewport = element.closest('[data-testid="chat-transcript"]')!.firstElementChild!.getBoundingClientRect()
          const content = element.getBoundingClientRect()
          return {top:content.top,bottom:content.bottom,viewportTop:viewport.top,viewportBottom:viewport.bottom}
        })
        expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop-1)
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom+1)
        reading.push({width,height,geometry,selectionRetained:true,draftRetained:true})
        await appPage.mouse.move(10,10)
        const file = `apack-native-model-${selection}-${width}-${height}.png`
        await capturePage(file,width,height);files.push(file)
      }
      notices.push({selection,text:message.text,screenshots:files,reading})
    }
    expect(await readFile(settingsPath,'utf8')).toBe(settingsBefore)
    await writeFile(join(workspace!,'native-model-notice-app.json'),JSON.stringify({sessionId:beforeModels.sessionId,nativePid:boundNativePid,turns:beforeModels.turns,settingsUnchanged:true,modelPolicyNotice,retainedDraft,notices}))
    await appPage.setViewportSize({width:1100,height:900})
  }
  await replaceDraft(composer,'Review the release notes with a worker.')
  await send.click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'running'), { timeout: 15000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  await expect(row.getByTestId('native-agent-status-text')).toContainText('Reviewing release notes')
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()
  await replaceDraft(composer,mainDraft)
  await row.getByRole('button', { name: 'Open Agent', exact: true }).click()
  const focused = appPage.getByRole('region', { name: 'Focused Agent conversation', exact: true })
  const agentForm = focused.getByRole('form', { name: 'Agent message', exact: true })
  const agentEditor = agentForm.locator('[contenteditable="true"]')
  const agentDraft = 'Please also note the migration steps.'
  if(!combinedAcceptance){
  for (const [width, height] of [[1100, 900], [680, 600]] as const) {
    await appPage.setViewportSize({ width, height })
    await replaceDraft(agentEditor,'/cc-model haiku')
    await expect(agentEditor).toHaveText('/cc-model haiku')
    await expect(appPage.locator('.command-suggestion-popup:visible')).toHaveCount(0)
    await expect(agentEditor.locator('.command-segment')).toHaveCount(0)
    const appMatching = await agentEditor.evaluate(element => {
      const editor = (element as unknown as { editor: { state: { plugins: { key: string; getState(state: unknown): { active: boolean; selectedCommand?: unknown } }[] } } }).editor
      const matcher = editor.state.plugins.find(plugin => plugin.key.startsWith('commandSuggestion$'))
      if (!matcher) throw new Error('Shared command matcher is missing from Agent editor')
      return matcher.getState(editor.state)
    })
    expect(appMatching.active).toBe(false); expect(appMatching.selectedCommand).toBeNull()
    await expect(agentForm.getByRole('button', { name: 'Send to Agent', exact: true })).toBeInViewport({ ratio: 1 })
    const file = `apack-agent-command-owner-${width}-${height}.png`
    await capturePage(file, width, height)
    commandScreens.push({ stage: 'agent', width, height, file })
  }
  await writeFile(join(workspace!, 'native-command-ui-verification.json'), JSON.stringify({ commandScreens, noSubmittedTurn: true, agentAppCommandsHeld: true, boundNativePid }))
  }
  await replaceDraft(agentEditor,agentDraft)
  await capture('agent', agentEditor, [agentForm.getByRole('button', { name: 'Send to Agent', exact: true }), focused.getByRole('button', { name: 'Back to conversation', exact: true })], focused.getByRole('region', { name: 'Agent transcript', exact: true }))
  await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await expect(composer).toHaveText(mainDraft)
  await expect.poll(async () => (await context()).native.state.tasks.find((task: any) => task.id === taskId)?.status, { timeout: 20000 }).toBe('completed')
  const toolsButton = appPage.getByRole('button', { name: /^Native tools/ }).first()
  if (!await row.isVisible()) await toolsButton.click()
  await row.getByRole('button', { name: 'Open Agent', exact: true }).click()
  await expect(agentEditor).toHaveText(agentDraft)
  await expect(focused.getByRole('region', { name: 'Agent transcript', exact: true })).toContainText('The release notes cover behavior changes and migration guidance.')
  await capture('agent-result', agentEditor, [agentForm.getByRole('button', { name: 'Send to Agent', exact: true }), focused.getByRole('button', { name: 'Back to conversation', exact: true })], focused.getByRole('region', { name: 'Agent transcript', exact: true }))
  await focused.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await expect(composer).toHaveText(mainDraft)
  await expect.poll(async () => (await context()).native.state.busy, { timeout: 20000 }).toBe(false)
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('The release review is ready.'))).toBe(true)
  await capture('composer', composer, [send], appPage.getByTestId('chat-transcript'))
  const reference = JSON.parse(await readFile(join(workspace!, 'reference-fixture.json'), 'utf8'))
  await replaceDraft(composer,'Read the release checklist before proposing changes.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'everyday-read-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  await replaceDraft(composer,'Keep my review draft while I approve this read.')
  await writeFile(join(workspace!, 'everyday-read-release'), 'release')
  const approval = appPage.getByTestId('native-read-approval')
  await expect(approval).toBeVisible(); await expect(approval.getByTestId('native-read-path')).toHaveText(reference.file)
  await expect(composer).toBeHidden(); await expect(composer).toHaveText('Keep my review draft while I approve this read.')
  await capture('approval', approval.getByTestId('native-read-path'), [approval.getByRole('button', { name: 'Approve', exact: true })], approval.locator('.details'))
  await approval.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(approval).toBeHidden()
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('The release checklist is available.')), { timeout: 15000 }).toBe(true)
  await expect(composer).toHaveText('Keep my review draft while I approve this read.')
  await replaceDraft(composer,'Ask me which release audience to target.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'everyday-question-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  await replaceDraft(composer,'Use a direct, concise tone in the summary.')
  await writeFile(join(workspace!, 'everyday-question-release'), 'release')
  const question = appPage.getByTestId('native-question-panel')
  await expect(question).toBeVisible(); await expect(question).toContainText('Who should the release summary address?')
  await expect(composer).toBeHidden(); await expect(composer).toHaveText('Use a direct, concise tone in the summary.')
  const toolNotice=process.env.CLAUDE_RESEARCH_QUESTION_TOOL_NOTICE==='1'
  let questionNoticeReceipt: any, missingCallRefusal: any
  const questionNoticeLiveUpdates: any[]=[]
  async function readQuestionNoticeScreen(){
    const native=(await context()).native,chunks=native.output.filter((chunk:any)=>chunk.sequence>lastSequence)
    if(chunks.length){await new Promise<void>(resolve=>terminalScreen!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));lastSequence=chunks.at(-1).sequence}
    const buffer=terminalScreen!.buffer.active
    const screen=Array.from({length:terminalScreen!.rows},(_,row)=>buffer.getLine(buffer.baseY+row)?.translateToString(true)??'').join('\n')
    await writeFile(join(workspace!,'native-question-tool-notice-screen.json'),JSON.stringify({receipt:questionNoticeReceipt,screen}))
    return screen
  }
  if(toolNotice){
    questionNoticeReceipt=JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-native.json'),'utf8'))
    expect(questionNoticeReceipt.accepted).toBe(true)
    await expect.poll(async()=>{
      const screen=await readQuestionNoticeScreen()
      return screen.includes(questionNoticeReceipt.text)
    }).toBe(true)
    await expect(question.getByText(questionNoticeReceipt.text,{exact:false})).toBeVisible()
  }
  await capture(toolNotice?'question-notice':'question', toolNotice?question.getByText(questionNoticeReceipt.text,{exact:false}):question.locator('h2'), [question.getByRole('button', { name: 'Submit answers', exact: true })], question.getByLabel('Question details', { exact: true }))
  if(toolNotice){
    const answer=question.locator('.answer textarea')
    await answer.fill('Developers')
    const before=await context()
    for(const [index,action] of ['update','clear','restore'].entries()){
      await writeFile(join(workspace!,'native-question-tool-notice-command.json'),JSON.stringify({sequence:index+1,action}))
      await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-command-result.json'),'utf8').catch(()=>'{}')).sequence).toBe(index+1)
      const receipt=JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-command-result.json'),'utf8'))
      expect(receipt.accepted).toBe(true);expect(receipt.toolUseId).toBe(questionNoticeReceipt.toolUseId)
      const updated='Release policy updated this question.'
      await expect.poll(async()=>{const screen=await readQuestionNoticeScreen();return action==='clear'?!screen.includes(updated)&&!screen.includes(questionNoticeReceipt.text):screen.includes(action==='restore'?questionNoticeReceipt.text:updated)}).toBe(true)
      const notice=question.getByRole('note')
      if(action==='clear')await expect(notice).toHaveCount(0)
      else await expect(notice).toContainText(action==='restore'?questionNoticeReceipt.text:updated)
      await expect(answer).toHaveValue('Developers')
      expect((await context()).claude.turns).toBe(before.claude.turns)
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      await capture('question-notice-'+action,action==='clear'?question.locator('h2'):notice,[question.getByRole('button',{name:'Submit answers',exact:true})],question.getByLabel('Question details',{exact:true}))
      await expect(answer).toHaveValue('Developers')
      questionNoticeLiveUpdates.push({action,receipt,nativePaint:true,answerRetained:true,widths:[1100,680]})
      await writeFile(join(workspace!,'native-question-tool-notice-live-progress.json'),JSON.stringify(questionNoticeLiveUpdates))
    }
    await writeFile(join(workspace!,'native-question-tool-notice-command.json'),JSON.stringify({sequence:4,action:'non-open'}))
    await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-command-result.json'),'utf8').catch(()=>'{}')).sequence).toBe(4)
    missingCallRefusal=JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-command-result.json'),'utf8'))
    expect(missingCallRefusal.enqueued).toBe(true)
    await expect.poll(async()=>(await readFile(join(workspace!,'native-debug.log'),'utf8')).includes('$.ui.notice: '+missingCallRefusal.toolUseId+' refused: no call with that tool_use_id is open')).toBe(true)
    await expect(question.getByRole('note')).toContainText(questionNoticeReceipt.text)
    await expect(appPage.getByText('Nonexistent-call notice must not appear.',{exact:false})).toHaveCount(0)
    await expect(answer).toHaveValue('Developers')
    expect((await context()).claude.turns).toBe(before.claude.turns)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await capture('question-notice-refused',question.getByRole('note'),[question.getByRole('button',{name:'Submit answers',exact:true})],question.getByLabel('Question details',{exact:true}))
  }
  await question.getByRole('radio', { name: 'Developers People integrating the updated behavior', exact: true }).check()
  await question.getByRole('button', { name: 'Submit answers', exact: true }).click()
  await expect(question).toBeHidden()
  if(toolNotice){await expect(appPage.getByText(questionNoticeReceipt.text,{exact:false})).toHaveCount(0);await writeFile(join(workspace!,'native-question-tool-notice-app.json'),JSON.stringify({receipt:questionNoticeReceipt,missingCallRefusal,liveUpdates:questionNoticeLiveUpdates,nativeScreenIncludesNotice:true,appVisible:true,retired:true}))}
  await expect.poll(async () => (await context()).messages.some((message: any) => message.sender === 'assistant' && message.text.includes('for developers.')), { timeout: 15000 }).toBe(true)
  await expect(composer).toHaveText('Use a direct, concise tone in the summary.')
  await replaceDraft(composer,'Draft the release summary while I review the checklist.')
  await send.click()
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-pause-ready.json'), 'utf8').catch(() => '{}')).ready).toBe(true)
  if(toolNotice){
    const closedRefusal=JSON.parse(await readFile(join(workspace!,'native-question-tool-notice-closed-refusal.json'),'utf8'))
    expect(closedRefusal.enqueued).toBe(true);expect(closedRefusal.toolUseId).toBe(questionNoticeReceipt.toolUseId)
    await expect.poll(async()=>(await readFile(join(workspace!,'native-debug.log'),'utf8')).includes('$.ui.notice: '+closedRefusal.toolUseId+' refused: no call with that tool_use_id is open')).toBe(true)
    await expect(appPage.getByText('Closed-question notice must not appear.',{exact:false})).toHaveCount(0)
    const path=join(workspace!,'native-question-tool-notice-app.json'),proof=JSON.parse(await readFile(path,'utf8'))
    await writeFile(path,JSON.stringify({...proof,closedRefusal}))
  }
  await replaceDraft(composer,'Keep this note after interruption.')
  await card.getByTitle('Pause agent work', { exact: true }).click()
  await expect.poll(async () => (await context()).native.state.busy).toBe(false)
  expect((await context()).native.state.status).toBe('live')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await expect(composer).toHaveText('Keep this note after interruption.')
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async () => (await context()).native.state.status, { timeout: 15000 }).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText('Keep this note after interruption.')
  const ledger = async () => {
    for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
      try { return (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
    throw Error('Original session journal missing')
  }
  const acceptedUsers: any[] = []
  const users = (await ledger()).filter((row: any) => row.type === 'user' && row.origin?.kind === 'human')
  for (const text of ['Review the release notes with a worker.', 'Read the release checklist before proposing changes.', 'Ask me which release audience to target.', 'Draft the release summary while I review the checklist.']) {
    const original = users.filter((row: any) => row.message?.content === text); expect(original).toHaveLength(1)
    acceptedUsers.push(original[0])
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original[0].uuid).length).toBe(1)
  }
  const nativeCost = (await ledger()).filter((row: any) => row.type === 'cost-state').at(-1)?.totalCostUSD
  expect(nativeCost).toBeGreaterThan(0); await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await composer.click();await appPage.keyboard.press('ControlOrMeta+A');await appPage.keyboard.type('Continue the same release review after the interruption.')
  await expect(composer).toHaveText('Continue the same release review after the interruption.')
  await send.click()
  await expect.poll(async () => (await context()).claude.chatState, { timeout: 15000 }).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  let resumedCost = 0
  await expect.poll(async () => {
    const text = await readFile(join(workspace!, 'native-print-results.jsonl'), 'utf8').catch(() => '')
    const result = text.split('\n').slice(0, -1).map(line => JSON.parse(line)).at(-1)
    if (result?.sessionId !== sessionId || result.totalCostUsd <= nativeCost) return false
    resumedCost = result.totalCostUsd
    return (await context()).claude.totalCostUsd === resumedCost
  }).toBe(true)
  for (const original of acceptedUsers) await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original.uuid).length).toBe(1)
  await replaceDraft(composer,'Ready for the next release-review step.')
  await capture('recovered', composer, [send], appPage.getByTestId('chat-transcript'))
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-everyday-app.json'), JSON.stringify({ taskId, sessionId, nativeCost, resumedCost, geometry, screenshots, combinedAcceptance, retainedParentDraft:mainDraft,retainedAgentDraft:agentDraft }))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeEverydayCombined: testInfo.errors.length === 0, nativeAgentReturn: true, nativePausedWhileWorking: true, nativePauseOwnerRetained: true, nativeHistorySynchronized: true, nativeCostSynchronized: true, nativeRetainedDraft: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, nativeCost, resumedCost, browserErrors: errors }))
})
