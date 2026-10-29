import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async({appPage},info) => { if(info.status!==info.expectedStatus)await appPage.screenshot({caret:'initial',path:info.outputPath('native-composer-wrap-failure.png')}).catch(()=>{}) })
test('keeps multiline prose and long tokens readable across ordinary composer resizing', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const restriction = false
  let initialLive:any
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
    if(native?.state?.status==='live'&&!initialLive)initialLive={at:Date.now(),state:native.state}
    return native?.state?.status==='live'&&native.state.mainStatus?.includes('Session ready')
  },{timeout:25000,intervals:[250]}).toBe(true)
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
  const draft='Review the release notes and confirm the migration checklist. Keep the explanation readable when this window gets smaller.\n\nCheck the generated reference: https://example.com/releases/'+ 'migration'.repeat(24)+'\n\nFinal checklist item: preserve this entire unsent draft and continue editing here.'
  await composer.fill(draft);const before=await context(),samples:any[]=[]
  const canonical=await composer.evaluate(element=>(element as any).editor.storage.markdown.getMarkdown())
  expect(await composer.innerText()).toContain('Final checklist item: preserve this entire unsent draft and continue editing here.')
  const measure=()=>composer.evaluate(element=>{
    const editor=(element as any).editor,root=element.getBoundingClientRect(),site=element.closest('[data-testid="composer-editor-area"]')!.getBoundingClientRect(),card=element.closest('[data-onboarding-id="agent-chat-input"]')!.getBoundingClientRect()
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),rects:any[]=[];let node:Node|null
    while((node=walker.nextNode())){if(!node.textContent?.length)continue;const range=document.createRange();range.selectNodeContents(node);rects.push(...Array.from(range.getClientRects(),r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})));}
    const selection=document.getSelection(),caret=selection?.rangeCount?selection.getRangeAt(0).getBoundingClientRect():undefined
    const scrollers=[];for(let parent:HTMLElement|null=element as HTMLElement;parent;parent=parent.parentElement){if(['auto','scroll'].includes(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight+1)scrollers.push({tag:parent.tagName,testId:parent.dataset.testid??null,scrollTop:parent.scrollTop,clientHeight:parent.clientHeight,scrollHeight:parent.scrollHeight});if(parent.hasAttribute('data-onboarding-id'))break}
    const strip=element.closest('[data-onboarding-id]')!.querySelector<HTMLElement>('[data-testid="composer-session-strip"]')!,stripRect=strip.getBoundingClientRect()
    return {strip:{height:stripRect.height,scrollHeight:strip.scrollHeight,flexShrink:getComputedStyle(strip).flexShrink},site:{top:site.top,bottom:site.bottom},card:{top:card.top,bottom:card.bottom},scrollers,lines:new Set(rects.map(r=>Math.round(r.top))).size,horizontalOverflow:rects.some(r=>r.left<root.left-2||r.right>root.right+2),root:{left:root.left,right:root.right},scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,caret:caret?{left:caret.left,right:caret.right,top:caret.top,bottom:caret.bottom}:null,caretVisible:!!caret&&caret.left>=root.left-2&&caret.right<=root.right+2&&caret.top>=Math.max(site.top,card.top)-2&&caret.bottom<=Math.min(site.bottom,card.bottom)+2,whiteSpace:getComputedStyle(element).whiteSpace,canonical:editor.storage.markdown.getMarkdown()}
  })
  for(const [index,{width,height}] of [{width:1100,height:900},{width:680,height:600},{width:680,height:800},{width:680,height:600},{width:1100,height:900}].entries()){
    await appPage.setViewportSize({width,height});await composer.focus();await composer.press('Control+End')
    await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
    let geometry=await measure()
    try {await expect.poll(async()=>{geometry=await measure();return geometry.caretVisible}).toBe(true)} finally {
      samples.push({width,height,canonical:geometry.canonical,geometry})
      await writeFile(join(workspace!,'native-composer-wrap-partial.json'),JSON.stringify({canonical,samples}))
      await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-composer-wrap-'+index+'-'+width+'.png')})
    }
    await expect(status).toHaveText('Session ready\nReviewing release notes');await expect(status).toBeInViewport({ratio:1});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1})
    expect(geometry.canonical).toBe(canonical);expect(geometry.horizontalOverflow).toBe(false);expect(geometry.caretVisible).toBe(true);expect(geometry.scrollers.length).toBeLessThanOrEqual(1)
  }
  expect(samples[1].geometry.lines).toBeGreaterThan(samples[0].geometry.lines)
  expect(samples[4].geometry.lines).toBe(samples[0].geometry.lines)
  const after=await context();expect(after.turns).toBe(before.turns);expect(after.messages.map((m:any)=>m.id)).toEqual(before.messages.map((m:any)=>m.id));expect(after.native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-composer-wrap-proof.json'),JSON.stringify({sessionId,boundNativePid,canonical,samples,noPhantomTurn:true}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  expect(await composer.evaluate(element=>(element as any).editor.storage.markdown.getMarkdown())).toBe(canonical)
  await composer.fill('Continue after checking multiline composing.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeComposerWrap:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
