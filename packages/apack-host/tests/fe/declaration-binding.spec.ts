import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { describe, expect, it, vi } from 'vitest';
import type { PackFERegistration } from '@apackdev/sdk/fe';
import { createMachine } from 'xstate';
import { Extension } from '@tiptap/core';
import { ManifestSchema, type PackManifest } from '@apackdev/sdk/build';

import { frontendBindingProblem } from '../../src/fe/declaration-binding.ts';

function fixture() {
  const component = { render: vi.fn() };
  const getHeight = vi.fn(() => 60);
  const bindSettings = vi.fn();
  const editorExtension = Extension.create({ name: 'example' });
  const configure = vi.spyOn(editorExtension, 'configure');
  const isSuggestionActive = vi.fn(() => false);
  const manifest: PackManifest = { id: 'notes-pack', name: 'Notes', version: '1.0.0',
    features: { notes: { description: 'Feature declaration fixture.', surface: { label: 'Notes', state: 'src/surface.ts', default: true }, designation: 'notes' },
      backend: { description: 'Feature declaration fixture.', system: { entry: 'src/system.ts' } }, form: { description: 'Feature declaration fixture.', settings: { schema: { type: 'object' }, defaults: {}, form: 'src/form.vue' } } },
    extensions: { settings: { preferences: { schema: { type: 'object' }, defaults: {}, form: 'src/preferences.vue' } },
      steps: { note: { node: { label: 'Note' }, fe: { colorKey: 'blue', nodeConfig: { icon: 'File', category: 'data', connectionRules: { inputs: 1, outputs: 1 } }, components: { form: 'src/form.vue' }, layout: { hasInput: true, getHeight: 'src/layout.ts#getHeight' } } }, trigger: { kind: 'trigger', node: { label: 'Trigger' } } },
      artifacts: { text: { icon: 'File', fe: 'src/text.vue' } }, blocks: { note: { kind: 'input', fe: 'src/block.vue' } },
      appExtensions: { toolbar: 'src/toolbar.vue' }, textEditor: { tools: {
        extensions: { example: 'src/editor.ts#Example' }, popups: { suggestions: 'src/editor.vue' },
        isSuggestionActive: 'src/editor.ts#isSuggestionActive' } } ,
      dsl: { notes: { prefix: 'n', entry: 'src/schema.ts', targets: ['monaco'], globals: { foo: 'Foo' } } } } };
  expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  const registration = { id: manifest.id, bindSettings,
    features: { notes: { surface: { label: 'Notes', state: createMachine({}) }, designation: 'notes', default: true }, form: { settingsForm: component } },
    settingsForms: { preferences: component }, steps: [{ type: 'note', node: { label: 'Note' }, fe: { colorKey: 'blue', nodeConfig: { icon: component, category: 'data', connectionRules: { inputs: 1, outputs: 1 } }, components: { form: component }, layout: { hasInput: true, getHeight } } }, { type: 'trigger', kind: 'trigger', node: { label: 'Trigger' } }],
    artifacts: [{ type: 'text', fe: { icon: component, component } }], blocks: [{ type: 'note', kind: 'input', fe: { component } }],
    appExtensions: { toolbar: component }, textEditor: { tools: { extensions: { example: editorExtension },
      popups: { suggestions: component }, isSuggestionActive } },
  } satisfies PackFERegistration;
  return { manifest, registration, component, getHeight, bindSettings, configure, isSuggestionActive };
}

