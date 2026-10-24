import { readFile, readdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('retires a held question after owner loss and permits one fresh same-session answer', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(150000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForSurface('default-setup/threads'); await app.navigate('default-setup/threads')
  await app.navigate('host/settings')
  await appPage.evaluate(() => { const settings = (window as any).applicationState.system.get('host/settings'); settings.send({ type: 'TAB.SELECT', tab: 'general' }); settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' }) })
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..')
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!)
  await appPage.waitForTimeout(700)
  await app.navigate('default-setup/threads')
  await appPage.evaluate(cwd => { const actor = (window as any).applicationState.system.get('default-setup/threads'); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd }); actor.send({ type: 'VIEW_DASHBOARD' }); actor.send({ type: 'SET_MODE', mode: 'Claude Code' }); actor.send({ type: 'SET_PHASE', phase: 'Edit' }) }, workspace!)
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]')
  await card.locator('[contenteditable="true"]').fill('Help me review the release notes and checklist.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
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
  const nativeWindow=await electronApp.browserWindow(appPage),captures:string[]=[]
  const draft='Keep my audience-review wording while recovering this question.'
  const question=appPage.getByTestId('native-question-panel')
  const controls=async()=>JSON.parse(await readFile(join(workspace!,'native-client-control-receipts.json'),'utf8').catch(()=>'[]'))
  const answers=async()=>(await controls()).filter((row:any)=>row.request.subtype==='apack_answer_question_dialog')
  const frame=()=>appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return (Object.values(c.nativeUiViews) as any[]).find(v=>v.threadId===c.currentThread?.id&&v.state?.question)?.state.question})
  async function journal(){for(const bucket of await readdir(join(workspace!,'.claude/projects'))){try{return (await readFile(join(workspace!,'.claude/projects',bucket,sessionId+'.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))}catch(error:any){if(error.code!=='ENOENT')throw error}}return []}
  async function capture(stage:string){for(const [width,height] of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});if(await question.isVisible()){for(const control of [question.locator('h2'),question.getByRole('button',{name:'Submit answers',exact:true})])await expect(control).toBeInViewport({ratio:1})}else{await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})}const png=await nativeWindow.evaluate(async(win,size)=>(await win.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),{width,height});const name='native-question-owner-'+stage+'-'+width+'.png';await writeFile(testInfo.outputPath(name),Buffer.from(png,'base64'));captures.push(name)}}
  async function ask(text:string){for(const name of ['everyday-question-ready.json','everyday-question-release'])await unlink(join(workspace!,name)).catch(error=>{if(error.code!=='ENOENT')throw error});await composer.fill(text);await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>readFile(join(workspace!,'everyday-question-ready.json'),'utf8').then(()=>true,()=>false)).toBe(true);await composer.fill(draft);await writeFile(join(workspace!,'everyday-question-release'),'release');await expect(question).toBeVisible();await expect(question).toContainText('Who should the release summary address?');await expect(composer).toHaveText(draft)}
  try{
    await ask('Ask me which release audience to target.')
    const before=await context(),retired=before.claude.pendingControlRequest,oldFrame=await frame()
    expect(retired.toolName).toBe('AskUserQuestion');expect(retired.nativeTerminal.ownerId).toBe(before.native.state.ownerId);expect(oldFrame.messageId).toBe(retired.approvalMessageId);expect(oldFrame.token).toBeTruthy();expect(await answers()).toHaveLength(0)
    const history=before.messages.filter((row:any)=>row.context?.cliUuid).map((row:any)=>({id:row.id,uuid:row.context.cliUuid,text:row.text,sender:row.sender}))
    await capture('before-loss');expect(boundNativePid).toBeGreaterThan(1);expect(boundNativePid).not.toBe(process.pid);process.kill(boundNativePid,'SIGKILL')
    await expect.poll(async()=>(await context()).native.state.status).toBe('error');await expect(question).toHaveCount(0);await expect.poll(async()=>(await context()).claude.pendingControlRequest).toBeFalsy();await expect(composer).toHaveText(draft)
    await expect.poll(()=>{try{process.kill(boundNativePid,0);return false}catch(error:any){if(error.code!=='ESRCH')throw error;return true}}).toBe(true)
    await expect.poll(async()=>(await context()).messages.find((row:any)=>row.id===retired.approvalMessageId)?.blockResponse?.cancelled).toBe(true)
    const retiredHistory=(await context()).messages.find((row:any)=>row.id===retired.approvalMessageId)
    await appPage.setViewportSize({width:1100,height:900});await section.getByRole('button',{name:'Use native interface',exact:true}).click()
    await expect.poll(async()=>{const state=(await context()).native?.state;return !!state?.ownerId&&state.ownerId!==retired.nativeTerminal.ownerId&&state.nativePid>1&&state.nativePid!==boundNativePid}).toBe(true)
    await expect.poll(resize).toBeTruthy();const reopenedDimensions=(await resize())!
    terminalScreen?.dispose();terminalScreen=new Terminal({cols:reopenedDimensions.cols,rows:reopenedDimensions.rows,allowProposedApi:true});lastSequence=0
    let navigation=false,confirmed=false,selectedAt=0
    await expect.poll(async()=>{const n=(await context()).native,fit=await resize();if(fit)terminalScreen!.resize(fit.cols,fit.rows);const chunks=n?.output?.filter((chunk:any)=>chunk.sequence>lastSequence)??[];if(chunks.length){await new Promise<void>(resolve=>terminalScreen!.write(chunks.map((chunk:any)=>chunk.text).join(''),resolve));lastSequence=chunks.at(-1).sequence}const b=terminalScreen!.buffer.active,text=Array.from({length:terminalScreen!.rows},(_,row)=>b.getLine(b.baseY+row)?.translateToString(true)??'').join('\n'),screen=recognizeOnboardingPrompt(text,workspace);if(screen==='workspace-trust'&&!navigation){navigation=true;selectedAt=Date.now();await input.press('ArrowDown')}else if(screen==='workspace-trust-selected'&&!navigation){navigation=true;selectedAt=Date.now()}else if(screen==='workspace-trust-selected'&&navigation&&!confirmed&&Date.now()-selectedAt>1200){confirmed=true;await input.press('Enter')}return n?.state.status==='live'&&n.state.nativePid!==boundNativePid&&n.state.mainStatus?.includes('Release review')},{timeout:25000,intervals:[250]}).toBe(true)
    const reopenedNativePid=(await context()).native.state.nativePid
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(draft);await ask('Ask me which release audience after recovering the question.')
    const fresh=(await context()).claude.pendingControlRequest;expect(fresh.nativeTerminal.ownerId).not.toBe(retired.nativeTerminal.ownerId);expect(fresh.requestId).not.toBe(retired.requestId)
    const answer={answers:{'Who should the release summary address?':'Developers'}}
    await appPage.evaluate(({retired,token,answer})=>(window as any).applicationState.system.get('default-setup/threads').send({type:'RESPOND_TO_BLOCK_INTERACTION',messageId:retired.approvalMessageId,response:{nativeQuestionAnswer:answer,nativeQuestionRenderToken:token,nativeQuestionDraftStarted:false}}),{retired,token:oldFrame.token,answer})
    await expect.poll(async()=>{const log=await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8');return [...log.matchAll(/Incoming: "INTERACTIVE_MSG_RESPONSE" \{[\s\S]*?\n\}/g)].some(match=>match[0].includes(retired.approvalMessageId))}).toBe(true)
    expect((await context()).claude.pendingControlRequest.requestId).toBe(fresh.requestId);expect(await answers()).toHaveLength(0);expect((await context()).messages.find((row:any)=>row.id===retired.approvalMessageId).blockResponse.cancelled).toBe(true)
    await capture('fresh-question');await question.getByRole('radio',{name:'Developers People integrating the updated behavior',exact:true}).check();await question.getByRole('button',{name:'Submit answers',exact:true}).click();await expect(question).toBeHidden();await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await expect.poll(async()=>(await answers()).length).toBe(1)
    const restored=await context(),recoveredCost=restored.claude.totalCostUsd;expect(restored.sessionId).toBe(sessionId);await expect(composer).toHaveText(draft)
    for(const old of history){const rows=restored.messages.filter((row:any)=>row.context?.cliUuid===old.uuid);expect(rows).toHaveLength(1);expect({id:rows[0].id,uuid:rows[0].context.cliUuid,text:rows[0].text,sender:rows[0].sender}).toEqual(old)}
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
    await composer.fill('Continue the audience review after recovery.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');await composer.fill(draft);await capture('recovered')
    const final=await context(),nativePrintResult=JSON.parse((await readFile(join(workspace!,'native-print-results.jsonl'),'utf8')).trim().split('\n').at(-1)!);expect(final.sessionId).toBe(sessionId);expect(nativePrintResult.totalCostUsd).toBe(final.claude.totalCostUsd);expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-question-owner-failure-proof.json'),JSON.stringify({sessionId,boundNativePid,reopenedNativePid,retired,fresh,retiredHistory,history,captures,retainedDraft:true,staleAnswerRefused:true,sameSessionRecovery:true,recoveredCost,continuedCost:final.claude.totalCostUsd,nativePrintResult,journal:await journal()},null,2))
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeQuestionOwnerFailure:true,nativeCost:recoveredCost,resumedCost:final.claude.totalCostUsd,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,reopenedNativePid,browserErrors:errors}))
  }catch(error){await writeFile(join(workspace!,'native-question-owner-failure-error.json'),JSON.stringify({context:await context(),journal:await journal()},null,2));const png=await nativeWindow.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(testInfo.outputPath('native-question-owner-failure.png'),Buffer.from(png,'base64'));throw error}
})
