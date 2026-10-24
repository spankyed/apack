import { readFile, readdir as _readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@apackdev/testing'
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE, launcher = process.env.CLAUDE_RESEARCH_LAUNCHER, onboarding = process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace || !launcher || !onboarding, 'Explicit private native terminal fixture required')
test('renders original theme previews, cancellation, button roles and saved custom reload', async ({ app, appPage, electronApp: _electronApp }, testInfo) => {
  test.setTimeout(90000)
  expect(process.env.HOME).toBe(workspace)
  const { planScenario, documentTheme } = JSON.parse(await readFile(join(workspace!, 'question-preview-fixture.json'), 'utf8'))
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
  const boundNativePid = (await context()).native.state.nativePid
  await input.pressSequentially('/theme')
  await input.press('Enter')
  await expect.poll(async () => (await context()).native.output.map((chunk: any) => chunk.text).join('')).toContain('Research')
  await writeFile(join(workspace!, 'native-theme-picker-output.txt'), (await context()).native.output.map((chunk: any) => chunk.text).join(''))
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-theme-picker.png') })
  const savedTheme = JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).theme
  await input.press('ArrowDown')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await appPage.setViewportSize({ width: 680, height: 900 })
  const label = card.getByText('Native themed label', { exact: true })
  const action = card.getByRole('button', { name: 'Native theme action', exact: true })
  const composer = card.locator('[contenteditable="true"]')
  const note = card.getByRole('textbox', { name: 'Theme note', exact: true })
  const choice = card.getByRole('combobox', { name: 'Theme choice', exact: true })
  let previewFieldColor = ''
  const documentLink = card.getByRole('link', { name: 'Native document link', exact: true })
  const documentProse = card.locator('.native-document-themed [data-native-markdown-ansi]').filter({ hasText: 'Native document paragraph' })
  const sourceCode = card.locator('[data-native-code-ansi][aria-label="Code"]')
  const diffCode = card.locator('[data-native-code-ansi][aria-label="Code diff"]')
  const documentReceipts: any[] = []
  async function readDocuments() {
    return appPage.evaluate(() => {
      const state = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context
      const pending = Object.values(state.nativeUiViews).filter((view: any) => view.threadId === state.currentThread?.id && view.state?.status === 'live').map((view: any) => view.state.tree), codes: any[] = [], markdown: any[] = []
      while (pending.length) { const node: any = pending.pop(); if (!node) continue; if (node.kind === 'code') codes.push(node); if (node.kind === 'markdown') markdown.push(node); if (Array.isArray(node.children)) pending.push(...node.children) }
      return { markdown: markdown.find(node => node.text.includes('Native document paragraph')), source: codes.find(node => node.source.includes('nativeThemeValue')), diff: codes.find(node => node.source.includes('nativeThemeDiff')) }
    })
  }
  async function verifyDocuments(color: string, stage: string) {
    await expect(documentLink).toHaveCSS('color', color)
    await expect(documentProse).toHaveCSS('color', color)
    await expect(sourceCode).toHaveCSS('color', color)
    await expect(diffCode).toHaveCSS('color', color)
    const receipt = await readDocuments()
    expect(receipt.markdown?.nativeAnsi).toContain('nativeMarkdownValue')
    expect(receipt.markdown?.nativeAnsi).toContain('\x1b]8;')
    expect(await documentProse.textContent()).toBe(stripVTControlCharacters(receipt.markdown.nativeAnsi))
    expect(await documentProse.locator('span').evaluateAll(spans => spans.some(span => (span as HTMLElement).style.fontWeight !== ''))).toBe(true)
    expect(receipt.source?.source).toBe('const nativeThemeValue = "document";\nconsole.log(nativeThemeValue);')
    expect(receipt.diff?.source).toBe('@@ -1 +1 @@\n-const nativeThemeDiff = 1;\n+const nativeThemeDiff = 2;')
    expect(await sourceCode.textContent()).toBe(stripVTControlCharacters(receipt.source.nativeAnsi))
    expect(await diffCode.textContent()).toBe(stripVTControlCharacters(receipt.diff.nativeAnsi))
    await expect(sourceCode).toContainText(/3\s+const/)
    await expect(diffCode).toContainText('nativeThemeDiff')
    expect(await sourceCode.locator('[class*="hljs"]').count()).toBe(0)
    expect(await diffCode.locator('span').evaluateAll(spans => spans.some(span => (span as HTMLElement).style.backgroundColor !== ''))).toBe(true)
    documentReceipts.push({ stage, color, ...receipt })
  }
  async function showTools() {
    await expect(card).toBeVisible()
    const toggle = card.getByRole('button', { name: 'Session tools', exact: true })
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(label).toBeVisible()
    await expect(action).toBeEnabled()
    await action.focus()
    await action.scrollIntoViewIfNeeded()
    try { await expect(action).toBeInViewport({ ratio: 0.99 }) }
    catch (error) {
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-theme-control-visibility-failure.png') })
      throw error
    }
    // Layout can move the action under the old pointer; inspect base paint outside the site.
    await appPage.mouse.move(8, 8)
  }
  await showTools()
  await composer.fill('Draft retained during native theme preview')
  await expect(label).toHaveCSS('color', 'rgb(44, 122, 57)')
  await expect(action).toHaveCSS('color', 'rgb(87, 105, 247)')
  previewFieldColor = await note.evaluate(el => getComputedStyle(el).color)
  await expect(choice).toHaveCSS('color', previewFieldColor)
  if (documentTheme) await verifyDocuments(previewFieldColor, 'preview')
  await note.fill('Retain this field note through theme changes')
  await expect.poll(async () => readFile(join(workspace!, 'native-theme-note.txt'), 'utf8').catch(() => '')).toBe('Retain this field note through theme changes')
  await choice.selectOption('b')
  await expect.poll(async () => readFile(join(workspace!, 'native-theme-choice.txt'), 'utf8').catch(() => '')).toBe('b')
  expect(JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).theme).toBe(savedTheme)
  await action.scrollIntoViewIfNeeded()
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-theme-preview.png') })
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await input.press('Escape')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await showTools()
  await expect(label).toHaveCSS('color', 'rgb(78, 186, 101)')
  await expect(action).toHaveCSS('color', 'rgb(177, 185, 249)')
  await expect.poll(async () => note.evaluate(el => getComputedStyle(el).color)).not.toBe(previewFieldColor)
  await expect(note).toHaveValue('Retain this field note through theme changes')
  await expect(choice).toHaveValue('b')
  await expect(composer).toHaveText('Draft retained during native theme preview')
  if (documentTheme) await verifyDocuments(await note.evaluate(el => getComputedStyle(el).color), 'preview-cancelled')
  expect(JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).theme).toBe(savedTheme)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-theme-preview-cancelled.png') })
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await input.pressSequentially('/theme'); await input.press('Enter')
  // Read the current native highlight; the picker may reopen at Auto or the saved theme.
  async function highlightedTheme() {
    const output = stripVTControlCharacters((await context()).native.output.map((chunk: any) => chunk.text).join(''))
    return output.slice(output.lastIndexOf('Theme')).match(/❯\s*([^\r\n]+)/)?.[1]?.trim().replace(/^✔\s*/, '') ?? ''
  }
  await expect.poll(highlightedTheme).not.toBe('')
  for (let index = 0; index < 9 && !(await highlightedTheme()).startsWith('Research'); index++) {
    const before = await highlightedTheme()
    await input.press('ArrowDown')
    await expect.poll(highlightedTheme).not.toBe(before)
  }
  expect(await highlightedTheme()).toMatch(/^Research(?:\s*custom)?$/)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-theme-picker-selected.png') })
  await writeFile(join(workspace!, 'native-theme-selected-output.txt'), (await context()).native.output.map((chunk: any) => chunk.text).join(''))
  await input.press('Enter')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).theme).toBe('custom:research')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await appPage.setViewportSize({ width: 680, height: 900 })
  await showTools()
  await expect(label).toHaveCSS('color', 'rgb(17, 34, 51)')
  await expect(note).toHaveCSS('color', 'rgb(18, 52, 86)')
  await expect(choice).toHaveCSS('color', 'rgb(18, 52, 86)')
  await expect(note).toHaveValue('Retain this field note through theme changes')
  const themedBox = label.locator('..')
  await expect(themedBox).toHaveCSS('border-top-color', 'rgb(171, 205, 239)')
  if (documentTheme) {
    await verifyDocuments('rgb(18, 52, 86)', 'custom-saved')
    const enabled = await readDocuments()
    await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
    const beforePicker = (await context()).native.output.at(-1)?.sequence ?? 0
    await input.pressSequentially('/theme'); await input.press('Enter')
    await expect.poll(async () => stripVTControlCharacters((await context()).native.output.filter((chunk: any) => chunk.sequence > beforePicker).map((chunk: any) => chunk.text).join(''))).toContain('Theme')
    await expect.poll(highlightedTheme).not.toBe('')
    await input.press('Control+t')
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).syntaxHighlightingDisabled).toBe(true)
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    await showTools()
    await expect.poll(async () => (await readDocuments()).diff?.nativeAnsi).not.toBe(enabled.diff.nativeAnsi)
    await expect.poll(async () => (await readDocuments()).markdown?.nativeAnsi).not.toBe(enabled.markdown.nativeAnsi)
    await verifyDocuments('rgb(18, 52, 86)', 'syntax-disabled')
    await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
    await input.press('Control+t')
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, '.claude/settings.json'), 'utf8')).syntaxHighlightingDisabled).toBe(false)
    await input.press('Escape')
    await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    await showTools()
    await expect.poll(async () => (await readDocuments()).diff?.nativeAnsi).toBe(enabled.diff.nativeAnsi)
    await expect.poll(async () => (await readDocuments()).markdown?.nativeAnsi).toBe(enabled.markdown.nativeAnsi)
    await verifyDocuments('rgb(18, 52, 86)', 'syntax-restored')
  }
  // Exercise the original custom editor: a valid edit previews without saving; Escape restores it.
  const savedCustomTheme = await readFile(join(workspace!, '.claude/themes/research.json'), 'utf8')
  const nativeText = async () => stripVTControlCharacters((await context()).native.output.map((chunk: any) => chunk.text).join(''))
  await composer.fill('Draft retained during custom theme editing')
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await input.pressSequentially('/theme'); await input.press('Enter')
  await expect.poll(highlightedTheme).toMatch(/^Research(?:\s*custom)?$/)
  await input.press('Control+e')
  await expect.poll(nativeText).toContain('Filter color tokens')
  await input.pressSequentially('success')
  await expect.poll(nativeText).toContain('success')
  await input.press('Enter')
  await expect.poll(nativeText).toContain('Enter to save')
  await input.press('Control+u'); await input.pressSequentially('#a1b2c3')
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme-editor.png') })
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await showTools()
  await expect(label).toHaveCSS('color', 'rgb(161, 178, 195)')
  await expect(note).toHaveValue('Retain this field note through theme changes')
  await expect(choice).toHaveValue('b')
  await expect(composer).toHaveText('Draft retained during custom theme editing')
  expect(await readFile(join(workspace!, '.claude/themes/research.json'), 'utf8')).toBe(savedCustomTheme)
  await label.scrollIntoViewIfNeeded()
  await expect(label).toBeInViewport({ ratio: 0.99 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-editor-preview.png') })
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await input.press('Escape')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await showTools()
  await expect(label).toHaveCSS('color', 'rgb(17, 34, 51)')
  expect(await readFile(join(workspace!, '.claude/themes/research.json'), 'utf8')).toBe(savedCustomTheme)
  await label.scrollIntoViewIfNeeded()
  await expect(label).toBeInViewport({ ratio: 0.99 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-editor-cancelled.png') })
  await section.getByRole('button', { name: 'Use native interface', exact: true }).click()
  await input.press('Enter')
  await input.press('Control+u'); await input.pressSequentially('#c3b2a1'); await input.press('Enter')
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, '.claude/themes/research.json'), 'utf8')).overrides.success).toBe('#c3b2a1')
  await input.press('Escape')
  await section.getByRole('button', { name: 'Back to conversation', exact: true }).click()
  await showTools()
  await expect(label).toHaveCSS('color', 'rgb(195, 178, 161)')
  await expect(note).toHaveValue('Retain this field note through theme changes')
  await expect(composer).toHaveText('Draft retained during custom theme editing')
  await label.scrollIntoViewIfNeeded()
  await expect(label).toBeInViewport({ ratio: 0.99 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-editor-saved.png') })
  await composer.fill('Draft retained during native theme reload')
  await expect(action).toHaveCSS('color', 'rgb(68, 85, 102)')
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme.png') })
  await note.focus()
  await writeFile(join(workspace!, '.claude/themes/research.json'), JSON.stringify({ name: 'Research', base: 'dark', overrides: { text: '#abcdef', success: '#998877', warning: '#123456', suggestion: '#334455' } }))
  await expect(label).toHaveCSS('color', 'rgb(153, 136, 119)', { timeout: 10000 })
  await expect(note).toHaveCSS('color', 'rgb(171, 205, 239)')
  await expect(choice).toHaveCSS('color', 'rgb(171, 205, 239)')
  await expect(note).toBeFocused()
  await expect(note).toHaveValue('Retain this field note through theme changes')
  await expect(choice).toHaveValue('b')
  if (documentTheme) await verifyDocuments('rgb(171, 205, 239)', 'custom-reloaded')
  const composerGeometry: any[] = []
  for (const height of [900, 600]) {
    await appPage.setViewportSize({ width: 680, height })
    await note.focus()
    const fieldLabel = note.locator('..').locator('.native-field-label')
    await expect(fieldLabel).toBeInViewport({ ratio: 0.99 }).catch(async error => {
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-field-label-failure-' + height + '.png') })
      throw error
    })
    await expect(note).toBeInViewport({ ratio: 0.99 }).catch(async error => {
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-field-bounds-failure-' + height + '.png') })
      await writeFile(join(workspace!, 'native-field-bounds-failure.json'), JSON.stringify({ height, context: await context(), ui: await appPage.evaluate(() => { const c = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context; return { views: c.nativeUiViews, focus: c.nativeUiFocus } }), geometry: await card.evaluate(card => {
        const note = card.querySelector('textarea[aria-label="Theme note"]')!
        const nodes = [note, note.parentElement!, ...(() => { const result: Element[] = []; for(let p: Element | null = note.parentElement; p && p !== card; p = p.parentElement) result.push(p); return result })(), card]
        return nodes.map(node => { const el = node as HTMLElement, r = el.getBoundingClientRect(), style = getComputedStyle(el); return { tag: el.tagName, class: el.className, active: el === document.activeElement, top:r.top, bottom:r.bottom, height:r.height, clientHeight:el.clientHeight, scrollHeight:el.scrollHeight, scrollTop:el.scrollTop, padding:style.padding, overflow:style.overflow } })
      }) }, null, 2))
      throw error
    })
    await writeFile(join(workspace!, 'native-composer-geometry-' + height + '.json'), JSON.stringify(await card.evaluate(element => {
      const selectors = ['[contenteditable="true"]', '.composer-document', '.tiptap-wrapper', '[data-testid="composer-editor-area"]', '[data-testid="composer-session-strip"]', '[data-composer-toolbar]', '[data-testid="native-composer-placements"]']
      return selectors.flatMap(selector => [...element.querySelectorAll<HTMLElement>(selector)].map(node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { selector, rect: { x:r.x, y:r.y, width:r.width, height:r.height }, scrollHeight:node.scrollHeight, clientHeight:node.clientHeight, minHeight:s.minHeight, padding:s.padding, flex:s.flex, overflow:s.overflow } }))
    })))
    await expect(composer).toBeInViewport({ ratio: 0.99 }).catch(async error => {
      await appPage.screenshot({ path: testInfo.outputPath('apack-native-composer-visibility-failure-' + height + '.png') })
      throw error
    })
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 0.99 })
    const sizes = await card.evaluate(element => {
      const strip = element.querySelector<HTMLElement>('[data-testid="composer-session-strip"]')!
      const site = element.querySelector<HTMLElement>('.native-extension-surface')!
      return { card: { height: element.clientHeight, scrollHeight: element.scrollHeight }, strip: { height: strip.clientHeight, scrollHeight: strip.scrollHeight }, site: { height: site.clientHeight, scrollHeight: site.scrollHeight } }
    })
    expect(sizes.card.scrollHeight).toBeLessThanOrEqual(sizes.card.height + 1)
    expect(sizes.strip.scrollHeight).toBeLessThanOrEqual(sizes.strip.height + 1)
    composerGeometry.push({ height, ...sizes })
    await appPage.screenshot({ path: testInfo.outputPath('apack-native-field-composer-' + height + '.png') })
  }
  if (documentTheme) {
    await appPage.setViewportSize({ width: 680, height: 900 })
    const site = card.locator('.native-extension-surface')
    await expect.poll(() => site.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(220)
    await card.getByRole('button', { name: 'Session tools', exact: true }).click()
    await expect(site).toBeHidden()
    await expect(composer).toHaveText('Draft retained during native theme reload')
    await card.getByRole('button', { name: 'Session tools', exact: true }).click()
    await expect(site).toBeVisible()
    await expect.poll(() => site.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(220)
    await composer.focus()
    for (const height of [900, 600]) {
      await appPage.setViewportSize({ width: 680, height })
      await expect.poll(() => site.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(height === 900 ? 220 : 80)
      for (const [name, target] of [['markdown', documentProse], ['source', sourceCode], ['diff', diffCode]] as const) {
        await target.scrollIntoViewIfNeeded()
        await expect(target).toBeInViewport({ ratio: name === 'markdown' ? 0.2 : 0.99 })
        await expect(composer).toBeInViewport({ ratio: 0.99 })
        await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 0.99 })
        await appPage.screenshot({ path: testInfo.outputPath('apack-native-document-' + name + '-' + height + '.png') })
      }
    }
    await card.getByRole('link', { name: 'native callback', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-document-link.json'), 'utf8').catch(() => '{}')).href).toBe('https://example.com/native-document-callback')
    await expect(composer).toHaveText('Draft retained during native theme reload')
    await writeFile(join(workspace!, 'native-document-app-evidence.json'), JSON.stringify({ receipts: documentReceipts, callback: JSON.parse(await readFile(join(workspace!, 'native-document-link.json'), 'utf8')), sourceAndDiffNormalCompact: true }, null, 2))
  }
  await appPage.setViewportSize({ width: 680, height: 900 })
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-field-theme-reloaded.png') })
  await expect(themedBox).toHaveCSS('border-top-color', 'rgb(18, 52, 86)')
  await expect(composer).toHaveText('Draft retained during native theme reload')
  await expect(action).toHaveCSS('color', 'rgb(51, 68, 85)')
  await action.scrollIntoViewIfNeeded()
  await action.hover()
  await expect(action).toHaveCSS('color', 'rgb(18, 52, 86)')
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme-hover.png') })
  await action.click()
  await expect.poll(async () => readFile(join(workspace!, 'native-theme-action.txt'), 'utf8').catch(() => '')).toBe('pressed')
  expect((await context()).native.state.nativePid).toBe(boundNativePid)
  expect((await context()).sessionId).toBe(sessionId)
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-custom-theme-reloaded.png') })
  await composer.fill('Continue after native theme verification.')
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => { const c = await context(); return c.native?.state.busy === false && c.messages.some((m: any) => m.context?.claudeTerminalMessage && m.text === 'Fixture completed.') }).toBe(true)
  await section.getByRole('button',{name:'Use native interface',exact:true}).click()
  await section.getByRole('button',{name:'Stop session',exact:true}).click()
  await expect.poll(async()=> (await context()).native?.state.status??'exited').toMatch(/^(exited|error)$/)
  const back=section.getByRole('button',{name:'Back to conversation',exact:true});if(await back.isVisible())await back.click()
  await composer.fill('Continue the same session after layout verification.')
  await card.getByRole('button',{name:'Send',exact:true}).click()
  await expect.poll(async()=> (await context()).claude.chatState).toBe('success')
  expect((await context()).sessionId).toBe(sessionId)
  expect(errors).toEqual([])
  await writeFile(join(workspace!,'native-terminal-app-evidence.json'),JSON.stringify({actualAppGui:true,...(documentTheme?{nativeDocumentTheme:true,nativeDocumentSyntaxToggle:true,nativeDocumentCallback:true,nativeDocumentCompact:true}:{}),nativePlanScenario:'theme',nativeCustomTheme:true,nativeThemePreview:true,nativeThemePreviewCancel:true,nativeCustomEditorPreview:true,nativeCustomEditorCancel:true,nativeCustomEditorSave:true,nativeThemeButtonRoles:true,nativeComposerSingleViewport:true,nativeFieldLabelVisibleNormalCompact:true,composerGeometry,nativeFieldTheme:true,nativeFieldThemeRetainedDraft:true,nativeThemeReload:true,nativeRetainedDraft:true,nativeThemeAction:true,nativeThemeHover:true,sameNativeOwner:true,resumedPrintSameSession:true,sessionId,finalSessionId:sessionId,boundNativePid,browserErrors:errors},null,2))
})
