import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
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
test('reads native MCP resources with binary storage and stale URI recovery', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const {promptMedia: _promptMedia,promptSyntax: _promptSyntax,uiCopy: _uiCopy,uiSelection: _uiSelection}=JSON.parse(await readFile(join(workspace!,'question-preview-fixture.json'),'utf8'))
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
    const cols=row?.match(/columns:\s*(\d+)/)?.[1];return cols?{cols:Number(cols),rows:200}:undefined;
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
    if (native?.state?.status === 'live') return native.state.mainStatus?.includes('AppNativeMain '+sessionId) === true
    const screen = recognizeOnboardingPrompt(text, workspace)
    await writeFile(join(workspace!, 'native-capability-onboarding.json'), JSON.stringify({ screen, theme, security, navigated, trusted, trustAttempts, dimensions, output: text }))
    if (screen === 'theme' && !theme) { theme = true; await input.press('Enter') }
    else if (screen === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
    else if (screen === 'workspace-trust' && !navigated) { navigated = true; trustSelectedAt = Date.now(); await input.press('ArrowDown') }
    else if (screen === 'workspace-trust-selected' && !navigated) { navigated = true; trustSelectedAt = Date.now() }
    else if (screen === 'workspace-trust-selected' && navigated && trustAttempts < 3 && Date.now() - trustSelectedAt > 1200) { trusted = true; trustAttempts++; trustSelectedAt = Date.now(); await input.press('Enter') }
    return native?.state?.status === 'live' && (restriction ? native.state.mainStatus === undefined : native.state.mainStatus?.includes('AppNativeMain '+sessionId))
  }, { timeout: 25000, intervals: [250] }).toBe(true)
  await expect(card).toBeHidden()
  const main = section.getByTestId('native-main-status')
  if (restriction) await expect(main).toHaveCount(0)
  else {
    await expect(main).toContainText('AppNativeMain '+sessionId)
    await expect(main).toContainText('Second native status line')
  }
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  const status = card.getByTestId('composer-native-status')
  if (restriction) await expect(status).toHaveCount(0)
  else await expect(status).toContainText('AppNativeMain '+sessionId)
  const composer = card.locator('[contenteditable="true"]')

  try{
    const expected=JSON.parse(await readFile(join(workspace!,'mcp-resource-expectations.json'),'utf8'))
    await composer.fill('Inspect the release resources and recover a stale resource URI.');await card.getByRole('button',{name:'Send',exact:true}).click()
    await expect.poll(async()=>(await context()).messages.some((m:any)=>m.sender==='assistant'&&m.text==='Resources inspected.'),{timeout:20000}).toBe(true)
    const entries=()=>context().then(c=>c.messages.flatMap((m:any)=>m.blocks??[]).filter((b:any)=>b.type==='tool-activity').flatMap((b:any)=>b.props.entries))
    await expect.poll(async()=>(await entries()).filter((entry:any)=>entry.id.startsWith('resource-')).length).toBe(5)
    const rows=await entries(),byId=(id:string)=>rows.find((entry:any)=>entry.id===id)
    await writeFile(join(workspace!,'native-mcp-resource-entries.json'),JSON.stringify(rows,null,2))
    const text=JSON.parse(byId('resource-read-text').details.output),binary=JSON.parse(byId('resource-read-binary').details.output),missing={error:byId('resource-read-stale').details.output},listed=JSON.parse(byId('resource-list-refresh').details.output)
    expect(text.contents[0]).toMatchObject({uri:expected.resourceUris.text,text:expected.resourceText})
    const blobPath=binary.contents[0].blobSavedTo;expect(blobPath).toContain(sessionId+'/tool-results/');expect((await readFile(blobPath)).toString('base64')).toBe(expected.resourceBlob)
    expect(missing.error).toContain('Resource not found');expect(JSON.stringify(listed)).toContain('Current release notes')
    const draft='Keep this release-review draft while reading MCP resources.';await composer.fill(draft)
    const expand=appPage.getByRole('button',{name:'Expand tool activity',exact:true})
    for(let n=0;n<8&&await expand.count();n++)await expand.first().click()
    const fallback=appPage.locator('[data-native-tool-activity] > button[aria-expanded="false"]')
    for(let n=0;n<8&&await fallback.count();n++)await fallback.first().click()
    const result=(id:string)=>appPage.locator('[data-native-tool-result="'+id+'"]').first()
    await expect(result('resource-read-text')).toContainText('ReleaseReadmeEnd')
    await expect.poll(()=>result('resource-read-binary').evaluate(el=>(el.textContent??'').replace(/\s+/g,''))).toContain(blobPath.replace(/\s+/g,''))
    await expect(result('resource-read-stale')).toContainText('Resource not found')
    for(const width of [1100,680]){await appPage.setViewportSize({width,height:width===680?600:900});for(const id of ['resource-read-text','resource-read-binary','resource-read-stale']){await result(id).scrollIntoViewIfNeeded();await appPage.screenshot({path:testInfo.outputPath('native-mcp-'+id+'-'+width+'.png')})}await composer.scrollIntoViewIfNeeded();await expect(composer).toHaveText(draft);await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()}
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
    await composer.fill('Continue the release review after reading MCP resources.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
    await writeFile(join(workspace!,'native-mcp-resource-proof.json'),JSON.stringify({text,binary,missing,listed,blobPath,sessionId,boundNativePid},null,2))
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'mcp-status',nativeMcpResources:true,nativeMcpResourceBinary:true,nativeMcpResourceRefresh:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}))
  }catch(error){await writeFile(join(workspace!,'native-mcp-resource-failure.json'),JSON.stringify(await context(),null,2));await appPage.screenshot({path:testInfo.outputPath('native-mcp-resource-failure.png')});throw error}
})
