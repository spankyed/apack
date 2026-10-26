import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { stripVTControlCharacters } from 'node:util'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
delete process.env.FORCE_COLOR
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
const roundTripJourney=process.env.CLAUDE_RESEARCH_AGENT_ROUNDTRIP==='1'
const referenceJourney = process.env.CLAUDE_RESEARCH_AGENT_REFERENCE === '1'||roundTripJourney
const imeJourney = process.env.CLAUDE_RESEARCH_AGENT_IME === '1'
let terminalScreen: import('@xterm/xterm').Terminal | undefined
test.afterEach(() => { terminalScreen?.dispose(); terminalScreen = undefined })
test.afterEach(async({appPage},info)=>{if(!roundTripJourney||info.status===info.expectedStatus)return;await writeFile(join(workspace!,'native-rich-roundtrip-failure.txt'),await appPage.locator('body').innerText({timeout:2000}).catch(()=>'<page unavailable>'));await appPage.screenshot({caret:'initial',path:info.outputPath('native-rich-roundtrip-failure.png'),timeout:5000}).catch(()=>{});})
test('preserves rich parent and Agent drafts and selection through actual Agent remount', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(roundTripJourney?240000:90000)
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
  await expect.poll(async () => (await context()).turns).toBe(1)
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
    if(!roundTripJourney)await expect(main.locator('span').first()).toHaveCSS('color', 'rgb(74, 222, 128)')
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

  const selected=()=>appPage.evaluate(()=>window.getSelection()?.toString()??'')
  async function fill(container:typeof card,editor:typeof composer,owner:string){
    await editor.fill(owner+' release review'+(referenceJourney&&owner==='Worker'?'\n\n[Reference](apack-ref://thread/'+(await context()).threadId+')':''))
    const tools=container.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
    await container.getByRole('button',{name:'Use review template',exact:true}).click()
    await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-fill.json'),'utf8').catch(()=>'{}'))).toMatchObject({result:{isFilled:true},after:{text:expect.stringContaining('# '+owner+' review')}})
    await expect(editor.locator('h1')).toHaveText(owner+' review');await expect(editor.locator('pre')).toContainText('const ready = true')
    await tools.click()
    await editor.locator('p').filter({hasText:'Review changes.'}).click();await editor.press(process.platform==='darwin'?'Control+a':'Home');await editor.press('Shift+ArrowRight');await editor.press('Shift+ArrowRight')
    await expect.poll(selected).toBe('Re')
    return JSON.parse(await readFile(join(workspace!,'native-rich-draft-fill.json'),'utf8'))
  }
  const snapshot=(editor:typeof composer)=>editor.evaluate(element=>{const e=(element as any).editor;return {doc:e.state.doc.toJSON(),selection:e.state.selection.toJSON(),storedMarks:e.state.storedMarks?.map((mark:any)=>mark.toJSON())??null,canonical:e.storage.markdown.getMarkdown()}})
  const roundtripReads:any[]=[],roundtripCaptures:any[]=[];let parentState:any,agentState:any,parentImage:string|undefined,agentNativeBefore:any
  async function nativeRead(container:typeof card,editor:typeof composer,agentId?:string){
    const expected=(await snapshot(editor)).canonical,tools=container.getByRole('button',{name:'Session tools',exact:true})
    await writeFile(join(workspace!,'native-rich-draft-read.json'),'{}')
    if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
    await container.getByRole('button',{name:'Read current draft',exact:true}).click()
    await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8'))).toMatchObject({text:expected})
    const value=JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8'));expect(value.view?.agentId).toBe(agentId)
    roundtripReads.push({agentId,value});await writeFile(join(workspace!,'native-agent-roundtrip-reads.json'),JSON.stringify(roundtripReads))
    await tools.click();await editor.focus();await expect.poll(selected).toBe('Re');return value
  }
  const formattingObservations:any[]=[]
  async function observeFormatting(editor:typeof composer,phase:string){
    formattingObservations.push({phase,...await snapshot(editor),...await editor.evaluate(element=>({html:element.innerHTML,selected:window.getSelection()?.toString()??'',focused:element===document.activeElement}))})
    await writeFile(join(workspace!,'native-rich-roundtrip-formatting.json'),JSON.stringify(formattingObservations,null,2))
  }
  async function markSelected(editor:typeof composer){
    await observeFormatting(editor,'before bold')
    await editor.press('Control+b');await observeFormatting(editor,'after bold')
    await editor.press('Control+i');await observeFormatting(editor,'after italic')
    try{
      await expect(editor.locator('strong em, em strong').filter({hasText:'Re'})).toHaveCount(1);await expect.poll(selected).toBe('Re')
      const menu=appPage.locator('.bubble-menu:visible');await expect(menu).toHaveCount(1)
      await expect.poll(async()=>{const m=await menu.boundingBox(),f=await editor.evaluate(element=>{const r=element.closest('form')!.getBoundingClientRect();return {left:r.left,right:r.right}});return !!m&&m.x>=f.left&&m.x+m.width<=f.right}).toBe(true)
    }
    finally{await observeFormatting(editor,'after formatting assertion')}
  }
  const parentFill=await fill(card,composer,'Parent')
  if(roundTripJourney){
    expect(process.platform).toBe('linux')
    const png=await appPage.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=96;const x=c.getContext('2d')!;x.fillStyle='#e5efff';x.fillRect(0,0,160,96);x.fillStyle='#224477';x.fillRect(10,12,140,22);x.fillStyle='#ffffff';x.font='bold 12px sans-serif';x.fillText('Release review',16,27);x.fillStyle='#335577';x.fillText('Ready for review',14,57);x.fillStyle='#28734a';x.fillRect(14,70,110,10);return c.toDataURL('image/png').split(',')[1]})
    await _electronApp.evaluate(({clipboard,nativeImage},png)=>clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png,'base64'))),png)
    await composer.focus();await composer.press('Control+v')
    const image=card.locator('img[src^="data:image/"]');await expect(image).toHaveCount(1);await expect.poll(async()=>image.evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBe(160);parentImage=(await image.getAttribute('src'))!
    await composer.locator('p').last().click();await composer.press('End');await composer.pressSequentially(' #')
    const popup=appPage.locator('.reference-suggestion-popup');await popup.getByText('Threads',{exact:true}).click();await popup.locator('.reference-suggestion-item').filter({has:appPage.getByText((await context()).topic,{exact:true})}).click();await expect(popup).toBeHidden()
    const paragraph=composer.locator('p').filter({hasText:'Review changes.'});await paragraph.click({position:{x:8,y:8}});await composer.press('Home');await composer.press('Shift+ArrowRight');await composer.press('Shift+ArrowRight');await expect.poll(selected).toBe('Re')
    await markSelected(composer);parentFill.after=await nativeRead(card,composer);parentState=await snapshot(composer)
  }
  await row.getByRole('button',{name:'Open Agent',exact:true}).click()
  const focused=appPage.getByRole('region',{name:'Focused Agent conversation',exact:true}),form=focused.getByRole('form',{name:'Agent message',exact:true}),agentComposer=form.locator('[contenteditable="true"]')
  await expect(focused).toBeVisible();const agentFill=await fill(form,agentComposer,'Worker')
  const referenceHref=referenceJourney?'apack-ref://thread/'+(await context()).threadId:null
  if(referenceJourney)await expect(agentComposer.locator('.reference-pill')).toHaveAttribute('data-ref-type','thread')
  if(roundTripJourney){await markSelected(agentComposer);agentNativeBefore=await nativeRead(form,agentComposer,taskId!);agentFill.after=agentNativeBefore;agentState=await snapshot(agentComposer)}
  const codeClass=await agentComposer.locator('code').getAttribute('class')
  await agentComposer.evaluate(el=>el.setAttribute('data-rich-original','true'))
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click()
  await expect(composer.locator('h1')).toHaveText('Parent review');await expect(composer.locator('pre')).toContainText('const ready = true');await expect(composer).toBeFocused();await expect.poll(selected).toBe('Re')
  if(roundTripJourney){expect(await snapshot(composer)).toEqual(parentState);await expect(card.locator('img[src^="data:image/"]')).toHaveAttribute('src',parentImage!);await expect(card.locator('img[src^="data:image/"]')).toHaveCSS('object-fit','contain')}
  await row.getByRole('button',{name:'Open Agent',exact:true}).click();await expect(focused).toBeVisible()
  expect(await agentComposer.getAttribute('data-rich-original')).toBeNull()
  if(referenceJourney)await expect(agentComposer.locator('.reference-pill')).toHaveAttribute('data-ref-type','thread')
  await expect(agentComposer.locator('h1')).toHaveText('Worker review');await expect(agentComposer.locator('pre')).toContainText('const ready = true')
  expect(await agentComposer.locator('code').getAttribute('class')).toBe(codeClass)
  await agentComposer.focus();await expect.poll(selected).toBe('Re')
  expect((await context()).native.state.view).toMatchObject({kind:'agent',taskId})
  if(roundTripJourney)expect(await snapshot(agentComposer)).toEqual(agentState)
  const tools=form.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
  if(roundTripJourney)await writeFile(join(workspace!,'native-rich-draft-read.json'),'{}')
  await form.getByRole('button',{name:'Read current draft',exact:true}).click()
  await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8').catch(()=>'{}'))).toMatchObject({text:agentFill.after.text,cursor:roundTripJourney?agentNativeBefore.cursor:agentFill.after.text.indexOf('Review changes.')+2})
  if(roundTripJourney){const value=JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8'));expect(value.view?.agentId).toBe(taskId);roundtripReads.push({agentId:taskId,value});await writeFile(join(workspace!,'native-agent-roundtrip-reads.json'),JSON.stringify(roundtripReads))}
  await tools.click();await agentComposer.focus();await expect.poll(selected).toBe('Re')
  for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);const selectionLine=agentComposer.locator('p').filter({hasText:'Review changes.'});await selectionLine.scrollIntoViewIfNeeded();await expect(selectionLine).toBeInViewport();await expect.poll(selected).toBe('Re');await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport();await capture('native-rich-agent-draft-'+size.width+'.png');if(roundTripJourney)roundtripCaptures.push({owner:'agent-draft',width:size.width,height:size.height,file:'native-rich-agent-draft-'+size.width+'.png'})}
  if(imeJourney){
    await agentComposer.locator('p').filter({hasText:'Review changes.'}).click();await agentComposer.press('End')
    const cdp=await appPage.context().newCDPSession(appPage),preview='にほん',commit='日本語'
    const edits=async()=>JSON.parse(await readFile(join(workspace!,'native-agent-ime-edits.json'),'utf8').catch(()=>'[]'))
    const beforeEdits=await edits(),turns=(await context()).native.state.session.turns
    await appPage.evaluate(()=>{(window as any).__agentImeActorEvents=[];const actor=(window as any).applicationState.system.get('default-setup/threads');actor.system.inspect((item:any)=>{if(item.event?.type==='CLAUDE_PROMPT_EDIT'||item.event?.type==='CLAUDE_PROMPT_STATE')(window as any).__agentImeActorEvents.push(item.event)})});
    await agentComposer.evaluate(element=>{const events:any[]=[];(window as any).__agentImeEvents=events;for(const name of ['compositionstart','compositionupdate','compositionend','input'])element.addEventListener(name,event=>{const editor=(element as any).editor;events.push({type:event.type,data:(event as InputEvent).data,composing:editor?.view.composing,text:editor?.state.doc.textContent})})})
    await cdp.send('Input.imeSetComposition',{text:preview,selectionStart:3,selectionEnd:3});await expect(agentComposer).toContainText(preview)
    await agentComposer.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true})))
    await appPage.setViewportSize({width:680,height:600});await expect(agentComposer).toContainText(preview);await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport()
    expect((await edits()).some((edit:any)=>edit.text.includes(preview))).toBe(false);expect((await context()).native.state.session.turns).toBe(turns)
    await appPage.screenshot({path:testInfo.outputPath('native-agent-ime-preview.png')})
    await cdp.send('Input.insertText',{text:commit});await expect(agentComposer).toContainText(commit)
    try { await expect.poll(async()=>(await edits()).some((edit:any)=>edit.text.includes(commit))).toBe(true) }
    finally { await writeFile(join(workspace!,'native-agent-ime-editor-state.json'),JSON.stringify(await agentComposer.evaluate(element=>{const editor=(element as any).editor,view=editor?.view;return {composing:view?.composing,doc:view?.state.doc.toJSON(),markdown:editor?.storage.markdown.getMarkdown(),html:element.innerHTML,events:(window as any).__agentImeEvents,actorEvents:(window as any).__agentImeActorEvents,views:Object.values((window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews).map((view:any)=>({revision:view.promptRevision,prompt:view.prompt})),alerts:Array.from(document.querySelectorAll('[role=alert]')).map(node=>node.textContent)}}))) }
    const committedEdits=await edits();expect(committedEdits.some((edit:any)=>edit.text.includes(preview))).toBe(false)
    await cdp.detach()
    if(await tools.getAttribute('aria-expanded')!=='true')await tools.click();await form.getByRole('button',{name:'Read current draft',exact:true}).click()
    await expect.poll(async()=>JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8').catch(()=>'{}')).text).toContain(commit)
    agentFill.after=JSON.parse(await readFile(join(workspace!,'native-rich-draft-read.json'),'utf8'));expect(agentFill.after.text.split(commit)).toHaveLength(2);await tools.click()
    for(const size of [{width:1100,height:900},{width:680,height:600}]){await appPage.setViewportSize(size);await agentComposer.locator('p').filter({hasText:commit}).scrollIntoViewIfNeeded();await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport();await appPage.screenshot({path:testInfo.outputPath('native-agent-ime-'+size.width+'.png')})}
    await writeFile(join(workspace!,'native-agent-ime-composition-proof.json'),JSON.stringify({preview,commit,beforeEdits,committedEdits,turnsBefore:turns,turnsAfter:(await context()).native.state.session.turns,canonical:agentFill.after.text}))
  }
  if(referenceJourney||imeJourney){
    const sent=agentFill.after.text
    await form.getByRole('button',{name:'Send to Agent',exact:true}).click();await expect(agentComposer).toHaveText('')
    await expect.poll(async()=>appPage.evaluate(text=>{const views=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews;return Object.values(views).some((view:any)=>view.state?.agent?.messages?.some((message:any)=>message.role==='user'&&message.text===text))},sent)).toBe(true)
    const files=await readdir(join(workspace!,'.claude/projects'),{recursive:true})
    let nativeReceipt:any
    await expect.poll(async()=>{for(const file of files.filter(file=>file.endsWith('.jsonl')&&file.includes('agent-'+taskId))){const rows=(await readFile(join(workspace!,'.claude/projects',file),'utf8')).trim().split('\n').map(line=>JSON.parse(line));nativeReceipt=rows.find(row=>row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human'&&typeof row.message?.content==='string'&&row.message.content.includes(sent)&&row.message.content.split(sent).length===2);if(nativeReceipt)return true}return false}).toBe(true)
    if(roundTripJourney){
      const transcript=focused.getByRole('region',{name:'Agent transcript',exact:true}),human=transcript.locator('[data-native-agent-message]').filter({hasText:'Worker review'});await expect(human).toHaveCount(1)
      for(const [width,height]of [[1100,900],[680,600]]){
        await appPage.setViewportSize({width,height})
        for(const [part,needle]of [['heading','Worker review'],['code','const ready = true'],['reference','Review changes. Reference']]){
          const bounds=()=>human.evaluate((element,needle)=>{const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),chars:string[]=[],positions:{node:Node;offset:number}[]=[];let node:Node|null;while((node=walk.nextNode())){const value=node.textContent!;for(let offset=0;offset<value.length;offset++){const char=/\s/.test(value[offset])?' ':value[offset];if(char===' '&&chars.at(-1)===' ')continue;chars.push(char);positions.push({node,offset})}}const index=chars.join('').indexOf(needle);if(index<0)throw Error('Visible original Agent text missing: '+needle);const first=positions[index],last=positions[index+needle.length-1],range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset+1);const r=range.getBoundingClientRect(),b=element.closest('[aria-label="Agent transcript"]')!.getBoundingClientRect();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,top:r.top,bottom:r.bottom,viewportTop:b.top,viewportBottom:b.bottom,shift:r.top<b.top?r.top-b.top:r.bottom-b.bottom}},needle)
          await transcript.hover();let wheels=0
          for(let step=0;step<30;step++){const value=await bounds();if(value.visible)break;await appPage.mouse.wheel(0,value.shift);wheels++;await appPage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))}
          const geometry=await bounds();expect(geometry.visible).toBe(true);await expect(form.getByRole('button',{name:'Send to Agent',exact:true})).toBeInViewport();const file=`native-rich-agent-sent-${width}-${part}.png`;await capture(file);roundtripCaptures.push({owner:'agent-transcript',width,height,part,file,geometry,wheels,visibleUuid:await human.getAttribute('data-native-agent-message')})
        }
      }
    }
    await writeFile(join(workspace!,imeJourney?'native-agent-ime-proof.json':'native-agent-reference-proof.json'),JSON.stringify({taskId,referenceHref,text:sent,nativeUuid:nativeReceipt.uuid,parentDraft:parentFill.after.text,remounted:true}))
  }
  await focused.getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(composer.locator('h1')).toHaveText('Parent review');await expect.poll(selected).toBe('Re')
  if(roundTripJourney){
    expect(await snapshot(composer)).toEqual(parentState);await expect(card.locator('img[src^="data:image/"]')).toHaveAttribute('src',parentImage!);await expect(card.locator('img[src^="data:image/"]')).toHaveCSS('object-fit','contain')
    await expect.poll(async()=>(await context()).native.state.view?.kind).toBe('main')
    const restored=await nativeRead(card,composer);expect(restored.text).toBe(parentFill.after.text)
    for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width,height});await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await expect(card.locator('img[src^="data:image/"]')).toBeInViewport();await expect(composer.locator('p').filter({hasText:'Review changes.'})).toBeInViewport();const file=`native-rich-parent-roundtrip-${width}.png`;await capture(file);roundtripCaptures.push({owner:'parent',width,height,file})}
    const sent=parentFill.after.text.replace(/(\n&nbsp;)+$/, '').trim(),before=(await context()).messages.length;await card.getByRole('button',{name:'Send',exact:true}).click();await expect(card.locator('img[src^="data:image/"]')).toHaveCount(0);await expect(composer).toHaveText('')
    await expect.poll(async()=>(await context()).messages.slice(before).some((message:any)=>message.sender==='user'&&message.text.includes(sent))).toBe(true)
    const message=(await context()).messages.slice(before).find((message:any)=>message.sender==='user'&&message.text.includes(sent));expect(message.references.images).toHaveLength(1);expect(message.references.context).toEqual(expect.arrayContaining([expect.objectContaining({refType:'thread',refId:(await context()).threadId})]))
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false)
    await writeFile(join(workspace!,'native-agent-roundtrip-proof.json'),JSON.stringify({sessionId,taskId,boundNativePid,parentState,agentState,parentImage,parentMessageId:message.id,parentDraftCanonical:parentState.canonical,parentCanonical:sent,agentCanonical:agentFill.after.text,reads:roundtripReads,captures:roundtripCaptures,actualAgentRemount:true,parentMediaRetained:true,exactDocumentsAndSelections:true}))
  }
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  await writeFile(join(workspace!,'native-rich-agent-draft-proof.json'),JSON.stringify({taskId,parentFill,agentFill,codeClass,remounted:true,selected:'Re'}))
  await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue after reviewing the worker draft.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeRichAgentDraft:true,...(roundTripJourney?{nativeAgentRoundtrip:true}:{}),...(referenceJourney?{nativeAgentReference:true}:{}),...(imeJourney?{nativeAgentIme:true}:{}),nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
})
