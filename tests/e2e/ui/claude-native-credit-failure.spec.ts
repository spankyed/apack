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
    await writeFile(join(workspace,'native-credit-failure-final-failure.json'),JSON.stringify({text:await appPage.locator('body').innerText(),views:state}))
    const win=await electronApp.browserWindow(appPage)
    const image=await win.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(workspace,'native-credit-failure-final-failure.png'),Buffer.from(image,'base64'))
  }
})
test('recovers the original failed bundle payment without credit or a model switch', async ({app,appPage,electronApp},testInfo)=>{
  test.setTimeout(150000)
  expect(process.env.CLAUDE_RESEARCH_NATIVE_CREDITS).toBe('1')
  const scenario=process.env.CLAUDE_RESEARCH_NATIVE_CREDIT_SCENARIO!;expect(['payment-failed','payment-action','payment-http-error']).toContain(scenario);const pendingInvoice=scenario==='payment-failed'
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
  await replaceDraft(card.locator('[contenteditable="true"]'),'Review this project before a usage-credit payment failure.')
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

  const panel=appPage.getByRole('dialog',{name:'Claude Code model',exact:true}),editor=panel.locator('[aria-label="Claude Code setting editor"]'),send=card.getByRole('button',{name:'Send',exact:true})
  const draft='Keep my payment-review draft if the payment fails.',receipts:any[]=[],captures:any[]=[],nativeWindow=await electronApp.browserWindow(appPage)
  const ledger=async()=>JSON.parse(await readFile(join(workspace!,'native-credit-billing-live.json'),'utf8'))
  const selection=()=>composer.evaluate(element=>{const value=getSelection();return value&&element.contains(value.anchorNode)?{anchor:value.anchorOffset,focus:value.focusOffset}:null})
  await replaceDraft(composer,draft);await composer.press('Home');await composer.press('ArrowRight');const savedSelection=await selection();expect(savedSelection).not.toBeNull()
  async function record(stage:string){const state=await context(),billing=await ledger();expect(state.sessionId).toBe(sessionId);expect(state.native.state.nativePid).toBe(boundNativePid);receipts.push({stage,sessionId,nativePid:boundNativePid,purchases:billing.purchases.length,balance:billing.balance,enabled:billing.enabled,paymentStatus:billing.purchaseStates['owned-purchase-1']?.status??null});await writeFile(join(workspace!,'native-credit-failure-progress.json'),JSON.stringify({receipts,captures}))}
  async function capture(stage:string,reading:import('@playwright/test').Locator,controls:import('@playwright/test').Locator[]){for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await reading.scrollIntoViewIfNeeded();await expect(reading).toBeInViewport({ratio:1});for(const control of controls){await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport({ratio:1})}const file=`native-credit-failure-${stage}-${width}-${height}.png`,image=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'));captures.push({stage,width,height,file})}}
  const direct=card.getByRole('button',{name:'Choose Claude model',exact:true});if(await direct.isVisible())await direct.click();else{await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Choose Claude model',exact:true}).click()}
  await panel.locator('[data-native-settings-option="fable"]').click();await expect(editor).toContainText('buy usage credits');await panel.locator('[data-native-settings-option="confirm"]').click()
  const bundle=panel.locator('[data-native-settings-option="p0"]');await expect(bundle).toContainText('$100');await expect(bundle).toContainText('Save 10%');await record('bundle');await capture('bundle',bundle,[bundle]);await bundle.click()
  const pay=panel.getByRole('button',{name:/Pay .*99.00.* now/});await expect(pay).toBeEnabled();await expect(editor).toContainText('Subtotal after discount: $90.00');await expect(editor).toContainText('Review tax (10%): $9.00');await record('quote');await capture('quote',pay,[pay]);await pay.click()
  const confirmation=panel.getByRole('textbox',{name:'Confirmation',exact:true});await expect(confirmation).toBeVisible();const word=(await editor.innerText()).match(/Type (\w+) to confirm[.]/)?.[1];expect(word).toBeTruthy()
  await confirmation.fill(word!);await expect(editor.getByRole('status')).toHaveText(`Type ${word} to confirm.`);await expect(editor).toContainText('Buy usage credits for $99.00.');await expect(editor).not.toContainText(/[┌┐└┘─│]/);await record('typed-not-submitted');expect(receipts.at(-1).purchases).toBe(0)
  await capture('typed-consent',confirmation,[panel.getByRole('button',{name:'Confirm purchase',exact:true})]);await panel.getByRole('button',{name:'Confirm purchase',exact:true}).click()
  if(pendingInvoice){
    const pending=panel.getByText('Confirming payment… (may take a few seconds)',{exact:true});await expect(pending).toBeVisible();await expect(panel.getByRole('button',{name:'Close',exact:true})).toBeDisabled();await expect(panel.locator('[data-native-settings-option]')).toHaveCount(0)
    await expect.poll(async()=>(await ledger()).requests.some((row:any)=>row.method==='GET'&&row.path.endsWith('/prepaid/commits/owned-purchase-1')&&row.waitingForRelease===true)).toBe(true);await record('payment-pending');expect(receipts.at(-1).balance).toBe(0);expect(receipts.at(-1).purchases).toBe(1)
    await capture('pending',pending,[panel.getByRole('button',{name:'Close',exact:true})]);await writeFile(join(workspace!,'native-credit-payment-release'),'release-owned-payment\n')
  }
  const failure=editor.locator('[data-native-settings-editor-body] > p').filter({hasText:pendingInvoice?/^Payment failed$/:scenario==='payment-action'?/^Your card requires additional verification — this purchase was not completed[.]/:/^Unexpected purchase state$/});await expect(failure).toBeVisible()
  const errorMessage=(await failure.innerText()).replace(/\s+/g,' ').trim()
  if(scenario==='payment-action')expect(errorMessage).toMatch(/^Your card requires additional verification — this purchase was not completed[.] Try again at https:\/\/claude[.]ai\/settings\/usage/)
  const cancel=panel.locator('[data-native-settings-option="cancel"]');await expect(cancel).toBeVisible();await expect(cancel).toBeFocused()
  await expect(panel.locator('[data-native-settings-option="confirm"]')).toContainText('open https://')
  await record('payment-failed');expect(receipts.at(-1).balance).toBe(0);expect(receipts.at(-1).paymentStatus).toBe(pendingInvoice?'failed':scenario==='payment-action'?'action_needed':'error')
  await capture('error',failure,[cancel]);await cancel.click()
  const keep=panel.locator('[data-native-settings-option="switch"]');await expect(keep).toHaveText('No, keep my current model')
  // The original kl/E0 input guard rejects decisions within 150ms of a credit-state transition.
  // A desktop click is a fresh intent; let that native guard settle before submitting it.
  await new Promise(resolve=>setTimeout(resolve,200));await keep.click()
  await expect(panel).toBeHidden();await expect(composer).toHaveText(draft);await expect.poll(selection).toEqual(savedSelection)
  const settings=JSON.parse(await readFile(join(workspace!,'.claude/settings.json'),'utf8'));expect(settings.model).toBeUndefined()
  await record('recovered');expect(receipts.at(-1).balance).toBe(0);expect(receipts.at(-1).purchases).toBe(1);expect(receipts.at(-1).enabled).toBe(true);await capture('recovered',composer,[send])
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.status,{timeout:15000}).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  let nativeCost=0
  for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{const rows=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));nativeCost=rows.filter(row=>row.type==='cost-state').at(-1)?.totalCostUSD??0;break}catch(error:any){if(error.code!=='ENOENT')throw error}}
  expect(nativeCost).toBeGreaterThan(0)
  await replaceDraft(composer,'Continue the same release review after the failed payment.');await send.click()
  await expect.poll(async()=>(await context()).claude.chatState,{timeout:15000}).toBe('success')
  let resumedCost=0
  await expect.poll(async()=>{const rows=(await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const last=rows.at(-1);if(last?.sessionId!==sessionId||last.totalCostUsd<=nativeCost)return false;resumedCost=last.totalCostUsd;return (await context()).claude.totalCostUsd===resumedCost}).toBe(true)
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-credit-failure-app.json'),JSON.stringify({scenario,errorMessage,sessionId,nativePid:boundNativePid,receipts,captures}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeCreditForms:true,nativeCreditFailure:true,nativeCreditPendingPayment:pendingInvoice,nativeCreditFailureScenario:scenario,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:(await context()).sessionId,boundNativePid,nativeCost,resumedCost,browserErrors:errors}))
})
