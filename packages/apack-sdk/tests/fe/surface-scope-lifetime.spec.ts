// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onUnmounted } from 'vue';
import { createActor, setup } from 'xstate';
import type { AnyActorRef } from 'xstate';
import { SurfaceScope, useSurface } from '../../src/fe/actor-system.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

it('remounts cached content for a replaced actor and leaves unchanged scopes mounted', async () => {
  const ref = 'scope-pack/view';
  const firstPing = vi.fn();
  const nextPing = vi.fn();
  const actor = (ping: () => void) => createActor(setup({}).createMachine({ on: { PING: { actions: ping } } }), { id: ref }).start();
  const first = actor(firstPing);
  const second = actor(nextPing);
  let running: AnyActorRef | undefined = first;
  const parent = createActor(setup({}).createMachine({ on: { CHANGED: {} } })).start();
  const disposed = vi.fn();
  const mounted = vi.fn();
  const unsubscribe = vi.fn();
  bindFeHost({ catalog: {} as never, application: {
    system: { get: () => running },
    subscribe(listener: () => void) {
      const subscription = parent.subscribe(listener);
      return { unsubscribe() { unsubscribe(); subscription.unsubscribe(); } };
    },
  } as never, secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never });
  const Content = defineComponent({ setup() {
    mounted();
    const captured = useSurface<AnyActorRef>();
    onUnmounted(disposed);
    return () => h('button', { onClick: () => captured.send({ type: 'PING' }) }, captured.sessionId);
  } });
  const element = document.createElement('div');
  const app = createApp(defineComponent({ setup: () => () => h(SurfaceScope, { surface: ref }, () => h(Content)) }));
  try {
    app.mount(element);
    expect(element.textContent).toBe(first.sessionId);
    first.stop();
    running = second;
    parent.send({ type: 'CHANGED' });
    await nextTick();
    expect(element.textContent).toBe(second.sessionId);
    expect(disposed).toHaveBeenCalledOnce();
    element.querySelector('button')!.click();
    expect(nextPing).toHaveBeenCalledOnce();
    expect(firstPing).not.toHaveBeenCalled();
    parent.send({ type: 'CHANGED' });
    await nextTick();
    expect(mounted).toHaveBeenCalledTimes(2);
    running = undefined;
    parent.send({ type: 'CHANGED' });
    await nextTick();
    expect(element.textContent).toBe('');
    expect(disposed).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    first.stop(); second.stop(); parent.stop(); unbindFeHost();
  }
});
