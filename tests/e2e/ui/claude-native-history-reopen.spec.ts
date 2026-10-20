import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reopens saved native drawings under a fresh owner and refuses retired actions', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, ownerFailure } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(({ cwd, phase }) => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase }) }, { cwd: workspace!, phase: 'Edit' })
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  async function command(name: string, args = '') {
    const editor = card.locator('[contenteditable="true"]')
    await editor.fill(''); await editor.pressSequentially('/' + name)
    await appPage.locator('.command-suggestion-popup').getByText('/' + name, { exact: true }).click()
    if (args) await editor.pressSequentially(args)
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(editor).toHaveText('')
  }
  await command('cc-set-dir', workspace!)
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: state.nativeUiViews, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
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
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', {name:'Back to conversation',exact:true}).click()
  await appPage.locator('.cursor-row-resize').click({button:'right'})
  const composer=card.locator('[contenteditable="true"]')
  const expected=JSON.parse(await readFile(join(workspace!,'large-document-fixture.json'),'utf8'));
  const draft='Keep the release checklist draft while I inspect the migration registry.';
  const code=appPage.locator('[data-native-code-ansi]'),markdown=appPage.locator('[data-native-markdown-ansi]');
  async function document(kind:string){return appPage.evaluate(kind=>{
    const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const pending=Object.values(state.nativeUiViews).map((view:any)=>view.state);let count=0;
    while(pending.length&&++count<20000){const value:any=pending.pop();if(!value||typeof value!=='object')continue;if(value.kind===kind)return {kind:value.kind,source:value.source??value.text,nativeAnsi:value.nativeAnsi,formattingFallback:value.formattingFallback};pending.push(...Object.values(value).filter(value=>value&&typeof value==='object'));}return null;
  },kind)}

  async function guideCapability(){return appPage.evaluate(()=>{
    const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    for(const [mountId,view] of Object.entries(c.nativeUiViews) as any){if(view.threadId!==c.currentThread?.id||view.state.status!=='live')continue;const queue=[view.state];let count=0;while(queue.length&&++count<20000){const n:any=queue.pop();if(!n||typeof n!=='object')continue;if(n.kind==='button'&&n.label==='Guide'&&n.actionId)return {threadId:view.threadId,mountId,actionId:n.actionId};queue.push(...Object.values(n).filter(v=>v&&typeof v==='object'));}}
    return null;
  })}
  const callbacks=async()=>JSON.parse(await readFile(join(workspace!,'native-history-callbacks.json'),'utf8'));
  async function ledger(){
    for(const bucket of await readdir(join(workspace!,'.claude/projects'))){
      try{return (await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.type==='cost-state'&&row.sessionId===sessionId).at(-1)}
      catch(error:any){if(error.code!=='ENOENT')throw error}
    }
  }

  try{
    await composer.fill('Read the release checklist from the generated migration registry.');await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>readFile(join(workspace!,'large-read-ready'),'utf8').catch(()=>'' )).toBe('ready');await composer.fill(draft);await writeFile(join(workspace!,'release-large-read'),'ready');
    const approval=appPage.getByRole('region',{name:'Read approval',exact:true});await expect(approval).toBeVisible();await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toHaveCount(0);
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false);
    if(await code.count()===0)await appPage.getByRole('button',{name:'Expand tool activity',exact:true}).click();await expect(code).toHaveCount(1);
    await appPage.getByRole('button',{name:'Guide',exact:true}).click();await expect(markdown).toHaveCount(1);
    await expect(appPage.locator('[data-native-plugin-status]')).toContainText('Migration guide reviewed');await expect.poll(async()=>(await callbacks()).length).toBe(1);
    const retired=await guideCapability();expect(retired).toBeTruthy();
    await writeFile(join(workspace!,'native-history-initial-control-receipts.json'),await readFile(join(workspace!,'native-client-control-receipts.json')));
    const before=await context(),history=before.messages.filter((m:any)=>m.context?.cliUuid).map((m:any)=>({id:m.id,uuid:m.context.cliUuid,text:m.text,sender:m.sender}));expect(history.length).toBeGreaterThan(1);
    const nativeCost=before.claude.totalCostUsd,toolCallCount=before.claude.toolCallCount;expect(nativeCost).toBeGreaterThan(0);
    const checkpoint=ownerFailure?await ledger():undefined;if(ownerFailure)expect(checkpoint.totalCostUSD).toBe(nativeCost)
    let failure: { kind: string; pid: number; brokerPid: number; nativePid: number; at: number; retiredAt?: number } | undefined
    if(ownerFailure){
      const live=(await context()).native.state;expect(live.status).toBe('live');expect(live.nativePid).toBe(boundNativePid)
      const pid=ownerFailure==='native'?live.nativePid:live.pid;expect(pid).toBeGreaterThan(1);expect(pid).not.toBe(process.pid)
      failure={kind:ownerFailure,pid,brokerPid:live.pid,nativePid:live.nativePid,at:Date.now()};process.kill(pid,'SIGKILL')
      await expect.poll(async()=>(await context()).native.state.status).toBe('error')
      await expect.poll(()=>{try{process.kill(boundNativePid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true)
      failure.retiredAt=Date.now()
      await expect(composer).toHaveText(draft)
      await expect(section.getByRole('button',{name:'Use native interface',exact:true})).toBeEnabled()
      await expect(section.getByRole('status')).toContainText('disconnected unexpectedly')
      await expect(appPage.getByRole('button',{name:'Guide',exact:true})).toHaveCount(0)
      for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(section.getByRole('status')).toBeInViewport();await expect(section.getByRole('button',{name:'Use native interface',exact:true})).toBeInViewport();await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-owner-failure-'+width+'.png')})}
      await appPage.setViewportSize({width:1400,height:900})
    }else{
      await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft)
    }
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();
    let reopenNavigated=false,reopenTrusted=false
    await expect.poll(async()=>{const n=(await context()).native,screen=recognizeOnboardingPrompt(n?.output?.map((chunk:any)=>chunk.text).join('')??'',workspace);
      if(screen==='workspace-trust'&&!reopenNavigated){await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-history-reopen-trust.png')});reopenNavigated=true;await input.press('ArrowDown')}
      else if(screen==='workspace-trust-selected'&&reopenNavigated&&!reopenTrusted){reopenTrusted=true;await input.press('Enter')}
      return n?.state.status==='live'&&n.state.nativePid!==boundNativePid&&n.state.mainStatus?.includes(sessionId)
    },{timeout:25000,intervals:[250]}).toBe(true);
    const reopenedNativePid=(await context()).native.state.nativePid;expect(reopenedNativePid).not.toBe(boundNativePid);
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft);
    if(await code.count()===0&&await markdown.count()===0)await appPage.getByRole('button',{name:'Expand tool activity',exact:true}).click();
    await expect(code).toHaveCount(1,{timeout:15000});expect((await document('code')).source).toBe(expected.code);
    await expect(appPage.locator('[data-native-plugin-status]')).toHaveCount(0);
    const reopened=await context();expect(reopened.sessionId).toBe(sessionId);expect(reopened.threadId).toBe(before.threadId);expect(reopened.claude.totalCostUsd).toBe(nativeCost);expect(reopened.claude.toolCallCount).toBe(toolCallCount);if(ownerFailure){await expect(section.getByText(/disconnected unexpectedly/)).toHaveCount(0);expect((await ledger()).modelUsage).toEqual(checkpoint.modelUsage);}
    for(const old of history){const rows=reopened.messages.filter((m:any)=>m.context?.cliUuid===old.uuid);expect(rows).toHaveLength(1);expect({id:rows[0].id,uuid:rows[0].context.cliUuid,text:rows[0].text,sender:rows[0].sender}).toEqual(old);}
    const fresh=await guideCapability();expect(fresh).toBeTruthy();expect(fresh!.actionId).not.toBe(retired!.actionId);
    await appPage.evaluate(({current,old})=>{(window as any).applicationState.system.get('default-setup/threads').send({type:'CLAUDE_UI_PRESS',threadId:current.threadId,mountId:current.mountId,actionId:old.actionId})},{current:fresh!,old:retired!});
    await appPage.getByRole('button',{name:'Guide',exact:true}).click();await expect(markdown).toHaveCount(1);await expect.poll(async()=>(await callbacks()).length).toBe(2);
    expect((await callbacks()).map((v:any)=>v.tab)).toEqual(['guide','guide']);expect((await document('markdown')).source).toBe(expected.markdown);
    await expect(appPage.locator('[data-native-plugin-status]')).toContainText('Migration guide reviewed');
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      const last=markdown.locator('span').last();await expect.poll(async()=>{await last.evaluate(n=>n.scrollIntoView({block:'center'}));return last.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})}).toBe(true);await expect(last).toBeInViewport({ratio:1});
      await expect(composer).toHaveText(draft);await expect(card.getByTestId('composer-native-status')).toContainText('AppNativeMain '+sessionId);
      for(const target of [composer,card.getByRole('button',{name:'Send',exact:true})]){await expect(target).toBeInViewport();expect(await target.evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);}
      await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-history-reopen-'+width+'.png')});
    }
    await app.navigate('host/settings');await app.navigate('default-setup/threads');await expect(composer).toHaveText(draft);expect((await context()).native.state.nativePid).toBe(reopenedNativePid);
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();
    await composer.fill('Continue after reopening the saved migration review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');
    expect((await context()).sessionId).toBe(sessionId);const continuedCost=(await context()).claude.totalCostUsd;expect(continuedCost).toBeGreaterThan(nativeCost);const originalPrint=JSON.parse((await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').at(-1)!);expect(continuedCost).toBe(originalPrint.totalCostUsd);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'native-history-reopen-proof.json'),JSON.stringify({failure,checkpoint,history,retired,fresh,sessionId,boundNativePid,reopenedNativePid,nativeCost,toolCallCount,continuedCost,callbacks:await callbacks()},null,2));
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeHistoryReopened:true,nativeOwnerFailure:ownerFailure,nativeRetiredActionRefused:true,nativeLiveNoticeRetired:true,nativeHistoryIdentity:true,nativeLargeCode:true,nativeLargeMarkdown:true,nativeLargeNavigation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,nativeCost,continuedCost,browserErrors:errors},null,2));
  }catch(error){await writeFile(join(workspace!,'native-history-reopen-failure.json'),JSON.stringify(await context(),null,2));await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-history-reopen-failure.png')});throw error;}
});
