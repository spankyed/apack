import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import type { Component } from 'vue';
import type { Editor } from '@tiptap/core';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';
import { test as base, expect } from '@apackdev/testing';

// A separate worker boots with a real disabled-pack record. No runtime facade, form or setting is mocked.
const test = base.extend<{}, { hostOnlyData: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  hostOnlyData: [async ({}, use) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-host-settings-'));
    const previous = process.env.E2E_DATA_DIR;
    const { installedPacksFile } = resolveAppEnvironment({ env: 'test', userDataDir: directory });
    fs.mkdirSync(path.dirname(installedPacksFile), { recursive: true });
    fs.writeFileSync(installedPacksFile, JSON.stringify({ packs: [{ id: 'default-setup', enabled: false }] }));
    process.env.E2E_DATA_DIR = directory;
    try { await use(directory); }
    finally {
      if (previous === undefined) delete process.env.E2E_DATA_DIR;
      else process.env.E2E_DATA_DIR = previous;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker', auto: true }],
});

test('host preferences and shortcuts work with default-setup disabled', async ({ app, appPage }) => {
  expect((await app.getContext()).surfaceIds.some(id => id.startsWith('default-setup/'))).toBe(false);
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'General', exact: true }).click();
  await appPage.getByRole('button', { name: 'Personal', exact: true }).click();
  await appPage.getByLabel('Full Name', { exact: true }).fill('Host without a starter pack');
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await appPage.getByRole('button', { name: 'Application', exact: true }).click();
  await expect(appPage.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true })).toBeVisible();
  await appPage.getByText('Previous Surface', { exact: true }).locator('..').click();
  await appPage.keyboard.press('Control+Alt+9');
  await expect(appPage.getByText('Previous Surface', { exact: true }).locator('..')).toContainText('9');
  await appPage.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true }).click();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await appPage.evaluate(() => (window as any).applicationState.system.get('host/settings')
    .send({ type: 'GENERAL_NAV.SELECT', item: 'json' }));
  await expect(appPage.getByRole('heading', { name: 'Settings JSON' })).toBeVisible();
  await expect(appPage.locator('.monaco-editor')).toBeVisible();
  const values = await appPage.evaluate(() => JSON.parse((window as any).monaco.editor.getEditors().find((editor: any) =>
    editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json').getModel().getValue()));
  expect(values.app.personal.name).toBe('Host without a starter pack');
  expect(values.app.hotkeys.switchSurfaceUp.key).toBe('9');
  await appPage.keyboard.press('Control+Alt+9');
  await expect.poll(async () => (await app.getContext()).activeSurfaceId).not.toBe('host/settings');
});

test('the host-only editor preserves saved references without activating default-setup', async ({ app, appPage }) => {
  expect((await app.getContext()).surfaceIds.some(id => id.startsWith('default-setup/'))).toBe(false);
  const mounted = await appPage.evaluateHandle(async () => {
    const { createApp } = await import('vue');
    const componentPath = '@apackdev/ui/components/tiptap/TiptapEditor';
    const { default: TiptapEditor }: { default: Component } = await import(componentPath);
    const root = document.createElement('div'); root.id = 'native-reference-editor'; document.body.appendChild(root);
    const component = createApp(TiptapEditor, { mode: 'viewer', modelValue: '[Saved memo](apack-ref://memo/Memo-cold)' });
    const exposed = component.mount(root) as unknown as { editor: Editor | undefined };
    return { component, root, exposed };
  });
  try {
    await expect(appPage.locator('#native-reference-editor .reference-pill')).toHaveText('Saved memo');
    const result = await mounted.evaluate(({ exposed }) => {
      const editor = exposed.editor!;
      return { html: editor.getHTML(), document: editor.getJSON(),
        markdown: (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown() };
    });
    expect(result.html).toContain('apack-ref://memo/Memo-cold');
    expect(result.markdown).toBe('[Saved memo](apack-ref://memo/Memo-cold)');
    expect(result.document.content?.[0].content?.[0]).toMatchObject({ type: 'reference', attrs: { refType: 'memo', refId: 'Memo-cold' } });
  } finally {
    await mounted.evaluate(({ component, root }) => { component.unmount(); root.remove(); });
    await mounted.dispose();
  }
});

test('an open editor follows installed pack activation without losing its draft', async ({ app, appPage }, testInfo) => {
  expect((await app.getContext()).surfaceIds.some(id => id.startsWith('default-setup/'))).toBe(false);
  const mounted = await appPage.evaluateHandle(async () => {
    const { createApp } = await import('vue');
    const componentPath = '@apackdev/ui/components/tiptap/TiptapEditor';
    const { default: TiptapEditor }: { default: Component } = await import(componentPath);
    const root = document.createElement('div'); root.id = 'live-contribution-editor'; document.body.appendChild(root);
    const updates: string[] = [];
    const component = createApp(TiptapEditor, { mode: 'editor', modelValue: '/not-a-command [Saved memo](apack-ref://memo/Memo-live)',
      'onUpdate:modelValue': (value: string) => { updates.push(value); } });
    const exposed = component.mount(root) as unknown as { editor: Editor | undefined };
    // Observe the lifecycle without replacing its loader, events or editor behavior.
    const shell = (window as unknown as { applicationState: import('xstate').AnyActorRef }).applicationState;
    const events: Array<{ at: number; type: string; packId?: string }> = [];
    const subscription = shell.system.inspect(inspection => {
      if (inspection.type !== '@xstate.event') return;
      const { event } = inspection;
      if (['PACK_ACTIVATED', 'LOAD_PACK_FRONTENDS', 'PACK_FRONTEND_LOADED', 'PACK_FRONTENDS_SETTLED',
        'PACK_SURFACES_UNLOADED', 'SYSTEM_ERROR'].includes(event.type)) {
        events.push({ at: Date.now(), type: event.type,
          packId: typeof event.packId === 'string' ? event.packId : undefined });
      }
    });
    const resources: Array<{ name: string; start: number; end: number; duration: number }> = [];
    const recordResources = (entries: PerformanceEntry[]) => {
      for (const entry of entries) if (entry.name.startsWith('pack://default-setup/')) {
        resources.push({ name: entry.name, start: performance.timeOrigin + entry.startTime,
          end: performance.timeOrigin + entry.startTime + entry.duration, duration: entry.duration });
      }
    };
    const observer = new PerformanceObserver(list => recordResources(list.getEntries()));
    observer.observe({ type: 'resource' });
    const timeline = () => {
      recordResources(observer.takeRecords());
      const context = shell.getSnapshot().context;
      return { events, resources, at: Date.now(), packLoadRunning: context.packLoadRunning,
        packLoadQueued: context.packLoadQueued, acceptedPackRuntimes: context.acceptedPackRuntimes };
    };
    const dispose = () => { subscription.unsubscribe(); observer.disconnect(); component.unmount(); root.remove(); };
    return { exposed, updates, timeline, dispose };
  });
  const activationSamples: Array<{ at: number; extensions: string[] | null }> = [];
  const observesSuggestion = async () => {
    const extensions = await mounted.evaluate(({ exposed }) => exposed.editor?.extensionManager.extensions
      .map(extension => extension.name) ?? null);
    activationSamples.push({ at: Date.now(), extensions });
    return extensions?.includes('referenceSuggestion') ?? false;
  };
  const toggle = () => appPage.evaluate(async () => {
    const { untypedSendToSystem } = await import('@apackdev/sdk/events');
    untypedSendToSystem('host/packs', { type: 'TOGGLE_PACK_ENABLED', packId: 'default-setup' });
  });
  try {
    await expect(appPage.locator('#live-contribution-editor .reference-pill')).toHaveText('Saved memo');
    const initial = await mounted.evaluate(({ exposed, updates }) => {
      const editor = exposed.editor!;
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent(' pending draft');
      return { document: editor.getJSON(), selection: editor.state.selection.toJSON(), count: updates.length };
    });
    await toggle();
    await expect.poll(observesSuggestion).toBe(true);
    expect(await mounted.evaluate(({ exposed, updates }) => ({ document: exposed.editor!.getJSON(),
      selection: exposed.editor!.state.selection.toJSON(), count: updates.length }))).toEqual(initial);
    await toggle();
    await expect.poll(() => mounted.evaluate(({ exposed }) => !!exposed.editor && !exposed.editor.extensionManager.extensions
      .some(extension => extension.name === 'referenceSuggestion'))).toBe(true);
    expect(await mounted.evaluate(({ exposed, updates }) => ({ document: exposed.editor!.getJSON(),
      selection: exposed.editor!.state.selection.toJSON(), count: updates.length }))).toEqual(initial);
    await expect(appPage.locator('#live-contribution-editor .reference-pill')).toHaveText('Saved memo');
  } catch (error) {
    // Keep the original five-second predicate and failure. The accepted frontend bindings distinguish
    // a late pack load from a failed editor replacement; backend surfaces alone cannot establish that.
    try {
      const contributions = await appPage.evaluate(async () => {
        const { textEditorExtensionsRegistry } = await import('@apackdev/sdk/fe');
        return textEditorExtensionsRegistry.getAll().map(group => ({ packId: group.packId,
          groupId: group.groupId, extensions: Object.keys(group.binding.extensions ?? {}) }));
      });
      await testInfo.attach('editor-activation.json', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ activationSamples, contributions, app: await app.getContext() }, null, 2)) });
    } catch (diagnosticError) {
      console.warn('Could not capture editor activation diagnostics', diagnosticError);
    }
    throw error;
  } finally {
    try {
      await testInfo.attach('editor-activation-timeline.json', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify(await mounted.evaluate(({ timeline }) => timeline()), null, 2)) });
    } catch (diagnosticError) {
      console.warn('Could not capture editor activation timeline', diagnosticError);
    }
    await mounted.evaluate(({ dispose }) => dispose());
    await mounted.dispose();
    if ((await app.getContext()).surfaceIds.some(id => id.startsWith('default-setup/'))) {
      await toggle();
      await expect.poll(async () => (await app.getContext()).surfaceIds.some(id => id.startsWith('default-setup/'))).toBe(false);
    }
  }
});

