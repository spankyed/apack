import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, readonly, shallowRef, type App } from 'vue';
import type { SettingsSnapshot } from '@apackdev/sdk/types';
import type * as Monaco from 'monaco-editor';
import { provideMonacoRuntime } from '@apackdev/ui/components/monaco-config';

const { replaceAll } = vi.hoisted(() => ({ replaceAll: vi.fn(async () => ({ status: 'saved' })) }));
vi.mock('@/runtime/settings', () => ({ useWindowSettingsSnapshot: () => readonly(snapshot), windowSettings: { replaceAll } }));
vi.mock('@apackdev/ui/components/SimpleMonacoEditor', () => ({ default: defineComponent({
  props: ['modelValue'], emits: ['update:modelValue', 'mount'],
  setup(props, { emit }) {
    onMounted(() => emit('mount', { getModel: () => ({ uri: { toString: () => 'inmemory://settings/test' } }) }));
    return () => h('textarea', { value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) });
  },
}) }));
import SettingsJsonEditor from '@/views/settings/canvas/components/GeneralSettings/SettingsJsonEditor.vue';

const group = { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, defaults: { name: '' } };
const snapshot = shallowRef<SettingsSnapshot>();
let app: App | undefined;
let options: Monaco.json.DiagnosticsOptions;
let monaco: typeof Monaco;
beforeEach(() => {
  snapshot.value = { runId: 'editor-run', revision: 0, status: 'ready',
    catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: { fixture: { assistant: group } }, features: {}, dependencies: {} },
    values: { app: { hotkeys: {}, personal: {}, projects: [] }, packs: { fixture: { assistant: { name: '' } }, absent: { assistant: { name: 'Keep' } } }, features: {} },
  };
  options = { validate: true, enableSchemaRequest: false, schemas: [] };
  monaco = { json: { jsonDefaults: {
    get diagnosticsOptions() { return options; }, setDiagnosticsOptions(value: Monaco.json.DiagnosticsOptions) { options = value; },
  } } } as typeof Monaco;
});
afterEach(() => {
  app?.unmount(); app = undefined; vi.clearAllMocks();
});
function render() {
  const el = document.createElement('div');
  app = createApp(SettingsJsonEditor); provideMonacoRuntime(app, async () => monaco); app.mount(el); return el;
}
async function edit(el: HTMLElement, value: unknown) {
  const textarea = el.querySelector('textarea')!;
  textarea.value = JSON.stringify(value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
const saveButton = (el: HTMLElement) => [...el.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Save')!;

it('refuses malformed values, missing required fields and unavailable-owner edits before sending', async () => {
  const el = render();
  for (const assistant of [{ name: 1 }, {}]) {
    const next = structuredClone(snapshot.value!.values);
    next.packs.fixture.assistant = assistant;
    await edit(el, next);
    expect(saveButton(el).disabled).toBe(true);
    expect(el.textContent).toContain('packs/fixture/assistant');
  }
  const next = structuredClone(snapshot.value!.values);
  next.packs.absent.assistant = { name: 'Changed' };
  await edit(el, next);
  expect(saveButton(el).disabled).toBe(true);
  expect(el.textContent).toContain('Unavailable settings owner');
  expect(replaceAll).not.toHaveBeenCalled();
});

it('saves a complete document with retained orphans and the original draft comparison', async () => {
  const el = render();
  const original = structuredClone(snapshot.value!.values);
  const next = structuredClone(original);
  next.packs.fixture.assistant = { name: 'Ada' };
  await edit(el, next);
  expect(saveButton(el).disabled).toBe(false);
  saveButton(el).click();
  await nextTick();
  expect(replaceAll).toHaveBeenCalledWith(next, { runId: 'editor-run', expected: { exists: true, value: original } });
});

it('revalidates a dirty draft on catalog changes and removes schemas on disposal', async () => {
  const el = render();
  const next = structuredClone(snapshot.value!.values);
  next.packs.fixture.assistant = { name: 'Ada' };
  await edit(el, next);
  const text = el.querySelector('textarea')!.value;
  const current = snapshot.value!;
  snapshot.value = { ...current, catalog: { ...current.catalog, revision: 1, packs: { fixture: { assistant: {
    ...group, schema: { ...group.schema, properties: { name: { type: 'string', enum: [''] } } },
  } } } } };
  await nextTick();
  expect(el.querySelector('textarea')!.value).toBe(text);
  expect(saveButton(el).disabled).toBe(true);
  expect(options.schemas?.every(resource => resource.uri.includes('/1/'))).toBe(true);
  app?.unmount(); app = undefined;
  expect(options.schemas).toEqual([]);
});

it('holds a draft during data replacement and discards it without resetting stored preferences', async () => {
  const el = render();
  const next = structuredClone(snapshot.value!.values);
  next.packs.fixture.assistant = { name: 'Ada' };
  await edit(el, next);
  expect(saveButton(el).disabled).toBe(false);
  snapshot.value = { ...snapshot.value!, status: 'replacing' };
  await nextTick();
  expect(saveButton(el).disabled).toBe(true);
  snapshot.value = { ...snapshot.value!, status: 'ready' };
  await nextTick();
  [...el.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Discard changes')!.click();
  await nextTick();
  expect(JSON.parse(el.querySelector('textarea')!.value)).toEqual(snapshot.value!.values);
  expect(saveButton(el).disabled).toBe(true);
  expect(replaceAll).not.toHaveBeenCalled();
});
