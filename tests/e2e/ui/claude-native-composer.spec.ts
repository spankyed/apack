import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@apackdev/testing';

const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE;
const launcher = process.env.CLAUDE_RESEARCH_LAUNCHER;
const endpoint = process.env.CLAUDE_RESEARCH_MODEL_URL;
test.skip(!workspace || !launcher || !endpoint, 'Explicit private native research fixture required');

test('native extension fields, paint and hover work inside the actual composer', async ({ app, appPage }, testInfo) => {
  expect(process.env.HOME).toBe(workspace);
  expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  const errors: string[] = [];
  appPage.on('pageerror', error => errors.push(error.message));
  await app.waitForPlugin('default-setup/threads');
  await app.navigate('default-setup/threads');
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.forcedMode)).toBe('Birth');
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
  });
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..');
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!);
  // CLI paths save after the form's 600ms debounce; remount to verify persisted state.
  await appPage.waitForTimeout(700);
  await app.navigate('default-setup/threads');
  await app.navigate('host/settings');
  await expect(provider.getByPlaceholder('Path override (auto-detected if empty)')).toHaveValue(launcher!);
  await app.navigate('default-setup/threads');
  await appPage.evaluate(cwd => {
    const threads = (window as any).applicationState.system.get('default-setup/threads');
    threads.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd });
    threads.send({ type: 'VIEW_DASHBOARD' });
    threads.send({ type: 'SET_MODE', mode: 'Claude Code' });
  }, workspace!);
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]');
  const editor = card.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('Help me review the changes in this workspace.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  const strip = card.getByTestId('composer-session-strip');
  await expect(strip.getByText('Context tools · 0 updates', { exact: true })).toBeVisible({ timeout: 20000 });
  const snapshot = () => appPage.evaluate(() => {
    const context = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    return { threadId: context.currentThread?.id, messages: context.currentThread?.messages.length, turns: context.currentThread?.context?.claudeCode?.turns };
  });
  await expect.poll(async () => (await snapshot()).turns).toBe(1);
  const synchronized = () => appPage.evaluate(() => {
    const context = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const view: any = Object.values(context.nativeUiViews).find((value: any) => value.threadId === context.currentThread?.id);
    return !!view?.promptRevision && view.prompt?.revision === view.promptRevision;
  });
  const before = await snapshot();
  const ghost = editor.locator('.claude-prompt-suggestion');
  const suggest = strip.getByRole('button', { name: 'Suggest next step', exact: true });
  const suggestions = async () => JSON.parse(await readFile(join(workspace!, 'native-suggestions.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error }));
  for (const key of ['Tab', 'ArrowRight']) {
    await editor.fill(''); await expect.poll(synchronized).toBe(true);
    await suggest.click(); await expect(ghost).toBeVisible(); await expect(ghost).toHaveText('Review the implementation.');
    if (key === 'Tab') await appPage.screenshot({ path: testInfo.outputPath('apack-native-suggestion.png') });
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect.poll(async () => (await suggestions()).at(-1)?.result.isShown).toBe(true);
    expect((await suggestions()).at(-1).draft).toEqual({ text: '', cursor: 0 });
    await editor.focus(); await editor.press(key);
    await expect(ghost).toHaveCount(0); await expect(editor).toHaveText('Review the implementation.');
    await expect.poll(synchronized).toBe(true);
  }
  const acceptedSuggestions = JSON.parse(await readFile(join(workspace!, 'native-accepted-suggestions.json'), 'utf8'));
  expect(acceptedSuggestions.map((value: any) => value.key.key)).toEqual(['tab', 'right']);
  expect(acceptedSuggestions.every((value: any) => value.origin.kind === 'composer')).toBe(true);
  await suggest.click();
  await expect.poll(async () => (await suggestions()).at(-1)?.result.isShown).toBe(false);
  await expect(editor).toHaveText('Review the implementation.');
  expect(await snapshot()).toEqual(before);
  await editor.fill(''); await expect.poll(synchronized).toBe(true);
  await editor.focus();
  await editor.press('1');
  await expect(strip.getByText('Context tools · 1 update', { exact: true })).toBeVisible();
  await expect(editor).toBeEmpty();
  // A draft keeps ordinary digits; the native survey shortcut only owns an empty composer.
  await editor.fill('Draft'); await editor.press('1'); await expect(editor).toHaveText('Draft1');
  const note = strip.getByRole('textbox', { name: 'Context note', exact: true });
  await strip.getByRole('button', { name: 'Focus note', exact: true }).focus();
  await expect(note).toBeFocused();
  await note.fill('Move focus to response style');
  await expect(strip.getByRole('combobox', { name: 'Response style', exact: true })).toBeFocused();

  await editor.fill('Review the changes and outline the next steps.');
  await strip.getByRole('button', { name: 'Refresh context', exact: true }).click();
  await expect(strip.getByText('Context tools · 2 updates', { exact: true })).toBeVisible();
  await strip.getByRole('textbox', { name: 'Context note', exact: true }).fill('Focus on the UI and interaction details.');
  await expect.poll(async () => readFile(join(workspace!, 'native-field.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })).toBe(JSON.stringify('Focus on the UI and interaction details.'));
  await strip.getByRole('combobox', { name: 'Response style', exact: true }).selectOption('beta');
  await expect.poll(async () => readFile(join(workspace!, 'native-choice.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })).toBe(JSON.stringify('beta'));
  const diagram = strip.getByRole('img', { name: 'Connection status', exact: true });
  await expect(diagram).toBeVisible();
  await expect.poll(() => diagram.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await editor.focus();
  await strip.getByText('More details', { exact: true }).hover();
  await expect.poll(() => strip.getByText('Current session', { exact: true }).evaluate(element => getComputedStyle(element).color)).toBe('rgb(217, 119, 87)');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Review the changes and outline the next steps.');
  await strip.getByRole('button', { name: 'Fill draft', exact: true }).click();
  await expect(editor).toHaveText('Review the changes and outline the next steps. (native draft)');
  await expect.poll(async () => readFile(join(workspace!, 'native-prompt-host.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })).not.toBe('');
  const promptHost = JSON.parse(await readFile(join(workspace!, 'native-prompt-host.json'), 'utf8'));
  expect(promptHost.before.text).toBe('Review the changes and outline the next steps.');
  expect(promptHost.filled.isFilled).toBe(true);
  expect(promptHost.after.text).toBe('Review the changes and outline the next steps. (native draft)');
  await expect.poll(synchronized).toBe(true);
  await expect(editor.locator('.claude-prompt-decoration')).toHaveText('(native draft)');
  await expect(editor.locator('.claude-prompt-decoration')).toHaveCSS('font-style', 'italic');
  const richReplacement = '**Native** replacement\n\n- item';
  await strip.getByRole('button', { name: 'Fill draft', exact: true }).click();
  const nativeDraft = async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-host.json'), 'utf8')).after.text;
  await expect.poll(nativeDraft).toBe(richReplacement);
  await expect(editor.locator('strong')).toHaveText('Native');
  await expect(editor.locator('li')).toContainText('item');
  await expect.poll(synchronized).toBe(true);
  await expect(editor.locator('.claude-prompt-decoration').first()).toHaveCSS('font-style', 'italic');
  await editor.focus(); await editor.press('ArrowLeft'); await editor.press('x');
  await expect.poll(synchronized).toBe(true);
  await expect(editor.locator('.claude-prompt-decoration')).toHaveCount(0);
  await strip.getByRole('button', { name: 'Fill draft', exact: true }).click();
  await expect.poll(async () => JSON.parse(await readFile(join(workspace!, 'native-prompt-host.json'), 'utf8')).mode).toBe('insert');
  const inserted = JSON.parse(await readFile(join(workspace!, 'native-prompt-host.json'), 'utf8'));
  expect(inserted.before.text).toContain('x');
  expect(inserted.after.text).toBe(inserted.before.text.slice(0, inserted.before.cursor) + ' inserted' + inserted.before.text.slice(inserted.before.cursor));
  await expect.poll(synchronized).toBe(true);
  await expect(editor.locator('.claude-prompt-decoration')).toHaveText('inserted');
  await expect(editor.locator('.claude-prompt-decoration')).toHaveCSS('font-style', 'italic');
  expect(await snapshot()).toEqual(before);
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-composer-wide.png') });
  const fitsComposer = () => card.evaluate(element => {
    const pane = element.closest('[data-testid="chat-composer-area"]')!;
    const bounds = element.getBoundingClientRect(), area = pane.getBoundingClientRect();
    return bounds.top >= area.top - 1 && bounds.bottom <= area.bottom + 1;
  });
  await expect.poll(fitsComposer).toBe(true);
  await appPage.setViewportSize({ width: 680, height: 900 });
  await expect(strip.getByRole('button', { name: 'Refresh context', exact: true })).toBeVisible();
  const geometry = await strip.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  await expect.poll(fitsComposer).toBe(true);
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-composer-narrow.png') });
  const codePreview = strip.getByRole('button', { name: 'Code preview', exact: true });
  await codePreview.click();
  const nativeCode = strip.getByRole('region', { name: 'Code', exact: true });
  await expect(nativeCode).toBeVisible(); await nativeCode.scrollIntoViewIfNeeded();
  await expect(nativeCode.locator('.native-source-row')).toHaveCount(4);
  await expect(nativeCode.locator('.hljs-keyword').first()).toHaveText('const');
  const wrappedCode = await nativeCode.evaluate(element => {
    const rows = [...element.querySelectorAll('.native-source-row')];
    return { firstHeight: rows[0].getBoundingClientRect().height, secondTop: rows[1].getBoundingClientRect().top,
      firstBottom: rows[0].getBoundingClientRect().bottom, overflow: element.scrollWidth > element.clientWidth + 1,
      aligned: rows.every(row => Math.abs(row.querySelector('code')!.getBoundingClientRect().top - row.querySelector('[aria-hidden]')!.getBoundingClientRect().top) < 1) };
  });
  expect(wrappedCode.firstHeight).toBeGreaterThan(20);
  expect(wrappedCode.secondTop).toBeGreaterThanOrEqual(wrappedCode.firstBottom - 1);
  expect(wrappedCode.aligned).toBe(true); expect(wrappedCode.overflow).toBe(false);
  await expect(strip.getByText('language-hint-only.ts', { exact: true })).toHaveCount(0);
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-code-wrap.png') });
  await codePreview.click(); await nativeCode.scrollIntoViewIfNeeded();
  await expect.poll(() => nativeCode.locator('code').first().evaluate(element => ({
    ellipsis: getComputedStyle(element).textOverflow, clipped: element.scrollWidth > element.clientWidth,
    height: element.getBoundingClientRect().height,
  }))).toEqual({ ellipsis: 'ellipsis', clipped: true, height: 20 });
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-code-truncate.png') });
  await codePreview.click();
  const nativeDiff = strip.getByRole('region', { name: 'Code diff', exact: true });
  await expect(nativeDiff).toBeVisible(); await nativeDiff.scrollIntoViewIfNeeded();
  await expect(nativeDiff.locator('[data-diff-kind="add"] code')).toHaveText('<img onerror="bad()">');
  await expect(nativeDiff.locator('[data-diff-kind="remove"] code')).toHaveText('<script>old()</script>');
  await expect(nativeDiff.locator('img, script')).toHaveCount(0);
  expect(await nativeDiff.locator('[data-diff-kind="context"] .native-diff-number').allTextContents()).toEqual(['4', '8']);
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-code-diff.png') });
  await codePreview.click(); await expect(nativeDiff).toHaveCount(0);
  expect(await snapshot()).toEqual(before);
  await appPage.setViewportSize({ width: 680, height: 600 });
  await expect.poll(fitsComposer).toBe(true);
  const nativeSite = strip.locator('.native-extension-surface');
  await expect.poll(() => nativeSite.evaluate(element => element.clientHeight > 0 && element.scrollHeight > element.clientHeight)).toBe(true);
  await strip.getByRole('button', { name: 'Focus note', exact: true }).focus();
  await expect(note).toBeFocused();
  await expect.poll(() => note.evaluate(element => {
    const bounds = element.getBoundingClientRect(), site = element.closest('.native-extension-surface')!.getBoundingClientRect();
    return bounds.top >= site.top - 1 && bounds.bottom <= site.bottom + 1;
  })).toBe(true);
  await note.press('Escape'); await expect(editor).toBeFocused();
  await editor.fill(Array.from({ length: 40 }, (_, index) => `Draft line ${index + 1}`).join('\n'));
  await expect.poll(fitsComposer).toBe(true);
  const editorArea = card.getByTestId('composer-editor-area');
  await expect.poll(() => editorArea.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 });
  const shortGeometry = await card.evaluate(element => {
    const bounds = element.getBoundingClientRect(), pane = element.closest('[data-testid="chat-composer-area"]')!.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, paneTop: pane.top, paneBottom: pane.bottom };
  });
  expect(await snapshot()).toEqual(before);
  await appPage.screenshot({ path: testInfo.outputPath('apack-native-composer-short.png') });
  await appPage.setViewportSize({ width: 680, height: 900 });

  await editor.fill('Continue with the review.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await snapshot()).turns).toBe(2);
  const launches = (await readFile(join(workspace!, 'native-launches.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(launches.filter(value => value.args.includes('--input-format'))).toHaveLength(1);
  await appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').send({ type: 'CLEAR_THREAD' }));
  await expect(card.getByRole('button', { name: 'Refresh context', exact: true })).toHaveCount(0);
  await appPage.evaluate(threadId => (window as any).applicationState.system.get('default-setup/threads').send({ type: 'OPEN_THREAD_CHAT', threadId }), before.threadId);
  await expect(strip.getByText('Context tools · 2 updates', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(join(workspace!, 'composer-app-evidence.json'), JSON.stringify({ actualApp: true, nativeCodeWrap: true, nativeCodeTruncate: true, nativeCodeDiff: true, nativeCodeLiteralMarkup: true, nativeCodeHiddenPath: true, nativePress: true, composerVerticalFit: true, shortComposerUsable: true, nativeFocusScrollScoped: true, longDraftScrolls: true, nativeSuggestionGhost: true, nativeSuggestionTab: true, nativeSuggestionRightArrow: true, nativeSuggestionNotSubmitted: true, nativeSuggestionPersonKeys: true, nativeSuggestionPopulatedRefused: true, nativePromptHostRead: true, nativePromptHostFill: true, nativePromptFillModes: true, nativeRichReplacement: true, nativeFillPaintSurvivesAdoption: true, nativeFillPaintClearedByEdit: true, nativeNumericHotkey: true, populatedDraftDigitPreserved: true, nativeFocusRedirect: true, nativePluginFocusPush: true, nativeFields: true, nativeSvg: true, nativeHover: true, draftPreserved: true, noPhantomTurn: true, narrowOverflowBounded: true, sameNativeProcess: true, detachRemount: true, hostInputs: 2, errors, geometry, shortGeometry }, null, 2));
});