test('shortcut drafts follow another window and preserve the global flag', async ({ app, appPage, electronApp }) => {
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'General', exact: true }).click();
  await appPage.getByRole('button', { name: 'Application', exact: true }).click();
  const opened = electronApp.waitForEvent('window');
  await appPage.evaluate(() => (window as any).electronAPI.surfaces.popout('host/settings', 'Settings'));
  const second = await opened;
  try {
    await second.waitForLoadState('domcontentloaded');
    await second.evaluate(() => {
      const actor = (window as any).applicationState.system.get('host/settings');
      actor.send({ type: 'TAB.SELECT', tab: 'general' });
      actor.send({ type: 'GENERAL_NAV.SELECT', item: 'json' });
    });
    await expect(second.locator('.monaco-editor')).toBeVisible();
    await second.evaluate(() => {
      const model = (window as any).monaco.editor.getEditors().find((editor: any) =>
        editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json').getModel();
      const values = JSON.parse(model.getValue());
      values.app.hotkeys.switchSurfaceUp = { key: 'F8', modifiers: [], global: true };
      model.setValue(JSON.stringify(values, null, 2));
    });
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(second.getByText('Saved', { exact: true })).toBeVisible();
    const shortcut = appPage.getByText('Previous Surface', { exact: true }).locator('..');
    await expect(shortcut).toContainText('F8');
    await expect(shortcut).toContainText('Global');
    await shortcut.click();
    await appPage.keyboard.press('F7');
    await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
    await expect.poll(() => second.evaluate(() => {
      const model = (window as any).monaco.editor.getEditors().find((editor: any) =>
        editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json').getModel();
      return JSON.parse(model.getValue()).app.hotkeys.switchSurfaceUp;
    })).toEqual({ key: 'F7', modifiers: [], global: true });
  } finally {
    await second.close();
  }
});


