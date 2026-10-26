// Exercises the external-pack path end to end: compiled CJS system, bundled FE with
// host-shared SDK proxies, pack Tailwind, prefixed bus IDs, and the test packs dir.
// Run via `npm run test:external-pack` from the repo root.
import { test, expect, waitForAppReady, type AppDriver } from '@apackdev/testing';
import { acceptedRuntime, frontendAccepted, frontendUnloaded } from './_support/pack-frontend.ts';

test('advanced settings JSON provides offline declared completion, descriptions and validated saves', async ({ appPage, app }) => {
  const externalRequests: string[] = [];
  await appPage.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.continue();
    externalRequests.push(url.href);
    return route.abort();
  });
  await appPage.reload();
  await waitForAppReady(appPage);
  await app.waitForSurface('memos');
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'json' });
  });
  await expect(appPage.getByRole('heading', { name: 'Settings JSON' })).toBeVisible();
  await expect(appPage.locator('.monaco-editor')).toBeVisible();
  const original = await appPage.evaluate(async () => {
    const monaco = (window as any).monaco;
    const model = monaco.editor.getModels().find((model: any) => model.getLanguageId() === 'json');
    const text = model.getValue();
    const data = JSON.parse(text);
    data.features['e2e-fixture/memos'].listTitle = 123;
    model.setValue(JSON.stringify(data, null, 2));
    return text as string;
  });
  const save = appPage.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await expect(appPage.getByText(/features\/e2e-fixture\/memos.*string/)).toBeVisible();
  await expect.poll(async () => appPage.evaluate(async () => {
    const monaco = (window as any).monaco;
    const model = monaco.editor.getModels().find((model: any) => model.getLanguageId() === 'json');
    const worker = await (await monaco.json.getWorker())(model.uri);
    const diagnostics = await worker.doValidation(model.uri.toString());
    return diagnostics.map((problem: any) => problem.message) as string[];
  })).toContain('Incorrect type. Expected "string".');
  const assistance = await appPage.evaluate(async (text) => {
    const monaco = (window as any).monaco;
    const model = monaco.editor.getModels().find((model: any) => model.getLanguageId() === 'json');
    model.setValue(text);
    const worker = await (await monaco.json.getWorker())(model.uri);
    const validDiagnostics = await worker.doValidation(model.uri.toString());
    const offset = text.indexOf('"listTitle"', text.indexOf('"e2e-fixture/memos"')) + 2;
    const position = model.getPositionAt(offset);
    const hover = await worker.doHover(model.uri.toString(), { line: position.lineNumber - 1, character: position.column - 1 });
    const data = JSON.parse(text);
    data.features['e2e-fixture/memos'] = {};
    const incomplete = JSON.stringify(data, null, 2).replace('"e2e-fixture/memos": {}', '"e2e-fixture/memos": {\n      \n    }');
    model.setValue(incomplete);
    const insertion = incomplete.indexOf('\n      \n', incomplete.indexOf('"e2e-fixture/memos"')) + 7;
    const at = model.getPositionAt(insertion);
    const completion = await worker.doComplete(model.uri.toString(), { line: at.lineNumber - 1, character: at.column - 1 });
    return { hover: JSON.stringify(hover), completions: completion.items.map((item: any) => item.label) as string[],
      validDiagnostics: validDiagnostics.map((problem: any) => problem.message) as string[] };
  }, original);
  expect(assistance.validDiagnostics).toEqual([]);
  expect(assistance.hover).toContain('Heading shown above the memo list');
  expect(assistance.completions).toContain('listTitle');
  await expect(save).toBeDisabled();
  await appPage.evaluate(text => {
    const monaco = (window as any).monaco;
    const model = monaco.editor.getModels().find((model: any) => model.getLanguageId() === 'json');
    const data = JSON.parse(text);
    data.features['e2e-fixture/memos'].listTitle = 'Saved through JSON';
    model.setValue(JSON.stringify(data, null, 2));
  }, original);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(appPage.getByText('Saved', { exact: true })).toBeVisible();
  await expect(await openMemoPreferences(appPage, app)).toHaveValue('Saved through JSON');
  await appPage.getByTitle('Reset to defaults', { exact: true }).click();
  await appPage.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(appPage.getByTestId('memos-list-title')).toHaveValue('Memos');
  expect(externalRequests).toEqual([]);
});

