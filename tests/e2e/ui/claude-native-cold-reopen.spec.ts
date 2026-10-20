import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {resolveAppEnvironment} from '@apackdev/sdk/env'
import {test,expect} from '@apackdev/testing'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,onboarding=process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace||!onboarding,'Explicit private native cold-reopen fixture required')
test('cold reopens the saved native session without an invented model turn',async({app,appPage,electronApp},testInfo)=>{
 test.setTimeout(90000)
 const saved=JSON.parse(await readFile(join(workspace!,'native-cold-state.json'),'utf8')),expected=JSON.parse(await readFile(join(workspace!,'large-document-fixture.json'),'utf8'));
 const {sessionId,draft,boundNativePid}=saved;
 const {recognizeOnboardingPrompt}=await import(pathToFileURL(onboarding!).href);
 const errors:string[]=[];appPage.on('pageerror',e=>errors.push(e.message));
 expect(electronApp.process().pid).not.toBe(saved.mainPid);
 const api=JSON.parse(await readFile(resolveAppEnvironment({env:'test',userDataDir:join(workspace!,'app-data')}).apiPortFile,'utf8'));expect(api.pid).not.toBe(saved.apiPid);
 for(const pid of [saved.mainPid,saved.apiPid]){let live=false;try{execFileSync('/bin/ps',['-p',String(pid),'-o','pid='],{stdio:'pipe'});live=true}catch(error:any){expect(error.status).toBe(1)}expect(live).toBe(false)}
 await app.waitForPlugin('default-setup/threads');await app.navigate('default-setup/threads');
 await appPage.evaluate(id=>(window as any).applicationState.system.get('default-setup/threads').send({type:'OPEN_THREAD_CHAT',threadId:id,restore:true}),saved.threadId);
 const card=appPage.locator('[data-onboarding-id="agent-chat-input"]'),composer=card.locator('[contenteditable="true"]');
 const section=appPage.getByRole('region',{name:'Claude native interface',exact:true}),input=section.locator('textarea.xterm-helper-textarea');
 const code=appPage.locator('[data-native-code-ansi]'),markdown=appPage.locator('[data-native-markdown-ansi]');
 const context=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {phase:c.phase,mode:c.mode,threadId:c.currentThread?.id,sessionId:c.currentThread?.context?.claudeCode?.sessionId,claude:c.currentThread?.context?.claudeCode,messages:c.currentThread?.messages,ui:c.nativeUiViews,native:Object.values(c.nativeTerminalViews).find((v:any)=>v.threadId===c.currentThread?.id)} as any});
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
 await expect.poll(async()=>(await context()).threadId).toBe(saved.threadId);
 await appPage.locator('.cursor-row-resize').click({button:'right'});await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
 expect((await context()).claude.nativeLaunch).toEqual(saved.savedLaunch);
 expect((await readFile(join(workspace!,'native-children.jsonl'),'utf8')).trim().split('\n')).toHaveLength(2);
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();
    let reopenNavigated=false,reopenTrusted=false
    await expect.poll(async()=>{const n=(await context()).native,screen=recognizeOnboardingPrompt(n?.output?.map((chunk:any)=>chunk.text).join('')??'',workspace);
      if(screen==='workspace-trust'&&!reopenNavigated){await appPage.screenshot({path:testInfo.outputPath('native-cold-reopen-trust.png')});reopenNavigated=true;await input.press('ArrowDown')}
      else if(screen==='workspace-trust-selected'&&reopenNavigated&&!reopenTrusted){reopenTrusted=true;await input.press('Enter')}
      return n?.state?.status==='live'&&n.state.nativePid!==boundNativePid&&n.state.mainStatus?.includes(sessionId)
    },{timeout:25000,intervals:[250]}).toBe(true);
    const reopenedNativePid=(await context()).native.state.nativePid;expect(reopenedNativePid).not.toBe(boundNativePid);
    await expect.poll(async()=>(await context()).native.state.session?.permissionMode).toBe(saved.stagedPermissionMode);if(saved.stagedModel){await expect.poll(async()=>(await context()).native.state.session?.model).toMatch(/haiku/i);expect((await context()).claude.modelOverride).toBe(saved.stagedModel);}
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft);
    if(await code.count()===0&&await markdown.count()===0)await appPage.getByRole('button',{name:'Expand tool activity',exact:true}).click();
    await expect(code).toHaveCount(1,{timeout:15000});expect((await document('code')).source).toBe(expected.code);
    await expect(appPage.locator('[data-native-plugin-status]')).toHaveCount(0);
    const reopened=await context();expect(reopened.sessionId).toBe(sessionId);expect(reopened.threadId).toBe(saved.threadId);expect(reopened.claude.totalCostUsd).toBe(saved.nativeCost);expect(reopened.claude.toolCallCount).toBe(saved.toolCallCount);
    expect(reopened.messages.filter((m:any)=>m.context?.cliUuid).map((m:any)=>m.context.cliUuid)).toEqual(saved.history.map((m:any)=>m.uuid));
    for(const old of saved.history){const rows=reopened.messages.filter((m:any)=>m.context?.cliUuid===old.uuid);expect(rows).toHaveLength(1);expect({id:rows[0].id,uuid:rows[0].context.cliUuid,text:rows[0].text,sender:rows[0].sender}).toEqual(old);}
    const fresh=await guideCapability();expect(fresh).toBeTruthy();expect(fresh!.actionId).not.toBe(saved.retired.actionId);
    await appPage.evaluate(({current,old})=>{(window as any).applicationState.system.get('default-setup/threads').send({type:'CLAUDE_UI_PRESS',threadId:current.threadId,mountId:current.mountId,actionId:old.actionId})},{current:fresh!,old:saved.retired});
    await appPage.getByRole('button',{name:'Guide',exact:true}).click();await expect(markdown).toHaveCount(1);await expect.poll(async()=>(await callbacks()).length).toBe(2);
    expect((await callbacks()).map((v:any)=>v.tab)).toEqual(['guide','guide']);expect((await document('markdown')).source).toBe(expected.markdown);
    await expect(appPage.locator('[data-native-plugin-status]')).toContainText('Migration guide reviewed');
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      const last=markdown.locator('span').last();await expect.poll(async()=>{await last.evaluate(n=>n.scrollIntoView({block:'center'}));return last.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})}).toBe(true);await expect(last).toBeInViewport({ratio:1});
      await expect(composer).toHaveText(draft);await expect(card.getByTestId('composer-native-status')).toContainText('AppNativeMain '+sessionId);
      for(const target of [composer,card.getByRole('button',{name:'Send',exact:true})]){await expect(target).toBeInViewport();expect(await target.evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);}
      await appPage.screenshot({path:testInfo.outputPath('native-cold-reopen-'+width+'.png')});
    }
    await app.navigate('host/settings');await app.navigate('default-setup/threads');await expect(composer).toHaveText(draft);expect((await context()).native.state.nativePid).toBe(reopenedNativePid);
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();
    await composer.fill('Continue after reopening the saved migration review.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');
    expect((await context()).sessionId).toBe(sessionId);const continuedCost=(await context()).claude.totalCostUsd;expect(continuedCost).toBeGreaterThan(saved.nativeCost);const originalPrint=JSON.parse((await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').at(-1)!);expect(continuedCost).toBe(originalPrint.totalCostUsd);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'native-history-reopen-proof.json'),JSON.stringify({history:saved.history,retired:saved.retired,fresh,sessionId,boundNativePid,reopenedNativePid,nativeCost:saved.nativeCost,toolCallCount:reopened.claude.toolCallCount,continuedCost,callbacks:await callbacks(),coldMainPid:electronApp.process().pid,coldApiPid:api.pid,priorMainPid:saved.mainPid,priorApiPid:saved.apiPid},null,2));
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeColdReopen:true,nativeImportedHistoryReopened:saved.importReopen===true,nativeHistoryReopened:true,nativeRetiredActionRefused:true,nativeLiveNoticeRetired:true,nativeHistoryIdentity:true,nativeLargeCode:true,nativeLargeMarkdown:true,nativeLargeNavigation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,nativeCost:saved.nativeCost,continuedCost,browserErrors:errors},null,2));
  }catch(error){await writeFile(join(workspace!,'native-cold-reopen-failure.json'),JSON.stringify(await context(),null,2));await appPage.screenshot({path:testInfo.outputPath('native-cold-reopen-failure.png')});throw error;}
});
