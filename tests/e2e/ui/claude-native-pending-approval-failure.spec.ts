import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('retires a crashed pending approval and permits a fresh same-session decision', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, pendingApprovalFailure } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: state.nativeUiViews, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  ;(globalThis as any).self ??= globalThis
  const {Terminal}=createRequire(import.meta.url)('@app/claude-terminal-xterm')
  let terminalScreen: import('@xterm/xterm').Terminal | undefined, screenOwner: string | undefined,lastSequence=0
  async function screenText(native:any){
    if(!native?.state?.ownerId)return ''
    if(screenOwner!==native.state.ownerId){
      const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'))
      const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(native.state.ownerId)).at(-1)
      const columns=row?.match(/columns:\s*(\d+)/)?.[1];if(!columns)return ''
      terminalScreen?.dispose();terminalScreen=new Terminal({cols:Number(columns),rows:200,allowProposedApi:true});screenOwner=native.state.ownerId;lastSequence=0
    }
    const chunks=native.output.filter((chunk:any)=>chunk.sequence>lastSequence)
    if(chunks.length){await new Promise<void>(resolve=>terminalScreen!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));lastSequence=chunks.at(-1).sequence}
    const buffer=terminalScreen!.buffer.active
    return Array.from({length:terminalScreen!.rows},(_,row)=>buffer.getLine(buffer.baseY+row)?.translateToString(true)??'').join('\n')
  }

  let theme = false, security = false, navigated = false, trusted = false
  await expect.poll(async () => {
    const current = await context(), native = current.native
    const text = await screenText(native)
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
  expect(['native','broker','cancel']).toContain(pendingApprovalFailure)
  const draft='Keep my unsent release summary while recovering this approval.'
  const approval=appPage.getByRole('region',{name:'Read approval',exact:true})
  const controls=async()=>JSON.parse(await readFile(join(workspace!,'native-client-control-receipts.json'),'utf8').catch(()=>'[]'))
  async function journal(){
    for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{return (await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))}catch(error:any){if(error.code!=='ENOENT')throw error}}
    return []
  }
  try{
    await composer.fill('Read the release checklist before writing the release summary.');await card.getByRole('button',{name:'Send',exact:true}).click()
    await expect.poll(async()=>readFile(join(workspace!,'large-read-ready'),'utf8').catch(()=>'')).toBe('ready')
    await composer.fill(draft);await writeFile(join(workspace!,'release-large-read'),'ready');await expect(approval).toBeVisible()
    const before=await context(),retired=before.claude.pendingControlRequest;expect(retired.nativeTerminal.ownerId).toBe(before.native.state.ownerId)
    const history=before.messages.filter((row:any)=>row.context?.cliUuid).map((row:any)=>({id:row.id,uuid:row.context.cliUuid,text:row.text,sender:row.sender}))
    const nativeCost=before.claude.totalCostUsd;expect(nativeCost).toBeGreaterThan(0)
    expect((await controls()).filter((row:any)=>row.request.subtype==='apack_answer_file_dialog')).toHaveLength(0)
    for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(approval.getByRole('button',{name:'Approve',exact:true})).toBeInViewport();const transcript=appPage.getByTestId('chat-transcript');await expect(transcript).toBeVisible();expect((await transcript.boundingBox())!.height).toBeGreaterThan(80);const approvalBox=(await approval.boundingBox())!;expect(approvalBox.height).toBeLessThan(width===680?380:580);expect(approvalBox.height).toBeGreaterThan(240);for(const name of ['Cancel','Deny','Approve']){const bounds=(await approval.getByRole('button',{name,exact:true}).boundingBox())!;expect(bounds.y+bounds.height).toBeLessThanOrEqual(approvalBox.y+approvalBox.height);}await expect(composer).toHaveText(draft);await expect(composer).toBeHidden();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-pending-before-loss-'+width+'.png')})}
    await appPage.setViewportSize({width:1400,height:900})
    const live=before.native.state,pid=pendingApprovalFailure==='native'?live.nativePid:live.pid
    const failure={kind:pendingApprovalFailure,pid,brokerPid:live.pid,nativePid:live.nativePid,at:Date.now(),retiredAt:0};expect(pid).toBeGreaterThan(1);expect(pid).not.toBe(process.pid);if(pendingApprovalFailure==='cancel')await approval.getByRole('button',{name:'Cancel',exact:true}).click();else process.kill(pid,'SIGKILL')
    await expect.poll(async()=>(await context()).native.state.status).toBe(pendingApprovalFailure==='cancel'?'exited':'error')
    await expect.poll(()=>{try{process.kill(boundNativePid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true);failure.retiredAt=Date.now()
    await expect(approval).toHaveCount(0);await expect.poll(async()=>(await context()).claude.pendingControlRequest).toBeFalsy();await expect(composer).toHaveText(draft)
    await expect(composer).toBeInViewport();if(pendingApprovalFailure!=='cancel')await expect(section.getByRole('status')).toContainText('disconnected unexpectedly')
    await section.getByRole('button',{name:'Use native interface',exact:true}).click()
    let reopenNavigated=false,reopenTrusted=false,reopenNavigationAt=0,reopenNavigationAttempts=0
    await expect.poll(async()=>{const n=(await context()).native,text=await screenText(n),screen=recognizeOnboardingPrompt(text,workspace)
      if(screen==='workspace-trust'&&(!reopenNavigated||Date.now()-reopenNavigationAt>1200)){expect(++reopenNavigationAttempts).toBeLessThanOrEqual(3);reopenNavigated=true;reopenNavigationAt=Date.now();await input.press('ArrowDown')}
      else if(screen==='workspace-trust-selected'&&reopenNavigated&&!reopenTrusted&&Date.now()-reopenNavigationAt>1200){reopenTrusted=true;await input.press('Enter')}
      await writeFile(join(workspace!,'native-pending-onboarding.json'),JSON.stringify({screen,text,reopenNavigated,reopenTrusted,reopenNavigationAttempts}));return n?.state.status==='live'&&n.state.nativePid!==boundNativePid&&n.state.mainStatus?.includes(sessionId)
    },{timeout:25000,intervals:[250]}).toBe(true)
    const reopenedNativePid=(await context()).native.state.nativePid
    await writeFile(join(workspace!,'native-pending-approval-resume.json'),JSON.stringify({context:await context(),journal:await journal()},null,2))
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    await input.pressSequentially('Read the release checklist after recovery.');await input.press('Enter')
    await expect.poll(async()=>!!(await context()).claude.pendingControlRequest?.nativeTerminal).toBe(true)
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(approval).toBeVisible();await expect(composer).toHaveText(draft)
    const fresh=(await context()).claude.pendingControlRequest;expect(fresh.nativeTerminal.ownerId).not.toBe(retired.nativeTerminal.ownerId);expect(fresh.requestId).not.toBe(retired.requestId)
    expect(fresh.approvalMessageId).not.toBe(retired.approvalMessageId)
    await appPage.evaluate(old=>(window as any).applicationState.system.get('default-setup/threads').send({type:'RESPOND_TO_BLOCK_INTERACTION',messageId:old.approvalMessageId,response:{approved:true}}),retired)
    await expect.poll(async()=>{const log=await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8');return [...log.matchAll(/Incoming: "INTERACTIVE_MSG_RESPONSE" \{[\s\S]*?\n\}/g)].some(match=>match[0].includes(retired.approvalMessageId))}).toBe(true)
    expect((await context()).claude.pendingControlRequest.requestId).toBe(fresh.requestId)
    expect((await controls()).filter((row:any)=>row.request.subtype==='apack_answer_file_dialog')).toHaveLength(0)
    const oldMessage=(await context()).messages.find((row:any)=>row.id===retired.approvalMessageId);expect(oldMessage.blockResponse.cancelled).toBe(true)
    for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(approval.getByRole('button',{name:'Approve',exact:true})).toBeInViewport();const transcript=appPage.getByTestId('chat-transcript');await expect(transcript).toBeVisible();expect((await transcript.boundingBox())!.height).toBeGreaterThan(80);const approvalBox=(await approval.boundingBox())!;expect(approvalBox.height).toBeLessThan(width===680?380:580);expect(approvalBox.height).toBeGreaterThan(240);for(const name of ['Cancel','Deny','Approve']){const bounds=(await approval.getByRole('button',{name,exact:true}).boundingBox())!;expect(bounds.y+bounds.height).toBeLessThanOrEqual(approvalBox.y+approvalBox.height);}await expect(composer).toBeHidden();await expect(composer).toHaveText(draft);await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-pending-fresh-'+width+'.png')})}
    await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toHaveCount(0);await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    const answers=(await controls()).filter((row:any)=>row.request.subtype==='apack_answer_file_dialog');expect(answers).toHaveLength(1);expect(answers[0].request.revision).toBe(fresh.nativeTerminal.revision);expect(answers[0].response.pid).toBe(reopenedNativePid);expect(answers[0].response.result.answered).toBe(true)
    await expect(composer).toBeInViewport();await expect(composer).toHaveText(draft)
    const restored=await context();expect(restored.sessionId).toBe(sessionId);expect(restored.claude.totalCostUsd).toBeGreaterThanOrEqual(nativeCost);expect(restored.claude.toolCallCount).toBe(2)
    for(const prior of history){const rows=restored.messages.filter((row:any)=>row.context?.cliUuid===prior.uuid);expect(rows).toHaveLength(1);expect({id:rows[0].id,uuid:rows[0].context.cliUuid,text:rows[0].text,sender:rows[0].sender}).toEqual(prior)}
    for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await expect(composer).toBeInViewport();await expect(composer).toHaveText(draft);await expect(card.getByTestId('composer-native-status')).toContainText('AppNativeMain '+sessionId);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-pending-recovered-'+width+'.png')})}
    const cancelledHistory=appPage.locator('[data-chat-message="'+retired.approvalMessageId+'"]')
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900})
      const label=cancelledHistory.getByText('Cancelled',{exact:true});await label.scrollIntoViewIfNeeded();await expect(label).toBeInViewport()
      await expect(cancelledHistory.getByText('Denied',{exact:true})).toHaveCount(0)
      expect((await context()).messages.find((row:any)=>row.id===retired.approvalMessageId).blockResponse.cancelled).toBe(true)
      await appPage.screenshot({path:testInfo.outputPath('native-cancelled-approval-history-'+width+'.png')})
    }
    await composer.scrollIntoViewIfNeeded()
    await app.navigate('host/settings');await app.navigate('default-setup/threads');await expect(composer).toHaveText(draft);expect((await context()).native.state.nativePid).toBe(reopenedNativePid)
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
    await composer.fill('Continue the release summary after recovering the interrupted approval.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
    const final=await context();expect(final.sessionId).toBe(sessionId);const nativePrintResult=JSON.parse((await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').at(-1)!);expect(nativePrintResult.totalCostUsd).toBe(final.claude.totalCostUsd);expect(final.claude.totalCostUsd).toBeGreaterThan(restored.claude.totalCostUsd);expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-pending-approval-failure-proof.json'),JSON.stringify({failure,sessionId,boundNativePid,reopenedNativePid,retired,fresh,retiredHistory:oldMessage,history,nativeCost,recoveredCost:restored.claude.totalCostUsd,continuedCost:final.claude.totalCostUsd,nativePrintResult,answers,journal:await journal()},null,2))
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativePendingApprovalFailure:pendingApprovalFailure,nativeCancelledApprovalLabel:true,nativeRetiredApprovalRefused:true,nativeFreshApproval:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,nativeCost,continuedCost:final.claude.totalCostUsd,browserErrors:errors}))
  }catch(error){await writeFile(join(workspace!,'native-pending-approval-failure.json'),JSON.stringify({context:await context(),journal:await journal()},null,2));await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-pending-approval-failure.png')});throw error}finally{terminalScreen?.dispose()}
});
