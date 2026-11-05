import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@guolao/vue-monaco-editor', () => ({ loader: { config: vi.fn() } }));
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { provideMonacoRuntime, useMonacoRuntime } from '@apackdev/ui/components/monaco-config';

type Monaco = typeof import('monaco-editor');
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); });
function mount(load: () => Promise<Monaco>, consumers = 1) {
  const states: ReturnType<typeof useMonacoRuntime>[] = [];
  const Consumer = defineComponent({ setup() { states.push(useMonacoRuntime()); return () => h('div'); } });
  const app = createApp({ render: () => h('div', Array.from({ length: consumers }, () => h(Consumer))) });
  provideMonacoRuntime(app, load);
  apps.push(app);
  return { app, states, start: () => app.mount(document.createElement('div')) };
}
it('loads on first consumer and shares initialization across concurrent consumers', async () => {
  const runtime = {} as Monaco;
  const load = vi.fn(async () => runtime);
  const view = mount(load, 2);
  expect(load).not.toHaveBeenCalled();
  view.start();
  await nextTick();
  expect(load).toHaveBeenCalledTimes(1);
  expect(view.states.map(state => state.monaco.value)).toEqual([runtime, runtime]);
});
it('does not adopt a result after its consumer unmounts', async () => {
  let resolve!: (value: Monaco) => void;
  const view = mount(() => new Promise<Monaco>(done => { resolve = done; }));
  view.start(); view.app.unmount(); apps.pop();
  resolve({} as Monaco); await nextTick();
  expect(view.states[0]!.monaco.value).toBeUndefined();
});
it('exposes a loading failure without creating a partial runtime', async () => {
  const view = mount(async () => { throw new Error('Local editor unavailable'); });
  view.start(); await nextTick();
  await vi.waitFor(() => expect(view.states[0]!.problem.value).toBe('Local editor unavailable'));
  expect(view.states[0]!.monaco.value).toBeUndefined();
});
