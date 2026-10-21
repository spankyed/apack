import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@app/claude-terminal-xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('edits long native review notes within the actual site viewport without submitting chat', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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
  // A cold native owner loads its original plugins before the first result.
  await expect.poll(async () => (await context()).turns, { timeout: 20000, message: 'Initial original-native seed turn completes before field acceptance starts' }).toBe(1)
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')


  const draft='Keep the release-review draft while editing the notes.'
  await composer.fill(draft)
  let initial:any
  await expect.poll(async()=>{initial=JSON.parse(await readFile(join(workspace!,'native-field-bounds-initial.json'),'utf8').catch(()=>'null'));return !!initial}).toBe(true)
  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-field-bounds-receipts.json'),'utf8').catch(()=>'[]'))
  const before=await context(),tools=card.getByRole('button',{name:'Session tools',exact:true})
  await tools.click()
  const notes=card.getByRole('textbox',{name:'Release review notes',exact:true})
  await expect(notes).toHaveValue(initial.value);expect(initial.value.length).toBeGreaterThan(16384);expect(initial.rows).toBe(80)
  expect(await notes.getAttribute('maxlength')).toBe('16384')
  await notes.press('Enter')
  await expect(card.getByRole('alert')).toContainText('Shorten this field to 16,384 characters')
  await expect(notes).toHaveValue(initial.value);await expect(composer).toHaveText(draft)
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await notes.focus()
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-field-bounds-limit-before-'+width+'.png')})
    await writeFile(join(workspace!,'native-field-bounds-layout-'+width+'.json'),JSON.stringify(await notes.evaluate(control=>{
      const rect=(element:Element|null)=>element?.getBoundingClientRect().toJSON()
      const site=control.closest('[data-native-scroll-content]')?.parentElement
      return {field:rect(control.closest('label')),input:rect(control),alert:rect(control.closest('label')?.querySelector('[role=alert]')??null),site:rect(site??null),scrollTop:site?.scrollTop,viewport:{width:innerWidth,height:innerHeight}}
    })))
    await expect(card.getByRole('alert')).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-field-bounds-limit-'+width+'.png')})
  }
  const revised='  Reviewed release notes\n'+'detail '.repeat(1800)+'\nKeep trailing spaces.  '
  expect(revised.length).toBeLessThanOrEqual(16384)
  await notes.fill(revised)
  await expect.poll(async()=>(await receipts()).at(-1)).toMatchObject({kind:'change',value:revised})
  await expect(card.getByRole('alert')).toHaveCount(0)
  const geometry:Record<string,unknown>={}
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await notes.focus()
    await expect.poll(async()=>{
      const value=await notes.evaluate(control=>{
        const field=control.closest('label')!,site=control.closest('[data-native-scroll-content]')!.parentElement!,box=field.getBoundingClientRect(),bounds=site.getBoundingClientRect(),textarea=control as HTMLTextAreaElement
        return {fits:box.height<=site.clientHeight+1&&box.top>=bounds.top-1&&box.bottom<=bounds.bottom+1,fieldHeight:box.height,siteHeight:site.clientHeight,fieldTop:box.top,siteTop:bounds.top,rows:textarea.rows,valueLength:textarea.value.length}
      });geometry[String(width)]=value;return value.fits
    }).toBe(true)
    await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(composer).toHaveText(draft)
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-field-bounds-'+width+'.png')})
  }
  await notes.press('Enter')
  await expect.poll(async()=>(await receipts()).at(-1)).toMatchObject({kind:'submit',value:revised})
  await expect(card.getByText('Review notes saved',{exact:true})).toBeVisible()
  await expect(notes).toHaveValue(revised);await expect(composer).toHaveText(draft)
  expect((await receipts()).every((row:any)=>row.value===revised)).toBe(true)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((row:any)=>row.id)).toEqual(before.messages.map((row:any)=>row.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await tools.click()
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(composer).toHaveText(draft);await composer.fill('Continue after saving the review notes.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-field-bounds-proof.json'),JSON.stringify({sessionId,boundNativePid,drawnValueLength:initial.value.length,requestedRows:initial.rows,revised,receipts:await receipts(),geometry,retainedDraft:draft,noPhantomTurn:true,originalTurnCount:before.turns}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeFieldBounds:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
