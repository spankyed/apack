import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@app/claude-terminal-xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test('preserves literal parent and Agent drafts through remount and exact native Agent Send', async ({ app, appPage, electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia,promptSyntax,uiCopy,uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
  const restriction = false
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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


  await composer.fill('Review the release notes with a worker.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).native.state.tasks.some((task:any)=>task.status==='completed'),{timeout:20000}).toBe(true)
  await appPage.getByRole('button',{name:/^Native tools/}).first().click()
  const row=appPage.locator('[data-native-agent-id]').first(),taskId=await row.getAttribute('data-native-agent-id')
  expect(taskId).toBeTruthy()
  const reads=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-source-reads.json'),'utf8').catch(()=>'[]'))
  const edits=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-source-edits.json'),'utf8').catch(()=>'[]'))
  const readDraft=async(container:typeof card)=>{
    const tools=container.getByRole('button',{name:'Session tools',exact:true})
    if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
    const count=(await reads()).length
    await container.getByRole('button',{name:'Read review draft',exact:true}).click()
    await expect.poll(async()=>(await reads()).length).toBe(count+1)
    const value=(await reads()).at(-1);await tools.click();return value
  }
  const prepare=async(container:typeof card,editor:typeof composer,owner:string)=>{
    const count=(await edits()).length
    await editor.fill(owner+' release review');await editor.press('End');await editor.pressSequentially(' outline')
    await expect.poll(async()=>(await edits()).length).toBe(count+1)
    const receipt=(await edits()).at(-1),literal=editor.locator('[data-claude-prompt-source]')
    await expect(literal).toHaveText(receipt.result.text)
    await editor.pressSequentially('!')
    const typed=await readDraft(container)
    expect(typed.value).toEqual({text:receipt.result.text.slice(0,receipt.result.cursor)+'!'+receipt.result.text.slice(receipt.result.cursor),cursor:receipt.result.cursor+1})
    await editor.focus();await editor.press('Backspace');await expect(literal).toHaveText(receipt.result.text)
    const restored=await readDraft(container);expect(restored.value).toEqual({text:receipt.result.text,cursor:receipt.result.cursor})
    return receipt.result
  }
  const parent=await prepare(card,composer,'Parent')
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),agentComposer=form.locator('[contenteditable="true"]')
  await expect(focused).toBeVisible();const agent=await prepare(form,agentComposer,'Worker')
  await agentComposer.evaluate(el=>el.setAttribute('data-source-original','true'))
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer.locator('[data-claude-prompt-source]')).toHaveText(parent.text)
  expect((await readDraft(card)).value).toEqual({text:parent.text,cursor:parent.cursor})
  await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect(focused).toBeVisible()
  expect(await agentComposer.getAttribute('data-source-original')).toBeNull()
  await expect(agentComposer.locator('[data-claude-prompt-source]')).toHaveText(agent.text)
  const remounted=await readDraft(form);expect(remounted.view.agentId).toBe(taskId)
  expect(remounted.value).toEqual({text:agent.text,cursor:agent.cursor})
  await agentComposer.focus();await agentComposer.press('Meta+ArrowDown');await agentComposer.press('End');await agentComposer.press('Shift+Enter');await agentComposer.pressSequentially('Checked worker notes.')
  const sent=(await readDraft(form)).value.text
  expect(sent).toBe(agent.text+'\nChecked worker notes.')
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900});await agentComposer.focus();await agentComposer.press('Meta+ArrowDown');await agentComposer.press('End')
    await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
    await expect(agentComposer.locator('[data-claude-prompt-source]')).toContainText('Checked worker notes.')
    await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-agent-source-'+width+'.png')})
  }
  await form.getByRole('button',{name:'Send to Agent',exact:true}).click();await expect(agentComposer).toHaveText('')
  await expect.poll(async()=>appPage.evaluate(text=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).some((view:any)=>view.state?.agent?.messages?.some((message:any)=>message.role==='user'&&message.text===text)),sent)).toBe(true)
  const files=await readdir(join(workspace!,'.claude/projects'),{recursive:true});let receipt:any
  await expect.poll(async()=>{for(const file of files.filter(file=>file.endsWith('.jsonl')&&file.includes('agent-'+taskId))){const rows=(await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').map(line=>JSON.parse(line));receipt=rows.find(row=>row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human'&&typeof row.message?.content==='string'&&row.message.content.includes(sent)&&row.message.content.split(sent).length===2);if(receipt)return true}return false}).toBe(true)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer.locator('[data-claude-prompt-source]')).toHaveText(parent.text)
  expect((await readDraft(card)).value).toEqual({text:parent.text,cursor:parent.cursor})
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after verifying the worker review.');await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-agent-source-proof.json'),JSON.stringify({taskId,parent,agent,sent,reads:await reads(),edits:await edits(),remounted:true,nativeUuid:receipt.uuid,sessionId,boundNativePid}))
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentSource:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
