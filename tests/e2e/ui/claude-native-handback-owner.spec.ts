import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('shows the original native-owner handback report and returns to the retained parent draft', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const noticeCancel=process.env.CLAUDE_RESEARCH_BILLING_NOTICE_CANCEL==='1'
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
  const expected=JSON.parse(await readFile(join(workspace!,'handback-fixture.json'),'utf8')).report;
  const original=async()=>JSON.parse(await readFile(join(workspace!,'native-handback-state.json'),'utf8')).tasks;
  const draft='Keep the parent release-review draft while I read the Agent report.';
  try{
    await composer.fill('Review the release notes with a worker and return its report.');
    await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='running'),{timeout:15000}).toBe(true);
    await composer.fill(draft);
    await writeFile(join(workspace!,'native-pending-duration-release'),'ready');
    const dialogs=async()=>JSON.parse(await readFile(join(workspace!,'native-dialog-shapes.json'),'utf8')).events;
    await expect.poll(async()=>(await dialogs()).some((event:any)=>event.value?.open?.some((item:any)=>item.kind==='auto_mode_server_fallback'))).toBe(true);
    const notice=(await dialogs()).flatMap((event:any)=>event.value?.open??[]).find((item:any)=>item.kind==='auto_mode_server_fallback');
    expect(notice.payload.title).toContain("We're changing auto mode");
    const noticeCard=appPage.getByRole('region',{name:'Claude auto mode notice',exact:true});
    await expect(noticeCard).toContainText(notice.payload.title);
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      await expect(noticeCard.getByRole('button',{name:'Continue in auto mode',exact:true})).toBeInViewport();
      await expect(composer).toBeInViewport();
      await expect(composer).toHaveText(draft);
      await appPage.screenshot({path:testInfo.outputPath('native-handback-gateway-notice-'+width+'.png')});
    }
    if(noticeCancel){
      await noticeCard.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect.poll(async()=>(await dialogs()).some((event:any)=>event.type==='closed'&&event.value?.id===notice.id&&event.value?.result==='interrupt')).toBe(true);
      await expect(noticeCard).toHaveCount(0);
      await expect.poll(async()=>(await context()).native.state.tasks.every((task:any)=>['completed','failed','killed'].includes(task.status)),{timeout:20000}).toBe(true);
      expect((await original()).some((task:any)=>task.handbackReport)).toBe(false);
      await expect(composer).toHaveText(draft);
      await writeFile(join(workspace!,'native-billing-notice-cancel-proof.json'),JSON.stringify({notice,original:await original(),draft,dialogs:await dialogs()},null,2));
      await section.getByRole('button',{name:'Use native interface',exact:true}).click();
      await section.getByRole('button',{name:'Stop session',exact:true}).click();
      await expect.poll(async()=>(await context()).native.state.status).toBe('exited');
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click();
      await composer.fill('Continue the release review after cancelling the auto mode notice.');
      await card.getByRole('button',{name:'Send',exact:true}).click();
      await expect.poll(async()=>(await context()).claude.chatState).toBe('success');
      expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);
      await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'agent-layout',nativeBillingNoticeCancel:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2));
      return;
    }
    await noticeCard.getByRole('button',{name:'Continue in auto mode',exact:true}).click();
    await expect.poll(async()=>(await dialogs()).some((event:any)=>event.type==='closed'&&event.value?.id===notice.id&&event.value?.result==='continue')).toBe(true);
    await expect(noticeCard).toHaveCount(0);
    await expect(composer).toHaveText(draft);
    await expect.poll(async()=>(await original()).some((task:any)=>task.handbackReport?.text===expected),{timeout:25000}).toBe(true);
    const task=(await original()).find((task:any)=>task.handbackReport?.text===expected);
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false);
    await appPage.getByRole('button',{name:/^Native tools/}).first().click();
    const row=appPage.locator('[data-native-agent-id="'+task.id+'"]');await expect(row).toBeVisible();
    await row.getByRole('button',{name:'View Agent conversation',exact:true}).click();
    const conversation=row.getByRole('region',{name:'Agent conversation',exact:true});
    const report=conversation.getByRole('region',{name:'Agent report',exact:true});
    await expect(report).toContainText(expected);await expect(report.getByRole('alert')).toHaveText(task.handbackReport.warning);
    const details=(await context()).native.task.details;
    expect(details.handback).toEqual({taskId:task.id,...task.handbackReport});
    await row.getByRole('button',{name:'Hide Agent conversation',exact:true}).click();
    await row.getByRole('button',{name:'Open Agent',exact:true}).click();
    const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true});
    await expect(focused).toBeVisible();
    const transcript=focused.getByRole('region',{name:'Agent transcript',exact:true});
    const focusedReport=transcript.getByRole('region',{name:'Agent report',exact:true});
    await expect(focusedReport).toContainText(expected);await expect(focusedReport.getByRole('alert')).toHaveText(task.handbackReport.warning);
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      await focusedReport.getByText('Check the migration example before publishing.',{exact:false}).scrollIntoViewIfNeeded();
      await expect(focusedReport.getByText('Check the migration example before publishing.',{exact:false})).toBeInViewport();
      await expect(focused.getByRole('button',{name:'Back to conversation',exact:true})).toBeInViewport();
      await appPage.screenshot({path:testInfo.outputPath('native-handback-owner-'+width+'.png')});
    }
    await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();
    await expect(composer).toHaveText(draft);await expect(card.getByTestId('composer-native-status')).toContainText('AppNativeMain '+sessionId);
    expect((await context()).native.state.nativePid).toBe(boundNativePid);
    await writeFile(join(workspace!,'native-handback-owner-proof.json'),JSON.stringify({original:task,details,draft,notice,sameNativeOwner:true},null,2));
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();
    await section.getByRole('button',{name:'Stop session',exact:true}).click();
    await expect.poll(async()=>(await context()).native.state.status).toBe('exited');
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();
    await composer.fill('Continue the release review after reading the Agent report.');
    await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>(await context()).claude.chatState).toBe('success');
    expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'agent-layout',nativeHandbackOwnerReport:true,nativeHandbackOwnerReturn:true,nativeHandbackOwnerContinuation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2));
  }catch(error){
    await writeFile(join(workspace!,'native-handback-owner-failure.json'),JSON.stringify(await context(),null,2));
    await appPage.screenshot({path:testInfo.outputPath('native-handback-owner-failure.png')});throw error;
  }
});
