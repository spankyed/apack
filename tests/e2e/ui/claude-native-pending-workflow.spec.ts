import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
const workflowGrantScope=process.env.CLAUDE_RESEARCH_WORKFLOW_GRANT_SCOPE==='1'
const workflowStanding=process.env.CLAUDE_RESEARCH_WORKFLOW_STANDING==='1'
const workflowEditor=process.env.CLAUDE_RESEARCH_WORKFLOW_EDITOR==='1'
const workflowEditorWithheld=process.env.CLAUDE_RESEARCH_WORKFLOW_EDITOR_WITHHELD==='1'
const workflowDeny=process.env.CLAUDE_RESEARCH_WORKFLOW_DENY==='1',workflowWithheld=workflowEditorWithheld||process.env.CLAUDE_RESEARCH_WORKFLOW_WITHHELD==='1'
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-pending-workflow-failure.png') }).catch(() => {}) })
test('mirrors original pending workflow duration and completion', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { pendingWorkflow, workflowQueue } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!pendingWorkflow, 'Explicit private native pending-duration profile required')
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await appPage.setViewportSize({ width: 1100, height: 900 })
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: Object.values(state.nativeUiViews).find((view: any) => view.threadId === state.currentThread?.id && view.state?.status === 'live'), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
  const dimensions = () => input.evaluate(element => { const root = element.closest('.xterm')!, box = root.querySelector('.xterm-screen')!.getBoundingClientRect(), font = getComputedStyle(root.querySelector('.xterm-char-measure-element')!), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!; context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`; return Math.round(box.width / context.measureText('W').width) })
  await expect.poll(dimensions).toBeGreaterThan(1)
  const terminal = new Terminal({ cols: await dimensions(), rows: 200, allowProposedApi: true })
  let lastSequence = 0, lastScreen = ''
  async function screen() {
    if (await input.isVisible()) { const cols = await dimensions(); if (cols > 1 && cols !== terminal.cols) terminal.resize(cols, 200) }
    const native = (await context()).native, chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminal.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminal.buffer.active
    lastScreen = Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    return lastScreen
  }
  try {
    let theme = false, security = false, navigated = false, trustAt = 0, attempts = 0
    await expect.poll(async () => {
      const current = await context(), kind = recognizeOnboardingPrompt(await screen(), workspace)
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('AppNativeMain ' + sessionId) === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    const composer = card.locator('[contenteditable="true"]')
    const frames = async () => ((await context()).ui?.state.transcriptMessages ?? []).filter((frame: any) => frame.component === 'TurnDuration' && frame.body.status === 'live')
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    await composer.fill('Use a workflow to review the release notes.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const approval = appPage.getByRole('region', { name: 'Workflow approval', exact: true })
    await expect(approval).toBeVisible()
    const summary=approval.getByTestId('native-workflow-summary'),retainedDraft='Keep review notes while inspecting the workflow.'
    if(workflowWithheld){
      await expect(approval).toContainText('Claude withheld this script');await expect(approval.getByTestId('native-workflow-script')).toHaveCount(0);await expect(summary).toHaveCount(0)
      await expect(approval.getByRole('button',{name:'Allow',exact:true})).toBeDisabled();await expect(approval.getByRole('button',{name:'Edit in native interface',exact:true})).toBeEnabled()
      if(!workflowDeny)for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await approval.getByRole('button',{name:'Edit in native interface',exact:true}).scrollIntoViewIfNeeded();await expect(approval.getByRole('button',{name:'Edit in native interface',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-workflow-withheld-'+size.width+'.png')})}
    }else{await expect(approval.getByTestId('native-workflow-description')).toContainText('Review release notes');await expect(summary).toContainText('Review');await expect(summary).toContainText('Return the synthetic worker marker only.')}
    await expect(composer).toBeHidden()
    if(workflowDeny){
      const feedback='Keep this workflow local; do not launch review workers.'
      await approval.getByText('Add a reason for denying',{exact:true}).click();const field=approval.getByRole('textbox',{name:'Reason for denying',exact:true});await field.fill(feedback)
      for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await field.scrollIntoViewIfNeeded();await expect(field).toBeInViewport();await expect(approval.getByRole('button',{name:'Deny',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-workflow-denial-'+size.width+'.png')})}
      await approval.getByRole('button',{name:'Deny',exact:true}).click();await expect(approval).toHaveCount(0)
      await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
      const tasks=JSON.parse(await readFile(join(workspace!,'native-workflow-state.json'),'utf8'));expect(tasks).toEqual([])
      const journal=async()=>{for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{return (await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))}catch(error:any){if(error.code!=='ENOENT')throw error}}return []}
      const refusal=async()=>(await journal()).flatMap(row=>Array.isArray(row.message?.content)?row.message.content:[]).find(block=>block.type==='tool_result'&&block.tool_use_id==='status_agent_fixture'&&block.is_error===true&&JSON.stringify(block.content).includes(feedback))
      await expect.poll(async()=>!!await refusal()).toBe(true)
      const draft='Keep the release notes after denying the workflow.';await composer.fill(draft)
      for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-workflow-denial-recovery-'+size.width+'.png')})}
      expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).native.state.activity?.pendingWorkflows??0).toBe(0)
      await writeFile(join(workspace!,'native-workflow-denial-proof.json'),JSON.stringify({feedback,tasks,refusal:await refusal(),withheld:workflowWithheld,draft}))
      await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
      const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
      await composer.fill('Continue after refusing the workflow.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
      await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'task-controls',nativeWorkflowDenied:true,nativeWorkflowFeedback:true,nativeNoWorkflowStarted:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));return
    }
    let editorBeforeToken:string|undefined,editorAfterToken:string|undefined
    if(workflowEditor){
      editorBeforeToken=(await context()).claude.pendingControlRequest.nativeTerminal.workflow.token
      await approval.getByRole('button',{name:'Edit in native interface',exact:true}).click();await expect(input).toBeVisible();await input.focus();await input.press('Control+g')
      await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-workflow-editor-receipt.json'),'utf8').catch(()=>'{}')).after).toContain('Edited release notes')
      expect((await context()).native.state.nativePid).toBe(boundNativePid)
      await appPage.screenshot({path:testInfo.outputPath('native-workflow-editor-terminal.png')})
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(approval).toBeVisible()
      await expect(approval.getByTestId('native-workflow-description')).toContainText('Edited release notes');await expect(summary).toContainText('Edited review')
      editorAfterToken=(await context()).claude.pendingControlRequest.nativeTerminal.workflow.token;expect(editorAfterToken).not.toBe(editorBeforeToken)
    }
    const summaryText=await summary.innerText();let scriptText=''
    for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
      await appPage.setViewportSize(size); await expect(approval.getByRole('button', { name: 'Yes, run it', exact: true })).toBeInViewport()
      await expect(composer).toBeHidden();await appPage.screenshot({ path: testInfo.outputPath('native-workflow-summary-' + size.width + '.png') })
      await approval.getByRole('button',{name:'View raw script',exact:true}).click()
      await expect(approval.getByTestId('native-workflow-script')).toContainText('export const meta');await expect(approval.getByTestId('native-workflow-script')).toContainText('status-fixture')
      scriptText=await approval.getByTestId('native-workflow-script').innerText();await expect(approval.getByRole('button',{name:'Yes, run it',exact:true})).toBeInViewport()
      await appPage.screenshot({ path: testInfo.outputPath('native-workflow-approval-' + size.width + '.png') })
      await approval.getByRole('button',{name:'View workflow summary',exact:true}).click();await expect(summary).toContainText('Return the synthetic worker marker only.')
    }
    await writeFile(join(workspace!,'native-workflow-summary-proof.json'),JSON.stringify({summaryText,scriptText,retainedDraft,normalAndCompact:true}))
    if(workflowStanding){const standing=approval.getByRole('combobox',{name:'Workflow approval choice',exact:true});await expect(standing).toBeVisible();await standing.selectOption('yes-always');for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await standing.scrollIntoViewIfNeeded();await expect(standing).toBeInViewport();await expect(approval.getByRole('button',{name:/don't ask again/})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-workflow-standing-'+size.width+'.png')})}await approval.getByRole('button',{name:/don't ask again/}).click()}else await approval.getByRole('button', { name: 'Yes, run it', exact: true }).click()
    await expect(approval).toHaveCount(0)
    await composer.fill(retainedDraft);await expect(composer).toHaveText(retainedDraft)
    const tasks = async () => JSON.parse(await readFile(join(workspace!, 'native-workflow-state.json'), 'utf8').catch(() => '[]'))
    await expect.poll(async () => (await tasks()).some((task: any) => task.type === 'local_workflow' && task.status === 'running'), { timeout: 15000 }).toBe(true)
    await expect.poll(async () => (await frames()).some((frame: any) => /Waiting for.*dynamic workflow/.test(frame.engineOutput ?? '')), { timeout: 15000 }).toBe(true)
    const pendingFrame = (await frames()).findLast((frame: any) => /Waiting for.*dynamic workflow/.test(frame.engineOutput ?? ''))
    const waitingRow = appPage.locator('[data-native-placement="TurnDuration"]').filter({ hasText: /Waiting for.*dynamic workflow/ }).last()
    await expect(waitingRow).toBeVisible()
    const journalPath = async () => { const dirs = await readdir(join(workspace!, '.claude/projects')); for (const dir of dirs) { const path = join(workspace!, '.claude/projects', dir, sessionId + '.jsonl'); try { await readFile(path); return path } catch {} } throw Error('Original native journal missing') }
    const journal = async () => (await readFile(await journalPath(), 'utf8')).trim().split(String.fromCharCode(10)).map(line => JSON.parse(line))
    if(workflowEditor){
      await expect.poll(async()=>(await journal()).find(row=>typeof row.toolUseResult?.scriptPath==='string')?.toolUseResult.scriptPath).toBeTruthy()
      const persistedScriptPath=(await journal()).find(row=>typeof row.toolUseResult?.scriptPath==='string').toolUseResult.scriptPath
      expect(persistedScriptPath.startsWith(workspace!+'/')).toBe(true);expect(await readFile(persistedScriptPath,'utf8')).toBe(scriptText)
      await writeFile(join(workspace!,'native-workflow-editor-proof.json'),JSON.stringify({beforeToken:editorBeforeToken,afterToken:editorAfterToken,scriptText,persistedScriptPath,sameNativeOwner:(await context()).native.state.nativePid===boundNativePid}))
    }
    await expect.poll(async () => (await journal()).some(row => row.type === 'system' && row.subtype === 'turn_duration' && row.pendingWorkflowCount === 1)).toBe(true)
    const pendingNativeRows = (await journal()).filter(row => row.type === 'system' && row.subtype === 'turn_duration')
    await expect.poll(async () => (await context()).native.state.activity?.pendingWorkflows).toBe(1)
    await expect.poll(async () => (await context()).claude.chatState).toBe('working')
    const during = (await context()).native.state.activity
    const earlier = new Set((await frames()).map((frame: any) => frame.uuid))
    const queue=async()=>JSON.parse(await readFile(join(workspace!,'native-queued-completion.json'),'utf8').catch(()=>'{}'))
    let held: any
    if(workflowQueue){await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await writeFile(join(workspace!,'native-parent-delay-request'),'delay');await expect.poll(()=>readFile(join(workspace!,'native-parent-delay-ready'),'utf8').catch(()=>'')).toBe('ready')}
    await composer.fill('Check the release checklist while the workflow continues.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    if(workflowQueue){
      await expect.poll(()=>readFile(join(workspace!,'native-parent-delay-active'),'utf8').catch(()=>'')).toBe('active')
      await writeFile(join(workspace!,'native-pending-duration-release'),'release')
      const eligible=(snapshot:any)=>snapshot.queue.some((command:any)=>command.mode==='task-notification'&&snapshot.tasks.some((task:any)=>task.id===command.taskId&&task.type==='local_workflow'&&task.status==='completed'))
      await expect.poll(async()=>(await queue()).snapshots?.some(eligible),{timeout:10000}).toBe(true)
      held=(await queue()).snapshots.find(eligible);expect(held.counts.pendingWorkflows).toBe(1)
      await expect.poll(async()=>(await context()).native.state.activity?.pendingWorkflows).toBe(1)
    }else{
    await expect.poll(async () => (await frames()).some((frame: any) => !earlier.has(frame.uuid) && /Waiting for.*dynamic workflow/.test(frame.engineOutput ?? ''))).toBe(true)
    await expect.poll(async () => (await context()).native.state.busy).toBe(false)
    await expect.poll(async () => (await context()).claude.chatState).toBe('working')
    }
    const draft = 'Keep this release-review draft while the worker finishes.'
    await composer.fill(draft)
    for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
      await appPage.setViewportSize(size); await waitingRow.scrollIntoViewIfNeeded(); await expect(waitingRow).toBeInViewport(); await expect(composer).toHaveText(draft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
      await appPage.screenshot({ path: testInfo.outputPath('native-pending-workflow-' + size.width + '.png') })
    }
    await writeFile(join(workspace!, 'native-pending-duration-release'), 'release')
    await expect.poll(async () => (await tasks()).some((task: any) => task.status === 'completed'), { timeout: 15000 }).toBe(true)
    await expect(composer).toHaveText(draft)
    await expect.poll(async () => (await context()).native.state.activity?.pendingWorkflows, { timeout: 15000 }).toBe(0)
    await expect.poll(async () => (await context()).claude.chatState).toBe('success')
    const after = (await context()).native.state.activity
    if(workflowQueue){const drained=(await queue()).snapshots.at(-1);expect(drained.counts.pendingWorkflows).toBe(0);await writeFile(join(workspace!,'native-queued-completion-proof.json'),JSON.stringify({held,drained}))}
    if(workflowGrantScope){
      const approvalIds=async()=>{const inspection=JSON.parse(await readFile(join(workspace!,'native-dialog-shapes.json'),'utf8'));return [...new Set(inspection.events.flatMap((event:any)=>event.value?.open??[]).filter((dialog:any)=>dialog.kind==='permission_workflow').map((dialog:any)=>dialog.id))]}
      const initialApprovalCount=(await approvalIds()).length,priorTasks=(await tasks()).map((task:any)=>task.id)
      await composer.fill('Run the saved release review again.');await card.getByRole('button',{name:'Send',exact:true}).click()
      await expect.poll(async()=>(await tasks()).some((task:any)=>!priorTasks.includes(task.id)&&task.status==='completed'),{timeout:15000}).toBe(true)
      await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await expect(approval).toHaveCount(0)
      const repeatedApprovalCount=(await approvalIds()).length;expect(repeatedApprovalCount).toBe(initialApprovalCount)
      const repeatedTasks=await tasks();await composer.fill('Run the separate security review.');await card.getByRole('button',{name:'Send',exact:true}).click()
      await expect(approval).toBeVisible();await expect(approval.getByTestId('native-workflow-description')).toContainText('Review security notes')
      const unrelatedToken=(await context()).claude.pendingControlRequest.nativeTerminal.workflow.token
      for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await expect(approval.getByRole('button',{name:'Deny',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-workflow-unrelated-'+size.width+'.png')})}
      await approval.getByRole('button',{name:'Deny',exact:true}).click();await expect(approval).toHaveCount(0);await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
      expect((await tasks()).map((task:any)=>task.id)).toEqual(repeatedTasks.map((task:any)=>task.id))
      await writeFile(join(workspace!,'native-workflow-grant-scope-proof.json'),JSON.stringify({initialApprovalCount,repeatedApprovalCount,priorTasks,repeatedTasks,unrelatedToken,finalApprovalIds:await approvalIds(),unrelatedNotLaunched:true}))
    }
    const before = new Set((await frames()).map((frame: any) => frame.uuid))
    await composer.fill('Continue the release review after the worker finishes.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await frames()).some((frame: any) => !before.has(frame.uuid) && /for \d/.test(frame.engineOutput ?? '') && !/Waiting for/.test(frame.engineOutput ?? '')), { timeout: 15000 }).toBe(true)
    const completedFrame = (await frames()).findLast((frame: any) => !before.has(frame.uuid) && /for \d/.test(frame.engineOutput ?? '') && !/Waiting for/.test(frame.engineOutput ?? ''))
    await expect(appPage.locator('[data-native-placement="TurnDuration"]').last()).toContainText(/for \d/)
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!, 'native-pending-duration-proof.json'), JSON.stringify({ waiting: pendingFrame.engineOutput, completed: completedFrame.engineOutput, pendingFrame, completedFrame, pendingNativeRows, during, after, submittedWhilePending: true }))
    await section.getByRole('button', { name: 'Use native interface', exact: true }).click(); await section.getByRole('button', { name: 'Stop session', exact: true }).click()
    await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
    const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
    await composer.fill('Continue the same session after the pending worker review.'); await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'task-controls', nativeQueuedCompletion:workflowQueue===true,nativePendingDuration: true, nativeWorkflowApproval: true, ...(workflowGrantScope?{nativeWorkflowMatchingRepeat:true,nativeWorkflowUnrelatedDenied:true}:{}), ...(workflowStanding?{nativeWorkflowStanding:true}:{}), nativeWorkflowSummary: true, ...(workflowEditor?{nativeWorkflowEditor:true,...(workflowEditorWithheld?{nativeWorkflowEditorWithheld:true}:{})}:{}), nativeWorkflowActivity: true, nativeWorkflowConcurrentPrompt: true, nativePendingWorkflow: true, nativePendingCompletion: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
  } finally { await writeFile(join(workspace!, 'native-pending-duration-screen.txt'), lastScreen); terminal.dispose() }
})
