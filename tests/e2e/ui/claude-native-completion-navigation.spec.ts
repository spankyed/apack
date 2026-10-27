import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
type Screen = { cols: number; rows: number; write(text: string, done: () => void): void; resize(cols: number, rows: number): void; dispose(): void; buffer: { active: { baseY: number; getLine(row: number): { translateToString(trim: boolean): string } | undefined } } }
let terminalScreen: Screen | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('uses original native completion rows with keyboard navigation in main and Agent', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(120000)
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
  await card.locator('[contenteditable="true"]').fill('Review the release notes for this project.')
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
  // The mounted app reports its actual fitted grid to the backend; no private DOM font probe.
  const resize = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);
    const cols=row?.match(/columns:\s*(\d+)/)?.[1], rows=row?.match(/rows:\s*(\d+)/)?.[1];return cols&&rows?{cols:Number(cols),rows:Number(rows)}:undefined;
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
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('Session ready')
  const composer = card.locator('[contenteditable="true"]')

  const nativeWindow=await electronApp.browserWindow(appPage),captures:{owner:string;width:number;file:string}[]=[],interactions:any[]=[]
  await nativeWindow.evaluate(window=>{window.show();window.focus()});await appPage.bringToFront()
  const replace=async(editor:typeof composer,text:string)=>{await editor.focus();await editor.press('Control+a');if(text)await editor.pressSequentially(text);await expect(editor).toHaveText(text)}
  const snapshot=(editor:typeof composer)=>editor.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
  await replace(composer,'Review the release notes with a worker.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
  const before=await context()
  async function exercise(container:typeof card,editor:typeof composer,owner:string,index:number){
    const beforeTurns=(await context()).turns,prefix='Review #release',labels=['Public release','Internal release','Release checklist'],descriptions=['Notes for customers','Notes for teammates','Checks before publishing']
    await replace(editor,prefix)
    const list=container.getByRole('group',{name:'Claude suggestions',exact:true}),buttons=list.getByRole('button')
    await expect(buttons).toHaveCount(3)
    for(let row=0;row<3;row++){await expect(buttons.nth(row)).toContainText(labels[row]!);await expect(buttons.nth(row)).toContainText(descriptions[row]!)}
    const original=await snapshot(editor)
    await editor.press('ArrowDown');await expect(buttons.nth(0)).toBeFocused()
    await buttons.nth(0).press('End');await expect(buttons.nth(2)).toBeFocused()
    await buttons.nth(2).press('Home');await expect(buttons.nth(0)).toBeFocused()
    await buttons.nth(0).press('Escape');await expect(list).toHaveCount(0);await expect(editor).toBeFocused();expect(await snapshot(editor)).toEqual(original)
    if(owner==='agent')await expect(focused).toBeVisible()
    await replace(editor,prefix);await expect(buttons).toHaveCount(3)
    await editor.press('ArrowUp');await expect(buttons.nth(2)).toBeFocused()
    await buttons.nth(2).press('Home');await expect(buttons.nth(0)).toBeFocused()
    if(index===1)await buttons.nth(0).press('ArrowDown');else await buttons.nth(0).press('End')
    await expect(buttons.nth(index)).toBeFocused()
    const send=container.getByRole('button',{name:owner==='main'?'Send':'Send to Agent',exact:true})
    for(const width of [1100,680]){
      const size={width,height:width===680?600:900};await appPage.setViewportSize(size)
      await expect(async()=>{await buttons.nth(index).scrollIntoViewIfNeeded();await expect(buttons.nth(index)).toBeInViewport({ratio:1});await expect(editor).toBeInViewport({ratio:1});await expect(send).toBeInViewport({ratio:1})}).toPass({timeout:5000,intervals:[100,250]})
      await expect(buttons.nth(index)).toBeFocused();expect(await snapshot(editor)).toEqual(original)
      const png=await nativeWindow.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size),file='native-completion-'+owner+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(png,'base64'));captures.push({owner,width,file})
    }
    await buttons.nth(index).press('Enter')
    const text='Review '+['#release-public','#release-internal','#release-checklist'][index]
    await expect(editor).toHaveText(text);await expect(editor).toBeFocused();await expect(list).toHaveCount(0)
    expect((await context()).turns).toBe(beforeTurns)
    interactions.push({owner,index,text,original,selected:await snapshot(editor),dismissPreservedDocumentAndCaret:true,descriptionsRetained:true,keyboardSelection:true,noSubmittedTurn:true})
    return text
  }
  // The closure is used only after the Agent region is mounted below.
  let focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true})
  const parentText=await exercise(card,composer,'main',1),parent=await snapshot(composer)
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id');expect(taskId).toBeTruthy()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect(focused).toBeVisible();await expect(card).toBeHidden()
  const form=focused.getByRole('form',{name:'Agent message',exact:true}),agentEditor=form.locator('[contenteditable="true"]')
  const agentText=await exercise(form,agentEditor,'agent',2)
  await form.getByRole('button',{name:'Send to Agent',exact:true}).click();await expect(agentEditor).toHaveText('')
  const agentRows=async()=>{const files=await readdir(join(workspace!,'.claude/projects'),{recursive:true}),path=files.find(file=>file.endsWith('/agent-'+taskId+'.jsonl'));if(!path)return [];return(await readFile(join(workspace!,'.claude/projects',path),'utf8')).trim().split('\n').map(JSON.parse)}
  await expect.poll(async()=>(await agentRows()).filter(row=>row.type==='assistant').length,{timeout:15000}).toBe(2)
  const nativeAgentHuman=(await agentRows()).filter(row=>row.type==='user'&&row.origin?.kind==='human'&&typeof row.message?.content==='string'&&row.message.content.includes(agentText));expect(nativeAgentHuman).toHaveLength(1)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parentText);expect(await snapshot(composer)).toEqual(parent)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited')
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  expect(await snapshot(composer)).toEqual(parent)
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');await expect(composer).toHaveText('')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-completion-navigation-proof.json'),JSON.stringify({sessionId,boundNativePid,taskId,captures,interactions,parentText,agentText,parent,agentHumanUuid:nativeAgentHuman[0].uuid,before,final:await context()},null,2))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeCompletionNavigation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
