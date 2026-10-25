import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('uses original terminal Client drawings, controls and lifetimes in the app', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, terminalClients } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!terminalClients, 'Explicit private terminal Client fixture required')
  const restriction = planScenario === 'managed-clear'
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
  await expect.poll(async () => (await context()).turns).toBe(1)
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
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain ' + sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain ' + sessionId)
    await expect(main).toContainText('Second native status line')
    await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain ' + sessionId)
  await appPage.setViewportSize({ width: 680, height: 600 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-managed-composer-status.png') })
  const composer = card.locator('[contenteditable="true"]')
  const info=appPage.locator('[data-native-placement="InfoNotice"] [data-native-client]').filter({hasText:'InfoNotice Client'}).first()
  try{await expect(info).toContainText('InfoNotice Client count=0 key=none',{timeout:10000})}catch(error){if(process.env.CLAUDE_RESEARCH_RASTER==='1'||process.env.CLAUDE_RESEARCH_IMAGE==='1'){await writeFile(join(workspace!,'native-raster-failure.json'),JSON.stringify(await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {views:c.nativeUiViews,native:c.nativeTerminalViews}})));await appPage.screenshot({path:testInfo.outputPath('native-raster-failure.png')})}throw error}
  if(process.env.CLAUDE_RESEARCH_CLIENT_RETURN==='1'){
    const stages: any[] = [], keys: any[] = [];
    const draft = 'Keep my review notes when returning from the native interface.';
    const events = async () => JSON.parse(await readFile(join(workspace!, 'native-terminal-client-events.json'), 'utf8'));
    const latest = async () => (await events()).filter((event: any) => event.kind === 'InfoNotice').at(-1);
    await appPage.evaluate(() => {
      (window as any).__clientReturnKeys = [];
      window.addEventListener('keydown', event => {
        const target = event.target as HTMLElement;
        (window as any).__clientReturnKeys.push({ key: event.key, client: target.closest('[data-native-client]')?.getAttribute('data-native-client'), input: target.hasAttribute('data-native-client-text-input') });
      }, true);
    });
    await composer.fill(draft);
    try {
      for (const [index, width] of [1100, 680, 1100].entries()) {
        const retired = await info.getAttribute('data-native-client');
        await section.getByRole('button', { name: 'Use native interface', exact: true }).click();
        await appPage.setViewportSize({ width, height: width === 680 ? 600 : 900 });
        expect((await context()).native.state.nativePid).toBe(boundNativePid);
        await section.getByRole('button', { name: 'Back to conversation', exact: true }).click();
        await expect(info).toBeVisible();
        await expect(composer).toHaveText(draft);
        const current = await info.getAttribute('data-native-client');
        expect(current).not.toBe(retired);
        await appPage.evaluate(token => {
          const actor = (window as any).applicationState.system.get('default-setup/threads'), c = actor.getSnapshot().context;
          const [mountId] = Object.entries(c.nativeUiViews).find(([, view]: any) => view.threadId === c.currentThread.id)!;
          actor.send({ type: 'CLAUDE_UI_CLIENT', mountId, threadId: c.currentThread.id, id: token, sequence: 1000000, event: { kind: 'key', key: 'old' } });
        }, retired);
        const key = ['j', 'k', 'l'][index];
        await info.scrollIntoViewIfNeeded();
        await info.focus();
        const focus = await info.evaluate(node => ({ held: node.contains(document.activeElement), target: document.activeElement?.tagName, input: document.activeElement?.hasAttribute('data-native-client-text-input') }));
        await info.press(key);
        await expect.poll(async () => (await latest())?.key).toBe(key);
        await info.getByRole('button', { name: 'Increment terminal Client', exact: true }).click();
        await expect.poll(async () => (await latest())?.count).toBe(index + 1);
        const originalReceipt = await latest();
        expect(originalReceipt.surface).toBe('terminal');
        expect(originalReceipt.key).toBe(key);
        expect((await events()).some((event: any) => event.key === 'old')).toBe(false);
        stages.push({ width, key, retired, current, focus, originalReceipt });
        await info.focus(); await info.press('Escape'); await expect(composer).toBeFocused();
        for (const target of [composer, status, card.getByRole('button', { name: 'Send', exact: true })]) {
          await expect(target).toBeInViewport();
          expect(await target.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)); })).toBe(true);
        }
        if(index<2)await appPage.screenshot({ path: testInfo.outputPath('native-client-return-'+width+'.png') });
      }
      keys.push(...await appPage.evaluate(() => (window as any).__clientReturnKeys));
      await writeFile(join(workspace!, 'native-client-return-proof.json'), JSON.stringify({ stages, keys, draft }, null, 2));
      await section.getByRole('button', { name: 'Use native interface', exact: true }).click();
      await section.getByRole('button', { name: 'Stop session', exact: true }).click();
      await expect.poll(async () => (await context()).native.state.status).toBe('exited');
      await section.getByRole('button', { name: 'Back to conversation', exact: true }).click();
      await composer.fill('Continue the same review after native interface return.');
      await card.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(async () => (await context()).claude.chatState).toBe('success');
      expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);
      await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui:true,nativePlanScenario:'composer-layout',nativeClientReturnKeys:true,nativeClientReturnActions:true,nativeClientRetiredToken:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors }));
    } catch(error) {
      await appPage.screenshot({path:testInfo.outputPath('native-client-return-failure.png')});
      await writeFile(join(workspace!,'native-client-return-failure.json'),JSON.stringify({stages,keys:await appPage.evaluate(()=>(window as any).__clientReturnKeys),latest:await latest(),state:await context(),focus:await info.evaluate(node=>({id:node.getAttribute('data-native-client'),keys:node.innerHTML,active:document.activeElement?.outerHTML}))},null,2));
      throw error;
    }
    return;
  }
  if(process.env.CLAUDE_RESEARCH_IMAGE_PIXELS==='1'){
    const image=appPage.locator('[data-native-placement="InfoNotice"] [data-native-image]').first(),receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-image-blits.json'),'utf8').catch(()=>'[]'))
    const pixel=()=>image.evaluate(element=>{const source=element.querySelector('img,canvas') as HTMLImageElement|HTMLCanvasElement;if(!source)return [];if(source instanceof HTMLImageElement&&!source.complete)return [];const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const c=canvas.getContext('2d')!;try{c.drawImage(source,0,0,2,2);return Array.from(c.getImageData(0,0,1,1).data)}catch{return []}})
    const terminalPixels=()=>section.locator('.webterm-kitty-overlay').evaluateAll(elements=>elements.flatMap(element=>Array.from(element.querySelectorAll('canvas')).filter(canvas=>canvas.getBoundingClientRect().width>0).map(canvas=>{try{return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data)}catch{return []}})))
    try{await expect.poll(pixel).toEqual([255,136,0,255])}catch(error){await writeFile(join(workspace!,'native-image-pixel-failure.json'),JSON.stringify({errors,state:await appPage.evaluate(()=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;return {views:c.nativeUiViews,native:c.nativeTerminalViews}})}));await appPage.screenshot({path:testInfo.outputPath('native-image-pixel-failure.png')});throw error}const draft='Keep my release notes while the original image changes.';await composer.fill(draft)
    await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).length).toBe(1);expect((await receipts())[0].result).toEqual({});await expect.poll(pixel).toEqual([0,136,255,255])
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await image.scrollIntoViewIfNeeded();await expect(image).toBeInViewport();await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport();expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.screenshot({path:testInfo.outputPath('native-image-pixels-'+size.width+'.png')})}
    await info.focus();await info.press('h');await expect(image).toHaveCount(0);await info.focus();await info.press('s');await expect.poll(pixel).toEqual([255,136,0,255]);await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).length).toBe(2);expect((await receipts())[1].result).toEqual({});await expect.poll(pixel).toEqual([0,136,255,255])
    await appPage.setViewportSize({width:1100,height:900});await section.getByRole('button',{name:'Use native interface',exact:true}).click();for(const size of [{width:1100,height:900},{width:680,height:600},{width:1100,height:900}]){await appPage.setViewportSize(size);if(size.width===1100)await expect.poll(terminalPixels).toContainEqual([0,136,255,255]);await appPage.screenshot({path:testInfo.outputPath('native-image-terminal-'+size.width+'.png')})}expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!,'native-image-app-proof.json'),JSON.stringify({initial:[255,136,0,255],swapped:await terminalPixels(),receipts:await receipts(),draft,sameNativeOwner:true}))
    await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue after inspecting the native image.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId)
    expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'composer-layout',nativeImagePixels:true,nativeImageSwap:true,nativeTerminalImagePixels:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));return
  }
  if(process.env.CLAUDE_RESEARCH_IMAGE==='1'){
    const image=appPage.locator('[data-native-placement="InfoNotice"]').getByText(/^Release cover (preview|updated)$/).first(),receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-image-blits.json'),'utf8').catch(()=>'[]'))
    await expect(image).toHaveText('Release cover preview');const draft='Keep my release notes while image admission changes.';await composer.fill(draft)
    await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).length).toBe(1);expect((await receipts())[0].result.deny).toMatch(/draws its alt|not drawn under a terminal root/);await expect(image).toHaveText('Release cover preview')
    await info.focus();await info.press('r');await expect(image).toHaveText('Release cover updated')
    await info.focus();await info.press('h');await expect(image).toHaveCount(0);await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).length).toBe(2);expect((await receipts())[1].result.deny).toContain('no Image')
    await info.focus();await info.press('s');await expect(image).toHaveText('Release cover updated');await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).length).toBe(3);expect((await receipts())[2].result.deny).toMatch(/draws its alt|not drawn under a terminal root/)
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await image.scrollIntoViewIfNeeded();await expect(image).toBeInViewport();await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport();expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.screenshot({path:testInfo.outputPath('native-image-fallback-'+size.width+'.png')})}
    await writeFile(join(workspace!,'native-image-app-proof.json'),JSON.stringify({text:await image.innerText(),receipts:await receipts(),draft,sameNativeOwner:(await context()).native.state.nativePid===boundNativePid}))
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue after inspecting native image admission.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId)
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'composer-layout',nativeImageFallback:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));return
  }
  if(process.env.CLAUDE_RESEARCH_RASTER==='1'){
    const raster=appPage.locator('[data-native-placement="InfoNotice"] [data-native-raster]').first();await expect(raster).toHaveText('Release \nready   ');await expect(raster).toHaveAttribute('data-columns','8');await expect(raster).toHaveAttribute('data-rows','2')
    const draft='Keep my release notes while the terminal drawing changes.';await composer.fill(draft)
    const blit=process.env.CLAUDE_RESEARCH_RASTER_BLIT==='1'
    const receipts=async()=>JSON.parse(await readFile(join(workspace!,'native-raster-blits.json'),'utf8').catch(()=>'[]'))
    const source=()=>appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).flatMap((view:any)=>view.state?.composer??[]).find((frame:any)=>frame.component==='InfoNotice')?.sourceRevision)
    const sourceBefore=await source()
    if(blit){
      await info.focus();await info.press('b');await expect(raster).toHaveText('Release \nblitted ');await expect.poll(async()=>(await receipts()).length).toBe(1);expect((await receipts())[0].result).toEqual({});expect(await source()).toBe(sourceBefore)
      await info.focus();await info.press('f');await expect.poll(async()=>(await receipts()).at(-1)?.key).toBe('f');expect((await receipts()).at(-1).result.deny).toContain('mounted Raster');await expect(raster).toHaveText('Release \nblitted ')
      await info.focus();await info.press('x');await expect.poll(async()=>(await receipts()).at(-1)?.key).toBe('x');expect((await receipts()).at(-1).result.deny).toContain('no Raster');await expect(raster).toHaveText('Release \nblitted ')
      await info.focus();await info.press('h');await expect(raster).toHaveCount(0);await info.focus();await info.press('b');await expect.poll(async()=>(await receipts()).at(-1)?.key).toBe('b');expect((await receipts()).at(-1).result.deny).toContain('no Raster');await expect(raster).toHaveCount(0)
      await info.focus();await info.press('s');await expect(raster).toHaveText('Release \nready   ');await info.focus();await info.press('b');await expect(raster).toHaveText('Release \nblitted ');expect((await receipts()).at(-1).result).toEqual({})
    }else{await info.focus();await info.press('r');await expect(raster).toHaveText('Release \nupdated ')}
    const frames=await appPage.evaluate(()=>Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).flatMap((view:any)=>view.state?.frames??[]))
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await raster.scrollIntoViewIfNeeded();await expect(raster).toBeInViewport();await expect(composer).toHaveText(draft);for(const item of [composer,status,card.getByRole('button',{name:'Send',exact:true})]){await expect(item).toBeInViewport();expect(await item.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(element===hit||element.contains(hit))})).toBe(true)}await appPage.screenshot({path:testInfo.outputPath('native-raster-'+size.width+'.png')})}
    await writeFile(join(workspace!,'native-raster-app-proof.json'),JSON.stringify({text:await raster.innerText(),columns:8,rows:2,frames,...(blit?{blit:true,sourceBefore,receipts:await receipts()}:{}),draft,sameNativeOwner:(await context()).native.state.nativePid===boundNativePid}))
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue after inspecting the terminal drawing.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId)
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'composer-layout',nativeRaster:true,...(blit?{nativeRasterBlit:true}:{}),nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));return
  }
  await appPage.locator('.cursor-row-resize').click({button:'right'})
  await composer.fill('Draft retained while using native terminal Clients')
  await info.scrollIntoViewIfNeeded();await info.focus();await info.press('k')
  await expect(info).toContainText('key=k')
  const retired=await info.getAttribute('data-native-client')
  await info.getByRole('button',{name:'Increment terminal Client',exact:true}).click()
  await expect(info).toContainText('count=1 key=k')
  await info.getByRole('textbox',{name:'Terminal note',exact:true}).fill('rewrite')
  await expect(info.getByRole('textbox',{name:'Terminal note',exact:true})).toHaveValue('native-value')
  await info.getByRole('combobox',{name:'Terminal choice',exact:true}).press('Enter');await appPage.keyboard.press('End');await appPage.keyboard.press('Enter')
  const events=async()=>JSON.parse(await readFile(join(workspace!,'native-terminal-client-events.json'),'utf8'))
  const last=async(kind:string)=>(await events()).filter((event:any)=>event.kind===kind).at(-1)
  await expect.poll(async()=>await last('InfoNotice')).toMatchObject({count:1,key:'k',note:'native-value',choice:'b',surface:'terminal'})
  await info.focus();await info.press('Escape');await expect(composer).toBeFocused()
  for(const height of [900,600]){
    await appPage.setViewportSize({width:680,height});await info.getByRole('textbox',{name:'Terminal note',exact:true}).scrollIntoViewIfNeeded()
    await expect(info.getByRole('textbox',{name:'Terminal note',exact:true})).toBeInViewport({ratio:0.99})
    await expect(composer).toBeInViewport({ratio:0.99});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:0.99})
    await expect(composer).toHaveText('Draft retained while using native terminal Clients')
    await appPage.screenshot({path:testInfo.outputPath('apack-terminal-client-info-'+height+'.png')})
  }
  const fields=JSON.parse(await readFile(join(workspace!,'native-terminal-client-fields.json'),'utf8'));expect(fields.some((field:any)=>field.surface==='terminal'&&field.value==='rewrite')).toBe(true)
  expect((await context()).turns).toBe(1)
  await composer.fill('Continue with original terminal Client projections.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=>{const c=await context();return c.native?.state.busy===false&&c.messages.some((m:any)=>m.context?.claudeTerminalMessage&&m.text==='Fixture completed.')}).toBe(true)
  const duration=appPage.locator('[data-native-placement="TurnDuration"] [data-native-client]').filter({hasText:'TurnDuration Client'}).last()
  await expect(duration).toContainText('count=0 key=none',{timeout:10000})
  await duration.scrollIntoViewIfNeeded();await duration.focus();await duration.press('d')
  await duration.getByRole('button',{name:'Increment terminal Client',exact:true}).click()
  await expect(duration).toContainText('count=1 key=d')
  await expect.poll(async()=>await last('TurnDuration')).toMatchObject({count:1,key:'d',surface:'terminal'})
  await expect.poll(async()=>await last('InfoNotice')).toMatchObject({count:1,key:'k',note:'native-value',choice:'b'})
  await appPage.screenshot({path:testInfo.outputPath('apack-terminal-client-duration-600.png')})
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(info).toContainText('count=1 key=k',{timeout:10000})
  expect(await info.getAttribute('data-native-client')).not.toBe(retired)
  await appPage.evaluate(token=>{const actor=(window as any).applicationState.system.get('default-setup/threads'),c=actor.getSnapshot().context;const[mountId]=Object.entries(c.nativeUiViews).find(([,view]:any)=>view.threadId===c.currentThread.id)!;actor.send({type:'CLAUDE_UI_CLIENT',mountId,threadId:c.currentThread.id,id:token,sequence:1000000,event:{kind:'key',key:'old'}})},retired)
  await appPage.waitForTimeout(350);await expect(info).toContainText('count=1 key=k')
  await info.focus();await info.press('Control+d');await expect(composer).toBeFocused()
  expect((await context()).native.state.nativePid).toBe(boundNativePid);expect((await context()).sessionId).toBe(sessionId)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=> (await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await expect(appPage.locator('[data-native-client]')).toHaveCount(0)
  await composer.fill('Continue the same session after native Client verification.')
  await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=> (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'composer-layout',finalSessionId:sessionId,nativeTerminalClients:true,nativeTerminalClientKeys:true,nativeTerminalClientFields:true,nativeTerminalClientHooks:true,nativeTerminalClientRemount:true,nativeTerminalClientIsolation:true,nativeTerminalClientComposerReturn:true,nativeTerminalClientRetiredToken:true,nativeTerminalClientCleanup:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,boundNativePid,browserErrors:errors},null,2))
})
