// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onUnmounted } from 'vue';
import { SurfaceScope, useSurface } from '../../src/fe/actor-system.ts';
import type { HostShellSurfaceRef } from '../../src/fe/shell.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

it('remounts cached content for a replaced surface handle and leaves unchanged scopes mounted', async () => {
  const ref = 'scope-pack/view';
  const firstPing = vi.fn();
  const nextPing = vi.fn();
  let seq = 0;
  const makeHandle = (ping: () => void): HostShellSurfaceRef => {
    const sessionId = `s-${++seq}`;
    return {
      id: ref,
      sessionId,
      getSnapshot: () => ({ status: 'active', value: 'ready', context: {} }),
      subscribe: () => ({ unsubscribe() {} }),
      send(event) { if (event.type === 'PING') ping(); },
    };
  };
  const first = makeHandle(firstPing);
  const second = makeHandle(nextPing);
  let running: HostShellSurfaceRef | undefined = first;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  const disposed = vi.fn();
  const mounted = vi.fn();
  const unsubscribe = vi.fn();
  bindFeHost({
    catalog: {} as never,
    application: {
      surface: () => running,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return { unsubscribe() { unsubscribe(); listeners.delete(listener); } };
      },
    } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
  const Content = defineComponent({
    setup() {
      mounted();
      const captured = useSurface<HostShellSurfaceRef>();
      onUnmounted(disposed);
      return () => h('button', { onClick: () => captured.send({ type: 'PING' }) }, captured.sessionId);
    },
  });
  const element = document.createElement('div');
  const app = createApp(defineComponent({ setup: () => () => h(SurfaceScope, { surface: ref }, () => h(Content)) }));
  try {
    app.mount(element);
    expect(element.textContent).toBe(first.sessionId);
    running = second;
    notify();
    await nextTick();
    expect(element.textContent).toBe(second.sessionId);
    expect(disposed).toHaveBeenCalledOnce();
    element.querySelector('button')!.click();
    expect(nextPing).toHaveBeenCalledOnce();
    expect(firstPing).not.toHaveBeenCalled();
    notify();
    await nextTick();
    expect(mounted).toHaveBeenCalledTimes(2);
    running = undefined;
    notify();
    await nextTick();
    expect(element.textContent).toBe('');
    expect(disposed).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    unbindFeHost();
  }
});