test('pack surface renders with its own styles', async ({ appPage, app }) => {
  const network = await appPage.context().newCDPSession(appPage);
  const resources: string[] = [];
  network.on('Network.requestWillBeSent', event => {
    if (event.request.url.startsWith('pack://e2e-fixture/')) resources.push(event.request.url);
  });
  await network.send('Network.enable');
  await network.send('Network.setCacheDisabled', { cacheDisabled: true });
  try {
    await appPage.reload();
    await waitForAppReady(appPage);
    await app.waitForSurface('memos');
    await app.navigate('memos');

    const canvas = appPage.getByTestId('memos-canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await expect(canvas).toHaveCSS('padding-top', '13px');
    const style = await appPage.locator('link[data-pack-id="e2e-fixture"]').getAttribute('href');
    const buildBase = style!.replace(/runtime\/fe\.css$/, '');
    expect(buildBase).toMatch(/^pack:\/\/e2e-fixture\/builds\/[a-f0-9]{64}\/$/);
    expect(resources.filter(url => url.endsWith('.js') && !url.endsWith('/fe.js')).length).toBeGreaterThan(0);
    expect(resources.every(url => url.startsWith(buildBase))).toBe(true);

    // The form is data-independent (the memo list grows across runs), so it can be a stable
    // baseline that catches pack styles regressing. Update with: npm run test:external-pack -- -u
    await expect(canvas.locator('form')).toHaveScreenshot('memos-form.png', { maxDiffPixelRatio: 0.01 });
  } finally {
    await network.send('Network.setCacheDisabled', { cacheDisabled: false });
    await network.detach();
  }
});

test('add memo round-trip through the pack backend', async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await app.navigate('memos');

  const text = `memo ${Date.now()}`;
  await appPage.getByTestId('memo-input').fill(text);
  await appPage.getByTestId('memo-add').click();

  // Only rendered after the backend persists the memo and emits MEMO_ADDED
  await expect(appPage.getByTestId('memo-list').getByText(text, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("renders the host's @apackdev/ui editor inside the pack", async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await app.navigate('memos');

  const preview = appPage.getByTestId('memo-preview');
  await expect(preview.locator('.ProseMirror')).toContainText('Memo preview', { timeout: 10_000 });
  await appPage.getByTestId('memo-input').fill('typed draft');
  await expect(preview.locator('.ProseMirror')).toContainText('typed draft');
});

test('content memos from apack.json: a markdown entry and a compiler module', async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await app.navigate('memos');

  const list = appPage.getByTestId('memo-list');
  await expect(list.getByText('Written from markdown', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(list.getByText('Written by a compiler module', { exact: true })).toBeVisible();
});

/** Settings are read through the actual form, which consumes the window settings resource. */
async function openMemoPreferences(page: import('@playwright/test').Page, app: AppDriver) {
  await app.navigate('host/settings');
  await page.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'features' });
    settings.send({ type: 'FEATURE.SELECT', featureId: 'e2e-fixture/memos' });
  });
  return page.getByTestId('memos-list-title');
}

test("the pack's feature settings are defaults in the app", async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await expect(await openMemoPreferences(appPage, app)).toHaveValue('Memos');
  // Its settings hide its sidebar tab by default; the surface is still there to open
  const visibleIds = () => appPage.evaluate(() => {
    const { surfaces, surfaceVisibility } = (window as any).applicationState.getSnapshot().context;
    return (surfaces as Array<{ id: string }>).filter((p) => surfaceVisibility[p.id] !== false).map((p) => p.id);
  });
  await expect.poll(visibleIds).toContain('default-setup/threads');
  await expect.poll(visibleIds).not.toContain('e2e-fixture/memos');
});

