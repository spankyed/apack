import { readFile, readdir as _readdir, writeFile, utimes, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test.afterEach(async ({appPage,electronApp},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus||!workspace)return
  await writeFile(join(workspace,'native-config-desktop-failure.txt'),await appPage.locator('body').innerText())
  const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!
  const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
  await writeFile(testInfo.outputPath('native-config-desktop-failure.png'),Buffer.from(image,'base64'))
})
test('edits original Settings through desktop controls and retains composing', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(260000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
  const externalConsentProfile=process.env.CLAUDE_RESEARCH_EXTERNAL_CONSENT==='1',externalFixture=externalConsentProfile?JSON.parse(await readFile(join(workspace!,'external-consent-fixture.json'),'utf8')):undefined
  let startupConsentAt=0,startupConsentAttempts=0
  const consentProject=async()=>{const config=JSON.parse(await readFile(join(workspace!,'.claude/.claude.json'),'utf8')),keys=Object.keys(config.projects??{});expect(keys).toHaveLength(1);return {...config.projects[keys[0]],projectKey:keys[0]}}
  const restriction = false, statusOnly=process.env.CLAUDE_RESEARCH_STATUS_ROWS==='1'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
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
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1];return cols?{cols:Number(cols),rows:200}:undefined;
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!;
  expect(dimensions.cols).toBeGreaterThan(1); expect(dimensions.cols).toBeLessThanOrEqual(500)
  terminalScreen = new Terminal({ cols: dimensions.cols, rows: Math.max(2, dimensions.rows), allowProposedApi: true })
  let lastSequence = 0
  async function settleNativeOnboarding(reset=false){
    if(reset){terminalScreen!.reset();lastSequence=0;await expect.poll(resize).toBeTruthy();const fit=(await resize())!;terminalScreen!.resize(fit.cols,fit.rows)}
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    if(externalConsentProfile&&text.includes('Allow external CLAUDE.md file imports?')){if(!startupConsentAt)startupConsentAt=Date.now();if(startupConsentAttempts<3&&Date.now()-startupConsentAt>1200){startupConsentAttempts++;startupConsentAt=Date.now();await input.press('Enter')}return false}
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Session ready') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  }
  await settleNativeOnboarding()
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Session ready')
    await expect(main).toContainText('Reviewing release notes')
  }
  const boundNativePid = (await context()).native.state.nativePid
  // Owned imported histories exercise the original discovery/filter path without changing clocks or gates.
  const projectRoot=join(workspace!,'.claude/projects')
  const parentFiles=(await _readdir(projectRoot,{recursive:true})).filter(file=>file.endsWith('/'+sessionId+'.jsonl')||file===sessionId+'.jsonl')
  expect(parentFiles).toHaveLength(1)
  const parentFile=join(projectRoot,parentFiles[0]),rows=(await readFile(parentFile,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  const nativeUser=rows.find(row=>row.type==='user'&&row.isMeta!==true&&row.message?.role==='user')
  const nativeAssistant=[...rows].reverse().find(row=>row.type==='assistant'&&row.message?.usage&&row.message?.role==='assistant')
  expect(nativeUser).toBeTruthy();expect(nativeAssistant).toBeTruthy()
  const sumTokens=(usage:any)=>['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].reduce((sum,key)=>sum+(usage[key]??0),0)
  const baselineTokens=rows.filter(row=>row.type==='assistant'&&row.message?.usage).reduce((sum,row)=>sum+sumTokens(row.message.usage),0)
  const histories:any[]=[]
  for(const [index,age]of [2,12,45].entries()){
    const id=randomUUID(),user=structuredClone(nativeUser),assistant=structuredClone(nativeAssistant),date=new Date()
    date.setDate(date.getDate()-age);date.setHours(12,0,0,0)
    user.uuid=randomUUID();user.parentUuid=null;user.sessionId=id;user.isSidechain=false;user.timestamp=date.toISOString()
    assistant.uuid=randomUUID();assistant.parentUuid=user.uuid;assistant.sessionId=id;assistant.isSidechain=false;assistant.timestamp=new Date(date.getTime()+65000).toISOString();assistant.message.id='msg_'+randomUUID()
    const scale=2**(index+1)
    Object.assign(assistant.message.usage,{input_tokens:1400*scale,output_tokens:200*scale,cache_read_input_tokens:100*scale,cache_creation_input_tokens:50*scale})
    if(assistant.message.usage.cache_creation)assistant.message.usage.cache_creation={ephemeral_5m_input_tokens:50*scale,ephemeral_1h_input_tokens:0}
    const file=join(dirname(parentFile),id+'.jsonl'),body=JSON.stringify(user)+'\n'+JSON.stringify(assistant)+'\n'
    await writeFile(file,body);await utimes(file,date,date)
    histories.push({id,age,date:date.toISOString().slice(0,10),tokens:sumTokens(assistant.message.usage),sha256:createHash('sha256').update(body).digest('hex')})
  }
  const expectedRange=(days?:number)=>baselineTokens+histories.filter(row=>days===undefined||row.age<days).reduce((sum,row)=>sum+row.tokens,0)
  const statsCompleteness:any={histories,baselineTokens,ranges:[],exports:[],captures:[],reading:[]}
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  await appPage.setViewportSize({width:1100,height:900})
  const draft = 'Keep these release notes while changing Claude settings.'
  await composer.fill(draft)
  const saved = await composer.evaluate(element => ({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  const panel = appPage.getByRole('dialog',{name:'Claude Code settings',exact:true})
  async function open() {
    const direct = card.getByRole('button',{name:'Claude settings',exact:true})
    if (await direct.isVisible()) await direct.click()
    else { await card.getByRole('button',{name:'More actions',exact:true}).click(); await appPage.getByRole('menuitem',{name:'Claude settings',exact:true}).click() }
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).toBeVisible({timeout:15000})
    await expect(panel.locator('textarea.xterm-helper-textarea')).toHaveCount(0)
  }
  await open()
  const local = async () => JSON.parse(await readFile(join(workspace!,'.claude/settings.local.json'),'utf8').catch(()=>'{}'))
  const user = async () => JSON.parse(await readFile(join(workspace!,'.claude/settings.json'),'utf8'))
  const search = panel.getByRole('textbox',{name:'Search Claude Code settings',exact:true})
  const nativeWindow = await electronApp.browserWindow(appPage), captures:string[]=[]
  if(externalConsentProfile)await electronApp.evaluate(({app,webContents})=>{(globalThis as any).consentSecurityNavigations=[];const observe=(contents:any)=>contents.on('did-start-navigation',(details:any)=>{if(details.url==='https://code.claude.com/docs/en/security'&&details.isMainFrame)(globalThis as any).consentSecurityNavigations.push({url:details.url,isMainFrame:details.isMainFrame,webContentsId:contents.id})});webContents.getAllWebContents().forEach(observe);app.on('web-contents-created',(_event,contents)=>observe(contents))})
  if(!externalConsentProfile){
  if(process.env.CLAUDE_RESEARCH_SETTINGS_FRESHNESS==='1'){await writeFile(join(workspace!,'native-settings-freshness-ready'),'ready');await expect.poll(async()=>{const observed=JSON.parse(await readFile(join(workspace!,'native-settings-freshness.json'),'utf8').catch(()=>'{}'));return observed.status==='observing'&&observed.samples.length>0}).toBe(true)}
  await panel.getByRole('checkbox',{name:'Show tips',exact:true}).click()
  await expect.poll(async()=>(await local()).spinnerTipsEnabled).toBe(false)
  await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).not.toBeChecked()
  await expect(panel.getByRole('status')).toHaveText('Saved by Claude Code')
  await search.fill('Reduce motion')
  await panel.getByRole('checkbox',{name:'Reduce motion',exact:true}).click()
  await expect.poll(async()=>(await local()).prefersReducedMotion).toBe(true)
  await expect(panel.getByRole('checkbox',{name:'Reduce motion',exact:true})).toBeChecked()
  await search.fill('Time format')
  await panel.getByRole('combobox',{name:'Time format',exact:true}).selectOption('24-hour')
  await expect.poll(async()=>(await user()).timeFormat).toBe('24-hour')
  await search.fill('Language')
  const languageRow=panel.locator('[data-native-setting="language"]'),languageEditor=panel.getByLabel('Claude Code setting editor',{exact:true})
  const languageInput=languageEditor.getByRole('textbox',{name:'Enter your preferred response and voice language:',exact:true})
  const openLanguage=async()=>{await languageRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(languageInput).toBeVisible()}
  const beforeLanguage=await user()
  await openLanguage();await languageInput.fill('Cancelled language');await languageEditor.getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(languageEditor).toHaveCount(0);expect(await user()).toEqual(beforeLanguage)
  await openLanguage();await languageInput.fill('Spanish');await languageEditor.getByRole('button',{name:'Save',exact:true}).click()
  await expect.poll(async()=>(await user()).language).toBe('Spanish');await expect(languageEditor).toHaveCount(0);await expect(languageRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
  await openLanguage();await expect(languageInput).toHaveValue('Spanish');await languageInput.fill('   ');await languageEditor.getByRole('button',{name:'Save',exact:true}).click()
  await expect.poll(async()=>(await user()).language).toBeUndefined();await expect(languageEditor).toHaveCount(0)
  await expect(languageRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
  await openLanguage();await expect(languageInput).toHaveValue('');await languageInput.fill('  French  ')
  await languageEditor.getByRole('button',{name:'Save',exact:true}).click()
  await expect.poll(async()=>(await user()).language).toBe('French');await expect(languageEditor).toHaveCount(0)
  await expect(languageRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
  await openLanguage();await expect(languageInput).toHaveValue('French')
  for (const [width,height] of [[1100,900],[680,600]]) {
    await appPage.setViewportSize({width,height})
    await expect(languageInput).toBeInViewport();await expect(languageEditor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport();await expect(languageEditor.getByRole('button',{name:'Save',exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeInViewport()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
    const path=testInfo.outputPath('native-config-desktop-language-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));captures.push(path)
  }
  await languageEditor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(languageEditor).toHaveCount(0)
  await search.fill('Thinking')
  const locked = panel.getByRole('checkbox',{name:/Thinking/})
  await expect(locked).toBeDisabled()
  await expect(panel.locator('[data-native-setting="thinking"] label > span').last()).toBeVisible()
  expect(await panel.locator('[data-native-setting="thinking"] label > span').last().innerText()).not.toBe('Thinking')
  await panel.getByRole('button',{name:'Close settings',exact:true}).click()
  await expect(panel).toHaveCount(0); await expect(composer).toHaveText(draft); await composer.focus()
  expect(await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))).toEqual(saved)
  await appPage.setViewportSize({width:1100,height:900});await open()
  await expect(panel.getByRole('checkbox',{name:'Show tips',exact:true})).not.toBeChecked()
  await search.fill('Reduce motion');await expect(panel.getByRole('checkbox',{name:'Reduce motion',exact:true})).toBeChecked()
  await search.fill('Time format');await expect(panel.getByRole('combobox',{name:'Time format',exact:true})).toHaveValue('24-hour')
  await search.fill('Language');await openLanguage();await expect(languageInput).toHaveValue('French');await languageEditor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(languageEditor).toHaveCount(0)
  }
  let outputStyleEditor:any,themeEditor:any,modelEditor:any,groupEditors:any,externalConsent:any,updateEditor:any,updateDecisions:any,remoteHomeEditor:any
  const externalDisableRoutes:string[]=[],securityNavigation:any[]=[]
  const disableExternalConsent=async()=>{
    await panel.locator('[data-native-setting="showExternalIncludesDialog"]').getByRole('button',{name:'Disable external imports',exact:true}).click()
    const editor=panel.getByLabel('Claude Code setting editor',{exact:true})
    let outcome='pending'
    await expect.poll(async()=>{if((await consentProject()).hasClaudeMdExternalIncludesApproved===false)outcome='disabled';else if(await editor.count())outcome='confirmation';return outcome}).not.toBe('pending')
    externalDisableRoutes.push(outcome)
    if(outcome==='confirmation')await editor.locator('[data-native-settings-option="cancel"]').click()
    await expect(editor).toHaveCount(0);await expect.poll(async()=>(await consentProject()).hasClaudeMdExternalIncludesApproved).toBe(false)
  }

  if(process.env.CLAUDE_RESEARCH_SETTINGS_REMOTE_HOME==='1'){
    const editor=panel.getByLabel('Claude Code setting editor',{exact:true}),row=panel.locator('[data-native-setting="remoteHomeSettings"]'),samples:any[]=[]
    const global=async()=>JSON.parse(await readFile(join(workspace!,'.claude/.claude.json'),'utf8')),originalTurns=(await context()).turns
    expect((await global()).remoteHomeSettingsMode).toBe('forward')
    await search.fill('Use this machine');const initialToggle=row.getByRole('checkbox'),initiallyForwarding=await initialToggle.count()>0&&await initialToggle.isChecked()
    if(initiallyForwarding){await initialToggle.click();await expect.poll(async()=>(await global()).remoteHomeSettingsMode).toBe('keep_local');await expect(initialToggle).not.toBeChecked()}
    const preservedMode=(await global()).remoteHomeSettingsMode
    const review=async()=>{await search.fill("Use this machine");await row.getByRole('button',{name:'Review cloud settings…',exact:true}).click();await expect(editor.getByRole('heading',{name:"Use this machine's settings in cloud sessions?",exact:true})).toBeVisible()}
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await review()
      const body=editor.locator('[data-native-settings-editor-body]'),description=body.locator('p').first(),text=await description.innerText(),readings:any[]=[],captures:string[]=[]
      expect(text).toContain("Send the CLAUDE.md, rules, output styles, and preferences")
      expect(text).toContain('never sends hooks, environment variables, MCP servers, or plugins')
      expect(text).toContain('encrypted at rest');expect(text).toContain('Yes and No are saved for this machine')
      await expect(editor.locator('[data-native-settings-option="not_now"]')).toHaveAttribute('aria-pressed','true');await expect(editor.locator('[data-native-settings-option="not_now"]')).toBeFocused()
      const lines=await description.evaluate(element=>{
        const node=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode()!,text=node.textContent!,lines:{start:number;end:number;top:number}[]=[]
        for(const word of text.matchAll(/\S+/g)){const range=document.createRange();range.setStart(node,word.index!);range.setEnd(node,word.index!+word[0].length);const rect=range.getBoundingClientRect(),last=lines.at(-1);if(last&&Math.abs(last.top-rect.top)<1)last.end=word.index!+word[0].length;else lines.push({start:word.index!,end:word.index!+word[0].length,top:rect.top})}return lines.map(({start,end})=>({start,end}))
      })
      const capture=async()=>{await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))));const path=testInfo.outputPath(`native-settings-cloud-${width}-${captures.length}.png`),image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});await writeFile(path,Buffer.from(image,'base64'));captures.push(path)}
      for(const [index,line]of lines.entries()){
        const bounds=()=>description.evaluate((element,line)=>{const range=document.createRange();const node=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode()!;range.setStart(node,line.start);range.setEnd(node,line.end);const r=range.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom,shift:r.top<b.top?r.top-b.top:r.bottom-b.bottom}},line)
        let wheels=0;await body.hover()
        for(let step=0;step<30;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,Math.sign(state.shift)*Math.max(Math.abs(state.shift),Math.min(80,(state.viewportBottom-state.viewportTop)/2)));wheels++;await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
        const geometry=await bounds();expect(geometry.visible).toBe(true);readings.push({index,text:text.slice(line.start,line.end),geometry,wheels});if(index===0||wheels)await capture()
      }
      for(const value of ['forward','keep_local','not_now']){
        const target=editor.locator(`[data-native-settings-option="${value}"]`),bounds=()=>target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom,shift:r.top<b.top?r.top-b.top:r.bottom-b.bottom}})
        await body.hover();for(let step=0;step<30;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
        const geometry=await bounds();expect(geometry.visible).toBe(true);readings.push({option:value,text:await target.innerText(),geometry});await expect(editor.getByRole('button',{name:'Not now',exact:true}).first()).toBeInViewport();await capture()
      }
      if(width===1100)await editor.locator('[data-native-settings-option="not_now"]').click();else await editor.getByRole('button',{name:'Not now',exact:true}).first().click()
      await expect(editor).toHaveCount(0);expect((await global()).remoteHomeSettingsMode).toBe(preservedMode);samples.push({width,height,text,readings,captures})
    }
    await review();await editor.locator('[data-native-settings-option="keep_local"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await global()).remoteHomeSettingsMode).toBe('keep_local')
    await review();await editor.locator('[data-native-settings-option="forward"]').click();await expect(editor).toHaveCount(0)
    await expect.poll(async()=>{const mode=(await global()).remoteHomeSettingsMode;return mode==='forward'?'enabled':(await row.innerText()).includes('not enabled for you right now')?'native-flag-refused':'pending'}).not.toBe('pending')
    const outcome=(await global()).remoteHomeSettingsMode==='forward'?'enabled':'native-flag-refused'
    if(outcome==='native-flag-refused'){await expect(row).toContainText('Could not turn this on: forwarding settings to cloud sessions is not enabled for you right now');expect((await global()).remoteHomeSettingsMode).toBe('keep_local')}
    expect((await context()).turns).toBe(originalTurns);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    remoteHomeEditor={samples,outcome,initiallyForwarding,notNowPreserved:true,cancelPreserved:true,keepLocalPersisted:true,noPhantomTurn:true,finalMode:(await global()).remoteHomeSettingsMode,nativeGatesUnchanged:true}
    await appPage.setViewportSize({width:1100,height:900});await search.fill('')
  }

  if(process.env.CLAUDE_RESEARCH_SETTINGS_UPDATE_DECISIONS==='1'){
    const editor=panel.getByLabel('Claude Code setting editor',{exact:true}),row=panel.locator('[data-native-setting="autoUpdatesChannel"]'),samples:any[]=[]
    const originalTurns=(await context()).turns
    await search.fill('')
    const openUpdate=async(title:string)=>{await expect(row.getByRole('button',{name:'Change…',exact:true})).toBeEnabled();await row.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('heading',{name:title,exact:true})).toBeVisible()}
    const capture=async(kind:string,width:number,height:number)=>{
      const body=editor.locator('[data-native-settings-editor-body]'),readings:any[]=[]
      for(const [index,target]of (await editor.locator('[data-native-settings-option]').all()).entries()){
        const bounds=()=>target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom,shift:r.top<b.top?r.top-b.top:r.bottom-b.bottom}})
        await body.hover();let wheels=0
        for(let step=0;step<20;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,Math.sign(state.shift)*Math.min(64,Math.max(2,Math.abs(state.shift))));wheels++;await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
        const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport()
        await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
        const path=testInfo.outputPath(`native-settings-updates-${kind}-${width}-${index}.png`),image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
        await writeFile(path,Buffer.from(image,'base64'));readings.push({index,option:await target.innerText(),geometry,wheels,capture:path})
      }
      samples.push({kind,width,height,text:await editor.innerText(),readings})
    }
    for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await openUpdate('Switch to Stable Channel');await expect(editor).toContainText('2.1.302');await expect(editor.locator('[data-native-settings-option="stay"]')).toContainText('Stay on current version (2.1.302) until stable catches up');await capture('downgrade',width,height);const before=await user();await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);expect(await user()).toEqual(before)}
    await openUpdate('Switch to Stable Channel');await editor.locator('[data-native-settings-option="stay"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).autoUpdatesChannel).toBe('stable');await expect.poll(async()=>(await user()).minimumVersion).toBe('2.1.302');await expect(row).toContainText('stable')
    await row.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).autoUpdatesChannel).toBeUndefined();await expect.poll(async()=>(await user()).minimumVersion).toBeUndefined();await expect(row).toContainText('latest')
    await openUpdate('Switch to Stable Channel');await editor.locator('[data-native-settings-option="downgrade"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).autoUpdatesChannel).toBe('stable');expect((await user()).minimumVersion).toBeUndefined();await expect(row).toContainText('stable')
    const globalPath=join(workspace!,'.claude/.claude.json'),global=async()=>JSON.parse(await readFile(globalPath,'utf8'))
    const disableByLiveConfig=async()=>{
      const before=await global();await writeFile(globalPath+'.research-temp',JSON.stringify({...before,autoUpdates:false}));await rename(globalPath+'.research-temp',globalPath)
      await expect.poll(async()=>{await panel.getByRole('button',{name:'Refresh',exact:true}).click();return row.innerText()},{timeout:15000}).toMatch(/disabled/i)
      // Keep the same panel mounted: Refresh must rebind the original callback, not just its displayed value.
      await expect(panel).toBeVisible();await expect(row).toContainText(/disabled/i)
    }
    await disableByLiveConfig();const beforeEnable=await user()
    for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await openUpdate('Enable Auto-Updates');await expect(editor.locator('[data-native-settings-option="latest"]')).toHaveText('Enable with latest channel');await expect(editor.locator('[data-native-settings-option="stable"]')).toHaveText('Enable with stable channel');await capture('enable',width,height);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);expect((await global()).autoUpdates).toBe(false);expect(await user()).toEqual(beforeEnable)}
    await openUpdate('Enable Auto-Updates');await editor.locator('[data-native-settings-option="stable"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await global()).autoUpdates).toBe(true);await expect.poll(async()=>(await user()).autoUpdatesChannel).toBe('stable');expect((await user()).minimumVersion).toBeUndefined()
    await disableByLiveConfig();await openUpdate('Enable Auto-Updates');await editor.locator('[data-native-settings-option="latest"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await global()).autoUpdates).toBe(true);await expect.poll(async()=>(await user()).autoUpdatesChannel).toBe('latest');expect((await user()).minimumVersion).toBeUndefined();await expect(row).toContainText('latest')
    expect((await context()).turns).toBe(originalTurns);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    updateDecisions={samples,visualAcceptanceVersion:2,liveConfigWatcherAdmission:true,enableCancelPreserved:true,enabledStable:true,enabledLatest:true,downgradeCancelPreserved:true,stayPinsCurrentVersion:true,switchLatestClearsPin:true,downgradeAllowsOlder:true,noPhantomTurn:true,finalUser:await user()}
    await appPage.setViewportSize({width:1100,height:900});await search.fill('')
  }
  if(process.env.CLAUDE_RESEARCH_SETTINGS_UPDATES==='1'){
    const editor=panel.getByLabel('Claude Code setting editor',{exact:true}),row=panel.locator('[data-native-setting="autoUpdatesChannel"]')
    const globalUpdateSetting=async()=>JSON.parse(await readFile(join(workspace!,'.claude/.claude.json'),'utf8')).autoUpdates
    const originalTurns=(await context()).turns,beforeUser=await user(),beforeLocal=await local(),beforeGlobalUpdate=await globalUpdateSetting(),samples:any[]=[]
    await search.fill('');await expect(row).toBeVisible()
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await row.getByRole('button',{name:'Change…',exact:true}).click()
      await expect(editor.getByRole('heading',{name:'Enable Auto-Updates',exact:true})).toBeVisible()
      const description=editor.locator('[data-native-settings-editor-body] p')
      await expect(description).toContainText('Auto-updates are controlled by an environment variable and cannot be changed here.')
      await expect(description).toContainText('to re-enable auto-updates.')
      expect(await editor.locator('input,select,textarea,form,[data-native-settings-option]').count()).toBe(0)
      const body=editor.locator('[data-native-settings-editor-body]');await body.hover()
      const bounds=()=>description.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom,shift:r.bottom-b.bottom}})
      for(let step=0;step<12;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,Math.sign(state.shift)*Math.min(80,Math.max(2,Math.abs(state.shift))));await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
      const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'Close',exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
      const capture=testInfo.outputPath(`native-settings-updates-information-${width}.png`),image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      await writeFile(capture,Buffer.from(image,'base64'));samples.push({width,height,text:await description.innerText(),geometry,capture,realWheel:true})
      await editor.getByRole('button',{name:'Close',exact:true}).click();await expect(editor).toHaveCount(0);await expect(row.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
      expect(await user()).toEqual(beforeUser);expect(await local()).toEqual(beforeLocal);expect(await globalUpdateSetting()).toEqual(beforeGlobalUpdate);await expect(panel.getByRole('alert')).toHaveCount(0)
    }
    expect((await context()).turns).toBe(originalTurns);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    updateEditor={samples,readOnly:true,cancelPreservesSettings:true,reopened:true,noPhantomTurn:true,decisionVariants:'not admitted under original updater-disabled environment'}
    await appPage.setViewportSize({width:1100,height:900});await search.fill('')
  }
  if(externalConsentProfile){
    const originalTurns=(await context()).turns,editor=panel.getByLabel('Claude Code setting editor',{exact:true}),row=panel.locator('[data-native-setting="showExternalIncludesDialog"]'),projectConfig=consentProject
    const begin=async()=>{await search.fill('External');await expect(row.getByRole('button',{name:'Review external imports…',exact:true})).toBeEnabled();await row.getByRole('button',{name:'Review external imports…',exact:true}).click();await expect(editor).toBeVisible();await expect(editor.getByRole('heading',{name:'Allow external CLAUDE.md file imports?',exact:true})).toBeVisible()}
    const samples:any[]=[]
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await begin()
      const no=editor.locator('[data-native-settings-option="cancel"]');await expect(no).toBeFocused()
      const body=editor.locator('[data-native-settings-editor-body]'),description=body.locator('p').first(),readings:any[]=[]
      await expect(description).toContainText(externalFixture.path);await expect(description).toContainText('Never allow this for third-party repositories.')
      for(const [index,text]of ["Never allow this for third-party repositories.",externalFixture.path,'Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks https://code.claude.com/docs/en/security','Yes, allow external imports'].entries()){
        const target=index===3?editor.locator('[data-native-settings-option="confirm"]'):description
        const bounds=()=>target.evaluate((element,text)=>{const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),characters:string[]=[],positions:{node:Node;offset:number}[]=[];let node:Node|null;while((node=walk.nextNode())){const raw=node.textContent!;for(let offset=0;offset<raw.length;offset++){const character=/\s/.test(raw[offset])?' ':raw[offset];if(character===' '&&characters.at(-1)===' ')continue;characters.push(character);positions.push({node,offset})}}const needle=text.replace(/\s+/g,' '),start=characters.join('').indexOf(needle);if(start<0)throw Error('Original consent disclosure text missing');const range=document.createRange(),first=positions[start],last=positions[start+needle.length-1];range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset+1);const r=element.tagName==='BUTTON'?element.getBoundingClientRect():range.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect(),delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}},text)
        await body.hover();for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
        const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'No, disable external imports',exact:true}).first()).toBeInViewport()
        await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
        const capture=testInfo.outputPath(`native-settings-external-consent-${width}-${index}.png`),image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
        await writeFile(capture,Buffer.from(image,'base64'));readings.push({index,text,geometry,realWheel:true,capture})
        if(index===2){
          const url='https://code.claude.com/docs/en/security',link=editor.getByRole('link',{name:url,exact:true});await expect(link).toHaveAttribute('href',url)
          const beforeNavigation=await electronApp.evaluate(()=>(globalThis as any).consentSecurityNavigations.length);await link.click()
          await app.waitForSurface('default-setup/browser');await expect.poll(async()=>electronApp.evaluate(()=>(globalThis as any).consentSecurityNavigations.length)).toBeGreaterThan(beforeNavigation)
          const navigation=await electronApp.evaluate(()=>(globalThis as any).consentSecurityNavigations.at(-1));expect(navigation.url).toBe(url);await expect(appPage.getByText(/^browser$/i).first()).toBeVisible()
          const browserCapture=testInfo.outputPath(`native-consent-security-browser-${width}.png`),browserImage=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});await writeFile(browserCapture,Buffer.from(browserImage,'base64'))
          await app.navigate('default-setup/threads');await expect(editor).toBeVisible();expect((await context()).native.state.nativePid).toBe(boundNativePid)
          securityNavigation.push({width,height,url,nativeNavigationStarted:true,navigation,capture:browserCapture,returnedToConsent:true,sameNativeOwner:true})
        }

      }
      await no.click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await projectConfig()).hasClaudeMdExternalIncludesApproved).toBe(false);await expect(panel.getByRole('alert')).toHaveCount(0)
      samples.push({width,height,readings,declined:true,project:await projectConfig()})
    }
    await begin();await editor.locator('[data-native-settings-option="confirm"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await projectConfig()).hasClaudeMdExternalIncludesApproved).toBe(true)
    await disableExternalConsent()
    await begin();await editor.locator('[data-native-settings-option="confirm"]').click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await projectConfig()).hasClaudeMdExternalIncludesApproved).toBe(true)
    expect((await context()).turns).toBe(originalTurns);expect((await context()).native.state.nativePid).toBe(boundNativePid)
    externalConsent={samples,securityNavigation,disableRoutes:externalDisableRoutes,startupConsentAttempts,marker:externalFixture.marker,path:externalFixture.path,approvedForLiveRequest:true,reopenedAfterDisable:true,noPhantomTurn:true,approvedProject:await projectConfig()}
    await search.fill('');await appPage.setViewportSize({width:1100,height:900})
  }
  if(process.env.CLAUDE_RESEARCH_SETTINGS_GROUPS==='1'){
    groupEditors=[]
    const editor=panel.getByLabel('Claude Code setting editor',{exact:true})
    const globalSettings=async()=>JSON.parse(await readFile(join(workspace!,'.claude.json'),'utf8'))
    const initialTurns=(await context()).turns
    for(const key of ['agentsView','notifChannel']){
      await search.fill('');const row=panel.locator(`[data-native-setting="${key}"]`)
      if(!await row.count()){groupEditors.push({key,admitted:false,reason:'Original Config did not advertise this row'});continue}
      const change=row.getByRole('button',{name:'Change…',exact:true})
      if(!await change.count()){groupEditors.push({key,admitted:false,reason:'Original Config advertises the scalar row without a group opener'});continue}
      await expect(change).toBeEnabled()
      await change.click();await expect(editor).toBeVisible()
      const labels=await editor.locator('[data-native-settings-group-row]').allTextContents(),samples:any[]=[],changes:any[]=[]
      for(const [width,height]of [[1100,900],[680,600]]){
        await appPage.setViewportSize({width,height})
        const controls=editor.locator('[data-native-settings-group-row]')
        for(let index=0;index<await controls.count();index++){
          const control=controls.nth(index),checkbox=control.locator('input[type="checkbox"]'),select=control.locator('select')
          if(await checkbox.count()&&!await checkbox.isDisabled()){
            const before=await checkbox.isChecked(),label=await control.innerText(),field=key==='agentsView'?await control.getAttribute('data-native-settings-group-row'):label.includes('needs you')?'inputNeededNotifEnabled':'agentPushNotifEnabled';expect(field).toBeTruthy();await checkbox.click();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked({checked:!before});await expect.poll(async()=>(await globalSettings())[field!]).toBe(!before);await editor.getByRole('button',{name:'Close',exact:true}).click();await expect(editor).toHaveCount(0);await change.click();await expect(checkbox).toBeChecked({checked:!before})
            changes.push({width,label:await control.innerText(),kind:'boolean',before,after:!before,global:await globalSettings()})
            await checkbox.click();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked({checked:before})
          }else if(await select.count()&&!await select.isDisabled()){
            const before=await select.inputValue(),options=await select.locator('option:not(:disabled)').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)),after=options.find(value=>value!==before)
            if(after!==undefined){await select.selectOption(after);await expect(select).toBeEnabled();await expect(select).toHaveValue(after);await expect.poll(async()=>(await globalSettings()).preferredNotifChannel).toBe(after);await editor.getByRole('button',{name:'Close',exact:true}).click();await expect(editor).toHaveCount(0);await change.click();await expect(select).toHaveValue(after);changes.push({width,label:await control.innerText(),kind:'choice',before,after,global:await globalSettings()});await select.selectOption(before);await expect(select).toBeEnabled();await expect(select).toHaveValue(before)}
          }
        }
        const body=editor.locator('[data-native-settings-editor-body]'),readings:any[]=[]
        for(let index=0;index<await controls.count();index++){
          const control=controls.nth(index)
          const bounds=()=>control.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect(),delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
          await body.hover();for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
          const geometry=await bounds();expect(geometry.visible).toBe(true);readings.push({index,label:await control.innerText(),geometry,realWheel:true})
        }
        await expect(editor.getByRole('button',{name:'Close',exact:true})).toBeInViewport()
        await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
        const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height}),capture=testInfo.outputPath(`native-settings-group-${key}-${width}.png`)
        await writeFile(capture,Buffer.from(image,'base64'));samples.push({width,height,readings,capture,global:await globalSettings()})
      }
      await editor.getByRole('button',{name:'Close',exact:true}).click();await expect(editor).toHaveCount(0)
      await expect(change).toBeEnabled();await change.click();await expect(editor).toBeVisible();expect(await editor.locator('[data-native-settings-group-row]').allTextContents()).toEqual(labels)
      await editor.getByRole('button',{name:'Close',exact:true}).click();await expect(editor).toHaveCount(0)
      groupEditors.push({key,admitted:true,labels,samples,changes,reopened:true})
    }
    await writeFile(join(workspace!,'native-settings-group-admission.json'),JSON.stringify(groupEditors))
    expect(groupEditors.some((group:any)=>group.admitted&&group.changes.length>0),'No original grouped Settings admitted; preserve native eligibility instead of forcing a feature flag').toBe(true)
    expect((await context()).turns).toBe(initialTurns)
    await search.fill('');await appPage.setViewportSize({width:1100,height:900})
  }
  if(process.env.CLAUDE_RESEARCH_SETTINGS_EDITORS==='1'){
    const beforeStyle=await local(),editor=panel.getByLabel('Claude Code setting editor',{exact:true}),row=panel.locator('[data-native-setting="outputStyle"]'),samples:any[]=[]
    await search.fill('Theme');const themeRow=panel.locator('[data-native-setting="theme"]')
    const openTheme=async()=>{await themeRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('region',{name:'Native Theme preview',exact:true})).toBeVisible()}
    await openTheme();await editor.getByRole('button',{name:'Dark mode',exact:true}).click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).theme).toBe('dark');await expect(themeRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    const themeSamples:any[]=[]
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await openTheme()
      const preview=editor.getByRole('region',{name:'Native Theme preview',exact:true}),before=await user(),dark=await preview.innerHTML()
      await editor.getByRole('button',{name:'Preview Light mode',exact:true}).click()
      await expect.poll(()=>preview.innerHTML()).not.toBe(dark);await expect(preview.locator('[data-native-theme-row]')).toHaveCount(4);expect(await user()).toEqual(before)
      await expect(editor.getByRole('button',{name:'Preview Light mode',exact:true})).toHaveAttribute('aria-pressed','true')
      const bounds=()=>preview.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Theme sample exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
      await editor.locator('[data-native-settings-editor-body]').hover();for(let step=0;step<50;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
      const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport()
      const surface=await preview.locator('[data-native-theme-surface]').evaluate(element=>{const style=getComputedStyle(element),contextColor=getComputedStyle(element.querySelector('[data-native-theme-row]:last-child code span:last-child')!).color;const luminance=(color:string)=>{const values=(color.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(value=>{const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4});return values[0]!*0.2126+values[1]!*0.7152+values[2]!*0.0722};const a=luminance(contextColor),b=luminance(style.backgroundColor);return {color:style.color,background:style.backgroundColor,contextColor,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)}});expect(surface.contrast).toBeGreaterThanOrEqual(4.5);expect(surface.background).not.toBe('rgba(0, 0, 0, 0)')
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const capture=testInfo.outputPath(`native-settings-theme-preview-${width}.png`);await writeFile(capture,Buffer.from(image,'base64'));themeSamples.push({width,height,geometry,realWheel:true,capture,previewChanges:true,structuredRows:4,surface})
      await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);expect(await user()).toEqual(before)
      await openTheme();await expect(preview).toHaveJSProperty('innerHTML',dark);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    }
    await openTheme();await editor.getByRole('button',{name:'Light mode',exact:true}).click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).theme).toBe('light');await expect(themeRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    await openTheme();await expect(editor.getByRole('button',{name:'Light mode',exact:true})).toHaveAttribute('aria-pressed','true')
    const sample=editor.getByRole('region',{name:'Native Theme preview',exact:true}),syntaxBefore=await sample.innerText()
    await editor.getByRole('button',{name:'Toggle syntax highlighting',exact:true}).click();await expect.poll(async()=>(await user()).syntaxHighlightingDisabled).toBe(true);await expect(sample).toContainText('Syntax highlighting disabled')
    await editor.getByRole('button',{name:'Toggle syntax highlighting',exact:true}).click();await expect.poll(async()=>(await user()).syntaxHighlightingDisabled).toBe(false);await expect(sample).toHaveText(syntaxBefore,{useInnerText:true})
    await editor.getByRole('button',{name:'Dark mode',exact:true}).click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).theme).toBe('dark');await expect(themeRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    themeEditor={samples:themeSamples,cancelRestoresPreview:true,previewPreservesSettings:true,lightCommitReopened:true,darkRestored:true,syntaxDisabledRestored:true}
    await search.fill('Model');const modelRow=panel.locator('[data-native-setting="model"]'),modelDetails=editor.getByRole('region',{name:'Native Model details',exact:true})
    const choices=()=>editor.locator('button[aria-pressed]:not([aria-label])')
    const sonnet=()=>choices().filter({hasText:/^Sonnet/}).first()
    const openModel=async()=>{await modelRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(modelDetails).toBeVisible();await expect(editor.getByRole('textbox')).toHaveCount(0)}
    const modelBefore=await user(),modelTurns=(await context()).turns,modelSamples:any[]=[]
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await openModel()
      const options=await choices().evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,disabled:(button as HTMLButtonElement).disabled})));expect(options.length).toBeGreaterThan(1)
      await editor.getByRole('button',{name:/^Details for Sonnet/}).first().click();await expect(modelDetails).toContainText('Sonnet')
      const beforeEffort=await modelDetails.innerText(),adjustment=/\blow\b/i.test(beforeEffort)?'Increase effort':'Decrease effort'
      await expect(modelDetails.getByRole('button',{name:adjustment,exact:true})).toBeEnabled();if(width===680){await modelDetails.focus();await modelDetails.press(adjustment==='Increase effort'?'ArrowRight':'ArrowLeft')}else await modelDetails.getByRole('button',{name:adjustment,exact:true}).click();await expect(modelDetails).not.toHaveText(beforeEffort,{useInnerText:true})
      const draftEffort=await modelDetails.getAttribute('data-native-model-draft-effort');expect(draftEffort).toBeTruthy()
      const bounds=()=>modelDetails.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Model details exceed viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
      await editor.locator('[data-native-settings-editor-body]').hover();for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
      const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const capture=testInfo.outputPath(`native-settings-model-details-${width}.png`);await writeFile(capture,Buffer.from(image,'base64'));modelSamples.push({width,height,options,geometry,realWheel:true,capture,interaction:width===680?'arrow':'button',beforeEffort,afterEffort:await modelDetails.innerText(),draftEffort})
      await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);expect(await user()).toEqual(modelBefore)
    }
    await openModel();await sonnet().click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).model).toMatch(/sonnet/i);await expect(modelRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    await openModel();await expect(sonnet()).toHaveAttribute('aria-pressed','true');await choices().filter({hasText:/^Default\b/}).first().click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).model).toBeUndefined();await expect(modelRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    await openModel();await expect(choices().filter({hasText:/^Default\b/}).first()).toHaveAttribute('aria-pressed','true');await editor.getByRole('button',{name:/^Details for Sonnet/}).first().click();await expect(modelDetails).toContainText('Sonnet')
    const initialEffort=await modelDetails.innerText(),adjustment=/\blow\b/i.test(initialEffort)?'Increase effort':'Decrease effort';await modelDetails.getByRole('button',{name:adjustment,exact:true}).click();await expect(modelDetails).not.toHaveText(initialEffort,{useInnerText:true})
    const selectedEffort=await modelDetails.getAttribute('data-native-model-draft-effort');expect(selectedEffort).toBeTruthy()
    await sonnet().click();await expect(editor).toHaveCount(0);await expect.poll(async()=>(await user()).model).toMatch(/sonnet/i);await expect(modelRow.getByRole('button',{name:'Change…',exact:true})).toBeEnabled()
    await expect.poll(async()=>(await context()).native.state.session.model).toMatch(/sonnet/i)
    await openModel();await expect(sonnet()).toHaveAttribute('aria-pressed','true');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    expect((await context()).turns).toBe(modelTurns);modelEditor={samples:modelSamples,cancelPreserved:true,nativeSearchClosed:true,defaultReset:true,selectedModel:(await user()).model,selectedEffort,reopenedNativeSelection:true,noPhantomTurn:true}
    await search.fill('Output style')
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await row.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor).toBeVisible()
      const options=editor.locator('button[aria-pressed]');expect(await options.count()).toBeGreaterThan(1)
      const optionTexts=await options.allTextContents(),target=options.last()
      const bounds=()=>target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[data-native-settings-editor-body]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Picker option exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
      await editor.locator('[data-native-settings-editor-body]').hover();for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
      const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const capture=testInfo.outputPath(`native-settings-output-style-${width}.png`);await writeFile(capture,Buffer.from(image,'base64'))
      samples.push({width,height,options:optionTexts,geometry,realWheel:true,capture})
      await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);expect(await local()).toEqual(beforeStyle)
    }
    await row.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor).toBeVisible()
    const choice=editor.locator('button[aria-pressed="false"]:not([disabled])').last(),chosenLabel=await choice.innerText();await choice.click();await expect(editor).toHaveCount(0)
    await expect.poll(async()=>(await local()).outputStyle).not.toBe(beforeStyle.outputStyle)
    const afterStyle=await local(),unchanged={...afterStyle};if(Object.hasOwn(beforeStyle,'outputStyle'))unchanged.outputStyle=beforeStyle.outputStyle;else delete unchanged.outputStyle;expect(unchanged).toEqual(beforeStyle)
    await row.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.locator('button[aria-pressed="true"]')).toHaveText(chosenLabel,{useInnerText:true})
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    const formSamples:any[]=[],noteDraft='日本語 – release review note'
    await search.fill('Review note')
    const noteRow=panel.locator('[data-native-setting$=".reviewNote"]')
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await noteRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor).toBeVisible()
      const field=editor.getByRole('textbox',{name:'Review note',exact:true});await expect(field).toHaveValue('Original release note');await field.fill(noteDraft)
      await expect(field).toBeInViewport();await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const capture=testInfo.outputPath(`native-settings-note-form-${width}.png`);await writeFile(capture,Buffer.from(image,'base64'));formSamples.push({width,height,draft:await field.inputValue(),capture})
      await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    }
    await noteRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Review note',exact:true})).toHaveValue('Original release note')
    await editor.getByRole('textbox',{name:'Review note',exact:true}).fill(noteDraft);await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0)
    await noteRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Review note',exact:true})).toHaveValue(noteDraft)
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    await search.fill('Review count');const countRow=panel.locator('[data-native-setting$=".reviewCount"]')
    await countRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Review count',exact:true})).toHaveValue('2')
    await editor.getByRole('textbox',{name:'Review count',exact:true}).fill('42');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('between 1 and 9');await expect(editor).toBeVisible()
    const validationMessage=await panel.getByRole('alert').innerText()
    await editor.getByRole('textbox',{name:'Review count',exact:true}).fill('3');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0)
    await countRow.getByRole('button',{name:'Change…',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Review count',exact:true})).toHaveValue('3')
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
    outputStyleEditor={before:beforeStyle,after:afterStyle,chosenLabel,samples,cancelPreserved:true,reopenedNativeSelection:true,forms:{samples:formSamples,noteDraft,noteReopened:true,cancelPreserved:true,validationMessage,numberReopened:'3'}}
  }
  await search.fill('')
  for (const [width,height] of [[1100,900],[680,600]]) {
    await appPage.setViewportSize({width,height});await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport();await expect(search).toBeInViewport()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
    const path=testInfo.outputPath('native-config-desktop-list-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));captures.push(path)
  }
  const frameCaptures:string[]=[],statusSamples:any[]=[]
  const tabs=panel.getByRole('navigation',{name:'Claude Code settings tabs'})
  for(const tab of statusOnly?['Status']:['Status','Usage','Stats']){
    await tabs.getByRole('button',{name:tab,exact:true}).click()
    await expect(tabs.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-current','page')
    if(tab==='Status'){await expect(panel.locator('dt').filter({hasText:/^Version$/})).toHaveText('Version');await expect(panel.locator('dd').filter({hasText:/^2\.1\.302$/})).toHaveCount(1)}
    if(tab==='Usage')await expect(panel.getByText('Context window',{exact:true})).toBeVisible()
    if(tab==='Stats'){
      await expect(panel.getByRole('button',{name:'Models',exact:true})).toBeEnabled()
      await expect(panel.locator('dt').filter({hasText:/^Sessions$/})).toBeVisible()
      const statistics=panel.getByRole('region',{name:'Claude Code statistics',exact:true})
      const total=statistics.locator('dt').filter({hasText:/^Total tokens$/}).locator('..').locator('dd')
      await expect(total).toHaveText(new Intl.NumberFormat().format(expectedRange()))
      statsCompleteness.ranges.push({range:'all',expected:expectedRange(),observed:Number((await total.innerText()).replace(/,/g,''))})
      const insight=statistics.getByText(/Your input and output/);await expect(insight).toBeVisible()
      const body=panel.locator('[aria-label="Claude Code Stats"]')
      const inBody=(target:import('@playwright/test').Locator)=>target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Stats"]')!.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom})
      async function readTo(target:import('@playwright/test').Locator){
        await body.hover()
        for(let step=0;step<40&&!await inBody(target);step++){
          const shift=await target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Stats"]')!.getBoundingClientRect();if(r.height>b.height)throw Error(`Stats reading target is taller than the viewport: ${r.height} > ${b.height}`);return r.top<b.top?Math.max(-60,r.top-b.top):Math.min(60,r.bottom-b.bottom)},undefined,{timeout:5000})
          await appPage.mouse.wheel(0,shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
        }
        expect(await inBody(target)).toBe(true)
      }
      async function statsCapture(label:string,width:number){
        const height=width===680?600:900
        await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport();await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeInViewport()
        await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
        const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
        const path=testInfo.outputPath('native-rich-stats-'+label+'-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));statsCompleteness.captures.push(path)
      }
      async function copyStats(view:'Overview'|'Models',width:number){
        await statistics.getByRole('button',{name:'Copy stats',exact:true}).scrollIntoViewIfNeeded()
        await electronApp.evaluate(({clipboard})=>clipboard.clear())
        await statistics.getByRole('button',{name:'Copy stats',exact:true}).click()
        await expect(statistics.getByText('Copied by Claude Code',{exact:true})).toBeVisible({timeout:15000})
        await expect.poll(()=>electronApp.evaluate(({clipboard})=>!clipboard.readImage().isEmpty()),{timeout:15000}).toBe(true)
        const exported=await electronApp.evaluate(({clipboard})=>{const image=clipboard.readImage();return {formats:clipboard.availableFormats(),size:image.getSize(),png:image.toPNG().toString('base64')}})
        expect(exported.formats).toContain('image/png');expect(exported.size.width).toBeGreaterThan(0);expect(exported.size.height).toBeGreaterThan(0)
        const bytes=Buffer.from(exported.png,'base64'),file='native-rich-stats-'+(view==='Models'?'models-':'')+'export-'+width+'.png';await writeFile(testInfo.outputPath(file),bytes)
        statsCompleteness.exports.push({file,width,view,formats:exported.formats,size:exported.size,sha256:createHash('sha256').update(bytes).digest('hex')})
      }
      for(const width of [1100,680]){
        await appPage.setViewportSize({width,height:width===680?600:900})
        const longest=statistics.locator('dt').filter({hasText:/^Longest session$/}).locator('..');await readTo(longest);await statsCapture('summary',width)
        await readTo(insight);await statsCapture('insight',width)
        const calendar=statistics.getByLabel('Claude Code activity calendar',{exact:true})
        await expect(calendar).toContainText('52 weeks')
        await expect(calendar.locator('[data-activity-level]')).toHaveCount(364)
        await expect(calendar.locator('pre')).toHaveCount(0)
        const levels=await calendar.locator('[data-activity-level]').evaluateAll(cells=>cells.map(cell=>cell.getAttribute('data-activity-level')))
        expect(levels.filter(level=>['1','2','3','4'].includes(level!))).toHaveLength(histories.length+1)
        expect(levels.every(level=>['0','1','2','3','4','future'].includes(level!))).toBe(true)
        expect(await calendar.innerText()).not.toMatch(/[·░▒▓█]/)
        await readTo(calendar);await statsCapture('calendar',width)
        const history=statistics.getByText('Activity dates and counts',{exact:true});await readTo(history);await history.click()
        const historicalRow=statistics.locator('details[open] tbody tr').filter({hasText:histories[2].date})
        await readTo(historicalRow);await statsCapture('history',width);statsCompleteness.reading.push({width,longest:true,historicalDate:histories[2].date,realWheel:true})
        await history.click()
        await copyStats('Overview',width)
      }
      await panel.getByRole('button',{name:'Models',exact:true}).click()
      await expect(panel.getByRole('button',{name:'Models',exact:true})).toHaveAttribute('aria-pressed','true')
      const modelTable=statistics.locator('table')
      for(const width of [1100,680]){
        await appPage.setViewportSize({width,height:width===680?600:900})
        await readTo(modelTable);await expect(modelTable.locator('thead')).toContainText('Cache read');await statsCapture('models',width)
        statsCompleteness.reading.find((row:any)=>row.width===width).modelTable=true
        await copyStats('Models',width)
      }
      await panel.getByRole('button',{name:/Change dates/}).click()
      await expect(panel.getByRole('button',{name:/Change dates/})).toContainText('Last 7 days')
      await expect(total).toHaveText(new Intl.NumberFormat().format(expectedRange(7)))
      statsCompleteness.ranges.push({range:'7d',expected:expectedRange(7),observed:Number((await total.innerText()).replace(/,/g,''))})
      await panel.getByRole('button',{name:/Change dates/}).click();await expect(panel.getByRole('button',{name:/Change dates/})).toContainText('Last 30 days')
      await expect(total).toHaveText(new Intl.NumberFormat().format(expectedRange(30)))
      statsCompleteness.ranges.push({range:'30d',expected:expectedRange(30),observed:Number((await total.innerText()).replace(/,/g,''))})
      await panel.getByRole('button',{name:/Change dates/}).click();await expect(total).toHaveText(new Intl.NumberFormat().format(expectedRange()))
      statsCompleteness.ranges.push({range:'all-restored',expected:expectedRange(),observed:Number((await total.innerText()).replace(/,/g,''))})
    }
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height})
      if(statusOnly){
        const row=panel.locator('dt').filter({hasText:/^Setting sources$/}).locator('..'),value=row.locator('dd'),body=panel.getByLabel('Claude Code Status',{exact:true})
        const bounds=()=>row.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Status"]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Status row exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}},undefined,{timeout:5000})
        await body.hover();for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
        const geometry=await bounds();expect(geometry.visible).toBe(true)
        const text=(await value.innerText()).replace(/\s+/g,' ').trim();expect(text).toMatch(/user settings/i);expect(text).toMatch(/project local settings/i);expect(text).toMatch(/,\s+/)
        const sample:any={width,height,value:text,geometry,realWheel:true}
        if(process.env.CLAUDE_RESEARCH_STATUS_DIAGNOSTICS==='1'){
          const warning=panel.getByRole('region',{name:'System diagnostics',exact:true}),items=warning.locator('li')
          const count=await items.count();expect(count).toBeGreaterThan(0);expect(count).toBeLessThanOrEqual(128)
          sample.diagnosticReadings=[]
          for(let index=0;index<count;index++){
            const item=items.nth(index)
            const diagnosticBounds=()=>item.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Status"]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Diagnostic exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
            await body.hover();for(let step=0;step<40;step++){const state=await diagnosticBounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
            const diagnosticGeometry=await diagnosticBounds();expect(diagnosticGeometry.visible).toBe(true)
            await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))))
            const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
            const capture=testInfo.outputPath(`native-settings-diagnostic-${index}-${width}.png`);await writeFile(capture,Buffer.from(image,'base64'))
            sample.diagnosticReadings.push({index,text:await item.innerText(),geometry:diagnosticGeometry,realWheel:true,capture})
          }
          sample.diagnostic=sample.diagnosticReadings.find((reading:any)=>/^Native installation exists but ~\/\.local\/bin is not in your PATH$/.test(reading.text))
          expect(sample.diagnostic).toBeTruthy()

        }
        statusSamples.push(sample)
      }
      await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
      await expect(tabs.getByRole('button',{name:tab,exact:true})).toBeInViewport()
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const path=testInfo.outputPath('native-settings-desktop-'+tab.toLowerCase()+'-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));frameCaptures.push(path)
    }
  }
  await tabs.getByRole('button',{name:'Config',exact:true}).click();await expect(search).toBeVisible()
  await panel.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toHaveCount(0);await expect(composer).toHaveText(draft)
  if(externalConsentProfile||updateEditor||updateDecisions){expect(await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))).toEqual(saved);if(externalConsent)externalConsent.exactParentDocumentSelection=true;if(updateEditor)updateEditor.exactParentDocumentSelection=true;if(updateDecisions)updateDecisions.exactParentDocumentSelection=true}
  const before=(await context()).turns
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns,{timeout:15000}).toBeGreaterThan(before)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  const stopNative=async()=>{await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()}
  if(externalConsentProfile){
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    await stopNative()
    await composer.fill('Continue the same session with approved external instructions.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId)
    await section.getByRole('button',{name:'Use native interface',exact:true}).click()
    await expect.poll(async()=>{const pid=(await context()).native?.state.nativePid;return pid&&pid!==boundNativePid?pid:undefined}).toBeTruthy()
    await settleNativeOnboarding(true);externalConsent.restartedNativePid=(await context()).native.state.nativePid
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await open();await search.fill('External');await disableExternalConsent()
    externalConsent.disabledBeforeResume=true;externalConsent.disabledProject=await consentProject();externalConsent.restartBoundaryVerified=true
    await panel.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toHaveCount(0)
    await stopNative()
  }else await stopNative()

  await composer.fill('Continue the same session after desktop settings.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-config-desktop-proof.json'),JSON.stringify({sessionId,boundNativePid,...remoteHomeEditor?{remoteHomeEditor}:{},...updateDecisions?{updateDecisions}:{},...updateEditor?{updateEditor}:{},...externalConsent?{externalConsent}:{},...groupEditors?{groupEditors}:{},...modelEditor?{modelEditor}:{},...themeEditor?{themeEditor}:{},...(!externalConsentProfile?{languageEditor:{cancelPreserved:true,emptyDefaultReset:true,trimmedReopen:true}}:{consentOnly:true}),local:await local(),user:await user(),captures,frameCaptures,...(outputStyleEditor?{nativeSettingsEditors:true,outputStyleEditor}:{}),...(statusOnly?{nativeStatusRows:true,nativeStatusDiagnostics:process.env.CLAUDE_RESEARCH_STATUS_DIAGNOSTICS==='1',nativeStatusDiagnosticList:process.env.CLAUDE_RESEARCH_STATUS_DIAGNOSTICS==='1',statusSamples}:{statsCompleteness}),desktopFrameTabs:!statusOnly,nativeStatsDates:!statusOnly,retainedDraft:true,reopenedValues:!externalConsentProfile,lockedControl:!externalConsentProfile}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeConfigDesktop:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
