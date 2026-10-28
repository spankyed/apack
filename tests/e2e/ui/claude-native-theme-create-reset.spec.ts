import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test.afterEach(async ({ appPage }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !appPage.isClosed()) await appPage.screenshot({ path: testInfo.outputPath('native-theme-create-reset-failure.png') }).catch(() => {}) })
test('creates, validates, forks and resets original native custom themes', async ({ app, appPage }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { themeCreateReset } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
  test.skip(!themeCreateReset, 'Explicit private native theme create/reset profile required')
  const { recognizeOnboardingPrompt } = await import(pathToFileURL(onboarding!).href)
  const errors: string[] = []; appPage.on('pageerror', error => errors.push(error.message))
  await appPage.setViewportSize({ width: 1100, height: 900 })
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
  ;(globalThis as any).self ??= globalThis
  const { Terminal } = createRequire(import.meta.url)('@app/claude-terminal-xterm')
  const dimensions = async () => {
    const ownerId=(await context()).native?.state?.ownerId;if(!ownerId)return 0
    const log=stripVTControlCharacters(await readFile(join(workspace!,'app-data/apack/logs/main.log'),'utf8'))
    const row=[...log.matchAll(/Incoming: "CLAUDE_TERMINAL_RESIZE" \{[\s\S]*?\n\}/g)].map(match=>match[0]).filter(row=>row.includes(ownerId)).at(-1)
    return Number(row?.match(/columns:\s*(\d+)/)?.[1]??0)
  }
  await expect.poll(dimensions).toBeGreaterThan(1)
  const terminal = new Terminal({ cols: await dimensions(), rows: 200, allowProposedApi: true })
  let lastSequence = 0, lastScreen = ''
  async function screen() {
    if (await input.isVisible()) { const cols = await dimensions(); if (cols > 1 && cols !== terminal.cols) terminal.resize(cols, 200) }
    const native = (await context()).native, chunks = native?.output?.filter((chunk: any) => chunk.sequence > lastSequence) ?? []
    if (chunks.length) { await new Promise<void>(resolve => terminal.write(chunks.map((chunk: any) => chunk.text).join(''), resolve)); lastSequence = chunks.at(-1).sequence }
    const buffer = terminal.buffer.active
    lastScreen = Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '').join('\n')
    return lastScreen
  }
  try {
    let theme = false, security = false, navigated = false, trustAt = 0, attempts = 0
    await expect.poll(async () => {
      const current = await context(), kind = recognizeOnboardingPrompt(await screen(), workspace)
      if (current.native?.state.status === 'live') return current.native.state.mainStatus?.includes('Workspace ready') === true
      if (kind === 'theme' && !theme) { theme = true; await input.press('Enter') }
      else if (kind === 'security-notes' && theme && !security) { security = true; await input.press('Enter') }
      else if (kind === 'workspace-trust' && !navigated) { navigated = true; trustAt = Date.now(); await input.press('ArrowDown') }
      else if (kind === 'workspace-trust-selected' && !navigated) { navigated = true; trustAt = Date.now() }
      else if (kind === 'workspace-trust-selected' && navigated && attempts < 3 && Date.now() - trustAt > 1200) { attempts++; await input.press('Enter'); trustAt = Date.now() }
      return false
    }, { timeout: 25000, intervals: [250] }).toBe(true)
    const boundNativePid = (await context()).native.state.nativePid
    if(process.env.CLAUDE_RESEARCH_THEME_DESKTOP==='1') {
      await section.getByRole('button',{name:'Back to conversation',exact:true}).click()
      const composer=card.locator('[contenteditable="true"]'),draft='Review the release notes with this theme.'
      await composer.fill(draft)
      const tools=card.getByRole('button',{name:'Session tools',exact:true});if(await tools.getAttribute('aria-expanded')!=='true')await tools.click()
      const ready=card.locator('.native-inline-text').filter({hasText:/^Workspace ready$/})
      const saved=await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))
      const panel=appPage.getByRole('dialog',{name:'Claude Code theme',exact:true})
      async function openTheme(){await card.getByRole('button',{name:'More actions',exact:true}).click();await appPage.getByRole('menuitem',{name:'Claude themes',exact:true}).click();await expect(panel).toBeVisible();await expect(panel.locator('[data-native-settings-option="dark"]')).toBeVisible();await expect(panel.locator('.xterm')).toHaveCount(0)}
      const themeDir=join(workspace!,'.claude/themes'),themeFile=(slug:string)=>join(themeDir,slug+'.json')
      const files=()=>readdir(themeDir).then(rows=>rows.sort()),settings=async()=>JSON.parse(await readFile(join(workspace!,'.claude/settings.json'),'utf8'))
      async function retained(){await expect(composer).toHaveText(draft);expect(await composer.evaluate(element=>({doc:(element as any).editor.state.doc.toJSON(),selection:(element as any).editor.state.selection.toJSON()}))).toEqual(saved);expect((await context()).native.state.nativePid).toBe(boundNativePid)}
      const captures:string[]=[]
      async function capture(stage:string){for(const [width,height]of [[1100,900],[680,600]]){await appPage.setViewportSize({width:width!,height:height!});await expect(panel).toBeInViewport({ratio:1});await retained();const path=testInfo.outputPath(`native-theme-desktop-${stage}-${width}.png`);await appPage.screenshot({path});captures.push(path)}}
      await openTheme();await panel.locator('[data-native-settings-option="dark"]').click();await expect(panel).toHaveCount(0);await expect.poll(async()=>(await settings()).theme).toBe('dark');await retained()
      await openTheme();const emptyNameFilesBefore=await files();await panel.locator('[data-native-settings-option="__new_custom_theme__"]').click()
      const name=panel.locator('[data-native-setting-field="name"]');await expect(name).toBeVisible()
      await panel.getByRole('button',{name:'Create theme',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('not accepted');const emptyNameFilesAfter=await files();expect(emptyNameFilesAfter).toEqual(emptyNameFilesBefore)
      await panel.getByRole('button',{name:'Refresh',exact:true}).click();await name.fill('Release Review');await expect(panel.getByRole('button',{name:'Create theme',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Create theme',exact:true}).click()
      await expect.poll(async()=>JSON.parse(await readFile(themeFile('release-review'),'utf8').catch(()=>'{}'))).toMatchObject({name:'Release Review',base:'dark',overrides:{}})
      await expect(panel.locator('[data-native-settings-option="success"]')).toBeVisible()
      let createdBefore=await readFile(themeFile('release-review'),'utf8');await panel.locator('[data-native-settings-option="success"]').click()
      const color=panel.locator('[data-native-setting-field="color"]');await expect(color).toBeVisible();await color.fill('not-a-color');await expect(panel.getByRole('button',{name:'Save color',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Save color',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('not accepted')
      const invalidFileBefore=createdBefore,invalidFileAfter=await readFile(themeFile('release-review'),'utf8');expect(invalidFileAfter).toBe(invalidFileBefore);await capture('invalid')
      await panel.getByRole('button',{name:'Refresh',exact:true}).click();await color.fill('#66bb77');await panel.getByRole('button',{name:'Save color',exact:true}).click();await expect.poll(async()=>JSON.parse(await readFile(themeFile('release-review'),'utf8')).overrides.success).toBe('#66bb77');await expect(ready).toHaveCSS('color','rgb(102, 187, 119)');createdBefore=await readFile(themeFile('release-review'),'utf8');await expect(panel.locator('[data-native-settings-option="success"]')).toBeVisible();
      await panel.locator('[data-native-settings-option="success"]').click();await color.fill('#abcdef');await expect(ready).toHaveCSS('color','rgb(171, 205, 239)');await panel.getByRole('button',{name:'Cancel',exact:true}).click();await expect(ready).toHaveCSS('color','rgb(102, 187, 119)');expect(await readFile(themeFile('release-review'),'utf8')).toBe(createdBefore);await panel.getByRole('button',{name:'Close theme selection',exact:true}).click();await expect(panel).toHaveCount(0)
      await openTheme();const pluginFile=join(workspace!,'prompt-fixture/theme-packs/team.json'),pluginBefore=await readFile(pluginFile,'utf8')
      await panel.getByRole('button',{name:'Edit Team Review',exact:true}).click();await expect(name).toBeVisible();await name.fill('Release Review');await panel.getByRole('button',{name:'Create theme',exact:true}).click()
      await expect.poll(async()=>JSON.parse(await readFile(themeFile('release-review-2'),'utf8').catch(()=>'{}'))).toMatchObject({name:'Release Review',base:'dark',overrides:{success:'#55aa66',warning:'#cc9944'}})
      await expect(panel.locator('[data-native-settings-option="success"]')).toBeVisible();await capture('fork')
      await panel.getByRole('button',{name:'Reset success',exact:true}).click();await expect.poll(async()=>JSON.parse(await readFile(themeFile('release-review-2'),'utf8')).overrides).toEqual({warning:'#cc9944'})
      const resetTheme=JSON.parse(await readFile(themeFile('release-review-2'),'utf8')),pluginAfter=await readFile(pluginFile,'utf8'),createdAfter=await readFile(themeFile('release-review'),'utf8');expect(pluginAfter).toBe(pluginBefore);expect(createdAfter).toBe(createdBefore)
      await capture('reset');await panel.getByRole('button',{name:'Close theme selection',exact:true}).click();await expect(panel).toHaveCount(0);await retained()
      await section.getByRole('button',{name:'Use native interface',exact:true}).click();await section.getByRole('button',{name:'Stop session',exact:true}).click();await expect.poll(async()=>(await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
      const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
      await composer.fill('Continue the same session after theme editing.');await card.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(async()=>(await context()).claude.chatState).toBe('success');expect((await context()).sessionId).toBe(sessionId);expect(errors).toEqual([])
      await writeFile(join(workspace!,'native-theme-create-reset-proof.json'),JSON.stringify({desktopControls:true,validColorWrite:true,cancelRestoresPalette:true,captures,saved,emptyNameFilesBefore,emptyNameFilesAfter,createdBefore,createdAfter,invalidFileBefore,invalidFileAfter,resetTheme,pluginBefore,pluginAfter}))
      await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,nativePlanScenario:'theme',nativeThemeDesktop:true,nativeThemeCreateReset:true,nativeThemeEmptyName:true,nativeThemeInvalidRejected:true,nativeThemeFork:true,nativeThemeCollision:true,nativeThemeTokenReset:true,nativeRetainedDraft:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors}));return
    }

    const composer = card.locator('[contenteditable="true"]'), ready = card.locator('.native-inline-text').filter({ hasText: /^Workspace ready$/ })
    const files = () => readdir(join(workspace!, '.claude/themes')).then(values => values.sort())
    const themeFile = (slug: string) => join(workspace!, '.claude/themes', slug + '.json')
    const settings = async () => JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8'))
    const highlighted = async () => (await screen()).split('\n').flatMap(line => { const match = line.match(/❯\s+(.+)/); return match ? [match[1]!.trim().replace(/^✔\s*/, '')] : [] }).at(-1) ?? ''
    async function openPicker(target: string) {
      await input.pressSequentially('/theme'); await input.press('Enter')
      await expect.poll(screen).toContain('Choose the text style')
      await expect.poll(highlighted).not.toBe('')
      const matches = (label: string) => target === 'Dark mode' ? label === target : label.startsWith(target)
      for (let count = 0; count < 20 && !matches(await highlighted()); count++) { const before = await highlighted(); await input.press('ArrowDown'); await expect.poll(highlighted).not.toBe(before) }
      expect(matches(await highlighted())).toBe(true)
    }
    async function mirror() {
      await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
      const tools = card.getByRole('button', { name: 'Session tools', exact: true }); if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
      await expect(ready).toBeVisible()
    }
    const enterNative = () => section.getByRole('button', { name: 'Use native interface', exact: true }).click()
    async function finishEditor() { const completed = ((await screen()).match(/Using custom theme/g) ?? []).length; await input.press('Escape'); await expect.poll(async () => ((await screen()).match(/Using custom theme/g) ?? []).length).toBeGreaterThan(completed) }
    await openPicker('Dark mode'); await input.press('Enter'); await expect.poll(async () => (await settings()).theme).toBe('dark')
    await mirror()
    const baseColor = await ready.evaluate(element => getComputedStyle(element).color)
    const draft = 'Review the release notes with this theme.'
    await composer.fill(draft)
    await enterNative(); await openPicker('New custom theme'); await input.press('Enter')
    await expect.poll(screen).toContain('New custom theme')
    await expect.poll(screen).toContain('Name:')
    const emptyNameFilesBefore = await files()
    await input.press('Enter'); await input.pressSequentially('Release Review')
    await expect.poll(screen).toContain('Name: Release Review')
    const emptyNameFilesAfter = await files(); expect(emptyNameFilesAfter).toEqual(emptyNameFilesBefore)
    await input.press('Enter')
    await expect.poll(async () => JSON.parse(await readFile(themeFile('release-review'), 'utf8').catch(() => '{}'))).toMatchObject({ name: 'Release Review', base: 'dark', overrides: {} })
    await expect.poll(async () => (await settings()).theme).toBe('custom:release-review')
    await expect.poll(screen).toContain('Filter color tokens')
    const createdBefore = await readFile(themeFile('release-review'), 'utf8')
    await input.pressSequentially('success'); await expect.poll(screen).toContain('success'); await input.press('Enter')
    await expect.poll(screen).toContain('Enter to save')
    await input.press('Control+u'); await input.pressSequentially('not-a-color')
    await expect.poll(screen).toContain('Accepts rgb(r,g,b)')
    await input.press('Enter')
    await mirror(); await expect(ready).toHaveCSS('color', baseColor); await expect(composer).toHaveText(draft)
    const invalidFileBefore = createdBefore, invalidFileAfter = await readFile(themeFile('release-review'), 'utf8'); expect(invalidFileAfter).toBe(invalidFileBefore)
    await enterNative(); await expect.poll(screen).toContain('Accepts rgb(r,g,b)')
    await appPage.screenshot({ path: testInfo.outputPath('native-theme-invalid-value.png') })
    await input.press('Escape'); await expect.poll(screen).toContain('Enter to edit')
    await input.press('Tab'); await finishEditor()
    expect(await readFile(themeFile('release-review'), 'utf8')).toBe(createdBefore)
    await openPicker('Team Review'); await input.press('Control+e')
    await expect.poll(screen).toContain('Fork Team Review to your themes')
    const pluginFile = join(workspace!, 'prompt-fixture/theme-packs/team.json'), pluginBefore = await readFile(pluginFile, 'utf8')
    await input.press('Control+u'); await input.pressSequentially('Release Review'); await input.press('Enter')
    await expect.poll(async () => JSON.parse(await readFile(themeFile('release-review-2'), 'utf8').catch(() => '{}'))).toMatchObject({ name: 'Release Review', base: 'dark', overrides: { success: '#55aa66', warning: '#cc9944' } })
    await expect.poll(async () => (await settings()).theme).toBe('custom:release-review-2')
    await expect.poll(screen).toContain('Filter color tokens')
    await input.pressSequentially('success'); await expect.poll(screen).toContain('success')
    await mirror(); await expect(ready).toHaveCSS('color', 'rgb(85, 170, 102)'); await expect(composer).toHaveText(draft)
    await appPage.screenshot({ path: testInfo.outputPath('native-theme-fork-preview.png') })
    await enterNative(); await input.press('Tab')
    await expect.poll(async () => JSON.parse(await readFile(themeFile('release-review-2'), 'utf8')).overrides).toEqual({ warning: '#cc9944' })
    const resetTheme = JSON.parse(await readFile(themeFile('release-review-2'), 'utf8')); expect(resetTheme.overrides).toEqual({ warning: '#cc9944' })
    const pluginAfter = await readFile(pluginFile, 'utf8'), createdAfter = await readFile(themeFile('release-review'), 'utf8')
    expect(pluginAfter).toBe(pluginBefore); expect(createdAfter).toBe(createdBefore)
    await mirror(); await expect(ready).toHaveCSS('color', baseColor); await expect(card.getByText('Theme details', { exact: true })).toHaveCSS('color', 'rgb(204, 153, 68)')
    for (const size of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
      await appPage.setViewportSize(size); await expect(ready).toBeInViewport({ ratio: .99 }); await expect(composer).toHaveText(draft); await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: .99 })
      await appPage.screenshot({ path: testInfo.outputPath(`native-theme-reset-${size.width}-${size.height}.png`) })
    }
    expect((await context()).native.state.nativePid).toBe(boundNativePid)
    await writeFile(join(workspace!, 'native-theme-create-reset-proof.json'), JSON.stringify({ emptyNameFilesBefore, emptyNameFilesAfter, createdBefore, createdAfter, invalidFileBefore, invalidFileAfter, resetTheme, pluginBefore, pluginAfter, baseColor }))
    await enterNative(); await finishEditor()
    await section.getByRole('button', { name: 'Stop session', exact: true }).click()
    await expect.poll(async () => (await context()).native?.state.status ?? 'exited').toMatch(/^(exited|error)$/)
    const back = section.getByRole('button', { name: 'Back to conversation', exact: true }); if (await back.isVisible()) await back.click()
    await composer.fill('Continue the same session after theme editing.')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await context()).claude.chatState).toBe('success')
    expect((await context()).sessionId).toBe(sessionId); expect(errors).toEqual([])
    await writeFile(join(workspace!, 'native-terminal-app-evidence.json'), JSON.stringify({ actualAppGui: true, nativePlanScenario: 'theme', nativeThemeCreateReset: true, nativeThemeEmptyName: true, nativeThemeInvalidRejected: true, nativeThemeFork: true, nativeThemeCollision: true, nativeThemeTokenReset: true, nativeRetainedDraft: true, sameNativeOwner: true, resumedPrintSameSession: true, sessionId, finalSessionId: sessionId, boundNativePid, browserErrors: errors }))
  } finally { await writeFile(join(workspace!, 'native-theme-create-reset-screen.txt'), lastScreen); terminal.dispose() }
})
