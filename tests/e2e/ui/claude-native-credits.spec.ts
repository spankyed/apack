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
test.afterEach(async ({appPage,electronApp},info) => {
  terminalScreen?.dispose(); terminalScreen=undefined
  if(workspace && info.status!==info.expectedStatus) {
    const state=await appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews)
    await writeFile(join(workspace,'native-credit-final-failure.json'),JSON.stringify({text:await appPage.locator('body').innerText(),views:state}))
    const win=await electronApp.browserWindow(appPage)
    const image=await win.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(workspace,'native-credit-final-failure.png'),Buffer.from(image,'base64'))
  }
})
test('uses original credit purchase previews, cancellation and typed consent', async ({app,appPage,electronApp},testInfo)=>{
  test.setTimeout(150000)
  expect(process.env.CLAUDE_RESEARCH_NATIVE_CREDITS).toBe('1')
  expect(process.env.HOME).toBe(workspace)
  const restriction=false
  async function replaceDraft(editor:import('@playwright/test').Locator,text:string){
    await editor.click();await editor.press('ControlOrMeta+A');await appPage.keyboard.insertText(text);await expect(editor).toHaveText(text)
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
  await replaceDraft(card.locator('[contenteditable="true"]'),'Review this project before choosing a credit-billed model.')
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

  const panel=appPage.getByRole('dialog',{name:'Claude Code model',exact:true})
  const send=card.getByRole('button',{name:'Send',exact:true})
  const draft='Keep my release-review draft while I review usage credits.'
  const receipts:any[]=[],captures:any[]=[]
  const ledger=async()=>JSON.parse(await readFile(join(workspace!,'native-credit-billing-live.json'),'utf8'))
  const nativeWindow=await electronApp.browserWindow(appPage)
  const choice=(value:string)=>panel.locator('[data-native-settings-option]').filter({hasText:new RegExp(value,'i')}).first()
  async function record(stage:string){
    const state=await context();expect(state.sessionId).toBe(sessionId);expect(state.native.state.nativePid).toBe(boundNativePid)
    const billing=await ledger();receipts.push({stage,sessionId,nativePid:boundNativePid,balance:billing.balance,purchases:billing.purchases.length,enabled:billing.enabled})
    await writeFile(join(workspace!,'native-credit-progress.json'),JSON.stringify({receipts,captures}))
  }
  async function capture(stage:string,reading:import('@playwright/test').Locator,controls:import('@playwright/test').Locator[]){
    for(const [width,height] of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});await reading.scrollIntoViewIfNeeded();await expect(reading).toBeInViewport({ratio:1})
      for(const control of controls){await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport({ratio:1})}
      const file=`native-credit-${stage}-${width}-${height}.png`
      const image=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height})
      await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'));captures.push({stage,width,height,file})
    }
  }
  async function open(){
    const direct=card.getByRole('button',{name:'Choose Claude model',exact:true})
    if(await direct.isVisible())await direct.click()
    else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Choose Claude model',exact:true}).click()}
    await expect(panel).toBeVisible();await expect(choice('Fable')).toBeVisible();await choice('Fable').click()
    await expect(choice('buy usage credits')).toBeVisible();await choice('buy usage credits').click()
    await expect(choice('Custom amount')).toBeVisible()
  }
  await replaceDraft(composer,draft);await composer.press('Home');await composer.press('ArrowRight')
  const selection=()=>composer.evaluate(element=>{const value=getSelection();return value&&element.contains(value.anchorNode)?{anchor:value.anchorOffset,focus:value.focusOffset}:null})
  const savedSelection=await selection();expect(savedSelection).not.toBeNull()
  await open();await record('bundles');await choice('Custom amount').click()
  const amount=panel.getByRole('textbox',{name:'Amount',exact:true})
  await expect(amount).toBeVisible();await amount.fill('1');await expect(panel.getByRole('alert')).toContainText('Minimum is');await expect(amount).toHaveAttribute('aria-invalid','true')
  await record('invalid-preview');expect(receipts.at(-1).purchases).toBe(0)
  await amount.fill('75');await expect(panel.locator('[aria-label="Claude Code setting editor"]').getByRole('status')).toContainText(/Buys .*75/);await expect(amount).not.toHaveAttribute('aria-invalid','true')
  await capture('amount-preview',amount,[panel.getByRole('button',{name:'Continue',exact:true})])
  await record('valid-preview');expect(receipts.at(-1).purchases).toBe(0)
  await panel.getByRole('button',{name:'Continue',exact:true}).click()
  const pay=panel.getByRole('button',{name:/Pay .*82.50.* now/})
  await expect(pay).toBeEnabled();await expect(panel.getByText(/Review tax/)).toBeVisible()
  await capture('quote',pay,[pay]);await record('quote');expect(receipts.at(-1).purchases).toBe(0)
  await pay.click();const confirmation=panel.getByRole('textbox',{name:'Confirmation',exact:true})
  await expect(confirmation).toBeVisible()
  const disclosure=await panel.innerText(),word=disclosure.match(/Type (\w+) to confirm[.]/)?.[1];expect(word).toBeTruthy()
  await confirmation.fill(word!);await expect(panel.locator('[aria-label="Claude Code setting editor"]').getByRole('status')).toHaveText(`Type ${word} to confirm.`)
  await capture('typed-consent',confirmation,[panel.getByRole('button',{name:'Confirm purchase',exact:true})]);await record('typed-not-submitted');expect(receipts.at(-1).purchases).toBe(0)
  // Backing out of the typed challenge must not charge or enable usage credits.
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();await expect(pay).toBeVisible();await record('cancel-charge');expect(receipts.at(-1).purchases).toBe(0);expect(receipts.at(-1).enabled).toBe(false)
  await pay.click();await confirmation.fill(word!);await panel.getByRole('button',{name:'Confirm purchase',exact:true}).click()
  await expect.poll(async()=>(await ledger()).purchases.length).toBe(1)
  await expect.poll(async()=>(await ledger()).enabled).toBe(true)
  const switchModel=panel.getByRole('button',{name:/^Yes, switch to Fable/})
  await expect(switchModel).toBeVisible();await expect(panel.locator('[aria-label="Claude Code setting editor"]')).toContainText('Your next response will be slower and use more tokens')
  await capture('model-confirmation',switchModel,[switchModel]);await switchModel.click()
  await expect(panel).toBeHidden();await expect(composer).toHaveText(draft);await expect.poll(selection).toEqual(savedSelection)
  await record('purchased');expect(receipts.at(-1).balance).toBe(7500)
  await capture('recovered',composer,[send])
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status,{timeout:15000}).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  let nativeCost=0
  for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));nativeCost=rows.filter(row=>row.type==='cost-state').at(-1)?.totalCostUSD??0;break}catch(error:any){if(error.code!=='ENOENT')throw error}}
  expect(nativeCost).toBeGreaterThan(0)
  await replaceDraft(composer,'Continue the same release review after usage-credit controls close.');await send.click()
  await expect.poll(async()=>(await context()).claude.chatState,{timeout:15000}).toBe('success')
  let resumedCost=0
  await expect.poll(async()=>{const rows=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const last=rows.at(-1);if(last?.sessionId!==sessionId||last.totalCostUsd<=nativeCost)return false;resumedCost=last.totalCostUsd;return (await context()).claude.totalCostUsd===resumedCost}).toBe(true)
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-credit-app.json'),JSON.stringify({sessionId,nativePid:boundNativePid,receipts,captures}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeCreditForms:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:(await context()).sessionId,boundNativePid,nativeCost,resumedCost,browserErrors:errors}))
})
