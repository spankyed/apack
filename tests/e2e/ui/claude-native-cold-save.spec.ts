import {resolveAppEnvironment} from '@apackdev/sdk/env'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('saves native launch, history and draft before a complete app shutdown', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, importReopen, startupCancel } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
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
    const before=await context(),history=before.messages.filter((m:any)=>m.context?.cliUuid).map((m:any)=>({id:m.id,uuid:m.context.cliUuid,text:m.text,sender:m.sender}));
    const nativeCost=before.claude.totalCostUsd;expect(nativeCost).toBeGreaterThan(0);
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft);
    let savedThreadId=before.threadId,savedHistory=history,savedLaunch:any,stagedModel:string|undefined,stagedPermissionMode='default';
    if(importReopen){
      await command('cc-reset');await expect.poll(async()=>(await context()).claude).toBeUndefined();
      await command('cc-import');await expect.poll(async()=>(await context()).messages.some((m:any)=>m.text==='Imported 1 sessions.')).toBe(true);
      await command('cc-resume',sessionId);await expect.poll(async()=>(await context()).threadId).not.toBe(before.threadId);
      const imported=await context();savedThreadId=imported.threadId;savedLaunch=imported.claude.nativeLaunch;
      expect(savedLaunch).toEqual({sessionId,cwd:workspace});expect(imported.claude.totalCostUsd).toBe(nativeCost);
      savedHistory=imported.messages.filter((m:any)=>m.context?.cliUuid).map((m:any)=>({id:m.id,uuid:m.context.cliUuid,text:m.text,sender:m.sender}));
      let journal:any[]=[];
      for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{journal=(await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);break}catch(error:any){if(error.code!=='ENOENT')throw error}}
      const canonicalHistory=history.map((old:any)=>{const row=journal.find(row=>row.uuid===old.uuid);expect(row).toBeTruthy();const content=row.message.content;const text=typeof content==='string'?content:content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');return {...old,text};});
      for(const old of canonicalHistory){const rows=savedHistory.filter((m:any)=>m.uuid===old.uuid);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({uuid:old.uuid,text:old.text,sender:old.sender});}
      expect(imported.claude.toolCallCount).toBe(before.claude.toolCallCount);
      await composer.fill(draft);
      await writeFile(join(workspace!,'native-import-history-before-reopen.json'),JSON.stringify({sourceThreadId:before.threadId,sourceHistory:canonicalHistory,sourceAppHistory:history,imported},null,2));
    }else{
    await command('cc-model','haiku');await expect.poll(async()=>(await context()).claude.modelOverride).toBe('haiku');
    await appPage.locator('.cursor-row-resize').click({button:'right'});
    await appPage.evaluate(threadId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId,restore:true}),before.threadId);
    const sessionArtifact=()=>appPage.evaluate(threadId=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return c.tabs.find((tab:any)=>tab.id===threadId)?.artifacts.find((a:any)=>a.type==='claude-session')?.id},before.threadId);
    await expect.poll(sessionArtifact).toBeTruthy();await appPage.evaluate(artifactId=>(window as any).applicationState.system.get('default-setup/threads').send({type:'SELECT_ARTIFACT',artifactId}),await sessionArtifact());
    await appPage.locator('summary').filter({hasText:'Details'}).click();
    await appPage.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(async()=>(await context()).claude.permissionMode).toBe('default');
    await appPage.locator('.cursor-row-resize').click({button:'right'});await composer.fill(draft);
    savedLaunch=(await context()).claude.nativeLaunch;expect(savedLaunch).toMatchObject({sessionId,cwd:workspace});expect(savedLaunch.allowedTools).toContain('Read');expect(savedLaunch.appendSystemPrompt).toContain('Implement only what the plan specifies');expect(savedLaunch).not.toHaveProperty('env');expect(savedLaunch).not.toHaveProperty('settings');expect(savedLaunch).not.toHaveProperty('worktree');
      stagedModel='haiku';
    }
    const api=JSON.parse(await readFile(resolveAppEnvironment({env:'test',userDataDir:join(workspace!,'app-data')}).apiPortFile,'utf8'));
    await writeFile(join(workspace!,'native-cold-state.json'),JSON.stringify({threadId:savedThreadId,sessionId,history:savedHistory,nativeCost,toolCallCount:before.claude.toolCallCount,retired,savedLaunch,stagedModel,stagedPermissionMode,importReopen,startupCancel,draft,boundNativePid,mainPid:electronApp.process().pid,apiPid:api.pid},null,2));
  }catch(error){await writeFile(join(workspace!,'native-cold-save-failure.json'),JSON.stringify(await context(),null,2));await appPage.screenshot({path:testInfo.outputPath('native-cold-save-failure.png')});throw error;}
});
