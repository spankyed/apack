import {createHash} from 'node:crypto'
import {stripVTControlCharacters} from 'node:util'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, info) => { if (info.status !== info.expectedStatus && !appPage.isClosed()) { await appPage.screenshot({ path: info.outputPath('background-confirmation-failure.png') }).catch(() => {}); const editor = await appPage.locator('[data-onboarding-id="agent-chat-input"] [contenteditable]').evaluate((el: any) => { const view = el.pmViewDesc?.view; return { text: el.textContent, contenteditable: el.getAttribute('contenteditable'), doc: view?.state.doc.toJSON(), selection: view?.state.selection.toJSON() } }).catch(() => null); await writeFile(info.outputPath('editor-failure.json'), JSON.stringify(editor)) } })
test('left-arrow entry and handoff: hands an original native conversation to a separate background session from the everyday composer', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(120000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const parentOwnerLoss = process.env.CLAUDE_RESEARCH_BACKGROUND_OWNER_LOSS_APP === '1'
  const childStatusLifecycle = process.env.CLAUDE_RESEARCH_BACKGROUND_STATUS_LIFECYCLE_APP === '1'
  const childStatus = childStatusLifecycle || process.env.CLAUDE_RESEARCH_BACKGROUND_STATUS_APP === '1'
  const childReply = parentOwnerLoss || childStatus || process.env.CLAUDE_RESEARCH_BACKGROUND_REPLY_APP === '1'
  const childResume = process.env.CLAUDE_RESEARCH_BACKGROUND_RESUME_APP === '1'
  const childInteraction = process.env.CLAUDE_RESEARCH_BACKGROUND_INTERACTION_APP === '1'
  const attachChild = childResume || childInteraction || process.env.CLAUDE_RESEARCH_BACKGROUND_ATTACH_APP === '1'
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: Object.values(state.nativeUiViews).filter((v: any) => v.threadId === state.currentThread?.id).map((v: any) => ({ status: v.state?.status, gestureProblem: v.state?.gestureProblem, agentProblem: v.state?.agentProblem })), native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns, { timeout: 25000, message: 'Original cold seed turn completes before native handoff' }).toBe(1)
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
    return native?.state?.status === 'live' && native.state.session?.turns >= 1
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const original = await context()
  const nativeWindow = await electronApp.browserWindow(appPage)
  async function capture(name: string) {
    await appPage.evaluate(() => document.fonts.ready.then(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
    const size = appPage.viewportSize()!
    const png = await nativeWindow.evaluate(async (window, size) => (await window.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG().toString('base64'), size)
    await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
  }
  const run = promisify(execFile)
  const cli = async (args: string[]) => (await run(launcher!, args, { cwd: workspace, timeout: 20000, maxBuffer: 2 * 1024 * 1024 })).stdout
  const list = async () => JSON.parse(await cli(['agents', '--json', '--all', '--cwd', workspace!])) as any[]
  const before = await list()
  let job: any
  const observations: any = { parentSessionId: sessionId, parentNativePid: original.native.state.nativePid, before, errors }
  try {
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    const composer = card.getByTestId('composer-editor-area').getByRole('textbox')
    await expect(composer).toBeVisible()
    await expect(composer).toBeEditable()
    await composer.fill('Start the owned review task before backgrounding this conversation.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const approval = appPage.getByRole('region', { name: 'Workflow approval', exact: true })
    await expect(approval).toBeVisible({ timeout: 15000 })
    await approval.getByRole('button', { name: 'Yes, run it', exact: true }).click()
    await expect(approval).toHaveCount(0)
    await expect.poll(async () => (await context()).native?.state?.activity?.pendingWorkflows ?? 0).toBe(1)
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-leftarrow-reviewer-ready.json'), 'utf8').catch(() => '{}')).originalChildRequest, { timeout: 15000 }).toBe(true)
    await composer.fill('Keep these notes while reviewing the background session.')
    const draft = await composer.textContent()
    await composer.press('ArrowLeft')
    await expect(composer).toHaveText(draft!)
    await expect(appPage.getByRole('dialog', { name: 'Background this session?', exact: true })).toHaveCount(0)
    await composer.click(); await composer.press('Control+A'); await composer.press('Backspace')
    await expect(composer).toHaveText('')
    await expect(composer).toBeEditable()
    async function review() {
      const dialog = appPage.getByRole('dialog', { name: 'Background this session?', exact: true })
      // Original source absorbs presses for 1s and requires >=150ms for a confirming press.
      await appPage.waitForTimeout(1100)
      await composer.press('ArrowLeft')
      if (!await dialog.isVisible()) {
        await appPage.waitForTimeout(250)
        if (!await dialog.isVisible() && await composer.isEditable()) await composer.press('ArrowLeft')
      }
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('1 running workflow subagent restarts from the beginning.')
      await expect(composer).toHaveAttribute('contenteditable', 'false')
      expect(await composer.evaluate(element => (element as HTMLElement).isContentEditable)).toBe(false)
      return dialog
    }
    let dialog = await review()
    if (!attachChild) {
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await expect(dialog.getByRole('button', { name: 'Stay', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(dialog.getByRole('button', { name: 'Background anyway (1 subagent restarts)', exact: true })).toBeInViewport({ ratio: 1 })
      await capture('apack-native-background-review-' + name + '.png')
    }
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(composer).toHaveText('')
    await expect(composer).toBeEditable()
    expect((await context()).native.state.nativePid).toBe(original.native.state.nativePid)
    await appPage.setViewportSize({ width: 1100, height: 900 })
    dialog = await review()
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(composer).toHaveText('')
    await expect(composer).toBeEditable()
    dialog = await review()
    }
    await dialog.getByRole('button', { name: 'Background anyway (1 subagent restarts)', exact: true }).click()
    await expect.poll(async () => (await context()).claude.nativeContinuation).toMatchObject({ sessionId })
    await expect(card).toContainText('This conversation moved to the background.')
    await expect(composer).toHaveAttribute('contenteditable', 'true')
    await composer.fill('Keep these notes after the native agents transition.')
    await expect(composer).toHaveText('Keep these notes after the native agents transition.')
    expect((await context()).claude.sessionError).toBeUndefined()
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await capture('apack-native-background-handoff-' + name + '.png')
    }
    observations.parentHandoffRecovered = true
    await expect.poll(async () => {
      observations.current = await context()
      observations.jobs = await list()
      job = observations.jobs.find((row: any) => row.kind === 'background' && row.id && !before.some((old: any) => old.id === row.id))
      return Number.isSafeInteger(job?.pid) && job.pid > 1
    }, { timeout: 25000, intervals: [500] }).toBe(true)
    observations.job = job
    expect(job.sessionId).not.toBe(sessionId)
    expect(job.pid).toBeGreaterThan(1)
    await expect.poll(async () => (await context()).claude.nativeContinuation).toMatchObject({ sessionId, continuedInSessionId: job.sessionId })
    const widget = appPage.getByRole('region', { name: 'Background Claude session', exact: true })
    await widget.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toBeEnabled({ timeout: 15000 })
    await composer.click(); await composer.press('Control+A'); await composer.pressSequentially('Keep these notes while the background session runs.')
    const retainedDraft = 'Keep these notes while the background session runs.'
    await expect(composer).toHaveText(retainedDraft)
    expect((await context()).claude.sessionError).toBeUndefined()
    await widget.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled()
    await expect(composer).toHaveText(retainedDraft!)
    observations.running = await context()
    expect(observations.running.claude.sessionError).toBeUndefined()
    expect(observations.running.sessionId).toBe(sessionId)
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 })
      await capture('apack-native-background-running-' + name + '.png')
    }
    const childProcessState = async () => {
      try {
        const stat = await readFile('/proc/' + job.pid + '/stat', 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        return { state: fields[0], start: fields[19] }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
    }
    if(parentOwnerLoss){
      const beforeWorker=await childProcessState(),beforeParent=await context()
      await section.getByRole('button',{name:'Use native interface',exact:true}).click()
      const stopParent=section.getByRole('button',{name:'Stop session',exact:true})
      await expect(stopParent).toBeVisible()
      const currentParent=await context()
      expect(currentParent.native.state.nativePid).toBe(observations.parentNativePid)
      const removed={threadId:currentParent.threadId,ownerId:currentParent.native.state.ownerId,pid:currentParent.native.state.nativePid,via:'native-ui-stop'}
      observations.parentOwnerLossRequest=removed
      await stopParent.click()
      await expect.poll(async()=>{try{const raw=await readFile('/proc/'+removed.pid+'/stat','utf8');return raw.slice(raw.lastIndexOf(')')+2).split(' ')[0]==='Z'}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error}},{timeout:10000}).toBe(true)
      await app.navigate('host/settings');await app.navigate('default-setup/threads')
      await expect.poll(async()=>(await context()).native?.state?.ownerId).toBeUndefined()
      await expect(widget.getByRole('button',{name:'Reply',exact:true})).toBeEnabled()
      const afterWorker=await childProcessState();expect(afterWorker?.start).toBe(beforeWorker?.start);expect(afterWorker?.state).not.toBe('Z')
      expect((await context()).messages).toEqual(beforeParent.messages);expect((await context()).claude.totalCostUsd).toBe(beforeParent.claude.totalCostUsd)
      observations.parentOwnerLoss={removed,beforeWorker,afterWorker,closedAt:Date.now(),parentProcessRetired:true,remountedWithoutOwner:true,parentPreserved:true}
      for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]as const){await appPage.setViewportSize(size);await expect(composer).toHaveText(retainedDraft);await expect(widget.getByRole('button',{name:'Reply',exact:true})).toBeInViewport({ratio:1});await capture('apack-native-background-parent-disconnected-'+name+'.png')}
    }
    if (childReply) {
      const beforeReply = await context(), workerBefore = await childProcessState()
      const readInfo = () => appPage.evaluate(() => {
        const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
        return (Object.values(state.nativeTerminalViews).find((view:any)=>view.threadId===state.currentThread?.id) as any)?.backgroundInfo
      })
      if(childStatus){
        try { await expect(widget.getByLabel('Background session usage',{exact:true})).toBeVisible({timeout:15000}) }
        catch(error){
          await widget.getByRole('button',{name:'Open session',exact:true}).click()
          await expect(appPage.getByRole('region',{name:'Background Claude terminal',exact:true})).toBeVisible({timeout:10000})
          await expect.poll(async()=>appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeTerminalViews).some((view:any)=>view.attachment?.state?.output?.length>0)),{timeout:10000}).toBe(true)
          observations.childStatusFailure=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeTerminalViews).map((view:any)=>({backgroundInfo:view.backgroundInfo,background:view.background,attachment:view.attachment})))
          await capture('apack-native-background-status-diagnostic.png')
          throw error
        }
        const info=await readInfo();expect(info.sessionId).toBe(job.sessionId);expect(info.jobId).toBe(job.id);expect(info.pid).toBe(job.pid);expect(info.model).toBeTruthy();expect(info.turns).toBeGreaterThan(0)
        observations.childStatus={before:info,parentBefore:beforeReply}
      }

      const replyText = 'Focus the background review on migration examples.'
      const projects = join(workspace!, '.claude', 'projects')
      const childRows = async () => {
        const text = (await Promise.all((await readdir(projects,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>readFile(join(projects,entry.name,job.sessionId+'.jsonl'),'utf8').catch(()=>'')))).join('\n')
        return text.split('\n').filter(Boolean).map(line=>JSON.parse(line))
      }
      const answered = async (text:string) => {
        const rows=await childRows(),human=rows.find(row=>row.origin?.kind==='human'&&row.message?.content===text)
        if(!human)return false
        const byId=new Map(rows.filter(row=>row.uuid).map(row=>[row.uuid,row]))
        return rows.some(row=>{
          if(row.type!=='assistant'||!row.message?.content?.some((block:any)=>block.type==='text'&&block.text))return false
          let parent=row.parentUuid;const seen=new Set<string>()
          while(parent&&!seen.has(parent)&&seen.size<128){if(parent===human.uuid)return true;seen.add(parent);const prior=byId.get(parent);if(prior?.origin?.kind==='human')return false;parent=prior?.parentUuid}
          return false
        })
      }
      await expect(widget.getByRole('button',{name:'Reply',exact:true})).toBeEnabled()
      await widget.getByRole('button',{name:'Reply',exact:true}).click()
      const input = widget.getByLabel('Message background session',{exact:true})
      await input.fill(replyText)
      for (const [name,size] of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]] as const) {
        await appPage.setViewportSize(size);await input.scrollIntoViewIfNeeded();await expect(widget.getByRole('button',{name:'Send message',exact:true})).toBeInViewport({ratio:1});await capture('apack-native-background-reply-draft-'+name+'.png')
      }
      await widget.getByRole('button',{name:'Send message',exact:true}).click()
      await expect(widget.getByRole('status').filter({hasText:'Message queued'})).toBeVisible({timeout:20000})
      await expect(input).toHaveValue('')
      await expect.poll(async()=>(await childRows()).filter(row=>row.origin?.kind==='human'&&row.message?.content===replyText).length,{timeout:15000}).toBe(1)
      await expect.poll(()=>answered(replyText),{timeout:15000}).toBe(true)
      const retainedReply = 'Keep this separate follow-up through navigation.'
      await input.fill(retainedReply)
      await app.navigate('host/settings');await app.navigate('default-setup/threads')
      await expect(input).toHaveValue(retainedReply)
      if(childStatus)await expect(widget.getByLabel('Background session usage',{exact:true})).toBeVisible()
      await expect(composer).toHaveText(retainedDraft)
      await widget.getByRole('button',{name:'Send message',exact:true}).click()
      await expect(input).toHaveValue('',{timeout:20000})
      await expect.poll(async()=>(await childRows()).filter(row=>row.origin?.kind==='human'&&row.message?.content===retainedReply).length,{timeout:15000}).toBe(1)
      await expect.poll(()=>answered(retainedReply),{timeout:15000}).toBe(true)
      const afterReply = await context()
      expect(afterReply.sessionId).toBe(sessionId);expect(afterReply.claude.totalCostUsd).toBe(beforeReply.claude.totalCostUsd)
      expect(afterReply.messages).toEqual(beforeReply.messages)
      expect((await childProcessState())?.start).toBe(workerBefore?.start)
      for (const [name,size] of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]] as const) {
        await appPage.setViewportSize(size);await input.scrollIntoViewIfNeeded();await capture('apack-native-background-reply-queued-'+name+'.png')
      }
      if(childStatus){const info=await readInfo();expect(info.sessionId).toBe(job.sessionId);expect(info.pid).toBe(job.pid);expect(info.observedAt).toBeGreaterThan(observations.childStatus.before.observedAt);observations.childStatus={...observations.childStatus,after:info,parentAfter:afterReply,remountPreserved:true}}
      observations.childReply = {replyText,retainedReply,rows:await childRows(),parentBefore:beforeReply,parentAfter:afterReply,workerBefore,workerAfter:await childProcessState(),queued:true,remountDraftPreserved:true}
      if(childStatusLifecycle){
        const auditPath=join(workspace!,'background-broker-audit.jsonl')
        const brokerRows=async()=>readFile(auditPath,'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))
        const registrations=async()=>(await brokerRows()).filter(row=>row.path==='/background-register'&&row.status===200&&row.leaseHash)
        const httpRows=async()=>{
          const names=(await readdir(workspace!)).filter(name=>name.startsWith('native-background-http-'+job.sessionId+'-')&&name.endsWith('.json'))
          return Promise.all(names.map(name=>readFile(join(workspace!,name),'utf8').then(JSON.parse)))
        }
        const attached=appPage.getByRole('region',{name:'Background Claude terminal',exact:true})
        const attachment=()=>appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeTerminalViews).map((view:any)=>view.attachment).find(Boolean) as any)
        const open=async()=>{await widget.getByRole('button',{name:'Open session',exact:true}).click();await expect(attached).toBeVisible();await expect.poll(async()=>(await attachment())?.state?.output?.length??0).toBeGreaterThan(0)}
        const close=async()=>{await attached.getByRole('button',{name:'Close connection',exact:true}).click();await expect(attached).toHaveCount(0);expect((await childProcessState())?.start).toBe(workerBefore?.start)}
        const captureStatus=async(label:string)=>{for(const[name,size]of[['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]as const){await appPage.setViewportSize(size);await widget.scrollIntoViewIfNeeded();await capture('apack-native-background-'+label+'-'+name+'.png')}}
        const state=JSON.parse(await readFile(join(workspace!,'.claude/jobs',job.id,'state.json'),'utf8'))
        let pluginRoot:string|undefined
        for(let i=0;i<state.respawnFlags.length-1;i++)if(state.respawnFlags[i]==='--plugin-dir'){
          const path=state.respawnFlags[i+1];const manifest=await readFile(join(path,'.claude-plugin/plugin.json'),'utf8').then(JSON.parse).catch(()=>undefined)
          if(manifest?.name==='apack-native-terminal')pluginRoot=path
        }
        expect(pluginRoot?.startsWith('/tmp/cc-app-')).toBe(true)
        const observer=JSON.parse(await readFile(join(pluginRoot!,'../observer.json'),'utf8'));expect(observer.sessionId).toBe(sessionId)
        const socket=join(dirname(pluginRoot!),'bridge.sock');expect(observer.socketPath).toBe(socket);expect((await stat(socket)).isSocket()).toBe(true)
        const reload=async()=>{
          const before=(await registrations()).at(-1);expect(before?.leaseHash).toBeTruthy()
          const modulePath=join(pluginRoot!,'hooks/register.ts'),source=await readFile(modulePath,'utf8'),comment='\n// Owned research reload '+Date.now()+'\n'
          await writeFile(modulePath,source+comment);expect(await readFile(modulePath,'utf8')).toBe(source+comment)
          const moduleChange={beforeSha256:createHash('sha256').update(source).digest('hex'),afterSha256:createHash('sha256').update(source+comment).digest('hex'),commentOnly:true}
          await open();const input=attached.locator('textarea.xterm-helper-textarea');await input.pressSequentially('/reload-plugins --force');await input.press('Enter')
          await expect.poll(async()=>(await registrations()).at(-1)?.leaseHash,{timeout:15000}).not.toBe(before.leaseHash)
          const after=(await registrations()).at(-1);expect(after?.leaseHash).toBeTruthy()
          await expect.poll(async()=>stripVTControlCharacters((await attachment())?.state?.output?.map((row:any)=>row.text).join('')??''),{timeout:15000}).toContain('Reloaded')
          await expect.poll(async()=>(await readInfo())?.observedAt??0,{timeout:5000}).toBeGreaterThan(after.at)
          const info=await readInfo();expect(info.pid).toBe(job.pid);expect((await childProcessState())?.start).toBe(workerBefore?.start)
          await close();return{before,after,info,moduleChange}
        }
        await expect.poll(async()=>(await registrations()).length).toBeGreaterThan(0)
        const firstReload=await reload();await captureStatus('reload')
        const hidden=socket+'.research-offline';let moved=false
        let disconnected:any
        try{
          const at=Date.now();await writeFile(auditPath+'.disconnect','owned disconnect');await rename(socket,hidden);moved=true
          await expect.poll(async()=>(await httpRows()).filter(row=>row.at>=at).length,{timeout:5000}).toBeGreaterThan(0)
          await expect(widget.getByLabel('Background session usage',{exact:true})).toHaveCount(0,{timeout:8000})
          const before=await httpRows();expect(before.length).toBeLessThan(100)
          const quietAt=Date.now();await appPage.waitForTimeout(2200);const after=await httpRows();expect(after).toHaveLength(before.length)
          expect((await childProcessState())?.start).toBe(workerBefore?.start);expect((await childProcessState())?.state).not.toBe('Z')
          disconnected={at,quietAt,checkedAt:Date.now(),httpBefore:before,httpAfter:after,infoRetired:true,worker:await childProcessState()};await captureStatus('broker-unavailable')
        }finally{if(moved)await rename(hidden,socket);await unlink(auditPath+'.disconnect').catch(error=>{if(error.code!=='ENOENT')throw error})}
        await expect(widget.getByLabel('Background session usage',{exact:true})).toHaveCount(0)
        const recovery=await reload();await captureStatus('broker-recovered')
        const parent=await context();expect(parent.messages).toEqual(beforeReply.messages);expect(parent.claude.totalCostUsd).toBe(beforeReply.claude.totalCostUsd)
        observations.childStatusLifecycle={firstReload,disconnected,recovery,brokerRows:await brokerRows(),httpRows:await httpRows(),parent,worker:await childProcessState(),restored:true}
      }

    }
    if (attachChild && !childResume) {
      const normalizeScreen = (value:string) => stripVTControlCharacters(value).replace(/\s+/g,'')
      const attachment = () => appPage.evaluate(() => {
        const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
        return (Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id && view.attachment) as any)?.attachment
      })
      const attached = appPage.getByRole('region', {name: 'Background Claude terminal', exact:true})
      const parentBefore = await context()
      const workerBefore = await childProcessState()
      async function openChild(expected = childInteraction?'Thereleasereviewisready.':'ParentSubagentFixtureComplete') {
        await widget.getByRole('button', {name:'Open session',exact:true}).click()
        await expect(attached).toBeVisible()
        await expect.poll(async () => normalizeScreen((await attachment())?.state?.output.map((chunk:any)=>chunk.text).join('')??''), {timeout:20000}).toContain(expected)
        const current = await attachment()
        expect(current.status).toBe('ready')
        expect(current.state.sessionId).toBe(job.sessionId)
        expect(current.state.jobId).toBe(job.id)
        expect(current.state.clientPid).not.toBe(job.pid)
        expect((await childProcessState())?.start).toBe(workerBefore?.start)
        await expect(card).toBeHidden()
        return current
      }
      const first = await openChild()
      const childText = childInteraction?'Read the release checklist before proposing changes.':'Confirm this attached background session received my review.'
      await attached.locator('textarea.xterm-helper-textarea').fill(childText)
      await attached.locator('textarea.xterm-helper-textarea').press('Enter')
      const projects = join(workspace!, '.claude', 'projects')
      const childJournal = async () => (await Promise.all((await readdir(projects,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>readFile(join(projects,entry.name,job.sessionId+'.jsonl'),'utf8').catch(()=>'')))).join('\n')
      await expect.poll(childJournal,{timeout:15000}).toContain(childText)
      if (childInteraction) {
        const terminalInput = attached.locator('textarea.xterm-helper-textarea')
        const screen = async () => normalizeScreen((await attachment())?.state?.output.map((chunk:any)=>chunk.text).join('') ?? '')
        await expect.poll(screen,{timeout:15000}).toMatch(/Doyouwant|Allow|Readfile/)
        observations.childReadReview = {attachment:await attachment(),nativeJobs:await list()}
        for (const [name,size] of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]] as const) {
          await appPage.setViewportSize(size);await capture('apack-native-child-read-review-'+name+'.png')
        }
        await terminalInput.press('Enter')
        await expect.poll(screen,{timeout:15000}).toContain('Thereleasechecklistisavailable.')
        const questionText='Ask me which release audience to target.'
        await terminalInput.fill(questionText);await terminalInput.press('Enter')
        await expect.poll(screen,{timeout:15000}).toContain('Whoshouldthereleasesummaryaddress?')
        observations.childQuestionReview = {attachment:await attachment(),nativeJobs:await list()}
        for (const [name,size] of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]] as const) {
          await appPage.setViewportSize(size);await expect.poll(()=>attached.locator('.child-terminal__viewport').evaluate(element=>element.clientHeight)).toBeGreaterThan(300);await capture('apack-native-child-question-'+name+'.png')
        }
        await terminalInput.press('Enter')
        await expect.poll(screen,{timeout:15000}).toContain('Iwillwritethereleasesummaryfordevelopers.')
        observations.childInteraction = {read:true,question:true,questionText,childJournal:await childJournal()}
      }

      for (const [name,size] of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]] as const) {
        await appPage.setViewportSize(size)
        await expect(attached.getByRole('button',{name:'Close connection',exact:true})).toBeInViewport({ratio:1})
        await expect(attached.locator('textarea.xterm-helper-textarea')).toBeAttached()
        await capture('apack-native-child-attached-'+name+'.png')
      }
      await attached.getByRole('button',{name:'Close connection',exact:true}).click()
      await expect(attached).toHaveCount(0)
      await expect(composer).toHaveText(retainedDraft)
      expect((await childProcessState())?.start).toBe(workerBefore?.start)
      await expect.poll(async()=>readFile('/proc/'+first.state.clientPid+'/stat','utf8').then(value=>value.slice(value.lastIndexOf(')')+2).split(' ')[0]).catch(error=>error.code==='ENOENT'?'gone':Promise.reject(error))).toMatch(/^(gone|Z)$/)
      const second = await openChild(childInteraction?'Iwillwritethereleasesummaryfordevelopers.':undefined)
      expect(second.state.id).not.toBe(first.state.id)
      await attached.getByRole('button',{name:'Close connection',exact:true}).click()
      await expect(attached).toHaveCount(0)
      await expect(composer).toHaveText(retainedDraft)
      const parentAfter = await context()
      expect(parentAfter.messages).toEqual(parentBefore.messages)
      expect(parentAfter.claude.totalCostUsd).toBe(parentBefore.claude.totalCostUsd)
      expect(parentAfter.sessionId).toBe(sessionId)
      observations.childAttachment = {first,second,workerBefore,workerAfter:await childProcessState(),childText,parentHistoryPreserved:true,parentDraftPreserved:true,closedClientOnly:true}
    }
    const childBeforeStop = process.platform === 'linux' ? await childProcessState() : undefined
    if (process.platform === 'linux') { expect(childBeforeStop?.start).toBeTruthy(); expect(childBeforeStop?.state).not.toBe('Z') }
    await widget.getByRole('button', { name: 'Stop background session', exact: true }).click()
    await expect(widget.getByRole('status').filter({hasText:/^Last reported:/})).toHaveText('Last reported: stopped', { timeout: 20000 })
    await expect(widget.getByRole('button', { name: 'Stop background session', exact: true })).toHaveCount(0)
    await expect(composer).toHaveText(retainedDraft!)
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await expect(card).toContainText('This conversation moved to the background.')
    if(childStatus){await expect(widget.getByLabel('Background session usage',{exact:true})).toHaveCount(0);observations.childStatus.retiredAfterStop=true}
    observations.uiStop = true
    if (process.platform === 'linux') {
      await expect.poll(async () => { const current = await childProcessState(); return !current || current.start !== childBeforeStop!.start || current.state === 'Z' }).toBe(true)
      observations.childProcessAfterStop = await childProcessState() ?? { state: 'gone' }
      observations.childPidRetired = true
    }

    observations.stopped = await context()
    expect(observations.stopped.claude.sessionError).toBeUndefined()
    expect(observations.stopped.native.state.sessionId).toBe(sessionId)
    for (const [name, size] of [['normal', { width: 1100, height: 900 }], ['compact', { width: 680, height: 600 }]] as const) {
      await appPage.setViewportSize(size)
      await capture('apack-native-background-stopped-' + name + '.png')
    }
    if (childResume) {
      const stoppedJob = {...job}, parentBefore = await context()
      const attachment = () => appPage.evaluate(() => {
        const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
        const entry=Object.entries(state.nativeTerminalViews).find(([,view]:any)=>view.threadId===state.currentThread?.id&&view.attachment)
        return entry?{mountId:entry[0],...(entry[1] as any).attachment}:undefined
      })
      const attached=appPage.getByRole('region',{name:'Background Claude terminal',exact:true})
      const projects=join(workspace!,'.claude','projects')
      const files=(await Promise.all((await readdir(projects,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(async entry=>{const path=join(projects,entry.name,job.sessionId+'.jsonl');return await readFile(path,'utf8').then(()=>path).catch(()=>undefined)}))).filter(Boolean) as string[]
      expect(files).toHaveLength(1)
      const journal=files[0]!, preserved=journal+'.research-preserved'
      let moved=false
      const screen=async()=>stripVTControlCharacters((await attachment())?.state?.output.map((chunk:any)=>chunk.text).join('')??'').replace(/\s+/g,'')
      const liveWorker=async()=>{const listed=(await list()).find(row=>row.id===stoppedJob.id);if(!listed?.pid)return;try{const raw=await readFile('/proc/'+listed.pid+'/stat','utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');if(fields[0]!=='Z')return {job:listed,state:fields[0],start:fields[19]}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
      async function captureResume(phase:string) {for(const [name,size]of [['normal',{width:1100,height:900}],['compact',{width:680,height:600}]]as const){await appPage.setViewportSize(size);await expect(attached.getByRole('button',{name:'Close connection',exact:true})).toBeInViewport({ratio:1});await capture('apack-native-child-'+phase+'-'+name+'.png')}}
      async function closeAttachment(){await attached.getByRole('button',{name:'Close connection',exact:true}).click();await expect(attached).toHaveCount(0);await expect(composer).toHaveText(retainedDraft)}
      async function restoreJournal(){
        // Keep unexpected native output as evidence rather than overwriting it.
        try {await rename(journal,journal+'.research-unexpected')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
        await rename(preserved,journal);moved=false
      }
      try {
        await widget.getByRole('button',{name:'Open session',exact:true}).click()
        await expect.poll(screen,{timeout:20000}).toContain('Quicksafetycheck:')
        await expect.poll(screen).toContain('No,exit')
        observations.childResume={refusal:{kind:'workspace-trust-exit',shown:await attachment()}}
        await captureResume('resume-trust-exit')
        await attached.locator('textarea.xterm-helper-textarea').press('Enter')
        await expect.poll(async()=>(await attachment())?.state?.status).toBe('exited')
        expect(await liveWorker()).toBeUndefined()
        observations.childResume.refusal={...observations.childResume.refusal,attachment:await attachment(),originalText:true,noWorker:true,jobs:await list()}
        await closeAttachment()
        await widget.getByRole('button',{name:'Open session',exact:true}).click()
        await expect.poll(screen,{timeout:20000}).toContain('Quicksafetycheck:')
        const terminalInput=attached.locator('textarea.xterm-helper-textarea')
        await terminalInput.press('ArrowDown');await terminalInput.press('Enter')
        await expect.poll(screen,{timeout:20000}).toContain('ParentSubagentFixtureComplete')
        await expect.poll(async()=>!!await liveWorker()).toBe(true)
        const resumed=await liveWorker();expect(resumed!.job.sessionId).toBe(stoppedJob.sessionId);expect(resumed!.job.id).toBe(stoppedJob.id);expect(resumed!.job.pid).not.toBe(stoppedJob.pid)
        job=resumed!.job;observations.resumedJob=job
        const resumedView=await attachment();expect(resumedView.state.sessionId).toBe(job.sessionId)
        const staleText='Retired refusal input must never reach the child.'
        await appPage.evaluate(({threadId,mountId,attachmentId,text})=>(window as any).applicationState.system.get('default-setup/threads').send({type:'CLAUDE_BACKGROUND_INPUT',threadId,mountId,attachmentId,text}),{threadId:(await context()).threadId,mountId:resumedView.mountId,attachmentId:observations.childResume.refusal.attachment.state.id,text:staleText})
        const text='Continue this background review after the stopped session resumes.'
        await terminalInput.fill(text);await terminalInput.press('Enter')
        await expect.poll(()=>readFile(journal,'utf8'),{timeout:15000}).toContain(text)
        expect(await readFile(journal,'utf8')).not.toContain(staleText)
        await captureResume('resumed')
        const completed=await attachment();await closeAttachment()
        const parentAfter=await context();expect(parentAfter.messages).toEqual(parentBefore.messages);expect(parentAfter.claude.totalCostUsd).toBe(parentBefore.claude.totalCostUsd);expect(parentAfter.sessionId).toBe(sessionId)
        await widget.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(widget.getByRole('button',{name:'Stop background session',exact:true})).toBeEnabled()
        await widget.getByRole('button',{name:'Stop background session',exact:true}).click();await expect(widget.getByRole('status').filter({hasText:/^Last reported:/})).toHaveText('Last reported: stopped',{timeout:20000})
        await expect.poll(async()=>!!await liveWorker()).toBe(false)
        const resumedProcess=async()=>{try{const raw=await readFile('/proc/'+resumed!.job.pid+'/stat','utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {state:fields[0],start:fields[19]}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}}
        await expect.poll(async()=>{const current=await resumedProcess();return !current||current.state==='Z'||current.start!==resumed!.start}).toBe(true)
        const workerProcessAfterStop=await resumedProcess()??{state:'gone'}
        observations.childResume={...observations.childResume,stoppedJob,resumed,attachment:completed,text,staleText,sameSession:true,parentPreserved:true,uiStop:true,workerRetired:true,workerProcessAfterStop}
        const originalJournal=await readFile(journal,'utf8')
        await rename(journal,preserved);moved=true
        await widget.getByRole('button',{name:'Open session',exact:true}).click()
        let historyTrustAccepted=false
        await expect.poll(async()=>{const value=await screen();if(value.includes('Quicksafetycheck:')&&!historyTrustAccepted){historyTrustAccepted=true;await terminalInput.press('ArrowDown');await terminalInput.press('Enter')}return value},{timeout:20000}).toContain('Thissessionhasnosavedtranscript')
        await expect.poll(async()=>(await attachment())?.state?.status).toBe('exited')
        expect(await liveWorker()).toBeUndefined()
        observations.childResume.historyRefusal={attachment:await attachment(),originalText:true,noWorker:true,historyTrustAccepted,jobs:await list(),journalSha256Before:createHash('sha256').update(originalJournal).digest('hex')}
        await captureResume('resume-history-refusal');await closeAttachment()
        expect(await readFile(preserved,'utf8')).toBe(originalJournal)
        await restoreJournal();expect(await readFile(journal,'utf8')).toBe(originalJournal)
        observations.childResume.historyRefusal.journalRestored=true
        observations.childResume.historyRefusal.journalSha256After=createHash('sha256').update(await readFile(journal)).digest('hex')
      } finally {if(moved)await restoreJournal()}
    }
    observations.current = await context()
    observations.retainedDraft = retainedDraft
    expect(observations.current.sessionId).toBe(sessionId)
    for (const message of observations.current.messages) {
      const native = message.context?.claudeTerminalMessage
      if (native) expect(native.sessionId).toBe(sessionId)
    }
    const projects = join(workspace!, '.claude', 'projects')
    const parentJournals = (await Promise.all((await readdir(projects, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => readFile(join(projects, entry.name, sessionId + '.jsonl'), 'utf8').catch(() => undefined)))).filter(Boolean)
    expect(parentJournals).toHaveLength(1)
    const costs = parentJournals[0]!.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.type === 'cost-state')
    expect(costs.length).toBeGreaterThan(0)
    expect(observations.current.claude.totalCostUsd).toBe(costs.at(-1).totalCostUSD)

    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ sessionId, backgroundSessionId: job.sessionId, jobId: job.id, nativeBackgroundHandoff: true, nativeLeftArrow: true, nativeBackgroundConfirmation: true, nativeBackgroundControls: true, ...(attachChild&&!childResume?{nativeBackgroundAttachment:true}:{}), ...(childInteraction?{nativeBackgroundChildInteractions:true}:{}), ...(childResume?{nativeBackgroundResume:true}:{}), ...(childReply?{nativeBackgroundReply:true}:{}), ...(parentOwnerLoss?{nativeBackgroundParentOwnerLoss:true}:{}), ...(childStatus?{nativeBackgroundStatus:true}:{}), ...(childStatusLifecycle?{nativeBackgroundStatusLifecycle:true}:{}), appHandoffAccepted: false }))
  } finally {
    if ((childInteraction && !observations.childInteraction) || (childResume && !observations.childResume?.workerRetired)) {observations.failedAttachments=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeTerminalViews).map((view:any)=>view.attachment).filter(Boolean));await capture('apack-native-child-interaction-failure.png')}
    if (!job) job = (await list()).find((row: any) => row.kind === 'background' && row.id && !before.some((old: any) => old.id === row.id))
    if (job) {
      observations.after = await list()
      if (observations.after.find((row: any) => row.id === job.id)?.state !== 'stopped') { observations.cleanupStop = await cli(['stop', job.id]); observations.after = await list() }
      expect(observations.after.find((row: any) => row.id === job.id)?.state).toBe('stopped')
    }
    observations.current = await context()
    await writeFile(join(workspace!, 'native-background-app-observation.json'), JSON.stringify(observations, null, 2))
  }
})
