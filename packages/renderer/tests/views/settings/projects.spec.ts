import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue';
import type { AppProject } from '@apackdev/sdk/types';
import type { SettingUpdate } from '@apackdev/sdk/fe';
import type { Message } from '@apackdev/sdk/events';
import type { SettingsSnapshot } from '@apackdev/sdk/types';
const { send } = vi.hoisted(() => ({ send: vi.fn(async (_message: Message) => {}) }));
vi.mock('@/transport', () => ({ trpc: {
  bus: { send: { mutate: send } },
  settings: { openHost: { mutate: async () => 'host-access' }, close: { mutate: async () => {} } },
} }));
import { windowSettings, connectWindowSettings, disconnectWindowSettings } from '@/runtime/settings';
import Projects from '@/views/settings/canvas/components/GeneralSettings/Projects.vue';

// The actual form, inputs and settings runtime run over a mocked transport and drag adapter.
vi.mock('vue-arrange', () => ({
  ArrangeableList: defineComponent({
    inheritAttrs: false,
    props: ['list'],
    setup(props, { slots }) { return () => h('div', (props.list as AppProject[]).map(item => slots.default?.({ item }))); },
  }),
}));

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electronAPI');
let app: App | undefined;
afterEach(async () => {
  app?.unmount(); app = undefined; disconnectWindowSettings(); await Promise.resolve(); send.mockClear(); vi.useRealTimers();
  if (originalElectron) Object.defineProperty(window, 'electronAPI', originalElectron);
  else Reflect.deleteProperty(window, 'electronAPI');
});
async function render(settings: AppProject[], save = vi.fn()) {
  const data: SettingsSnapshot = { runId: 'project-run', revision: 0, status: 'ready',
    values: { app: { projects: settings, hotkeys: {}, personal: {} }, packs: {}, features: {} },
    catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: {}, features: {}, dependencies: {} },
  };
  const ready = connectWindowSettings();
  for (let index = 0; index < 6; index++) await Promise.resolve();
  windowSettings.receive({ to: 'host/settings', answering: send.mock.calls.at(-1)![0].call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: data } } });
  await ready;
  const el = document.createElement('div');
  app = createApp(Projects, { settings, 'onUpdate-setting': save });
  app.mount(el);
  return el;
}
async function rename(el: HTMLElement) {
  const input = el.querySelector<HTMLInputElement>('input[placeholder="Project name"]')!;
  input.value = 'Edited';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

it('edits its own project and directory copies before the parent accepts a save', async () => {
  vi.useFakeTimers();
  const snapshot = [{ name: 'Original', directories: ['/first'], color: 'blue' }];
  const saves = vi.fn();
  const el = await render(snapshot, saves);
  await rename(el);
  expect(snapshot[0].name).toBe('Original');
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { fileUtils: { selectDirectory: vi.fn().mockResolvedValue('/second') } } });
  const add = [...el.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Add Directory'))!;
  add.click();
  await nextTick();
  vi.advanceTimersByTime(500);
  const update = saves.mock.calls[0][0] as SettingUpdate;
  const value = update.value as AppProject[];
  expect(value[0].name).toBe('Edited');
  expect(value[0].directories).toEqual(['/first', '/second']);
  expect(snapshot[0].directories).toEqual(['/first']);
  expect(update.condition).toEqual({ runId: 'project-run', expected: { exists: true, value: snapshot } });
});

it('renders a valid project with an empty directory list without mutating it', async () => {
  const projects = [{ name: 'Current', color: 'blue', directories: [] }];
  const el = await render(projects);
  expect(el.querySelector<HTMLInputElement>('input[placeholder="Project name"]')?.value).toBe('Current');
  expect(projects[0].directories).toEqual([]);
});

it('cancels a pending debounced write when the form is disposed', async () => {
  vi.useFakeTimers();
  const saves = vi.fn();
  await rename(await render([{ name: 'Original', directories: [], color: 'blue' }], saves));
  expect(vi.getTimerCount()).toBe(1);
  app?.unmount(); app = undefined;
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(500);
  expect(saves).not.toHaveBeenCalled();
});


it('retains an unsaved draft and its original comparison when another window changes projects', async () => {
  vi.useFakeTimers();
  const original = [{ name: 'Original', directories: ['/first'], color: 'blue' }];
  await render(original);
  app?.unmount();
  const incoming = shallowRef(original);
  const saves = vi.fn();
  const el = document.createElement('div');
  app = createApp(defineComponent({ setup: () => () => h(Projects, { settings: incoming.value, 'onUpdate-setting': saves }) }));
  app.mount(el);
  await rename(el);
  incoming.value = [{ name: 'Other window', directories: ['/second'], color: 'red' }];
  await nextTick();
  expect(el.querySelector<HTMLInputElement>('input[placeholder="Project name"]')?.value).toBe('Edited');
  vi.advanceTimersByTime(500);
  expect(saves.mock.calls[0][0]).toMatchObject({ value: [{ name: 'Edited' }], condition: { runId: 'project-run', expected: { exists: true, value: original } } });
});
