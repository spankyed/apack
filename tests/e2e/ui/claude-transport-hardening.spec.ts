import {test,expect} from '@apackdev/testing'
import {mkdtemp,readFile,writeFile,chmod,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'

test.skip(!process.env.CLAUDE_CONFIG_DIR?.match(/^\/(?:private\/)?tmp\/apack-transport-config-/), 'Explicit owned protocol fixture config required')

test.afterEach(async({appPage},info)=>{if(info.status!==info.expectedStatus){
 await appPage.screenshot({path:info.outputPath('failure.png')})
 await writeFile(info.outputPath('failure-state.json'),JSON.stringify(await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {nativeUiViews:c.nativeUiViews,thread:c.currentThread,card:document.querySelector('[data-onboarding-id="agent-chat-input"]')?.textContent,forms:[...document.querySelectorAll('[data-composer-form]')].map(f=>({valid:(f as HTMLFormElement).checkValidity(),html:f.outerHTML}))}})))
}})

test('shows native billing observations and honest stream recovery in the actual app',async({app,appPage},testInfo)=>{
 test.setTimeout(120000)
 const workspace=await mkdtemp(join(tmpdir(),'apack-transport-'))
 const launcher=join(workspace,'claude-fixture')
 await writeFile(launcher,`#!${process.execPath}\n`+await readFile(resolve('tests/e2e/fixtures/claude-transport.cjs'),'utf8'));await chmod(launcher,0o700)
 const errors:string[]=[];appPage.on('pageerror',error=>errors.push(error.message))
 try {
  await app.waitForSurface('default-setup/threads');await app.navigate('host/settings')
  await appPage.evaluate(()=>{const actor=(window as any).applicationState.system.get('host/settings');actor.send({type:'TAB.SELECT',tab:'general'});actor.send({type:'GENERAL_NAV.SELECT',item:'secrets'})})
  const provider=appPage.getByText('Claude Code CLI',{exact:true}).locator('..').locator('..').locator('..')
  const override=provider.getByPlaceholder('Path override (auto-detected if empty)');await override.fill(launcher);await override.blur()
  // FEATURE_SETTINGS_UPDATED follows the committed backend write; do not navigate
  // away while the form's 600ms save debounce is still pending.
  await expect.poll(()=>appPage.evaluate(()=>(window as any).applicationState.system.get('default-setup/code')?.getSnapshot().context.settings?.cliPaths?.['claude-code'])).toBe(launcher)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd=>{const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'NEW_THREAD_IN_PROJECT',directory:cwd});actor.send({type:'VIEW_DASHBOARD'});actor.send({type:'SET_MODE',mode:'Claude Code'});actor.send({type:'SET_PHASE',phase:'Edit'})},workspace)
  const card=appPage.locator('[data-onboarding-id="agent-chat-input"]'),editor=card.locator('[contenteditable="true"]'),billing=card.getByTestId('claude-billing-status')
  const state=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {claude:c.currentThread?.context?.claudeCode,messages:c.currentThread?.messages}})
  const send=async(text:string,turns:number)=>{await editor.fill(text);if(turns>1)await expect.poll(()=>appPage.evaluate(expected=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return Object.values(c.nativeUiViews).some((v:any)=>v.threadId===c.currentThread?.id&&v.prompt?.status==='applied'&&v.prompt.revision===v.promptRevision&&v.prompt.frame.text.includes(expected))},text)).toBe(true);await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await state()).claude?.turns).toBe(turns);await expect.poll(async()=>(await state()).claude?.chatState).toBe('success')}
  await send('Review release notes with a usage warning.',1);await expect(billing).toContainText('Usage limit warning');const session=(await state()).claude.sessionId
  await editor.fill('Keep this release checklist draft.')
  for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?650:900});await expect(billing).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath(`billing-warning-${width}.png`)})}
  const captureBilling=async(name:string)=>{for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?650:900});await expect(billing).toBeInViewport({ratio:1});await appPage.screenshot({path:testInfo.outputPath(`${name}-${width}.png`)})}}
  await send('Report credits on the request.',2);await expect(billing).toContainText('Usage credits charged on the reported request');await captureBilling('billing-credits')
  await send('Report a rejected request limit.',3);await expect(billing).toContainText('Usage limit reached');await captureBilling('billing-rejected')
  await send('Recover a missing suffix.',4);await expect(appPage.getByText('Release checklist reviewed successfully.',{exact:true}).last()).toBeVisible()
  await send('Exercise a conflict.',5);await expect(appPage.getByText('Claude response display is inconsistent with its completed native message.',{exact:false})).toBeVisible()
  const conflicting=(await state()).messages.find((m:any)=>m.context?.claudeStreamReconciliation?.kind==='conflict');expect(conflicting).toBeTruthy()
  expect(conflicting.text).toBe('Partial displayed answer.')
  expect(conflicting.context.claudeStreamCompletedRecord.text).toBe('Completed native answer differs.')
  expect(conflicting.context.claudeNativeMessages ?? []).toHaveLength(0)
  expect((await state()).claude.toolCallCount).toBe(0)
  const warning=appPage.getByText('Claude response display is inconsistent with its completed native message.',{exact:false})
  for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?650:900});await warning.scrollIntoViewIfNeeded();await expect(warning).toBeInViewport({ratio:1});await appPage.screenshot({path:testInfo.outputPath(`reconciliation-conflict-${width}.png`)})}
  await send('Continue the release review.',6);expect((await state()).claude.sessionId).toBe(session)
  await editor.fill('Keep this release checklist draft.')
  for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?650:900});await expect(editor).toHaveText('Keep this release checklist draft.');await appPage.screenshot({path:testInfo.outputPath(`reconciliation-recovery-${width}.png`)})}
  await appPage.evaluate(cwd=>{const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'NEW_THREAD_IN_PROJECT',directory:cwd});actor.send({type:'VIEW_DASHBOARD'});actor.send({type:'SET_MODE',mode:'Claude Code'});actor.send({type:'SET_PHASE',phase:'Edit'})},workspace)
  await expect.poll(async()=>(await state()).claude?.sessionId).not.toBe(session)
  await send('Start a fresh review without a billing observation.',1)
  const freshSession=(await state()).claude.sessionId;expect(freshSession).not.toBe(session)
  await expect(billing).toContainText('Billing status unknown');await captureBilling('billing-new-owner')
  expect(errors).toEqual([])
  await writeFile(testInfo.outputPath('transport-proof.json'),JSON.stringify({actualApp:true,authoredProtocolFixture:true,realModelRequests:0,sessionId:session,turns:6,freshSessionId:freshSession,freshOwnerUnknown:true,normalAndCompact:true,browserErrors:errors}))
 } finally {await writeFile(testInfo.outputPath('protocol-receipts.jsonl'),await readFile(join(process.env.CLAUDE_CONFIG_DIR!,'protocol-receipts.jsonl'),'utf8').catch(()=>''));await rm(workspace,{recursive:true,force:true})}
})
