import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters as _stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('reviews native file creation, overwrite and edit before one-time decisions', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const fileLayout=JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8')).fileLayout===true
  const restriction = false
  const clientLifetime = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8')).clientLifetime === true
  const lifetime = async (): Promise<any> => {
    try { return JSON.parse(await readFile(join(workspace!, 'native-client-lifetime.json'), 'utf8')) }
    catch (error: any) { if (error instanceof SyntaxError || error.code === 'ENOENT') return {}; throw error }
  }
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const socketFrames:any[]=[];const cdp=fileLayout?await appPage.context().newCDPSession(appPage):undefined;if(cdp){await cdp.send('Network.enable');cdp.on('Network.webSocketFrameReceived',event=>{if(!/CLAUDE_UI_STATE|CLAUDE_TERMINAL_STATE/.test(event.response.payloadData)&&(()=>{try{const frame=JSON.parse(event.response.payloadData);return !!frame.error||!!frame.result?.data}catch{return true}})())socketFrames.push({at:Date.now(),id:event.requestId,data:event.response.payloadData});if(socketFrames.length>1000)socketFrames.shift()})}
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
  await card.locator('[contenteditable="true"]').fill('Seed this private native interface session.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const context = () => appPage.evaluate(() => { const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { backendReload: state.view, threadId: state.currentThread?.id, topic: state.currentThread?.topic, sessionId: state.currentThread?.context?.claudeCode?.sessionId, turns: state.currentThread?.context?.claudeCode?.turns, claude: state.currentThread?.context?.claudeCode, messages: state.currentThread?.messages, native: Object.values(state.nativeTerminalViews).find((view: any) => view.threadId === state.currentThread?.id) } as any })
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
  const target = join(workspace!, 'file-fixture.txt')
  const formattedResults: { turn: number; id: string; text: string }[] = []
  async function toolBlock(id: string) {
    let owner: { messageId: string; index: number } | undefined
    await expect.poll(async () => {
      owner = await appPage.evaluate(id => {
        const messages = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.messages ?? []
        for (const message of messages) {
          const blocks = (message.blocks ?? []).filter((block: any) => block.type === 'tool-activity')
          const index = blocks.findIndex((block: any) => block.props.entries?.some((entry: any) => entry.id === id && entry.nativeResult?.uuid))
          if (index >= 0) return { messageId: message.id, index }
        }
      }, id)
      return !!owner
    }).toBe(true)
    return appPage.locator(`[data-native-tool-activity][data-native-tool-ids~="${id}"]`)
  }

  let acceptedLongUser:{uuid:string;text:string}|undefined
  const promptForTurn=(turn:number)=>'ResearchFileTurn'+turn+(fileLayout&&turn===4?'\n'+Array.from({length:30},(_,i)=>'Review user expansion line '+(i+1)+': preserve this release checklist.').join('\n'):'')
  for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
    const isEdit = [3, 5, 7].includes(turn)
    await composer.fill(promptForTurn(turn))
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    const panel = appPage.getByTestId(isEdit ? 'native-edit-approval' : 'native-write-approval')
    await expect(panel).toBeVisible({ timeout: 15000 })
    const after = turn === 1 ? 'created\n' : turn === 2 ? 'overwrite\n' : turn === 3 ? 'edited\n' : fileLayout&&turn===4?Array.from({length:160},(_,i)=>'Release checklist item '+(i+1)+': preserve existing behavior.').join('\n')+'\n':'Must not be applied\n'
    await expect(panel.getByTestId('native-read-path')).toHaveText(target)
    if (turn === 6) {
      await expect(panel.getByTestId('native-file-review')).toContainText('too large to show')
      await expect(panel.getByTestId('native-file-before')).toHaveCount(0)
      await expect(panel.getByTestId('native-file-after')).toHaveCount(0)
      await panel.getByTestId('native-file-review').scrollIntoViewIfNeeded()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-withheld.png') })
    } else {
      await expect(panel.getByTestId('native-file-after')).toHaveText(after)
      if (turn === 1) await expect(panel.getByTestId('native-file-before')).toHaveCount(0)
      else await expect(panel.getByTestId('native-file-before')).toHaveText(turn === 2 ? 'created\n' : turn === 3 ? 'overwrite\n' : 'edited\n')
    }
    await expect.poll(() => panel.evaluate(element => Array.from(element.querySelectorAll('footer button')).every(button => { const r = button.getBoundingClientRect(); return r.height >= 28 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }))).toBe(true)
    if (turn <= 3) {
      await appPage.setViewportSize({ width: 680, height: 900 })
      await panel.getByTestId('native-file-after').scrollIntoViewIfNeeded()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-review-' + turn + '.png') })
      await appPage.setViewportSize({ width: 680, height: 600 })
      await panel.getByTestId('native-file-after').scrollIntoViewIfNeeded()
      await expect(panel.getByTestId('native-file-after')).toBeInViewport()
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-file-compact-' + turn + '.png') })
    }
    if(fileLayout&&turn===4){
      let user:any
      await expect.poll(async()=>{user=(await context()).messages.find((message:any)=>message.sender==='user'&&message.text.startsWith('ResearchFileTurn4')&&message.text.includes('Review user expansion line 30:'));return !!user?.context?.cliUuid}).toBe(true)
      acceptedLongUser={uuid:user.context.cliUuid,text:user.text}
      for(let line=1;line<=30;line++)expect(user.text).toContain('Review user expansion line '+line+': preserve this release checklist.')
      const row=appPage.locator('[data-chat-message="'+user.id+'"]')
      await appPage.setViewportSize({width:1100,height:900})
      await row.getByRole('button',{name:'Expand user message',exact:true}).click()
      await expect(row.locator('[data-native-user]')).toContainText('Review user expansion line 30:')
      await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-long-user-expanded.png')})
      for(const width of [1100,680]){
        await appPage.setViewportSize({width,height:width===680?600:900})
        const transcript=appPage.getByTestId('chat-transcript');await expect(transcript).toBeVisible();expect((await transcript.boundingBox())!.height).toBeGreaterThan(80)
        await panel.getByTestId('native-file-after').evaluate(element=>{element.parentElement!.parentElement!.scrollTop=element.parentElement!.parentElement!.scrollHeight})
        await expect(panel.getByTestId('native-file-after')).toContainText('Release checklist item 160:')
        const summary=panel.locator('details').last().locator('summary');await summary.click()
        const feedback=panel.getByRole('textbox',{name:'Reason for denying',exact:true});await feedback.focus();await feedback.fill('Keep the existing file unchanged.');await expect(feedback).toBeInViewport()
        await expect.poll(()=>panel.evaluate(element=>Array.from(element.querySelectorAll('footer button')).every(button=>{const b=button.getBoundingClientRect(),p=element.getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom&&b.bottom<=innerHeight}))).toBe(true)
        await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-long-file-feedback-'+width+'.png')})
        await summary.click()
      }
    }
    await panel.getByRole('button', { name: turn <= 3 ? 'Allow once' : turn === 7 ? 'Cancel' : 'Deny', exact: true }).click()
    try{await expect(panel).toBeHidden()}catch(error){const snapshot=await context();const {open}=await import('lmdb');const db=open({path:join(workspace!,'app-data/apack/ears-db'),readOnly:true,maxDbs:8,compression:true});try{const attrs=db.openDB({name:'attrs',encoding:'json'});const ids=[snapshot.threadId,snapshot.claude.pendingControlRequest?.approvalMessageId];const rows=[...attrs.getRange()].filter(row=>ids.some(id=>id&&String(row.key).includes(id))&&/context|blockResponse|responseTimestamp/.test(String(row.key)));await writeFile(join(workspace!,'native-file-live-backend.json'),JSON.stringify({at:Date.now(),rows},null,2))}finally{await db.close()}await writeFile(join(workspace!,'native-file-socket-frames.json'),JSON.stringify(socketFrames));await writeFile(join(workspace!,'native-file-decision-failure.json'),JSON.stringify({turn,context:await context()},null,2));await appPage.screenshot({caret:'initial',path:testInfo.outputPath('native-file-decision-failure.png')});await appPage.evaluate(() => {const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'OPEN_THREAD_CHAT',threadId:actor.getSnapshot().context.currentThread.id})});await appPage.waitForTimeout(1200);await writeFile(join(workspace!,'native-file-decision-reloaded.json'),JSON.stringify({turn,context:await context()},null,2));throw error}
    if (turn === 7) await expect.poll(async () => (await context()).native.state.status).toMatch(/^(exited|error)$/)
    else await expect.poll(async () => (await context()).native.state.busy).toBe(false)
    const expected = turn === 1 ? 'created\n' : turn === 2 ? 'overwrite\n' : 'edited\n'
    await expect.poll(async () => readFile(target, 'utf8').catch(() => '')).toBe(expected)
    if (!fileLayout && turn >= 2 && turn <= 6) {
      const block = await toolBlock(`file_fixture_${turn}`)
      const toggle = block.getByRole('button').first()
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
      const header = block.locator(`[data-native-tool-use="file_fixture_${turn}"] [data-native-tool-format]`)
      await expect(header).toBeVisible()
      await expect(header).toContainText(isEdit ? 'Update' : 'Write')
      const result = block.locator(`[data-native-tool-result="file_fixture_${turn}"] [data-native-tool-format]`)
      if (turn === 4) await writeFile(join(workspace!, 'native-tool-denial-diagnostic.json'), JSON.stringify(await appPage.evaluate(() => ({ messages: (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.messages, views: (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.nativeUiViews }))))
      await expect(result).toBeVisible()
      const text = await result.innerText()
      if (turn === 2) expect(text).toContain('overwrite')
      else if (turn === 3) {
        expect(text).toContain('edited'); expect(text).toContain('overwrite')
        const readBlock = await toolBlock('file_read_3')
        const readToggle = readBlock.getByRole('button').first()
        if (await readToggle.getAttribute('aria-expanded') !== 'true') await readToggle.click()
        const read = readBlock.locator('[data-native-tool-result="file_read_3"] [data-native-tool-format]')
        await expect(read).toContainText('Read 2 lines')
        formattedResults.push({ turn, id: 'file_read_3', text: await read.innerText() })
        if(!(await readBlock.getAttribute('data-native-tool-ids'))?.split(' ').includes('file_fixture_3'))await readToggle.click()
      } else expect(text).toMatch(/rejected|denied|Error:/i)
      formattedResults.push({ turn, id: `file_fixture_${turn}`, text })
      if (turn === 3 || turn === 4) {
        await result.scrollIntoViewIfNeeded()
        await appPage.screenshot({ path: testInfo.outputPath(`apack-native-tool-formatted-${turn}.png`) })
      }
      if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click()
      if(turn===3){
        const group=(await toolBlock('file_read_3')).filter({has:appPage.getByRole('button',{name:'Inspect tool group',exact:true})})
        await expect(group).toHaveAttribute('data-native-tool-group',/.+/)
        const groupId=await group.getAttribute('data-native-tool-group'),disclosure=group.getByRole('button').first()
        let groupedRetired:{token:string;mountId:string;threadId:string;actionId:string}|undefined
        if(clientLifetime){
          if(await disclosure.getAttribute('aria-expanded')!=='true')await disclosure.click()
          const sandbox=group.locator('[data-native-tool-result="file_read_3"] [data-native-client]')
          await expect(sandbox).toBeVisible();await sandbox.getByRole('button',{name:'Result action',exact:true}).click();await sandbox.focus();await sandbox.press('g')
          await expect.poll(async()=> (await lifetime())['group-result']?.key).toBe('g')
          await expect.poll(async()=> (await lifetime())['group-result']?.ticks??0).toBeGreaterThan(1)
          const token=(await sandbox.getAttribute('data-native-client'))!
          groupedRetired=await appPage.evaluate(token=>{const c=(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;for(const[mountId,view]of Object.entries(c.nativeUiViews) as [string,any][]){const frame=view.state?.transcriptMessages?.find((frame:any)=>frame.component==='ToolResult'&&frame.uuid==='file_read_3');if(frame?.body.status!=='live')continue;const find=(node:any):string|undefined=>node.kind==='button'&&node.label==='Inspect native tool result'?node.actionId:node.children?.map(find).find(Boolean);const actionId=find(frame.body.tree);if(actionId)return{token,mountId,threadId:c.currentThread.id,actionId}}},token)
          expect(groupedRetired).toBeTruthy()
        }

        if(await disclosure.getAttribute('aria-expanded')==='true')await disclosure.click()
        await expect(disclosure).toHaveAttribute('aria-expanded','false')
        if(clientLifetime&&groupedRetired){
          await expect(group.locator('[data-native-client]')).toHaveCount(0);await appPage.waitForTimeout(400)
          const stopped=await lifetime(),before=await readFile(join(workspace!,'native-tool-result-hook.json'),'utf8')
          await appPage.evaluate(old=>{const actor=(window as any).applicationState.system.get('default-setup/threads');actor.send({type:'CLAUDE_UI_CLIENT',mountId:old.mountId,threadId:old.threadId,id:old.token,sequence:1000000,event:{kind:'key',key:'x'}});actor.send({type:'CLAUDE_UI_PRESS',mountId:old.mountId,threadId:old.threadId,actionId:old.actionId})},groupedRetired)
          await expect.poll(async()=> (await lifetime()).above?.posts??0).toBeGreaterThan(stopped.above.posts+2)
          expect((await lifetime())['group-result']).toEqual(stopped['group-result']);expect(await readFile(join(workspace!,'native-tool-result-hook.json'),'utf8')).toBe(before)
          await writeFile(join(workspace!,'native-group-client-stopped.json'),JSON.stringify({stopped,after:await lifetime(),staleInputAndActionRetired:true}))
        }

        await composer.fill('Keep my draft while inspecting a native tool group')
        await group.getByRole('button',{name:'Inspect tool group',exact:true}).click()
        const readGroup=async()=>{try{return JSON.parse(await readFile(join(workspace!,'native-tool-group-callback.json'),'utf8'))}catch{return undefined}}
        await expect.poll(async()=> (await readGroup())?.requestId).toBe(groupId)
        const hook=await readGroup();expect(hook.props).toMatchObject({isExpanded:false,isActive:false});expect(hook.box.text).toBe('Keep my draft while inspecting a native tool group')
        expect(hook.props.calls.some((call:any)=>call.tool_use_id==='file_read_3'&&call.tool==='Read'&&!call.isRunning)).toBe(true)
        await expect(disclosure).toHaveAttribute('aria-expanded','true')
        await expect(group.locator('[data-native-tool-result="file_read_3"]')).toHaveCount(1)
        if(clientLifetime&&groupedRetired){
          const fresh=group.locator('[data-native-tool-result="file_read_3"] [data-native-client]');await expect(fresh).toBeVisible()
          expect(await fresh.getAttribute('data-native-client')).not.toBe(groupedRetired.token)
          await expect.poll(async()=> (await lifetime())['group-result']?.key).toBe('none')
          await fresh.focus();await fresh.press('r');await expect.poll(async()=> (await lifetime())['group-result']?.key).toBe('r')
          await writeFile(join(workspace!,'native-group-client-reopened.json'),JSON.stringify({freshToken:await fresh.getAttribute('data-native-client'),retiredToken:groupedRetired.token,state:await lifetime()}))
        }

        const sites=JSON.parse(await readFile(join(workspace!,'native-tool-sites.json'),'utf8'))
        const original=sites.samples.flatMap((sample:any)=>sample.groups).filter((item:any)=>item.uuid===groupId).at(-1)
        expect([...new Set(original.messages.flatMap((message:any)=>message.toolIds))].sort()).toEqual(hook.props.calls.map((call:any)=>call.tool_use_id).sort())
        await appPage.setViewportSize({width:680,height:900});await group.scrollIntoViewIfNeeded();await appPage.screenshot({path:testInfo.outputPath('apack-native-tool-group-expanded.png')})
        await appPage.setViewportSize({width:680,height:600});await composer.scrollIntoViewIfNeeded();await expect(composer).toHaveText('Keep my draft while inspecting a native tool group')
        await appPage.screenshot({path:testInfo.outputPath('apack-native-tool-group-compact.png')})
      }
    }
    if (turn === 1) {
      const savedSplit = await appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes)
      expect(savedSplit.chatMaximized ?? false).toBe(false)
      if (clientLifetime) await appPage.locator('.cursor-row-resize').first().click({ button: 'right' })
      const tools = appPage.locator('[data-native-tool-activity]').last()
      await tools.getByRole('button').first().click()
      const result = tools.locator('[data-native-tool-result]')
      await expect(result.locator('[data-native-tool-format]')).toContainText('Rewritten native tool result')
      await expect(result.locator('[data-native-tool-format]')).toContainText('Wrote 1 line')
      formattedResults.push({ turn, id: 'file_fixture_1', text: await result.locator('[data-native-tool-format]').innerText() })
      const id = await result.getAttribute('data-native-tool-result')
      await composer.fill('Keep my draft while inspecting a native tool result')
      if (!clientLifetime) {
        const header = (await toolBlock(id!)).locator(`[data-native-tool-use="${id}"] [data-native-tool-format]`)
        await expect(header).toContainText('ShownWrite(display-only.txt)')
        const use = JSON.parse(await readFile(join(workspace!, 'native-tool-use-'+id+'.json'), 'utf8'))
        expect(use.requestId).toBe(id)
        expect(use.props).toMatchObject({ tool_use_id: id, tool: 'Write', input: { file_path: target }, isRunning: false, isErrored: false, isInterrupted: false })
      }
      await result.getByRole('button', { name: 'Inspect native tool result', exact: true }).click()
      await expect.poll(async () => { try { return JSON.parse(await readFile(join(workspace!, 'native-tool-result-hook.json'), 'utf8')).requestId } catch { return undefined } }).toBe(id)
      const hook = JSON.parse(await readFile(join(workspace!, 'native-tool-result-hook.json'), 'utf8'))
      expect(hook.props).toMatchObject({ tool_use_id: id, tool: 'Write', isErrored: false })
      expect(hook.props.output).toBeTruthy(); expect(typeof hook.props.output).toBe('object')
      let originalResult: any, originalCall: any
      for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
        try { const rows = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); originalCall = rows.find((row: any) => row.type === 'assistant' && Array.isArray(row.message?.content) && row.message.content.some((block: any) => block.type === 'tool_use' && block.id === id)); originalResult = rows.find((row: any) => row.type === 'user' && Array.isArray(row.message?.content) && row.message.content.some((block: any) => block.type === 'tool_result' && block.tool_use_id === id)); if (originalResult) break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
      }
      expect(originalResult?.uuid).toBeTruthy()
      expect(hook.props.output).toEqual(originalResult.toolUseResult)
      const frames = await appPage.evaluate(() => { const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return Object.values(c.nativeUiViews).flatMap((view: any) => view.state?.transcriptMessages ?? []) })
      expect(frames.find((frame: any) => frame.component === 'ToolResult' && frame.uuid === id)).toMatchObject({ resultUuid: originalResult.uuid, assistantUuid: originalCall.uuid })

      expect(hook.box.text).toBe('Keep my draft while inspecting a native tool result')
      expect(await readFile(target, 'utf8')).toBe('created\n')
      let retired: { token: string; mountId: string; threadId: string; actionId: string } | undefined
      if (clientLifetime) {
        await card.getByRole('button', { name: 'Session tools', exact: true }).click()
        const sandbox = result.locator('[data-native-client]')
        await sandbox.scrollIntoViewIfNeeded()
        await sandbox.getByRole('button', { name: 'Result action', exact: true }).click()
        await expect.poll(async () => (await lifetime()).result?.pressed).toBe(1)
        await sandbox.focus(); await sandbox.press('k')
        await expect.poll(async () => (await lifetime()).result?.key).toBe('k')
        await expect.poll(async () => (await lifetime()).above?.ticks ?? 0).toBeGreaterThan(1)
        const token = (await sandbox.getAttribute('data-native-client'))!
        await expect.poll(async () => {
          retired = await appPage.evaluate(({ token, toolId }) => {
            const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
            for (const [mountId, view] of Object.entries(c.nativeUiViews) as [string, any][]) {
              const frame = view.state?.transcriptMessages?.find((frame: any) => frame.component === 'ToolResult' && frame.uuid === toolId)
              if (frame?.body.status !== 'live') continue
              const find = (node: any): string | undefined => node.kind === 'button' && node.label === 'Result action' ? node.actionId : node.children?.map(find).find(Boolean)
              const actionId = find(frame.body.tree)
              if (actionId) return { token, mountId, threadId: c.currentThread.id, actionId }
            }
          }, { token, toolId: id })
          return !!retired
        }).toBe(true)
        await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-result-active.png') })
      } else {
      await result.scrollIntoViewIfNeeded()
      await expect(result).toBeInViewport({ ratio: 0.99 })
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      const resultBox = await result.boundingBox(), composerBox = await card.boundingBox()
      expect(resultBox!.height).toBeGreaterThan(40)
      expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(composerBox!.y)
      const transcriptBox = (await appPage.locator('[data-testid="chat-transcript"]').boundingBox())!
      expect(resultBox!.y).toBeGreaterThanOrEqual(transcriptBox.y - 1)
      expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(transcriptBox.y + transcriptBox.height + 1)
      const chatBox = await appPage.locator('[data-onboarding-id="chat-area"]').boundingBox()
      expect(chatBox!.height).toBeGreaterThanOrEqual(400)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-split.png') })
      await appPage.setViewportSize({ width: 680, height: 900 })
      await writeFile(join(workspace!, 'native-default-split-debug.json'), JSON.stringify(await appPage.evaluate(() => { const nodes = [document.querySelector('[data-onboarding-id="canvas-area"]'), document.querySelector('[data-onboarding-id="chat-area"]')]; return { height: innerHeight, split: (window as any).applicationState.getSnapshot().context.panelSizes, nodes: nodes.map(node => { const e = node as HTMLElement; return { box: e.getBoundingClientRect().toJSON(), style: e.getAttribute('style'), descendants: [e, ...Array.from(e.querySelectorAll('div')).slice(0, 9)].map(el => { const c = getComputedStyle(el); return { classes: el.className, style: el.getAttribute('style'), height: el.getBoundingClientRect().height, cssHeight: c.height, minHeight: c.minHeight, maxHeight: c.maxHeight, flex: c.flex, overflow: c.overflow } }) } }) } }), null, 2))
      await expect.poll(async () => (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeGreaterThan(300)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-tall.png') })
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      await appPage.setViewportSize({ width: 680, height: 600 })
      await result.scrollIntoViewIfNeeded(); await expect(result).toBeInViewport({ ratio: 0.99 })
      expect(await appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes)).toEqual(savedSplit)
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-tool-result-default-restored.png') })
      const divider = appPage.locator('.cursor-row-resize').first()
      await divider.click()
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.canvasHeight)).toBe(95)
      expect((await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeGreaterThan(500)
      await divider.click()
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.canvasHeight)).toBe(50)
      await result.scrollIntoViewIfNeeded(); await expect(result).toBeInViewport({ ratio: 0.99 })

      await divider.click({ button: 'right' })
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.chatMaximized)).toBe(true)
      await expect(result.getByRole('button', { name: 'Inspect native tool result', exact: true })).toBeInViewport({ ratio: 1 })
      await divider.click({ button: 'right' })
      await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.panelSizes.chatMaximized)).toBe(false)
      const beforeDrag = (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height
      const handle = (await divider.boundingBox())!
      await appPage.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await appPage.mouse.down(); await appPage.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 32, { steps: 4 }); await appPage.mouse.up()
      await expect.poll(async () => (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height).toBeLessThan(beforeDrag - 20)
      await writeFile(join(workspace!, 'native-default-split-geometry.json'), JSON.stringify({ compact: { chat: chatBox, result: resultBox, composer: composerBox }, savedSplit, canvasBeforeDrag: beforeDrag, canvasAfterDrag: (await appPage.locator('[data-onboarding-id="canvas-area"]').boundingBox())!.height, viewport: { width: 680, height: 600 }, maximizeRestore: true, collapseRestore: true, resizePreservedPreferences: true }, null, 2))
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')


      }
      await tools.getByRole('button').first().click()
      await expect(result).toHaveCount(0)
      await expect.poll(async () => appPage.evaluate((toolId: string | null) => { const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return Object.values(c.nativeUiViews).some((view: any) => view.state?.transcriptMessages?.some((frame: any) => frame.component === 'ToolResult' && frame.uuid === toolId)) }, id)).toBe(false)
      await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')
      if (clientLifetime && retired) {
        await appPage.waitForTimeout(400)
        const stopped = await lifetime()
        await appPage.evaluate(old => {
          const actor = (window as any).applicationState.system.get('default-setup/threads')
          actor.send({ type: 'CLAUDE_UI_CLIENT', mountId: old.mountId, threadId: old.threadId, id: old.token, sequence: 1000000, event: { kind: 'key', key: 'x' } })
          actor.send({ type: 'CLAUDE_UI_PRESS', mountId: old.mountId, threadId: old.threadId, actionId: old.actionId })
        }, retired)
        await expect.poll(async () => (await lifetime()).above?.posts ?? 0).toBeGreaterThan(stopped.above.posts + 2)
        expect((await lifetime()).result).toEqual(stopped.result)
        await writeFile(join(workspace!, 'native-client-lifetime-stopped.json'), JSON.stringify({ stopped, after: await lifetime(), staleInputAndActionRetired: true }))
        await tools.getByRole('button').first().click()
        const fresh = tools.locator('[data-native-tool-result] [data-native-client]')
        await expect(fresh).toBeVisible()
        expect(await fresh.getAttribute('data-native-client')).not.toBe(retired.token)
        await expect.poll(async () => (await lifetime()).result?.pressed).toBe(0)
        await fresh.scrollIntoViewIfNeeded(); await fresh.focus(); await fresh.press('r')
        await expect.poll(async () => (await lifetime()).result?.key).toBe('r')
        await expect(composer).toHaveText('Keep my draft while inspecting a native tool result')
        await appPage.screenshot({ path: testInfo.outputPath('apack-native-client-result-reopened.png') })
        await tools.getByRole('button').first().click()
      }
    }

  }
  let journal: any[] = []
  for (const bucket of await readdir(join(workspace!, '.claude/projects'))) {
    try { journal = (await readFile(join(workspace!, '.claude/projects', bucket, sessionId + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); break } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  }
  for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
    const original = journal.find(row => row.type === 'user' && row.message?.content === (fileLayout&&turn===4?acceptedLongUser?.text:promptForTurn(turn)))
    expect(original?.uuid).toBeTruthy()
    await expect.poll(async () => (await context()).messages.filter((message: any) => message.context?.cliUuid === original.uuid).length).toBe(1)
  }
  if(acceptedLongUser)expect(journal.find(row=>row.uuid===acceptedLongUser!.uuid)?.message?.content).toBe(acceptedLongUser.text)
  const nativeCost = journal.filter(row => row.type === 'cost-state').at(-1).totalCostUSD
  await expect.poll(async () => (await context()).claude.totalCostUsd).toBe(nativeCost)
  await composer.fill('Continue after file decisions.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await context()).messages.filter((message: any) => message.sender === 'assistant' && message.text === 'Fixture completed.').length).toBe(2)
  expect((await context()).sessionId).toBe(sessionId)
  const resumedCost = (await context()).claude.totalCostUsd
  expect(resumedCost).toBeGreaterThan(nativeCost)
  expect(errors).toEqual([])
  await writeFile(join(workspace!, 'native-tool-formatted-results.json'), JSON.stringify(formattedResults, null, 2))
  await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativeLongFileLayout:fileLayout, nativeWriteCreate: true, nativeWriteOverwrite: true, nativeEdit: true, nativeWriteDeny: true, nativeEditDeny: true, nativeFileCancel: true, nativeFileWithholding: true, nativeFileReview: true, nativeFileCompactControls: true, nativeToolResult: true, nativeToolGroup: !fileLayout, nativeToolGroupExpansionRewrite: !fileLayout, nativeToolFormatting: !fileLayout, nativeToolFormattingErrors: !fileLayout, nativeDefaultSplit: !clientLifetime, nativeClientLifetime: clientLifetime, nativeGroupedClientLifetime: clientLifetime, toolResultLayout: clientLifetime ? 'maximized Client lifetime fixture; independent AbovePrompt and ToolResult modules' : 'default split with native chat minimum; resized 600/900/600 without changing saved split', nativeHistorySynchronized: true, nativeCostSynchronized: true, resumedPrintSameSession: true, resumedCost, nativeCost, sessionId, boundNativePid, browserErrors: errors }, null, 2))
})
