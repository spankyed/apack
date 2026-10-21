import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},info) => { if(info.status!==info.expectedStatus)await appPage.screenshot({caret:'initial',path:info.outputPath('agent-structured-failure.png')}).catch(()=>{}) })
test('keeps selected Agent structured fills and decorations in their original owner through submission', async ({ app, appPage, electronApp }, testInfo) => {
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

  const parent='Keep the parent release review draft unchanged.'
  await expect.poll(async()=>(await context()).messages.some((message:any)=>message.text?.includes('ParentSubagentFixtureComplete'))).toBe(true)
  await composer.fill(parent);const before=await context()
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),field=form.locator('[contenteditable="true"]')
  await field.fill('Review the worker release notes.')
  const tools=form.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-structured-receipts.json'),'utf8').catch(()=>'[]'))
  for(const [index,label] of ['Use review outline','Add release checklist'].entries()){
    await form.getByRole('button',{name:label,exact:true}).click();await expect.poll(async()=>(await receipts()).length).toBe(index+1)
    expect((await receipts())[index].result.isFilled).toBe(true)
    await expect(field.locator('h1')).toHaveText('Worker release review');await expect(field.locator('pre')).toContainText('const ready = true')
    await expect(field.locator('.claude-prompt-decoration')).toHaveText(index?'Verify behavior':'Review changes.')
    await expect(field.locator('.claude-prompt-decoration')).toHaveCSS('font-weight','600')
  }
  await expect(field.locator('li')).toHaveText(['Verify behavior','Document migration'])
  await field.locator('p').filter({hasText:'Review changes.'}).click({position:{x:8,y:8}});await field.press('Home')
  const edits=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-structured-edits.json'),'utf8').catch(()=>'[]'))
  const prior=(await receipts())[1].after.text
  await expect.poll(async()=>(await edits()).at(-1)).toMatchObject({text:prior,cursor:prior.indexOf('Review changes.')})
  await form.getByRole('button',{name:'Add review note',exact:true}).click();await expect.poll(async()=>(await receipts()).length).toBe(3)
  const proofReceipts=await receipts();expect(proofReceipts[2].result.isFilled).toBe(true)
  await expect(field.locator('.claude-prompt-decoration')).toHaveText('Please')
  const finalCanonical=await field.evaluate(element=>(element as any).editor.storage.markdown.getMarkdown())
  expect(proofReceipts[2].after.text).toBe(finalCanonical)
  await form.getByRole('button',{name:'Read review draft',exact:true}).click()
  const reads=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-structured-reads.json'),'utf8').catch(()=>'[]'))
  await expect.poll(async()=>(await reads()).at(-1)?.value.text).toBe(finalCanonical);const finalNative=(await reads()).at(-1)
  if(await tools.getAttribute('aria-expanded')==='true')await tools.click()
  const afterFill=await context();expect(afterFill.turns).toBe(before.turns);expect(afterFill.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(afterFill.native.state.nativePid).toBe(boundNativePid)
  const window=await electronApp.browserWindow(appPage),captures:any[]=[]
  await appPage.evaluate(()=>document.fonts.ready.then(()=>undefined))
  for(const width of [1100,680]){
    await appPage.setViewportSize({width,height:width===680?600:900})
    for(const part of ['outline','checklist']){
      await (part==='outline'?field.locator('h1'):field.locator('li').last()).scrollIntoViewIfNeeded()
      await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport({ratio:1})
      expect(await field.evaluate(element=>(element as any).editor.storage.markdown.getMarkdown())).toBe(finalCanonical)
      await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
      const height=width===680?600:900
      const capture=await window.evaluate(async(win,size)=>{const image=await win.webContents.capturePage({x:0,y:0,...size});return {pixels:image.getSize(),contentSize:win.getContentSize(),png:image.toPNG().toString('base64')}},{width,height})
      expect(capture.pixels).toEqual({width,height})
      const file='agent-structured-'+part+'-'+width+'.png';await writeFile(testInfo.outputPath(file),Buffer.from(capture.png,'base64'))
      captures.push({file,viewport:{width,height},pixels:capture.pixels,contentSize:capture.contentSize,method:'owned Electron webContents.capturePage'})
      await writeFile(join(workspace!,'native-agent-structured-captures.json'),JSON.stringify(captures))
    }
  }
  await form.getByRole('button',{name:'Send to Agent',exact:true}).click();await expect(field).toHaveText('')
  const files=await readdir(join(workspace!,'.claude/projects'),{recursive:true});let humanRows:any[]=[]
  await expect.poll(async()=>{humanRows=[];for(const file of files.filter(file=>file.endsWith('.jsonl')&&file.includes('agent-'+taskId))){const rows=(await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').map(line=>JSON.parse(line));humanRows.push(...rows.filter(row=>row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human'&&typeof row.message?.content==='string'&&row.message.content.includes(finalCanonical)&&row.message.content.split(finalCanonical).length===2))}return humanRows.length}).toBe(1)
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer).toHaveText(parent)
  const parentTools=card.getByRole('button',{name:'Session tools',exact:true});if(await parentTools.getAttribute('aria-expanded')!=='true')await parentTools.click()
  const readCount=(await reads()).length;await card.getByRole('button',{name:'Read review draft',exact:true}).click();await expect.poll(async()=>(await reads()).length).toBe(readCount+1)
  const parentNative=(await reads()).at(-1);expect(parentNative.value.text).toBe(parent);expect(parentNative.view?.agentId).toBeUndefined()
  if(await parentTools.getAttribute('aria-expanded')==='true')await parentTools.click()
  await writeFile(join(workspace!,'native-agent-structured-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,parentDraft:parent,receipts:proofReceipts,finalCanonical,finalNative,parentNative,nativeUuid:humanRows[0].uuid,nativeHumanMatches:humanRows.length,noPhantomTurn:true,captures,edits:await edits()}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after reviewing the structured worker draft.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeAgentStructured:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
