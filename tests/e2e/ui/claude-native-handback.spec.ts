import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@apackdev/testing';

const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE;
const launcher = process.env.CLAUDE_RESEARCH_LAUNCHER;
const endpoint = process.env.CLAUDE_RESEARCH_MODEL_URL;
test.skip(!workspace || !launcher || !endpoint, 'Explicit private native research fixture required');

test('shows the original Agent handback report and warning with parent continuation', async ({ app, appPage }, testInfo) => {
  expect(process.env.HOME).toBe(workspace);
  expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  const errors: string[] = [];
  appPage.on('pageerror', error => errors.push(error.message));
  await app.waitForPlugin('default-setup/threads');
  await app.navigate('default-setup/threads');
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.forcedMode)).toBe('Birth');
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
  });
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..');
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!);
  // CLI paths save after the form's 600ms debounce; remount to verify persisted state.
  await appPage.waitForTimeout(700);
  await app.navigate('default-setup/threads');
  await app.navigate('host/settings');
  await expect(provider.getByPlaceholder('Path override (auto-detected if empty)')).toHaveValue(launcher!);
  await app.navigate('default-setup/threads');
  await appPage.evaluate(cwd => {
    const threads = (window as any).applicationState.system.get('default-setup/threads');
    threads.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd });
    threads.send({ type: 'VIEW_DASHBOARD' });
    threads.send({ type: 'SET_MODE', mode: 'Claude Code' });
    threads.send({ type: 'SET_PHASE', phase: 'Edit' });
  }, workspace!);
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]');
  const editor = card.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('Delegate the release review and bring its report back here.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  const expectedReport=JSON.parse(await readFile(join(workspace!,'handback-fixture.json'),'utf8')).report;
  const snapshot=()=>appPage.evaluate(()=>{
    const thread=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread;
    return {threadId:thread?.id,sessionId:thread?.context?.claudeCode?.sessionId,turns:thread?.context?.claudeCode?.turns,state:thread?.context?.claudeCode?.chatState,messages:thread?.messages};
  });
  const wire=async()=> (await readFile(join(workspace!,'handback-native-events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const draft='Keep my release notes while the Agent reports back.';
  try {
    await expect.poll(async()=>(await snapshot()).turns).toBe(1);
    const before=await snapshot();expect(before.sessionId).toBeTruthy();
    await expect(editor).toBeVisible();await editor.fill(draft);
    await writeFile(join(workspace!,'release-handback'),'ready');
    const report=appPage.getByRole('region',{name:'Agent report',exact:true});
    await expect(report).toHaveCount(1,{timeout:25000});
    await expect(report).toContainText(expectedReport);
    await expect(report.getByRole('alert')).toContainText('unavailable');
    await expect.poll(async()=>(await snapshot()).turns).toBeGreaterThanOrEqual(2);
    await expect.poll(async()=>(await snapshot()).state).toBe('success');
    const completed=await snapshot();
    const nativeResults=(await wire()).filter((e:any)=>e.type==='result');
    const nativeTurns=nativeResults.filter((e:any)=>e.num_turns!==0);
    expect(nativeResults.filter((e:any)=>e.num_turns===0&&e.result==='')).toHaveLength(1);
    expect(completed.turns).toBe(nativeTurns.length);
    const handbackEvent=(await wire()).find((e:any)=>e.type==='system'&&e.subtype==='task_notification'&&e.handback_report);
    expect(handbackEvent.handback_report.text).toBe(expectedReport);
    const personMessages=completed.messages.filter((m:any)=>m.sender==='user');
    expect(personMessages).toHaveLength(1);
    expect(completed.messages.filter((m:any)=>!m.deleted&&m.text==='Thinking…')).toHaveLength(0);
    const entries=completed.messages.flatMap((m:any)=>(m.blocks??[]).filter((b:any)=>b.type==='tool-activity').flatMap((b:any)=>b.props.entries??[]));
    const delivered=entries.filter((e:any)=>e.handback);
    expect(delivered).toHaveLength(1);expect(delivered[0].id).toBe('status_agent_fixture');
    expect(delivered[0].handback.text).toBe(expectedReport);
    expect(delivered[0].handback).toEqual({taskId:handbackEvent.task_id,runId:handbackEvent.run_id,...handbackEvent.handback_report});
    expect(handbackEvent.tool_use_id).toBe(delivered[0].id);
    expect(delivered[0].handback.taskId).toBe(await report.getAttribute('data-native-handback-task'));
    expect(delivered[0].handback.warning).toBe(await report.getByRole('alert').textContent());
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      await report.scrollIntoViewIfNeeded();
      await expect(report).toBeInViewport();await expect(editor).toHaveText(draft);
      for(const target of [editor,card.getByRole('button',{name:'Send',exact:true})]){
        await expect(target).toBeInViewport();
        expect(await target.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);
      }
      await appPage.screenshot({path:testInfo.outputPath('native-handback-'+width+'.png')});
      if(width===680){
        const body=report.locator('div.whitespace-pre-wrap').last();
        await body.evaluate(node=>node.scrollIntoView({block:'end'}));
        await expect.poll(()=>body.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.bottom-4))})).toBe(true);
        await expect(editor).toHaveText(draft);
        await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
        await appPage.screenshot({path:testInfo.outputPath('native-handback-680-report-end.png')});
      }
    }
    await app.navigate('host/settings');await app.navigate('default-setup/threads');
    await expect(report).toHaveCount(1);await expect(report).toContainText(expectedReport);
    await expect(editor).toHaveText(draft);
    await editor.fill('Continue the release review after reading the Agent report.');
    await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>(await snapshot()).turns).toBe(completed.turns+1);
    await expect.poll(async()=>(await snapshot()).state).toBe('success');
    const after=await snapshot();expect(after.messages.filter((m:any)=>m.sender==='user')).toHaveLength(2);expect(after.sessionId).toBe(before.sessionId);expect(after.threadId).toBe(before.threadId);
    await expect(report).toHaveCount(1);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'composer-app-evidence.json'),JSON.stringify({actualApp:true,nativeHandbackReport:true,nativeHandbackWarning:true,nativeHandbackParentContinuation:true,nativeRetainedDraft:true,before:{sessionId:before.sessionId,turns:before.turns},after:{sessionId:after.sessionId,turns:after.turns},handback:delivered[0].handback,nativeResults:nativeResults.map((e:any)=>({uuid:e.uuid,result:e.result,subtype:e.subtype,num_turns:e.num_turns})),handbackEvent,errors},null,2));
  }catch(error){
    await writeFile(join(workspace!,'native-handback-app-failure.json'),JSON.stringify(await snapshot(),null,2));
    await appPage.screenshot({path:testInfo.outputPath('native-handback-failure.png')});throw error;
  }
});
