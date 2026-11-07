import { expect, it, vi } from 'vitest';
import { createMachine } from 'xstate';
import type { NativePackDeclaration } from '@apackdev/sdk/framework';
import type { PackFERegistration, SettingsPort } from '@apackdev/sdk/fe';
import { createFePackRegistry } from '../../src/fe/pack-store.ts';

const settings = () => ({ port: {} as SettingsPort, dispose: vi.fn() });

it('requires explicit declaration authority and releases provisional resources on every refusal', () => {
  const registry = createFePackRegistry();
  const bindSettings = vi.fn(() => ({ activate() {}, dispose() {} }));
  const registration = { id: 'unknown', bindSettings };
  for (const authority of [undefined, { kind: 'native', declaration: { id: 'known' } },
    { kind: 'loaded', pack: { id: 'unknown' } }]) {
    const resource = settings();
    expect(() => registry.registerPackFE(authority as never, registration, resource)).toThrow();
    expect(resource.dispose).toHaveBeenCalledOnce();
  }
  expect(bindSettings).not.toHaveBeenCalled();
  expect(registry.hasPackFE('unknown')).toBe(false);
});

it('releases provisional settings when capture throws before binding', () => {
  const registry = createFePackRegistry();
  const resource = settings();
  const bindSettings = vi.fn();
  expect(() => registry.registerPackFE({ kind: 'native', declaration: { id: 'owner' } }, {
    id: 'owner', bindSettings, get features(): never { throw new Error('capture refused'); },
  }, resource)).toThrow('capture refused');
  expect(resource.dispose).toHaveBeenCalledOnce();
  expect(bindSettings).not.toHaveBeenCalled();
  expect(registry.hasPackFE('owner')).toBe(false);
});

it('compares loaded declarations before granting settings and refuses installed identities on native bindings', () => {
  const registry = createFePackRegistry();
  const bindSettings = vi.fn();
  const pack = { id: 'owner', name: 'Owner', version: '1.0.0', registrationId: 'runtime', declarationRevision: 'accepted',
    manifest: { id: 'owner', name: 'Owner', version: '1.0.0' } };
  for (const [authority, declarationRevision] of [
    [{ kind: 'loaded', pack }, 'stale'], [{ kind: 'native', declaration: { id: 'owner' } }, 'accepted'],
  ] as const) {
    const resource = settings();
    expect(() => registry.registerPackFE(authority, { id: 'owner', declarationRevision, bindSettings }, resource)).toThrow();
    expect(resource.dispose).toHaveBeenCalledOnce();
  }
  expect(bindSettings).not.toHaveBeenCalled();
});

