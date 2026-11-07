import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { pathToFileURL } from 'node:url';
import { createFePackRegistry, createPackFrontends } from '@apackdev/host/fe';
import { fakeSettings } from '@apackdev/sdk/testing';
import { readPackBuild } from '@apackdev/host/packs';
import { buildCommand } from '../../src/commands/build.ts';
import { inspectPack } from '../../src/commands/info.ts';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

it('builds declared editor members and step presentation, then discovers a copied source-free build', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-editor-declarations-'));
  roots.push(root);
  const extensions = {
    steps: { memo: {
      node: { label: 'Memo' }, types: 'src/model.ts', dsl: { helpers: 'src/helpers.ts' },
      fe: { nodeConfig: { icon: 'Box', category: 'data' as const, connectionRules: { inputs: 1, outputs: 1 } },
        colorKey: 'blue', components: { form: 'src/Popup.vue' },
        layout: { hasInput: true, getHeight: 'src/layout.ts#getHeight' } },
    } },
    textEditor: { suggestions: {
      extensions: { mention: 'src/editor.ts#Mention' }, popups: { mentions: 'src/Popup.vue' },
      isSuggestionActive: 'src/editor.ts#isSuggestionActive',
    } },
    appExtensions: { welcome: 'src/Welcome.vue' },
  };
  packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'),
    manifest: { id: 'editor-pack', name: 'Editor pack', features: {}, extensions }, files: {
      'src/editor.ts': `import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
export const Mention = Extension.create({ name: 'mention' });
export function isSuggestionActive(state: EditorState): boolean { return state.selection.empty; }`,
      'src/model.ts': `import type { NodeBase } from '@apackdev/sdk';
export interface MemoNode extends NodeBase { nodeType: 'memo'; text?: string }`,
      'src/helpers.ts': "export const memo = (text: string) => ({ type: 'memo' as const, text });",
      'src/layout.ts': `import type { StepLayoutDescriptor } from '@apackdev/sdk/steps';
export const getHeight: NonNullable<StepLayoutDescriptor['getHeight']> = node => String(node.label ?? '').length + 60;`,
      'src/Popup.vue': '<template><div>Suggestions</div></template>',
      'src/Welcome.vue': '<template><div>Welcome</div></template>',
    } });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  await buildCommand([]);
  const built = readPackBuild(path.join(root, 'dist'));
  expect(built.snapshot.manifest.extensions).toEqual(extensions);
  expect(built.snapshot.provenance?.tiptapExtensions).toEqual({ mention: 'editor-pack' });
  const entry = fs.readFileSync(path.join(root, 'src/__generated__/pack-entry-fe.ts'), 'utf8');
  expect(entry).toContain('Mention as __editor_0');
  expect(entry).toContain('isSuggestionActive as __editor_2');
  expect(fs.existsSync(path.join(root, 'dist/runtime/fe.js'))).toBe(true);

  const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-editor-installed-'));
  roots.push(installed);
  fs.cpSync(path.join(root, 'dist'), path.join(installed, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'apack.json'), path.join(installed, 'apack.json'));
  fs.rmSync(path.join(root, 'src'), { recursive: true });
  const report = await inspectPack(installed);
  expect(report.build.status).toBe('verified');
  expect(report.declared.extensions?.textEditor).toEqual(extensions.textEditor);
  expect(report.declared.extensions?.appExtensions).toEqual(extensions.appExtensions);
  expect(report.declared.extensions?.steps).toEqual(extensions.steps);
  // Runtime code is tested separately after offline discovery. Only the host supplies shared dependencies.
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
  const { default: registration } = await import(/* @vite-ignore */ pathToFileURL(path.join(installed, 'dist/runtime/fe.js')).href);
  const packs = createFePackRegistry();
  const frontends = createPackFrontends({
    importModule: async () => ({ default: registration }),
    styles: { prepare() { throw new Error('This fixture declares no stylesheet'); }, remove() {} },
    settingsForPack: async () => ({ port: fakeSettings(), dispose() {} }),
  }, packs);
  const { manifest, declarationRevision } = built.snapshot;
  await frontends.load({ id: manifest.id, name: manifest.name, version: manifest.version,
    manifest, declarationRevision, buildRevision: built.revision, registrationId: 'accepted-runtime', feEntry: 'runtime/fe.js' });
  expect(packs.stepBindings().get('memo')?.binding.fe?.colorKey).toBe('blue');
  expect(registration.steps[0].fe.layout.getHeight({ label: 'Memo' }, {})).toBe(64);
  expect(registration.steps[0].fe.components.form.__asyncLoader).toBeTypeOf('function');
  expect((await registration.steps[0].fe.components.form.__asyncLoader()).render).toBeTypeOf('function');
  frontends.unload(manifest.id);
  expect(packs.stepBindings().get('memo')).toBeUndefined();
  expect(fs.existsSync(path.join(installed, 'src'))).toBe(false);
}, 180_000 + 60_000 + 60_000 + 20_000);
