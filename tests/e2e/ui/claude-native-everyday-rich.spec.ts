import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { stripVTControlCharacters } from 'node:util'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(async({appPage,electronApp},info)=>{
  terminalScreen?.dispose();terminalScreen=undefined;
  if(info.status===info.expectedStatus||appPage.isClosed())return;
  await writeFile(join(workspace!,'native-rich-everyday-failure.txt'),await appPage.locator('body').innerText().catch(()=>'<page unavailable>'));
  try{const window=await electronApp.browserWindow(appPage),size=appPage.viewportSize()!;const png=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size);await writeFile(info.outputPath('native-rich-everyday-failure.png'),Buffer.from(png,'base64'))}catch{}
});
test('reads and submits everyday rich parent and Agent drafts across compact return', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(120000)
  async function capture(file:string){
    const window=await _electronApp.browserWindow(appPage),size=appPage.viewportSize()!
    const image=await window.evaluate(async(window,size)=>(await window.webContents.capturePage({x:0,y:0,...size})).toPNG().toString('base64'),size)
    await writeFile(testInfo.outputPath(file),Buffer.from(image,'base64'))
  }

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
  // Native cold startup can finish after Playwright's generic five-second assertion window.
  await expect.poll(async () => (await context()).turns, { timeout: 20000 }).toBe(1)
  const sessionId = (await context()).sessionId; expect(sessionId).toBeTruthy()
  const section = appPage.getByRole('region', { name: 'Claude native interface', exact: true })
  await expect(section.getByRole('button', { name: 'Use native interface', exact: true })).toBeEnabled()
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  const input = section.locator('textarea.xterm-helper-textarea')
  // Reuse the installed app emulator: native cursor-diff updates cannot be recognized by stripping escapes.
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const resize=async()=>{const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return;const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'));const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1);const cols=row?.match(/columns:\s*(\d+)/)?.[1];return cols?{cols:Number(cols),rows:200}:undefined}
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
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).native.state.tasks.some((task: any) => task.status === 'completed'), { timeout: 20000 }).toBe(true)
  await appPage.getByRole('button', { name: /^Native tools/ }).first().click()
  const row = appPage.locator('[data-native-agent-id]').first()
  const taskId = await row.getAttribute('data-native-agent-id'); expect(taskId).toBeTruthy()


  const observations:any[]=[];
  const snapshot=(editor:typeof composer)=>editor.evaluate((element:any)=>{const e=element.editor;return {doc:e.state.doc.toJSON(),selection:e.state.selection.toJSON(),canonical:e.storage.markdown.getMarkdown()}});
  const saved=await _electronApp.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage().toDataURL()}));
  const source=(owner:string)=>'# '+owner+" release review\n\nReview behavior changes.\n\n```ts\nconst ready = true\n```\n\n- Confirm installation\n- Document migration\n\nKeep the compatibility notes.";
  const pasteDraft=async(editor:typeof composer,owner:string)=>{
    await _electronApp.evaluate(({clipboard},text)=>clipboard.writeText(text),source(owner));
    await editor.focus();await editor.press('ControlOrMeta+a');await editor.press('ControlOrMeta+v');
    await expect(editor.locator('h1')).toHaveText(owner+' release review');await expect(editor.locator('pre')).toContainText('const ready = true');await expect(editor.locator('li')).toHaveCount(2);
    await editor.locator('p').filter({hasText:'Review behavior changes.'}).click();await editor.press('Home');await editor.press('Shift+ArrowRight');await editor.press('Shift+ArrowRight');
    return snapshot(editor);
  };
  async function review(owner:string,container:typeof card,editor:typeof composer,agent:boolean){
    const area=agent?container.locator('[data-native-agent-draft-viewport]'):container.getByTestId('composer-editor-area');
    const button=container.getByRole('button',{name:agent?'Send to Agent':'Send',exact:true});
    for(const [width,height]of [[1100,900],[680,600]]){
      await appPage.setViewportSize({width,height});
      await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const metrics=await area.evaluate(element=>{const b=element.getBoundingClientRect();return {height:b.height,top:b.top,bottom:b.bottom,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight}});
      observations.push({owner,width,height,metrics,sessionId:(await context()).sessionId,nativePid:(await context()).native.state.nativePid});
      await writeFile(join(workspace!,'native-rich-everyday-progress.json'),JSON.stringify(observations,null,2));
      await capture('native-rich-everyday-'+owner+'-'+width+'-before.png');
      expect(metrics.height).toBeGreaterThanOrEqual(width===680?88:112);
      await expect(button).toBeInViewport({ratio:1});
      const beforeReading=await snapshot(editor);
      for(const [edge,target,delta]of [['top',editor.locator('h1'),-1600],['bottom',editor.locator('p').filter({hasText:'Keep the compatibility notes.'}),1600]]as const){
        await area.hover();await appPage.mouse.wheel(0,delta);
        await expect.poll(()=>target.evaluate(element=>{const r=element.getBoundingClientRect(),area=element.closest('[data-native-agent-draft-viewport],[data-testid="composer-editor-area"]')!.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(element);const text=range.getBoundingClientRect(),hit=document.elementFromPoint(text.left+text.width/2,text.top+text.height/2);return r.top>=area.top-1&&r.bottom<=area.bottom+1&&r.top>=0&&r.bottom<=innerHeight&&r.left>=area.left-1&&r.right<=area.right+1&&!!hit&&element.contains(hit)})).toBe(true);
        await expect(button).toBeInViewport({ratio:1});await capture('native-rich-everyday-'+owner+'-'+width+'-'+edge+'.png');
        expect(await snapshot(editor)).toEqual(beforeReading);
      }
    }
    await editor.locator('p').filter({hasText:'Review behavior changes.'}).click();await editor.press('Home');await editor.press('Shift+ArrowRight');await editor.press('Shift+ArrowRight');
    await expect(appPage.locator('.bubble-menu:visible')).toHaveCount(1);
  }
  try{
    const parentDraft=await pasteDraft(composer,'Parent');await review('parent',card,composer,false);
    const parentBefore=await snapshot(composer);
    await row.getByRole('button',{name:'Open Agent',exact:true}).click();
    const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),agentEditor=form.locator('[contenteditable="true"]');
    await expect(focused).toBeVisible();const agentDraft=await pasteDraft(agentEditor,'Agent');await review('agent',form,agentEditor,true);
    const agentBefore=await snapshot(agentEditor);
    await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();
    await expect(composer).toBeVisible();await expect.poll(()=>snapshot(composer)).toEqual(parentBefore);
    if(!await row.isVisible())await appPage.getByRole('button',{name:/^Native tools/}).first().click();
    await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect.poll(()=>snapshot(agentEditor)).toEqual(agentBefore);
    await form.getByRole('button',{name:'Send to Agent',exact:true}).click();
    await expect(agentEditor).toHaveText('');await expect(focused.getByRole('region',{name:'Agent transcript',exact:true})).toContainText('Keep the compatibility notes.');
    await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect.poll(()=>snapshot(composer)).toEqual(parentBefore);
    await card.getByRole('button',{name:'Send',exact:true}).click();await expect(composer).toHaveText('');
    await expect.poll(async()=>(await context()).messages.filter((m:any)=>m.sender==='user'&&m.text===parentBefore.canonical).length).toBe(1);
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false);
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/);
    const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click();
    const recovery='Continue the everyday rich release review.';
    await composer.focus();await composer.press('ControlOrMeta+a');await composer.press('Backspace');await composer.pressSequentially(recovery);await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>(await context()).claude.chatState).toBe('success');const final=await context();expect(final.sessionId).toBe(sessionId);expect(final.messages.filter((m:any)=>m.sender==='user'&&m.text===recovery)).toHaveLength(1);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'native-rich-everyday-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,parentDraft,parentBefore,agentDraft,agentBefore,observations,final,recovery},null,2));
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeEverydayRich:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));
  }finally{
    await _electronApp.evaluate(({clipboard,nativeImage},saved)=>{const image=nativeImage.createFromDataURL(saved.image);clipboard.write({text:saved.text,html:saved.html,rtf:saved.rtf,...(!image.isEmpty()?{image}:{})})},saved);
  }
});
