import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineAsyncComponent, defineComponent, h, nextTick, type App, type Component } from 'vue';
import ContributionBoundary from '@/views/layout/ContributionBoundary.vue';

const runtime = vi.hoisted(() => ({ identity: {} as object | undefined, listeners: new Set<(packId: string) => void>() }));
vi.mock('@/runtime/packs', () => ({ fePacks: {
  frontendIdentity: () => runtime.identity,
  onChanged(listener: (packId: string) => void) { runtime.listeners.add(listener); return () => { runtime.listeners.delete(listener); }; },
} }));
vi.mock('@/runtime/catalog', () => ({ windowCatalog: {
  getSnapshot: () => ({ native: [{ id: 'fixture' }], packs: [] }), status: () => 'ready',
  subscribe: () => () => {},
} }));

let app: App | undefined;
const write = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  runtime.identity = {}; write.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = { rendererLog: { write } };
});
afterEach(() => { app?.unmount(); app = undefined; expect(runtime.listeners.size).toBe(0); });

function render(area: string, packId = 'fixture', component?: Component) {
  let broken = true;
  let current = true;
  const attempts = vi.fn();
  const healthy = vi.fn();
  const errorHandler = vi.fn();
  const View = component ?? defineComponent({ setup() {
    attempts();
    return () => { if (broken) throw new Error('render failed'); return h('p', 'Recovered'); };
  } });
  const el = document.createElement('div');
  app = createApp({ render: () => h('main', [
    h('button', { id: 'settings', onClick: healthy }, 'Host Settings'),
    h('button', { id: 'other-pane', onClick: healthy }, 'Other pane'),
    h(ContributionBoundary, { packId, owner: `${packId}/view`, area, current: () => current }, { default: () => h(View) }),
  ]) });
  app.config.errorHandler = errorHandler;
  app.mount(el);
  return { el, attempts, healthy, errorHandler, repair: () => { broken = false; }, retire: () => { current = false; } };
}

it.each(['canvas', 'panel', 'chat', 'settings form'])('contains a throwing %s and preserves neighboring host controls', async area => {
  const f = render(area); await nextTick();
  expect(f.el.querySelector('[role="alert"]')?.textContent).toContain(`fixture/view: ${area}`);
  f.el.querySelector<HTMLButtonElement>('#settings')!.click();
  f.el.querySelector<HTMLButtonElement>('#other-pane')!.click();
  expect(f.healthy).toHaveBeenCalledTimes(2);
  expect(f.errorHandler).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, source: 'pack.component',
    meta: expect.objectContaining({ detail: expect.objectContaining({ packId: 'fixture', area }) }),
  }));
  f.repair(); f.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await nextTick();
  expect(f.el.textContent).toContain('Recovered');
  expect(f.attempts).toHaveBeenCalledTimes(2);
});

it('rejects retry after retirement even before Vue receives the registry notification', async () => {
  const f = render('canvas'); await nextTick(); f.repair();
  runtime.identity = undefined;
  f.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await nextTick();
  expect(f.attempts).toHaveBeenCalledTimes(1);
  for (const listener of runtime.listeners) listener('fixture'); await nextTick();
  expect(f.el.textContent).toContain('no longer available');
});

it('rejects a stale view across frontend replacement', async () => {
  const f = render('panel'); await nextTick(); f.repair(); f.retire();
  f.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await nextTick();
  expect(f.attempts).toHaveBeenCalledTimes(1);
  runtime.identity = {};
  for (const listener of runtime.listeners) listener('fixture'); await nextTick();
  expect(f.attempts).toHaveBeenCalledTimes(1);
});

it('remounts the current frontend after replacement with a reused view', async () => {
  const f = render('canvas'); await nextTick(); f.repair();
  runtime.identity = {};
  for (const listener of runtime.listeners) listener('fixture');
  await nextTick();
  expect(f.el.textContent).toContain('Recovered');
  expect(f.attempts).toHaveBeenCalledTimes(2);
});

it('leaves native host failures with the host error handler', async () => {
  const f = render('canvas', 'host'); await nextTick();
  expect(f.errorHandler).toHaveBeenCalledOnce();
  expect(f.el.querySelector('[role="alert"]')).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

it('contains a rejected component import and retries it without disturbing host controls', async () => {
  const loader = vi.fn().mockRejectedValueOnce(new Error('component import failed'))
    .mockResolvedValue(defineComponent({ render: () => h('p', 'Loaded on retry') }));
  const component = defineAsyncComponent(loader);
  expect(loader).not.toHaveBeenCalled();
  const f = render('canvas', 'fixture', component);
  await vi.waitFor(() => expect(f.el.querySelector('[role="alert"]')?.textContent).toContain('component import failed'));
  f.el.querySelector<HTMLButtonElement>('#settings')!.click();
  expect(f.healthy).toHaveBeenCalledOnce();
  expect(f.errorHandler).not.toHaveBeenCalled();
  f.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
  await vi.waitFor(() => expect(f.el.textContent).toContain('Loaded on retry'));
  expect(loader).toHaveBeenCalledTimes(2);
});
