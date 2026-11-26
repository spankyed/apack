import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onUnmounted, ref, shallowRef, type App } from 'vue';
import type { SettingsSnapshot } from '@apackdev/sdk/types';

const { update, reset, send } = vi.hoisted(() => ({ update: vi.fn(), reset: vi.fn(), send: vi.fn() }));
vi.mock('@apackdev/host/fe', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/fe')>(),
  useHostState: () => ({ send }),
}));
vi.mock('@/views/settings/save', () => ({ useSettingsSaveStatus: () => ({
  saveStatus: ref('idle'), problems: ref([]), updateSettings: update, resetSettings: reset,
}) }));
vi.mock('@/runtime/settings', () => ({ useWindowSettingsSnapshot: () => snapshot }));
vi.mock('@/runtime/catalog', () => ({ windowCatalog: {
  getSnapshot: () => ({ native: [{ id: 'first' }, { id: 'second' }], packs: [] }),
  status: () => 'ready', subscribe: () => () => {},
} }));
import { fePacks } from '@/runtime/packs';
import { _createFeSettings } from '@apackdev/sdk/fe';
import { fakeSettings } from '@apackdev/sdk/testing';
import PacksTab from '@/views/settings/canvas/tabs/PacksTab.vue';
const fixtures = createNativeFrontendTestRegistry([], fePacks);

const definition = { title: 'Preferences', schema: { type: 'object' }, defaults: { name: 'Default' } };
const snapshot = shallowRef<SettingsSnapshot>({
  runId: 'forms', revision: 0, status: 'ready',
  values: { app: { hotkeys: {}, personal: {}, projects: [] }, packs: { first: { preferences: { name: 'First' } }, second: { preferences: { name: 'Second' } } }, features: {} },
  catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} },
    packs: { first: { preferences: definition }, second: { preferences: definition } }, features: {}, dependencies: {} },
});
let app: App | undefined;
afterEach(() => {
  app?.unmount(); app = undefined;
  fePacks.unregisterPackFE('first'); fePacks.unregisterPackFE('second');
  vi.clearAllMocks();
});
function render() {
  const el = document.createElement('div');
  app = createApp(PacksTab); app.mount(el); return el;
}
const form = defineComponent({
  props: ['settings'], emits: ['update-setting'],
  setup(props, { emit }) {
    return () => h('button', { 'data-form': '', onClick: () => emit('update-setting', {
      path: ['name'], value: 'Edited', target: { kind: 'app' },
    }) }, props.settings.name);
  },
});

it('keeps inactive declarations editable in JSON and reacts to form registration and unload', async () => {
  const el = render();
  expect(el.textContent).toContain('first/preferences');
  expect(el.textContent).toContain('second/preferences');
  expect(el.textContent).toContain('Edit in JSON');
  const json = [...el.querySelectorAll('button')].find(button => button.textContent === 'Edit in JSON')!;
  json.click();
  expect(send.mock.calls.map(([event]) => event)).toEqual([
    { type: 'TAB.SELECT', tab: 'general' }, { type: 'GENERAL_NAV.SELECT', item: 'json' },
  ]);
  fixtures.registerFixture({ id: 'first', settingsForms: { preferences: form } });
  await nextTick();
  expect(el.querySelector('[data-form]')?.textContent).toBe('First');
  fePacks.unregisterPackFE('first'); await nextTick();
  expect(el.querySelector('[data-form]')).toBeNull();
  expect(el.textContent).toContain('Edit in JSON');
});

it('uses the selected qualified owner even when a form emits a different target', async () => {
  fixtures.registerFixture({ id: 'first', settingsForms: { preferences: form } });
  fixtures.registerFixture({ id: 'second', settingsForms: { preferences: form } });
  const el = render();
  [...el.querySelectorAll('button')].find(button => button.textContent?.includes('second/preferences'))!.click();
  await nextTick();
  expect(el.querySelector('[data-form]')?.textContent).toBe('Second');
  el.querySelector<HTMLButtonElement>('[data-form]')!.click();
  expect(update).toHaveBeenCalledWith({
    target: { kind: 'pack', packId: 'second', groupId: 'preferences' },
    path: ['name'], value: 'Edited', condition: undefined,
  });
});

it('remounts a cached custom form for its binding lifetime and preserves it on unrelated publication', async () => {
  const generated = _createFeSettings();
  const target = { kind: 'pack', packId: 'first', groupId: 'preferences' } as const;
  const mounted = vi.fn();
  const disposed = vi.fn();
  const CachedForm = defineComponent({ setup() {
    mounted();
    const handle = generated.useSettings<{ name: string }>(target);
    onUnmounted(disposed);
    return () => h('button', { 'data-cached-form': '', onClick: () => handle.set({ path: ['name'], value: 'Saved' }) }, handle.value.value?.name);
  } });
  const first = fakeSettings({ packs: { first: { preferences: { name: 'Original binding' } } } });
  const second = fakeSettings({ packs: { first: { preferences: { name: 'New binding' } } } });
  const registration = { id: 'first', settingsForms: { preferences: CachedForm }, bindSettings: generated.bindSettings };
  fixtures.registerFixture(registration, { port: first, dispose() {} });
  const element = render();
  expect(element.textContent).toContain('Original binding');
  fixtures.registerFixture({ id: 'second', settingsForms: { preferences: form } });
  await nextTick();
  expect(mounted).toHaveBeenCalledOnce();
  expect(disposed).not.toHaveBeenCalled();
  fixtures.replaceFixture(registration, { port: second, dispose() {} });
  await nextTick();
  expect(element.textContent).toContain('New binding');
  expect(mounted).toHaveBeenCalledTimes(2);
  expect(disposed).toHaveBeenCalledOnce();
  element.querySelector<HTMLButtonElement>('[data-cached-form]')!.click();
  await nextTick();
  expect(second.get(target)).toEqual({ name: 'Saved' });
  expect(first.updates).toEqual([]);
});