it('captures every metadata container while retaining machines, components and callbacks', () => {
  const component = { render: vi.fn() };
  const replacement = { render: vi.fn() };
  const state = createMachine({});
  const isShown = vi.fn(() => true);
  const surface = { label: 'Items', state, icon: component, canvas: { list: component }, panel: component,
    hotkeys: [{ action: 'OPEN', global: true }], options: { headerClass: 'initial' },
    fallbackPanel: { label: 'Fallback', toggle: { type: 'TOGGLE' }, isShown } };
  const registration = { id: 'owner', features: { view: { surface, settingsForm: component } },
    settingsForms: { extra: component }, appExtensions: { welcome: component },
    artifacts: [{ type: 'card', fe: { icon: component, component } }],
    blocks: [{ type: 'answer', fe: { component } }],
    steps: [{ type: 'memo', node: { label: 'Memo' } }],
  } satisfies PackFERegistration;
  const preference = { schema: { type: 'object' }, defaults: {}, form: 'native/form.vue' };
  const declaration: NativePackDeclaration = { id: 'owner',
    features: { view: { description: 'Show items.', settings: preference, surface: {
      label: 'Items', state: 'native/state.ts#State', icon: 'Box', canvas: { routes: { list: 'native/list.vue' } }, panel: 'native/panel.vue',
      hotkeys: [{ action: 'OPEN', global: true }], options: { headerClass: 'initial' },
      fallbackPanel: { label: 'Fallback', toggle: { type: 'TOGGLE' }, isShown: 'native/state.ts#isShown' },
    } } },
    settings: { extra: preference }, appExtensions: { welcome: 'native/welcome.vue' },
    artifacts: { card: { icon: 'Box', fe: 'native/card.vue' } }, blocks: { answer: { fe: 'native/answer.vue' } },
    dsl: { items: { entry: 'native/types.ts', targets: ['monaco'], prefix: 'items', globals: { item: 'Item' } } },
    dslDefinitions: { items: 'initial' },
    steps: { memo: { node: { label: 'Memo' } } },
  };
  const registry = createFePackRegistry();
  const prepared = registry.preparePackFE({ kind: 'native', declaration }, registration);
  expect(registry.stepBindings().size).toBe(0);
  surface.label = 'Changed'; surface.canvas.list = replacement; surface.hotkeys[0].action = 'CHANGED';
  surface.options.headerClass = 'changed'; surface.fallbackPanel.label = 'Changed'; surface.fallbackPanel.toggle.type = 'CHANGED';
  registration.features.view.settingsForm = replacement;
  registration.settingsForms.extra = replacement; registration.appExtensions.welcome = replacement;
  registration.artifacts[0].fe.component = replacement; registration.blocks[0].fe.component = replacement;
  registration.steps[0].node.label = 'Changed'; declaration.steps!.memo.node.label = 'Changed';
  prepared.commit(); prepared.dispose();
  const accepted = registry.getRegisteredSurfaces()[0];
  expect(accepted).toMatchObject({ label: 'Items', hotkeys: [{ action: 'OPEN', global: true }],
    options: { headerClass: 'initial' }, fallbackPanel: { label: 'Fallback', toggle: { type: 'TOGGLE' }, isShown } });
  expect(accepted.state).toBe(state);
  expect((accepted.canvas as Record<string, unknown>).list).toBe(component);
  expect(accepted.panel).toBe(component);
  expect(registry.settingsForm({ kind: 'feature', featureRef: 'owner/view' })).toBe(component);
  expect(registry.settingsForm({ kind: 'pack', packId: 'owner', groupId: 'extra' })).toBe(component);
  expect(registry.appExtension('welcome')).toBe(component);
  expect(registry.appExtensionBinding('welcome')).toEqual({ packId: 'owner', component });
  expect(registry.artifact('card')?.fe?.component).toBe(component);
  expect(registry.block('answer')?.fe?.component).toBe(component);
  const row = registry.stepBindings().get('memo')!;
  expect(row).toMatchObject({ packId: 'owner', declaration: { node: { label: 'Memo' } }, binding: { node: { label: 'Memo' } } });
  expect(row.registrationId).toBeUndefined(); expect(row.buildRevision).toBeUndefined(); expect(row.declarationRevision).toBeUndefined();
  expect(Reflect.set(row, 'packId', 'other')).toBe(false);
  expect(Reflect.set(row.declaration.node, 'label', 'Other')).toBe(false);
  expect(Reflect.set(accepted.options!, 'headerClass', 'Other')).toBe(false);
  expect(Reflect.set(accepted, 'label', 'Other')).toBe(false);
  expect(component.render).not.toHaveBeenCalled(); expect(isShown).not.toHaveBeenCalled();
});

