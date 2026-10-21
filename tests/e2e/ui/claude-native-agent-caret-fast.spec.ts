import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},info) => { if(info.status!==info.expectedStatus)await appPage.screenshot({caret:'initial',path:info.outputPath('agent-caret-fast-failure.png')}).catch(()=>{}) })
test('rechecks the original immediate fill and Home sequence without an acknowledgement wait', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
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
  await expect.poll(async () => (await context()).turns,{timeout:20000}).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  let theme=false,security=false,navigated=false,trusted=false
  await expect.poll(async()=>{
    const native=(await context()).native
    const text=native?.output?.map((chunk:any)=>chunk.text).join('')??''
    const screen=recognizeOnboardingPrompt(text,workspace)
    if(screen==='theme'&&!theme){theme=true;await input.press('Enter')}
    else if(screen==='security-notes'&&theme&&!security){security=true;await input.press('Enter')}
    else if(screen==='workspace-trust'&&!navigated){navigated=true;await input.press('ArrowDown')}
    else if(screen==='workspace-trust-selected'&&navigated&&!trusted){trusted=true;await input.press('Enter')}
    return native?.state?.status==='live'&&native.state.mainStatus?.includes('Session ready')
  },{timeout:25000,intervals:[250]}).toBe(true)
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
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()

  const parent='Keep the parent review draft.',base='Review release changes carefully.',expected=base.slice(0,9)+'CHECK'+base.slice(9)
  await expect.poll(async()=>(await context()).messages.some((message:any)=>message.text?.includes('ParentSubagentFixtureComplete'))).toBe(true)
  await composer.fill(parent);const before=await context()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),field=form.locator('[contenteditable="true"]')
  await expect(field).toBeEditable()
  const inspect=()=>field.evaluate(element=>{const editor=(element as any).editor,s=document.getSelection();return {text:editor.storage.markdown.getMarkdown(),cursor:editor.state.selection.head-1,selection:editor.state.selection.toJSON(),focused:document.activeElement===element,domAnchorOffset:s?.anchorOffset,domFocusOffset:s?.focusOffset}})
  const edits=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-ime-edits.json'),'utf8').catch(()=>'[]'))
  // Preserve the original failing order: there is deliberately no native acknowledgement wait here.
  await field.fill(base);await field.press('Home');for(let i=0;i<9;i++)await field.press('ArrowRight')
  const immediate=await inspect();await writeFile(join(workspace!,'native-agent-caret-fast-partial.json'),JSON.stringify({immediate,edits:await edits()}))
  await expect.poll(async()=>(await inspect()).cursor).toBe(9)
  await expect.poll(async()=>(await edits()).at(-1)).toMatchObject({text:base,cursor:9})
  const tools=form.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  await form.getByRole('button',{name:'Read current draft',exact:true}).click()
  const read=async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8').catch(()=>'null'))
  await expect.poll(read).toEqual({text:base,cursor:9});const initialNative=await read()
  await field.focus();await appPage.keyboard.type('CHECK');await expect(field).toHaveText(expected)
  await expect.poll(async()=>(await edits()).at(-1)).toMatchObject({text:expected,cursor:14})
  await form.getByRole('button',{name:'Read current draft',exact:true}).click();await expect.poll(read).toEqual({text:expected,cursor:14});const finalNative=await read()
  if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-agent-caret-fast-proof.json'),JSON.stringify({sessionId,taskId,base,expected,immediate,initialNative,finalNative,noAcknowledgementWaitBeforeKeys:true,noPhantomTurn:true,edits:await edits(),boundNativePid}))
  for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});await field.focus();await expect(field).toHaveText(expected);await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport({ratio:1});await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await appPage.screenshot({caret:'initial',path:testInfo.outputPath('agent-caret-fast-'+width+'.png')})}
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parent)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after checking immediate Agent keys.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentCaret:true,nativeAgentCaretFast:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