test("a re-enabled pack's surface gets its startup data again", async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  const surfaceIds = () => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.surfaces.map((p: { id: string }) => p.id) as string[]);
  const toggle = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/packs').send({ type: 'UI.TOGGLE_ENABLED', packId: 'e2e-fixture' }));

  // Disabled while active: its surface actor must stop, or re-enabling can't spawn it again
  await app.navigate('memos');
  await toggle();
  await frontendUnloaded(appPage, 'e2e-fixture');
  expect(await surfaceIds()).not.toContain('e2e-fixture/memos');
  // Disabled declarations remain available; their executable forms are unloaded.
  await openMemoPreferences(appPage, app);
  await expect(appPage.getByText('e2e-fixture/memos', { exact: true })).toBeVisible();
  await expect(appPage.getByTestId('memos-list-title')).toHaveCount(0);
  await expect(appPage.getByRole('button', { name: 'Edit in JSON', exact: true })).toBeVisible();

  // Loaded after the connection: its data comes from the pack's client-ready handshake
  await toggle();
  await app.waitForSurface('memos');
  await expect(await openMemoPreferences(appPage, app)).toHaveValue('Memos');
  await app.navigate('memos');
  await expect(appPage.getByTestId('memo-list').getByText('Written from markdown', { exact: true })).toBeVisible({ timeout: 10_000 });
});

test('writes through @apackdev/ears and reads back through the SDK, on the app\'s engine', async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await app.navigate('memos');
  const text = `memo note ${Date.now()}`;
  // The memos system writes a note with @apackdev/ears (bridged to the app's) and reads it through services.repository
  await appPage.evaluate((t) => (window as any).applicationState.system.get('e2e-fixture/memos').send({ type: 'MEMOS.ADD_NOTE', text: t }), text);
  const noteFor = () => appPage.evaluate((t) => ((window as any).applicationState.system.get('e2e-fixture/memos').getSnapshot().context.notes as Array<{ text: string; note: { title: string } | null }>)
    .find((entry) => entry.text === t), text);
  await expect.poll(noteFor, { timeout: 10_000 }).toMatchObject({ text, note: { title: text } });
});

test('a custom feature form persists under its declared owner across a window reload', async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  const title = await openMemoPreferences(appPage, app);
  await expect(title).toHaveValue('Memos');
  await title.fill('Renamed memos');
  await title.press('Enter');
  await title.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();

  await appPage.reload();
  await waitForAppReady(appPage);
  await app.waitForSurface('memos');
  await expect(await openMemoPreferences(appPage, app)).toHaveValue('Renamed memos');
});

test('feature edits and reset reach another settings window', async ({ appPage, app, electronApp }) => {
  const first = await openMemoPreferences(appPage, app);
  await first.fill('Window memos');
  await first.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  const opened = electronApp.waitForEvent('window');
  await appPage.evaluate(() => (window as any).electronAPI.surfaces.popout('host/settings', 'Settings'));
  const second = await opened;
  try {
    await second.waitForLoadState('domcontentloaded');
    await second.getByRole('button', { name: 'Features', exact: true }).click();
    await second.getByText('e2e-fixture/memos', { exact: true }).click();
    const other = second.getByTestId('memos-list-title');
    await expect(other).toHaveValue('Window memos');

    await first.fill('Shared memos');
    await first.blur();
    await expect(other).toHaveValue('Shared memos');

    await second.getByTitle('Reset to defaults', { exact: true }).click();
    await second.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(other).toHaveValue('Memos');
    await expect(first).toHaveValue('Memos');
  } finally {
    await second.close();
  }
});

