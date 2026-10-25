import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test.afterEach(async ({appPage,electronApp},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus||!workspace)return
  await writeFile(join(workspace,'native-agent-settings-failure.txt'),await appPage.locator('body').innerText())
  const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!
  const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
  await writeFile(testInfo.outputPath('native-agent-settings-failure.png'),Buffer.from(image,'base64'))
})
test('preserves selected Agent context through native Settings tabs and compact controls', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1], rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()

  const parent='Keep the parent release review draft unchanged.'
  await expect.poll(async()=>(await context()).messages.some((message:any)=>message.text?.includes('ParentSubagentFixtureComplete'))).toBe(true)
  await composer.fill(parent);const before=await context()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),field=form.locator('[contenteditable="true"]')
  const samples: any[]=[], captures: unknown[]=[], calendarSamples: any[]=[]
  const nativeWindow=await electronApp.browserWindow(appPage)
  const panel=focused.getByRole('dialog',{name:'Claude Code settings',exact:true})
  async function capture(label:string){
    for(const width of [1100,680]){
      const height=width===680?600:900
      await appPage.setViewportSize({width,height})
      if(await panel.isVisible()){
        await expect(panel.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport({ratio:1})
        await expect(panel.getByRole('navigation',{name:'Claude Code settings tabs'})).toBeInViewport()
        if(label==='stats-models'||label==='stats-calendar'){
          const body=panel.locator('[aria-label="Claude Code Stats"]')
          const target=label==='stats-calendar'?panel.getByLabel('Claude Code activity calendar',{exact:true}):panel.locator('table')
          const bounds=()=>target.evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('[aria-label="Claude Code Stats"]')!.getBoundingClientRect();if(r.height>b.height+1)throw Error('Stats reading target exceeds viewport');const delta=r.top<b.top?r.top-b.top:r.bottom-b.bottom;return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,shift:Math.sign(delta)*Math.min(60,Math.max(2,Math.ceil(Math.abs(delta)))),target:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},viewport:{top:b.top,bottom:b.bottom,left:b.left,right:b.right}}},undefined,{timeout:5000})
          await body.hover()
          for(let step=0;step<40;step++){const state=await bounds();if(state.visible)break;await appPage.mouse.wheel(0,state.shift);await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
          expect((await bounds()).visible).toBe(true)
          if(label==='stats-calendar'){
            await expect(target).toContainText('52 weeks');await expect(target.locator('[data-activity-level]')).toHaveCount(364)
            const levels=await target.locator('[data-activity-level]').evaluateAll(cells=>cells.map(cell=>cell.getAttribute('data-activity-level')))
            const active=levels.filter(level=>['1','2','3','4'].includes(level!)).length;expect(active).toBeGreaterThan(0)
            expect(levels.every(level=>['0','1','2','3','4','future'].includes(level!))).toBe(true)
            expect(await target.innerText()).not.toMatch(/[·░▒▓█]/);await expect(target.locator('pre')).toHaveCount(0)
            calendarSamples.push({width,cells:levels.length,active,graphical:true,realWheel:true,geometry:await bounds()})
          }
        }

        const geometry=await panel.evaluate(element=>{
          const close=Array.from(element.querySelectorAll('button')).find(button=>button.textContent==='Close settings')!
          const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}}
          return {panel:rect(element),close:rect(close),window:{width:innerWidth,height:innerHeight}}
        })
        samples.push({label,width,height,geometry,view:(await context()).native.state.view,text:await panel.innerText()})
      }else await expect((await focused.isVisible())?form.getByRole('button',{name:'Send to Agent',exact:true}):card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
      await appPage.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
      const image=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      const file='agent-settings-desktop-'+label+'-'+width+'.png'
      await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'));captures.push({file,width,height,pixels:{width,height}})
    }
  }
  let draft='Keep the worker release review draft unchanged.'
  const retained: any[]=[]
  await field.fill(draft)
  const agentName=await focused.locator('h2').innerText()
  let originalDocument=await field.evaluate(element=>(element as any).editor.state.doc.toJSON())
  let originalSelection=await field.evaluate(element=>(element as any).editor.state.selection.toJSON())
  const originalView=(await context()).native.state.view
  const workerMessageCount=await focused.locator('[data-native-agent-message]').count()
  const humanRows=async()=>{
    const result:string[]=[]
    const files=(await readdir(join(workspace!,'.claude/projects'),{recursive:true})).filter(file=>file.endsWith('.jsonl')&&file.includes('agent-'+taskId))
    expect(files.length).toBeGreaterThan(0)
    for(const file of files){
      for(const line of (await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').filter(Boolean)){
        const row=JSON.parse(line);if(row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human')result.push(row.uuid)
      }
    }
    return result
  }
  const originalHumans=await humanRows()
  const usageRows:any[]=[]
  for(const file of (await readdir(join(workspace!,'.claude/projects'),{recursive:true})).filter(file=>file.endsWith('.jsonl'))){
    for(const line of (await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').filter(Boolean)){
      const row=JSON.parse(line);if(row.type==='assistant'&&row.message?.usage)usageRows.push(row)
    }
  }
  expect(usageRows.length).toBeGreaterThan(0)
  expect(new Set(usageRows.map(row=>row.uuid)).size).toBe(usageRows.length)
  const expectedStatsTokens=usageRows.reduce((total,row)=>total+['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'].reduce((sum,key)=>sum+(row.message.usage[key]??0),0),0)
  expect(expectedStatsTokens).toBeGreaterThan(0)
  const expectedStatsInputTokens=usageRows.reduce((total,row)=>total+row.message.usage.input_tokens,0)
  const expectedStatsOutputTokens=usageRows.reduce((total,row)=>total+row.message.usage.output_tokens,0)
  async function open(){
    await form.getByRole('button',{name:'Claude settings',exact:true}).click()
    await expect(panel).toBeVisible();await expect(panel).toContainText('Agent · '+agentName)
    await expect(panel.getByRole('textbox',{name:'Search Claude Code settings',exact:true})).toBeVisible()
    await expect(focused.locator(':scope > header')).toBeHidden()
  }
  async function close(){
    await panel.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toBeHidden()
    await expect(field).toHaveText(draft);await expect(field).toBeFocused()
    expect(await field.evaluate(element=>(element as any).editor.state.doc.toJSON())).toEqual(originalDocument)
    expect(await field.evaluate(element=>(element as any).editor.state.selection.toJSON())).toEqual(originalSelection)
    expect((await context()).native.state.view).toEqual(originalView)
    await expect(focused.locator(':scope > header')).toBeVisible()
    retained.push({draft,document:originalDocument,selection:originalSelection,view:(await context()).native.state.view})
  }
  const tabs=panel.getByRole('navigation',{name:'Claude Code settings tabs'})
  async function tab(name:string){await tabs.getByRole('button',{name,exact:true}).click();await expect(tabs.getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page')}
  await open();await tab('Status');await expect(panel.locator('dd').filter({hasText:/^2\.1\.302$/})).toHaveCount(1);await capture('status-tab')
  await tab('Config');await panel.getByRole('textbox',{name:'Search Claude Code settings',exact:true}).fill('Language');await expect(panel.getByRole('textbox',{name:'Language',exact:true})).toBeVisible();await capture('config-controls');await close()
  draft='/config';await field.fill(draft)
  originalDocument=await field.evaluate(element=>(element as any).editor.state.doc.toJSON())
  originalSelection=await field.evaluate(element=>(element as any).editor.state.selection.toJSON())
  await open();await tab('Usage');await expect(panel.getByText('Context window',{exact:true})).toBeVisible();await capture('usage-tab')
  await tab('Stats');await expect(panel.locator('dt').filter({hasText:/^Sessions$/})).toBeVisible();await capture('stats-overview');await capture('stats-calendar')
  await panel.getByRole('button',{name:'Models',exact:true}).click();await expect(panel.getByRole('button',{name:'Models',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(panel.locator('table thead')).toContainText('Cache read')
  const totals=await panel.locator('tbody tr').evaluateAll(rows=>rows.reduce((total,row)=>{
    const values=Array.from(row.querySelectorAll('td')).slice(0,4).map(cell=>Number((cell.textContent??'').replace(/,/g,'')))
    return {input:total.input+values[0],output:total.output+values[1],all:total.all+values.reduce((sum,value)=>sum+value,0)}
  },{input:0,output:0,all:0}))
  expect(totals).toEqual({input:expectedStatsInputTokens,output:expectedStatsOutputTokens,all:expectedStatsTokens})
  await capture('stats-models');await close();await capture('retained-agent')
  expect(await focused.locator('[data-native-agent-message]').count()).toBe(workerMessageCount)
  expect(await humanRows()).toEqual(originalHumans)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parent)
  await capture('retained-parent')
  await writeFile(join(workspace!,'native-agent-settings-proof.json'),JSON.stringify({desktop:true,sessionId,taskId,boundNativePid,agentName,parent,draft,originalDocument,originalSelection,originalView,workerMessageCount,retained,expectedStatsTokens,expectedStatsInputTokens,expectedStatsOutputTokens,totals,usageUuids:usageRows.map(row=>row.uuid),originalHumans,finalHumans:await humanRows(),noPhantomTurn:true,samples,captures,calendarSamples},null,2))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after reviewing worker settings.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentSettings:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
