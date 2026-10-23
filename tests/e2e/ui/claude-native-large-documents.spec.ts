import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reads large original native Code and Markdown without losing the parent composer', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  const restriction = planScenario === 'managed-clear'
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await app.waitForPlugin('default-setup/threads'); await app.navigate('default-setup/threads')
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
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { threadId: state.currentThread?.id, topic: state.currentThread?.topic, phase: state.phase, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, ui: state.nativeUiViews, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
  const boundNativePid = (await context()).native.state.nativePid
  await section.getByRole('button', {name:'Back to conversation',exact:true}).click()
  await appPage.locator('.cursor-row-resize').click({button:'right'})
  const composer=card.locator('[contenteditable="true"]')
  const expected=JSON.parse(await readFile(join(workspace!,'large-document-fixture.json'),'utf8'));
  const draft='Keep the release checklist draft while I inspect the migration registry.';
  const code=appPage.locator('[data-native-code-ansi]'),markdown=appPage.locator('[data-native-markdown-ansi]');
  async function document(kind:string){return appPage.evaluate(kind=>{
    const state=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const pending=Object.values(state.nativeUiViews).map((view:any)=>view.state);let count=0;
    while(pending.length&&++count<20000){const value:any=pending.pop();if(!value||typeof value!=='object')continue;if(value.kind===kind)return {kind:value.kind,source:value.source??value.text,nativeAnsi:value.nativeAnsi,formattingFallback:value.formattingFallback};pending.push(...Object.values(value).filter(value=>value&&typeof value==='object'));}return null;
  },kind)}
  const proof:any[]=[];
  try{
    await composer.fill('Read the release checklist from the generated migration registry.');await card.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(async()=>{try{return await readFile(join(workspace!,'large-read-ready'),'utf8')}catch{return ''}}).toBe('ready');
    await composer.fill(draft);await writeFile(join(workspace!,'release-large-read'),'ready');
    const approval=appPage.getByRole('region',{name:'Read approval',exact:true});await expect(approval).toBeVisible();
    await approval.getByRole('button',{name:'Approve',exact:true}).click();await expect(approval).toHaveCount(0);
    await expect.poll(async()=>(await context()).native.state.busy).toBe(false);
    if(await code.count()===0){const group=appPage.getByRole('button',{name:'Expand tool activity',exact:true});await expect(group).toBeVisible();await group.click();}
    await expect(code).toHaveCount(1,{timeout:20000});
    for(const width of [1100,680]){
      await appPage.setViewportSize({width,height:width===680?600:900});
      for(const kind of ['code','markdown']){
        const tab=appPage.getByRole('button',{name:kind==='code'?'Source':'Guide',exact:true});
        if(await (kind==='code'?code:markdown).count()===0)await tab.click();
        const drawn=kind==='code'?code:markdown;await expect(drawn).toHaveCount(1,{timeout:15000});
        const data=await document(kind);expect(data.source).toBe(kind==='code'?expected.code:expected.markdown);expect(data.source.length).toBeGreaterThan(32768);expect(data.formattingFallback).toBeUndefined();
        expect(data.nativeAnsi).toContain('\x1b[');if(kind==='code')expect(data.nativeAnsi.length).toBeGreaterThan(65536);
        expect(await drawn.textContent()).toBe(stripVTControlCharacters(data.nativeAnsi));expect(await drawn.locator('[class*="hljs"]').count()).toBe(0);
        const last=drawn.locator('span').last();await expect.poll(async()=>{await last.evaluate(node=>node.scrollIntoView({block:'center'}));return last.evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})}).toBe(true);await expect(last).toBeInViewport({ratio:1});
        await expect(composer).toHaveText(draft);
        for(const target of [composer,card.getByRole('button',{name:'Send',exact:true})]){await expect(target).toBeInViewport();expect(await target.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);}
        await appPage.screenshot({path:testInfo.outputPath('native-large-'+kind+'-'+width+'.png')});proof.push({width,...data});
      }
    }
    await app.navigate('host/settings');await app.navigate('default-setup/threads');await expect(composer).toHaveText(draft);
    await expect(card.getByTestId('composer-native-status')).toContainText('AppNativeMain '+sessionId);expect((await context()).native.state.nativePid).toBe(boundNativePid);
    await writeFile(join(workspace!,'native-large-document-proof.json'),JSON.stringify({documents:proof,draft,sessionId},null,2));
    await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native.state.status).toBe('exited');
    await section.getByRole('button',{name:'Back to conversation',exact:true}).click();await composer.fill('Continue after reviewing the migration registry.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([]);
    await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeLargeCode:true,nativeLargeMarkdown:true,nativeLargeNavigation:true,nativeRetainedDraft:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2));
  }catch(error){await writeFile(join(workspace!,'native-large-document-failure.json'),JSON.stringify(await context(),null,2));await appPage.screenshot({path:testInfo.outputPath('native-large-document-failure.png')});throw error;}
});