it('retains accepted backend identities for source-delivered frontends and stable rows until replacement', () => {
  const registry = createFePackRegistry();
  const pack = { id: 'owner', name: 'Owner', version: '1.0.0', registrationId: 'runtime-one', declarationRevision: 'declaration',
    buildRevision: 'a'.repeat(64), developmentBaseUrl: 'http://127.0.0.1:1',
    manifest: { id: 'owner', name: 'Owner', version: '1.0.0', extensions: { steps: { memo: { node: { label: 'Memo' } } } } } };
  const registration = { id: 'owner', declarationRevision: 'declaration', steps: [{ type: 'memo', node: { label: 'Memo' } }] };
  registry.registerPackFE({ kind: 'loaded', pack }, registration);
  const row = registry.stepBindings().get('memo')!;
  expect(row).toMatchObject({ packId: 'owner', registrationId: 'runtime-one', declarationRevision: 'declaration', buildRevision: 'a'.repeat(64) });
  pack.registrationId = 'runtime-two';
  registry.registerPackFE({ kind: 'native', declaration: { id: 'other' } }, { id: 'other' });
  expect(registry.stepBindings().get('memo')).toBe(row);
  const copy = registry.stepBindings();
  expect(Reflect.set(row, 'registrationId', 'forged')).toBe(false);
  expect(copy.get('memo')).toBe(row);
  Map.prototype.clear.call(copy);
  expect(registry.stepBindings().get('memo')).toBe(row);
  registry.replacePackFE({ kind: 'loaded', pack }, registration);
  expect(registry.stepBindings().get('memo')).not.toBe(row);
  expect(registry.stepBindings().get('memo')?.registrationId).toBe('runtime-two');
  registry.unregisterPackFE('owner');
  expect(registry.stepBindings().size).toBe(0);
});

it('validates loaded declaration data before reading its declarative identity accessor', () => {
  const registry = createFePackRegistry();
  const id = vi.fn(() => 'owner');
  const resource = settings();
  const pack = { id: 'owner', name: 'Owner', version: '1.0.0', declarationRevision: 'accepted', registrationId: 'runtime',
    manifest: { get id() { return id(); }, name: 'Owner', version: '1.0.0' } };
  expect(() => registry.registerPackFE({ kind: 'loaded', pack }, { id: 'owner', declarationRevision: 'accepted' }, resource))
    .toThrow('JSON data properties');
  expect(id).not.toHaveBeenCalled();
  expect(resource.dispose).toHaveBeenCalledOnce();
});


it.each(['settingsForms', 'appExtensions'] as const)('captures %s slot getters once before comparing and publishing them', field => {
  const registry = createFePackRegistry();
  const first = {}; const second = {};
  const read = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
  const slots = Object.defineProperty({}, 'extra', { enumerable: true, get: read });
  const declaration: NativePackDeclaration = field === 'settingsForms'
    ? { id: 'owner', settings: { extra: { schema: { type: 'object' }, defaults: {}, form: 'native/form.vue' } } }
    : { id: 'owner', appExtensions: { extra: 'native/extra.vue' } };
  registry.registerPackFE({ kind: 'native', declaration }, { id: 'owner', [field]: slots });
  const accepted = field === 'settingsForms'
    ? registry.settingsForm({ kind: 'pack', packId: 'owner', groupId: 'extra' }) : registry.appExtension('extra');
  expect(read).toHaveBeenCalledOnce();
  expect(accepted).toBe(first);
});


it.each(['artifacts', 'blocks'] as const)('captures %s facet getters once', field => {
  const component = {};
  const read = vi.fn(() => field === 'artifacts' ? { icon: component, component } : { component });
  const registry = createFePackRegistry();
  const declaration: NativePackDeclaration = field === 'artifacts'
    ? { id: 'owner', artifacts: { item: { icon: 'Box', fe: 'native/view.vue' } } }
    : { id: 'owner', blocks: { item: { fe: 'native/view.vue' } } };
  registry.registerPackFE({ kind: 'native', declaration }, { id: 'owner', [field]: [{ type: 'item', get fe() { return read(); } }] });
  expect(read).toHaveBeenCalledOnce();
});



it('blocks registry reentry from binding getters and retires both provisional resources', () => {
  const registry = createFePackRegistry();
  const outer = settings(); const inner = settings();
  expect(() => registry.registerPackFE({ kind: 'native', declaration: { id: 'outer' } }, {
    id: 'outer', get features() {
      registry.registerPackFE({ kind: 'native', declaration: { id: 'inner' } }, { id: 'inner' }, inner);
      return {};
    },
  }, outer)).toThrow('already in progress');
  expect(registry.hasPackFE('inner')).toBe(false);
  expect(registry.hasPackFE('outer')).toBe(false);
  expect(outer.dispose).toHaveBeenCalledOnce();
  expect(inner.dispose).toHaveBeenCalledOnce();
});
