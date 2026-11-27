// A component's send says which surface made it.
//
// This is the one path that reaches a machine's handlers from outside a delivery. The bus names the message it
// routes to a system and the shell names the one it hands a surface, but a click goes straight to the surface handle — so
// a handler that then sent to a system stamped no `Message.sender`, and the system answering it with `reply` had
// no address and threw. For the commonest kind of request in the app.
//
// What the scope is read for is `Message.sender` (`createSends` in `events/index.ts`); here it is read directly,
// because what this file is about is whether the scope is set at all.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { state, system, type System } from '@apackdev/state';
import { SurfaceScope, useSurface } from '../../src/fe/actor-system.ts';
import type { HostShellSurfaceRef, HostShellSurfaceSnapshot } from '../../src/fe/shell.ts';
import { _currentDelivery, type _Delivery } from '../../src/events/delivery.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

/** What the delivery scope held each time the surface handle was sent to */
let scopes: (_Delivery | undefined)[] = [];

/** A surface handle that records the scope its send ran in, which is the whole subject */
const recording = (id: string) => ({
  id,
  sessionId: id,
  getSnapshot: () => ({ status: 'active' as const, value: 'ready', context: {} }),
  subscribe: () => ({ unsubscribe() {} }),
  send: () => { scopes.push(_currentDelivery()); },
}) as HostShellSurfaceRef;

/**
 * A real `@apackdev/state` instance wrapped as a `HostShellSurfaceRef`, for the cases about what the Proxy passes
 * through rather than what it wraps.
 */
const counter = state<{ data: { count: number } }, { type: 'BUMP' }>()({
  data: { count: 0 },
  on: { BUMP: (_event, { data }) => ({ data: { count: data.count + 1 } }) },
});

function wrapCounter(id: string): { ref: HostShellSurfaceRef; sys: System } {
  const sys = system({ side: 'window' });
  const handle = sys.start(id, counter);
  const toSnapshot = (): HostShellSurfaceSnapshot => {
    const view = sys.read(handle);
    return {
      status: 'active',
      value: 'ready',
      context: view.data as unknown as Record<string, unknown>,
    };
  };
  const ref: HostShellSurfaceRef = {
    id,
    sessionId: id,
    getSnapshot: toSnapshot,
    subscribe: (observer) => {
      const stop = sys.subscribe(() => observer(toSnapshot()));
      return { unsubscribe: stop };
    },
    send: (event) => sys.send(handle, event as { type: 'BUMP' }),
  };
  return { ref, sys };
}

let live: ReturnType<typeof wrapCounter>;

beforeEach(() => {
  scopes = [];
  live = wrapCounter('memo-pack/counter');
  const running: Record<string, HostShellSurfaceRef> = {
    'memo-pack/memos': recording('memo-pack/memos'),
    'default-setup/notes': recording('default-setup/notes'),
    'memo-pack/counter': live.ref,
  };
  bindFeHost({
    catalog: {} as never,
    application: { surface: (ref: string) => running[ref], subscribe: () => ({ unsubscribe() {} }) } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
});

afterEach(() => {
  live.sys.stop();
  unbindFeHost();
});

/** A component that does what a click handler does: send to its own surface */
const Sends = defineComponent({
  setup: () => {
    useSurface<HostShellSurfaceRef>().send({ type: 'FETCH' });
    return () => '';
  },
});

const render = (root: () => ReturnType<typeof h>) => renderToString(createSSRApp(defineComponent({ setup: () => root })));

describe("a component's send", () => {
  it('runs in a delivery naming its own surface', async () => {
    await render(() => h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(Sends)));

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.receiver, 'so an answer can come back to this surface').toBe('memo-pack/memos');
  });

  // Two surfaces' components in one render: each send must name its own, not whichever rendered last
  it('names the surface whose component sent it', async () => {
    await render(() => h('div', [
      h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(Sends)),
      h(SurfaceScope, { surface: 'default-setup/notes' }, () => h(Sends)),
    ]));

    expect(scopes.map((scope) => scope?.receiver)).toEqual(['memo-pack/memos', 'default-setup/notes']);
  });

  /**
   * The scope is for the send and no longer: a component that sends and then does other work must not leave one
   * in place, or whatever ran next would answer the wrong asker.
   */
  it('leaves no scope behind once the send has returned', async () => {
    await render(() => h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(Sends)));

    expect(_currentDelivery(), 'nothing is being handled out here').toBeUndefined();
  });

  /**
   * Reading state through the wrapper still works, which is what makes it safe to hand a component.
   */
  it('passes getSnapshot and subscribe through to the handle', async () => {
    const seen: number[] = [];
    let readBefore: number | undefined;
    let readAfter: number | undefined;

    const Reads = defineComponent({
      setup: () => {
        const surface = useSurface<HostShellSurfaceRef>();
        surface.subscribe((snapshot) => { seen.push((snapshot.context as { count: number }).count); });
        readBefore = (surface.getSnapshot().context as { count: number }).count;
        surface.send({ type: 'BUMP' });
        readAfter = (surface.getSnapshot().context as { count: number }).count;
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/counter' }, () => h(Reads)));

    expect(readBefore, 'the handle was read through the wrapper').toBe(0);
    expect(readAfter, 'and the send it made reached the real state').toBe(1);
    expect(seen, 'and a subscriber was told').toContain(1);
  });

  /**
   * Its members keep their identity too, so readers that memoise on method identity stay stable.
   */
  it('hands back the same member each time it is read', async () => {
    let stable: boolean | undefined;
    let sendStable: boolean | undefined;
    const Reads = defineComponent({
      setup: () => {
        const surface = useSurface<HostShellSurfaceRef>();
        stable = surface.getSnapshot === surface.getSnapshot && surface.subscribe === surface.subscribe;
        sendStable = surface.send === surface.send;
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/counter' }, () => h(Reads)));

    expect(stable, 'a reader may hold on to either').toBe(true);
    expect(sendStable, 'and the wrapped send is one function, not one per read').toBe(true);
  });

  // The wrapper is per handle, so a component calling useSurface() twice compares equal either way
  it('hands back the same object each time', async () => {
    let first: unknown;
    let second: unknown;
    const Twice = defineComponent({
      setup: () => {
        first = useSurface<HostShellSurfaceRef>();
        second = useSurface<HostShellSurfaceRef>();
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(Twice)));

    expect(first).toBe(second);
  });
});