describe('frontend declaration binding', () => {
  it('accepts the frontend facet without executing component or settings factories', () => {
    const { manifest, registration, component, getHeight, bindSettings, configure, isSuggestionActive } = fixture();
    expect(frontendBindingProblem(manifest, registration)).toBeUndefined();
    expect(configure).not.toHaveBeenCalled();
    expect(isSuggestionActive).not.toHaveBeenCalled();
    expect(component.render).not.toHaveBeenCalled();
    expect(getHeight).not.toHaveBeenCalled();
    expect(bindSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['undeclared feature', (r: Record<string, unknown>) => { r.features = { ghost: {} }; }, 'features'],
    ['missing feature', (r: Record<string, unknown>) => { r.features = {}; }, 'features'],
    ['null features', (r: Record<string, unknown>) => { r.features = null; }, 'features'],
    ['foreign role', (r: Record<string, unknown>) => { r.features = { notes: { designation: 'brain' }, form: {} }; }, 'designation'],
    ['changed default', (r: Record<string, unknown>) => { r.features = { notes: { designation: 'notes', default: false }, form: {} }; }, 'default'],
    ['missing surface', (r: Record<string, unknown>) => { r.features = { notes: { designation: 'notes', default: true }, form: {} }; }, 'surface'],
    ['missing form', (r: Record<string, unknown>) => { (r.features as Record<string, unknown>).form = {}; }, 'settingsForm'],
    ['invalid form', (r: Record<string, unknown>) => { (r.features as Record<string, unknown>).form = { settingsForm: null }; }, 'settingsForm'],
    ['foreign form group', (r: Record<string, unknown>) => { r.settingsForms = { foreign: {} }; }, 'settingsForms'],
    ['null forms', (r: Record<string, unknown>) => { r.settingsForms = null; }, 'settingsForms'],
    ['missing step', (r: Record<string, unknown>) => { r.steps = []; }, 'steps'],
    ['duplicate step', (r: Record<string, unknown>) => { r.steps = [{ type: 'note' }, { type: 'note' }]; }, 'steps'],
    ['undeclared runtime facet', (r: Record<string, unknown>) => { (r.steps as Record<string, unknown>[])[0].runtime = {}; }, 'runtime'],
    ['missing node facet', (r: Record<string, unknown>) => { delete (r.steps as Record<string, unknown>[])[0].node; }, 'node'],
    ['changed node label', (r: Record<string, unknown>) => { (r.steps as Record<string, unknown>[])[0].node = { label: 'Different' }; }, 'node'],
    ['changed node defaults', (r: Record<string, unknown>) => { (r.steps as Record<string, unknown>[])[0].node = { label: 'Note', defaults: { foreign: true } }; }, 'node'],
    ['missing frontend facet', (r: Record<string, unknown>) => { delete (r.steps as Record<string, unknown>[])[0].fe; }, '.fe'],
    ['changed step kind', (r: Record<string, unknown>) => { (r.steps as Record<string, unknown>[])[0].kind = 'trigger'; }, 'kind'],
    ['foreign artifact', (r: Record<string, unknown>) => { r.artifacts = [{ type: 'foreign' }]; }, 'artifacts'],
    ['missing artifact viewer', (r: Record<string, unknown>) => { r.artifacts = [{ type: 'text', fe: { icon: {} } }]; }, 'artifacts.text.fe'],
    ['changed block kind', (r: Record<string, unknown>) => { r.blocks = [{ type: 'note', kind: 'display' }]; }, 'blocks.note.kind'],
    ['missing block component', (r: Record<string, unknown>) => { r.blocks = [{ type: 'note', kind: 'input', fe: {} }]; }, 'blocks.note.fe'],
    ['foreign slot', (r: Record<string, unknown>) => { r.appExtensions = { other: {} }; }, 'appExtensions'],
    ['missing editor binding', (r: Record<string, unknown>) => { r.textEditor = undefined; }, 'textEditor'],
    ['foreign editor group', (r: Record<string, unknown>) => { r.textEditor = { other: {} }; }, 'textEditor'],
    ['missing editor extension', (r: Record<string, unknown>) => { (r.textEditor as Record<string, Record<string, unknown>>).tools.extensions = {}; }, 'textEditor.tools.extensions'],
    ['wrong editor name', (r: Record<string, unknown>) => { (r.textEditor as Record<string, Record<string, unknown>>).tools.extensions = { example: Extension.create({ name: 'wrong' }) }; }, 'textEditor.tools.extensions.example'],
    ['invalid editor value', (r: Record<string, unknown>) => { (r.textEditor as Record<string, Record<string, unknown>>).tools.extensions = { example: { name: 'example' } }; }, 'textEditor.tools.extensions.example'],
    ['missing popup', (r: Record<string, unknown>) => { (r.textEditor as Record<string, Record<string, unknown>>).tools.popups = {}; }, 'textEditor.tools.popups'],
    ['invalid suggestion predicate', (r: Record<string, unknown>) => { (r.textEditor as Record<string, Record<string, unknown>>).tools.isSuggestionActive = {}; }, 'textEditor.tools.isSuggestionActive'],
    ['invalid settings factory', (r: Record<string, unknown>) => { r.bindSettings = {}; }, 'bindSettings'],
    ['unsupported registration field', (r: Record<string, unknown>) => { r.commands = []; }, 'registration fields'],
  ] as const)('refuses %s', (_name, mutate, expected) => {
    const { manifest, registration } = fixture();
    mutate(registration);
    expect(frontendBindingProblem(manifest, registration)).toContain(expected);
  });

  it('does not require a frontend binding for static DSL declarations', () => {
    const { manifest, registration } = fixture();
    delete manifest.extensions!.dsl!.notes.prefix;
    expect(frontendBindingProblem(manifest, registration)).toBeUndefined();
  });

  it('refuses editor bindings a manifest never declared', () => {
    expect(frontendBindingProblem({ id: 'empty' }, { textEditor: { undeclared: {} } })).toContain('textEditor');
  });
});

it('checks declared presentation and panes without resolving a component or predicate', () => {
  const { manifest, registration, component } = fixture();
  const declaration = manifest.features!.notes.surface!;
  Object.assign(declaration, { label: 'Notes', isPinned: true, icon: 'NotebookText',
    canvas: { routes: { list: 'src/list.vue', view: { entry: 'src/view.vue', load: 'lazy' } } },
    panel: 'src/panel.vue', chat: 'src/chat.vue', hotkeys: [{ action: 'open', global: false }],
    options: { headerClass: 'notes' }, fallbackPanel: { label: 'Inspect', toggle: { type: 'INSPECT' }, isShown: 'src/predicate.ts#isShown' } });
  const isShown = vi.fn();
  Object.assign(registration.features.notes.surface, { icon: component, isPinned: true,
    canvas: { list: component, view: component }, panel: component, chat: component,
    hotkeys: [{ action: 'open', global: false }], options: { headerClass: 'notes' },
    fallbackPanel: { label: 'Inspect', toggle: { type: 'INSPECT' }, isShown } });
  expect(frontendBindingProblem(manifest, registration)).toBeUndefined();
  expect(isShown).not.toHaveBeenCalled();
  expect(component.render).not.toHaveBeenCalled();
  const surface = registration.features.notes.surface as Record<string, unknown>;
  const changes: [string, unknown][] = [
    ['label', 'Wrong'], ['isPinned', false], ['icon', undefined], ['canvas', { list: component }],
    ['panel', undefined], ['chat', undefined], ['hotkeys', [{ action: 'other' }]],
    ['options', { headerClass: 'other' }], ['fallbackPanel', { label: 'Inspect', toggle: { type: 'OTHER' }, isShown }],
    ['undeclared', true],
  ];
  for (const [field, value] of changes) {
    const previous = surface[field];
    surface[field] = value;
    expect(frontendBindingProblem(manifest, registration), field).toContain(`surface.${field}`);
    if (previous === undefined) delete surface[field]; else surface[field] = previous;
  }
  expect(frontendBindingProblem(manifest, registration)).toBeUndefined();
});

it('refuses a native replacement before granting resources and retains the accepted surface', () => {
  const component = { render: vi.fn() };
  const native = { id: 'native', features: { view: { description: 'Feature declaration fixture.', surface: { label: 'Native view', state: 'native/state', canvas: 'native/canvas' } } } };
  const registry = createNativeFrontendTestRegistry([native]);
  const registration = { id: 'native', features: { view: { surface: { label: 'Native view', state: createMachine({}), canvas: component } } } };
  const [accepted] = registry.registerFixture(registration);
  native.features.view.surface.label = 'Mutated caller';
  const bindSettings = vi.fn();
  expect(() => registry.replaceFixture({ ...registration, bindSettings,
    features: { view: { surface: { ...registration.features.view.surface, label: 'Changed binding' } } } })).toThrow('surface.label');
  expect(bindSettings).not.toHaveBeenCalled();
  expect(registry.getRegisteredSurfaces()).toEqual([accepted]);
  expect(component.render).not.toHaveBeenCalled();
});

it('owns editor names transactionally across native packs and retains accepted bindings on refusal', () => {
  const frontend = { textEditor: { tools: { extensions: { example: 'native/editor.ts#Example' } } } };
  const registry = createNativeFrontendTestRegistry([{ id: 'first', ...frontend }, { id: 'second', ...frontend }]);
  const first = Extension.create({ name: 'example' });
  const second = Extension.create({ name: 'example' });
  registry.registerFixture({ id: 'first', textEditor: { tools: { extensions: { example: first } } } });
  expect(() => registry.registerFixture({ id: 'second', textEditor: { tools: { extensions: { example: second } } } }))
    .toThrow(/first\/tools.*second\/tools/);
  expect(registry.textEditor()).toHaveLength(1);
  expect(registry.textEditor()[0].binding.extensions!.example).toBe(first);
  const replacement = Extension.create({ name: 'wrong' });
  expect(() => registry.prepareFixture({ id: 'first', textEditor: { tools: { extensions: { example: replacement } } } }, undefined, true))
    .toThrow('textEditor.tools.extensions.example');
  expect(registry.textEditor()[0].binding.extensions!.example).toBe(first);
});

it('captures editor membership while preserving executable extension objects', () => {
  const registry = createNativeFrontendTestRegistry([{ id: 'editor', textEditor: {
    tools: { extensions: { example: 'native/editor.ts#Example' } },
  } }]);
  const extension = Extension.create({ name: 'example' });
  const extensions = { example: extension };
  const tools = { extensions };
  registry.registerFixture({ id: 'editor', textEditor: { tools } });
  extensions.example = Extension.create({ name: 'replacement' });
  tools.extensions = { example: Extension.create({ name: 'another' }) };
  expect(registry.textEditor()[0].binding.extensions!.example).toBe(extension);
  expect(Object.isFrozen(registry.textEditor()[0].binding.extensions)).toBe(true);
  expect(Object.isFrozen(extension)).toBe(false);
});

it('checks step presentation, component membership and callable layouts without invoking bindings', () => {
  const { manifest, registration, component, getHeight } = fixture();
  const step = registration.steps[0].fe!;
  const changes: [string, unknown, string][] = [
    ['colorKey', 'red', 'fe.colorKey'],
    ['nodeConfig', { ...step.nodeConfig, category: 'logic' }, 'fe.nodeConfig.category'],
    ['nodeConfig', { ...step.nodeConfig, icon: 'File' }, 'fe.nodeConfig.icon'],
    ['nodeConfig', { ...step.nodeConfig, connectionRules: { inputs: 0, outputs: 1 } }, 'fe.nodeConfig.connectionRules'],
    ['components', {}, 'fe.components'],
    ['components', { form: 'src/form.vue' }, 'fe.components'],
    ['components', { form: component, node: component }, 'fe.components'],
    ['layout', { hasInput: false, getHeight }, 'fe.layout.hasInput'],
    ['layout', { hasInput: true, getHeight: 'src/layout.ts#getHeight' }, 'fe.layout.getHeight'],
    ['layout', { hasInput: true, getHeight, getPorts: vi.fn() }, 'fe.layout'],
  ];
  for (const [key, value, path] of changes) {
    expect(frontendBindingProblem(manifest, { ...registration, steps: [
      { ...registration.steps[0], fe: { ...step, [key]: value } }, registration.steps[1],
    ] }), key).toContain(`steps.note.${path}`);
  }
  expect(frontendBindingProblem(manifest, registration)).toBeUndefined();
  expect(component.render).not.toHaveBeenCalled();
  expect(getHeight).not.toHaveBeenCalled();
});

it('checks admitted native steps and owns their data while preserving executable component identities', () => {
  const render = vi.fn();
  const component = { render };
  const getHeight = vi.fn(() => 70);
  const node = { label: 'Memo', defaults: { tags: ['draft'] } };
  const config = { icon: component, category: 'data' as const, connectionRules: { inputs: 1, outputs: 1 } };
  const registration = { id: 'native', steps: [{ type: 'memo', node,
    fe: { colorKey: 'blue', nodeConfig: config, components: { form: component }, layout: { hasInput: true, getHeight } },
  }] };
  const declaration = { id: 'native', steps: { memo: { node: structuredClone(node), fe: {
    colorKey: 'blue', nodeConfig: { ...config, icon: 'Box' }, components: { form: 'native.vue' },
    layout: { hasInput: true, getHeight: 'native.ts#getHeight' },
  } } } };
  const packs = createNativeFrontendTestRegistry([declaration]);
  packs.registerFixture(registration);
  const accepted = packs.stepBindings().get('memo')!.binding;
  expect(accepted.fe!.nodeConfig.icon).toBe(component);
  expect(accepted.fe!.components!.form).toBe(component);
  expect(accepted.fe!.layout!.getHeight).toBe(getHeight);
  node.defaults.tags.push('Caller mutation');
  config.connectionRules.inputs = 99;
  registration.steps[0].fe.components.form = { render: vi.fn() };
  registration.steps.length = 0;
  expect(accepted.node!.defaults!.tags).toEqual(['draft']);
  expect(accepted.fe!.nodeConfig.connectionRules.inputs).toBe(1);
  expect(accepted.fe!.components!.form).toBe(component);
  expect(Reflect.set(accepted.fe!.layout!, 'hasInput', false)).toBe(false);
  expect(() => packs.replaceFixture({ id: 'native', steps: [{ type: 'memo', node: { label: 'Changed' } }] }))
    .toThrow('steps.memo.node');
  expect(packs.stepBindings().get('memo')?.binding).toBe(accepted);
  expect(render).not.toHaveBeenCalled();
  expect(getHeight).not.toHaveBeenCalled();
});

it('admits declared native artifacts, blocks and feature designations', () => {
  const { manifest, registration, component } = fixture();
  const packs = createNativeFrontendTestRegistry([{
    id: manifest.id,
    features: { notes: manifest.features!.notes, form: manifest.features!.form },
    ...manifest.extensions,
    dslDefinitions: { notes: 'declare interface Foo {}' },
  }]);
  const bindings = { ...registration, bindSettings: undefined };
  packs.registerFixture(bindings);
  expect(packs.designation('notes')).toBe('notes-pack/notes');
  expect(packs.artifact('text')?.fe?.component).toBe(component);
  expect(packs.block('note')?.fe?.component).toBe(component);

});

it('checks native declaration data before copying it or reading declarative accessors', () => {
  const declaration = { id: 'native' };
  const read = vi.fn(() => ({}));
  Object.defineProperty(declaration, 'blocks', { get: read, enumerable: true });
  const packs = createNativeFrontendTestRegistry();
  expect(() => packs.registerPackFE({ kind: 'native', declaration }, { id: 'native' })).toThrow('JSON data properties');
  expect(read).not.toHaveBeenCalled();
});


it('matches declared read-only capabilities and refuses missing, foreign or non-callable adapters', () => {
  const manifest = { id: 'viewer-pack', extensions: { textEditor: { viewer: { readOnly: 'src/viewer.ts#Viewer' } } } };
  const valid = { id: 'viewer-pack', textEditor: { viewer: { readOnly: { decorate: () => undefined } } } };
  expect(frontendBindingProblem(manifest, valid)).toBeUndefined();
  expect(frontendBindingProblem(manifest, { id: 'viewer-pack', textEditor: { viewer: {} } })).toContain('readOnly');
  expect(frontendBindingProblem(manifest, { id: 'viewer-pack', textEditor: { viewer: { readOnly: { decorate: 'invalid' } } } })).toContain('readOnly');
  expect(frontendBindingProblem(manifest, { id: 'viewer-pack', textEditor: { viewer: { readOnly: { surprise: () => undefined } } } })).toContain('readOnly');
  const editorOnly = { id: 'viewer-pack', extensions: { textEditor: { viewer: { readOnly: false as const } } } };
  expect(frontendBindingProblem(editorOnly, { id: 'viewer-pack', textEditor: { viewer: { readOnly: false } } })).toBeUndefined();
  expect(frontendBindingProblem(editorOnly, valid)).toContain('readOnly');
  expect(frontendBindingProblem({ id: 'viewer-pack', extensions: { textEditor: { viewer: {} } } }, valid)).toContain('readOnly');
});
