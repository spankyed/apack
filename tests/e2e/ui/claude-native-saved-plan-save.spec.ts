import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveAppEnvironment } from '@apackdev/sdk/env'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('saves acknowledged native Plan and its prior mode before complete app shutdown', async ({ app, appPage, electronApp }, _testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const directoryFixture=JSON.parse(await readFile(join(workspace!,'reference-fixture.json'),'utf8'))
  const firstDirectory=directoryFixture.file.slice(0,directoryFixture.file.lastIndexOf('/')),secondDirectory=directoryFixture.secondFile.slice(0,directoryFixture.secondFile.lastIndexOf('/'))
  const stageDirectory=async(directory:string)=>{
    await appPage.evaluate(({threadId: _threadId,directory})=>(window as any).applicationState.system.get('default-setup/threads').send({type:'SEND_COMMAND',command:'cc-add-dir',text:JSON.stringify(directory)}),{threadId:(await context()).threadId,directory})
    await expect.poll(async()=>(await context()).claude.additionalDirs).toContain(directory)
  }
  await stageDirectory(firstDirectory)
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1],rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
  }
  await expect.poll(resize).toBeTruthy();const dimensions=(await resize())!;
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('Session ready') === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('Session ready'))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('Session ready')
    await expect(main).toContainText('Reviewing release notes')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  const read=async(turn:number)=>{const before=(await context()).messages.filter((message:any)=>message.text?.includes('Directory review complete.')).length;await composer.fill('ResearchDirectoryTurn'+turn);await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('');const approval=appPage.getByRole('region',{name:'Read approval',exact:true});await expect(approval).toBeVisible();await expect(approval.getByTestId('native-read-path')).toHaveText(turn===1?directoryFixture.file:directoryFixture.secondFile);await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toHaveCount(0);await expect.poll(async()=>(await context()).native.state.busy).toBe(false);await expect.poll(async()=>(await context()).messages.filter((message:any)=>message.text?.includes('Directory review complete.')).length).toBeGreaterThan(before)}
  await read(1)
  const planText='Plan the saved release review without changing files.',editText='Continue the saved release review in native Edit.'
  await composer.fill(planText);await card.getByRole('button',{name:'Edit',exact:true}).click();await appPage.getByRole('menuitem',{name:'Plan',exact:true}).click();await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect(composer).toHaveText('');await expect.poll(async()=>(await context()).claude.permissionMode).toBe('plan');await expect.poll(async()=>(await context()).claude.prePlanMode).toBe('acceptEdits')
  await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
  await expect.poll(async()=>(await context()).messages.filter((row:any)=>row.text===planText).length).toBe(1)
  await composer.fill(editText);await card.getByRole('button',{name:'Plan',exact:true}).click();await appPage.getByRole('menuitem',{name:'Edit',exact:true}).click()
  const before=await context(),originalMode=before.claude.prePlanMode
  expect(before.claude.permissionMode).toBe('plan');expect(originalMode).toBe('acceptEdits')
  const history=before.messages.filter((row:any)=>row.context?.cliUuid).map((row:any)=>({id:row.id,uuid:row.context.cliUuid,text:row.text,sender:row.sender}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await stageDirectory(secondDirectory);await expect(composer).toHaveText(editText);await expect(card.getByRole('button',{name:'Edit',exact:true})).toBeVisible()
  const after=await context(),api=JSON.parse(await readFile(resolveAppEnvironment({env:'test',userDataDir:join(workspace!,'app-data')}).apiPortFile,'utf8'))
  expect(after.claude.nativeLaunch).toMatchObject({permissionMode:'plan',prePlanMode:originalMode});expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-composer-cold-state.json'),JSON.stringify({sessionId,threadId:before.threadId,boundNativePid,mainPid:electronApp.process().pid,apiPid:api.pid,firstDirectory,secondDirectory,originalMode,planText,editText,history,cost:after.claude.totalCostUsd,toolCallCount:after.claude.toolCallCount,savedLaunch:after.claude.nativeLaunch}))
})