test('cold Monaco documents follow source-free declarations and share worker libraries', async ({ appPage, hostOnlyData }) => {
  const { packsDir, installedPacksFile } = resolveAppEnvironment({ env: 'test', userDataDir: hostOnlyData });
  const directory = path.join(packsDir, 'cold-editor');
  const activationMarker = path.join(hostOnlyData, 'cold-editor-activated');
  const manifest: PackManifest = { id: 'cold-editor', name: 'Cold editor', version: '1.0.0',
    extensions: { dsl: { cold: { entry: 'src/defs/cold.ts', prefix: 'cold:', targets: ['monaco'], globals: { lateMemo: '_dsl.Item' } } } },
  };
  const publish = (field?: string) => {
    fs.rmSync(directory, { recursive: true, force: true });
    const packs = [{ id: 'default-setup', enabled: false }];
    if (field) {
      fs.mkdirSync(path.join(directory, 'types'), { recursive: true });
      fs.mkdirSync(path.join(directory, 'runtime'), { recursive: true });
      fs.writeFileSync(path.join(directory, PACK_LAYOUT.runtimeEntry),
        `require('node:fs').writeFileSync(${JSON.stringify(activationMarker)}, 'activated'); throw new Error("Disabled DSL discovery activated runtime");`);
      fs.writeFileSync(path.join(directory, PACK_LAYOUT.snapshot), JSON.stringify({ manifest,
        declarationRevision: _declarationRevision(manifest), format: PACK_SNAPSHOT_FORMAT,
        types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts: {}, facades: {},
        dslDefinitions: { cold: `declare module "@app/defs/cold" { export interface Item { ${field} } }` },
      }));
      sealPackBuild(directory, manifest);
      packs.push({ id: manifest.id, enabled: false });
    }
    fs.writeFileSync(installedPacksFile, JSON.stringify({ packs }));
  };
  const refresh = () => appPage.evaluate(async () => {
    const { untypedSendToSystem } = await import('@apackdev/sdk/events');
    untypedSendToSystem('host/packs', { type: 'GET_INSTALLED_PACKS' });
  });
  const mounted = await appPage.evaluateHandle(async () => {
    const { createApp, h, ref } = await import('vue');
    const componentPath = '@apackdev/ui/components/UnifiedMonacoEditor';
    const { default: MonacoEditor }: { default: Component } = await import(componentPath);
    const editors = [0, 1].map(index => {
      const root = document.createElement('div'); root.id = `cold-monaco-${index}`;
      root.style.cssText = 'height: 200px; width: 700px'; document.body.appendChild(root);
      const view = ref(); const value = ref('lateMemo.before;\nlateMemo.'); const updates: string[] = [];
      const component = createApp({ render: () => h(MonacoEditor, { ref: view, modelValue: value.value,
        mode: 'multi-file', filePath: `cold:${index}.ts`, language: 'typescript',
        'onUpdate:modelValue': (text: string) => { value.value = text; updates.push(text); } }) });
      component.mount(root);
      return { root, component, view, value, updates, model: undefined as unknown };
    });
    return { editors,
      async completions(index = 0) {
        const model = editors[index].view.value.getEditor().getModel();
        const monaco = (window as any).monaco;
        const worker = await (await monaco.typescript.getTypeScriptWorker())(model.uri);
        return (await worker.getCompletionsAtPosition(model.uri.toString(), model.getValueLength()))?.entries.map((entry: { name: string }) => entry.name) ?? [];
      },
      async diagnostics(index = 0) {
        const model = editors[index].view.value.getEditor().getModel();
        const worker = await (await (window as any).monaco.typescript.getTypeScriptWorker())(model.uri);
        return (await worker.getSemanticDiagnostics(model.uri.toString())).map((diagnostic: { code: number }) => diagnostic.code);
      },
      state(index = 0) {
        const entry = editors[index]; const editor = entry.view.value.getEditor();
        return { value: editor.getValue(), uri: editor.getModel().uri.toString(), selection: editor.getSelection(),
          updates: entry.updates.length, sameModel: editor.getModel() === entry.model };
      },
    };
  });
  try {
    await expect.poll(() => mounted.evaluate(({ editors }) => editors.every(entry => !!entry.view.value?.getEditor()))).toBe(true);
    await mounted.evaluate(({ editors }) => { for (const entry of editors) entry.model = entry.view.value.getEditor().getModel(); });
    expect(await mounted.evaluate(value => value.completions())).not.toContain('before');
    await expect.poll(() => mounted.evaluate(value => value.diagnostics())).toContain(2304);
    publish('before: string'); await refresh();
    await expect.poll(() => mounted.evaluate(value => value.completions())).toContain('before');
    expect(fs.existsSync(path.join(directory, 'src'))).toBe(false);
    await mounted.evaluate(({ editors }) => {
      const editor = editors[0].view.value.getEditor(); editor.setPosition({ lineNumber: 1, column: 1 }); editor.focus();
    });
    await appPage.keyboard.type('// draft\n');
    const draft = await mounted.evaluate(value => value.state());
    expect(draft.value).toContain('// draft'); expect(draft.updates).toBeGreaterThan(0); expect(draft.sameModel).toBe(true);
    publish('after: number'); await refresh();
    await expect.poll(() => mounted.evaluate(value => value.completions())).toContain('after');
    expect(await mounted.evaluate(value => value.completions())).not.toContain('before');
    await expect.poll(() => mounted.evaluate(value => value.diagnostics())).toContain(2339);
    expect(await mounted.evaluate(value => value.state())).toEqual(draft);
    await mounted.evaluate(({ editors }) => { editors[0].component.unmount(); editors[0].root.remove(); });
    await expect.poll(() => mounted.evaluate(value => value.completions(1))).toContain('after');
    publish(); await refresh();
    await expect.poll(() => mounted.evaluate(value => value.diagnostics(1))).toContain(2304);
    expect(await mounted.evaluate(value => value.completions(1))).not.toContain('after');
    expect(fs.existsSync(activationMarker)).toBe(false);
  } finally {
    await mounted.evaluate(({ editors }) => { for (const entry of editors) { if (entry.root.isConnected) entry.component.unmount(); entry.root.remove(); } });
    await mounted.dispose(); publish(); await refresh();
  }
});