test('same-named pack preferences stay independent through save, disable and reset', async ({ appPage, app }) => {
  await app.navigate('host/settings');
  await appPage.locator('[data-onboarding-id="settings-packs-tab"]').click();
  const selectFixture = () => appPage.getByText('e2e-fixture/assistant', { exact: true }).click();
  const selectDefault = () => appPage.getByText('default-setup/assistant', { exact: true }).click();
  const fixture = appPage.getByLabel('Fixture assistant name', { exact: true });
  const shipped = appPage.getByLabel('Assistant name', { exact: true });
  await selectFixture();
  await expect(fixture).toHaveValue('Memo helper');
  await fixture.fill('Morgan'); await fixture.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await selectDefault();
  await expect(shipped).toHaveValue('');
  await shipped.fill('Ada'); await shipped.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await selectFixture();
  await expect(fixture).toHaveValue('Morgan');

  const toggle = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
    .send({ type: 'UI.TOGGLE_ENABLED', packId: 'e2e-fixture' }));
  const runtime = await acceptedRuntime(appPage, 'e2e-fixture');
  await toggle();
  await frontendUnloaded(appPage, 'e2e-fixture');
  await expect(fixture).toHaveCount(0);
  await expect(appPage.getByRole('button', { name: 'Edit in JSON', exact: true })).toBeVisible();
  await expect(appPage.getByText('e2e-fixture/assistant', { exact: true })).toBeVisible();
  await toggle();
  await frontendAccepted(appPage, 'e2e-fixture', runtime);
  await expect(fixture).toHaveValue('Morgan');
  await appPage.getByTitle('Reset to defaults', { exact: true }).click();
  await appPage.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(fixture).toHaveValue('Memo helper');
  await selectDefault();
  await expect(shipped).toHaveValue('Ada');
});

test('host personal settings follow edits in another window', async ({ appPage, app, electronApp }) => {
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'General', exact: true }).click();
  await appPage.getByRole('button', { name: 'Personal', exact: true }).click();
  const opened = electronApp.waitForEvent('window');
  await appPage.evaluate(() => (window as any).electronAPI.surfaces.popout('host/settings', 'Settings'));
  const second = await opened;
  try {
    await second.waitForLoadState('domcontentloaded');
    await second.getByRole('button', { name: 'Personal', exact: true }).click();
    await appPage.getByLabel('Full Name', { exact: true }).fill('Personal Ada');
    await expect(second.getByLabel('Full Name', { exact: true })).toHaveValue('Personal Ada');
    await second.getByLabel('Full Name', { exact: true }).fill('Personal Grace');
    await expect(appPage.getByLabel('Full Name', { exact: true })).toHaveValue('Personal Grace');
  } finally {
    await second.close();
  }
});


test('external reference declarations feed the existing editor and picker with canonical navigation', async ({ appPage, app }) => {
  await app.waitForSurface('memos');
  await app.navigate('memos');
  const editor = appPage.getByTestId('memo-reference-editor').locator('.tiptap');
  await expect(editor).toBeVisible();
  await appPage.getByTestId('memo-input').fill('Reference fixture memo');
  await appPage.getByTestId('memo-add').click();
  await expect(appPage.getByTestId('memo-list').getByText('Reference fixture memo')).toBeVisible();
  const memoId = await appPage.evaluate(() => {
    const actor = (window as any).applicationState.system.get('e2e-fixture/memos');
    return actor.getSnapshot().context.memos.find((memo: any) => memo.text === 'Reference fixture memo').id as string;
  });
  // The preview is already mounted: a newly supplied external URI uses the generic live parser.
  await appPage.getByTestId('memo-input').fill(`[Reference fixture memo](apack-ref://memo/${encodeURIComponent(memoId)})`);
  const pill = appPage.getByTestId('memo-preview').locator('.reference-pill');
  await expect(pill).toHaveText('Reference fixture memo');
  await pill.click();
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('e2e-fixture/memos').getSnapshot().context.highlighted)).toBe(memoId);
  await editor.click();
  await editor.pressSequentially('#memos:');
  const suggestion = appPage.locator('.reference-suggestion-popup');
  await expect(suggestion).toBeVisible();
  await suggestion.getByText('Reference fixture memo', { exact: true }).click();
  await expect(editor.locator('.reference-pill')).toHaveText('Reference fixture memo');
  await expect(suggestion).not.toBeVisible();
});
