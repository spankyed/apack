import { readFile, readdir as _readdir, writeFile, utimes } from 'node:fs/promises'
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
  let theme = false, security = false, navigated = false, trusted = false, trustSelectedAt = 0, trustAttempts = 0
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminalScreen!.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminalScreen!.buffer.active
    const text = Array.from({ length: terminalScreen!.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
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
  await panel.getByRole('textbox',{name:'Language',exact:true}).fill('French')
  await panel.getByRole('button',{name:'Save',exact:true}).click()
  await expect.poll(async()=>(await user()).language).toBe('French')
  await expect(panel.getByRole('status')).toHaveText('Saved by Claude Code')
  const nativeWindow = await electronApp.browserWindow(appPage), captures:string[]=[]
  for (const [width,height] of [[1100,900],[680,600]]) {
    await appPage.setViewportSize({width,height})
    for (const label of ['Search Claude Code settings','Language']) await expect(panel.getByRole('textbox',{name:label,exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport()
    await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeInViewport()
    await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const image=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
    const path=testInfo.outputPath('native-config-desktop-language-'+width+'.png');await writeFile(path,Buffer.from(image,'base64'));captures.push(path)
  }
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
  await search.fill('Language');await expect(panel.getByRole('textbox',{name:'Language',exact:true})).toHaveValue('French')
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
          const warning=panel.getByRole('region',{name:'System diagnostics',exact:true}),item=warning.locator('li').filter({hasText:/^Native installation exists but ~\/\.local\/bin is not in your PATH$/})
          await expect(item).toHaveCount(1)
          const diagnosticBounds=()=>item.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Status"]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Diagnostic exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(80,Math.max(2,Math.ceil(Math.abs(delta)))),top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom}})
          await body.hover();for(let step=0;step<40;step++){const state=await diagnosticBounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
          const diagnosticGeometry=await diagnosticBounds();expect(diagnosticGeometry.visible).toBe(true)
          sample.diagnostic={text:await item.innerText(),geometry:diagnosticGeometry,realWheel:true}
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
  const before=(await context()).turns
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).turns,{timeout:15000}).toBeGreaterThan(before)
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await composer.fill('Continue the same session after desktop settings.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-config-desktop-proof.json'),JSON.stringify({sessionId,boundNativePid,local:await local(),user:await user(),captures,frameCaptures,...(statusOnly?{nativeStatusRows:true,nativeStatusDiagnostics:process.env.CLAUDE_RESEARCH_STATUS_DIAGNOSTICS==='1',statusSamples}:{statsCompleteness}),desktopFrameTabs:!statusOnly,nativeStatsDates:!statusOnly,retainedDraft:true,reopenedValues:true,lockedControl:true}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeConfigDesktop:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
