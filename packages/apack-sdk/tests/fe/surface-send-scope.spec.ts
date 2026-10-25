// A component's send says which surface made it.
//
// This is the one path that reaches a machine's actions from outside a delivery. The bus names the message it
// routes to a system and the shell names the one it hands a surface, but a click goes straight to the actor — so
// an action that then sent to a system stamped no `Message.sender`, and the system answering it with `reply` had
// no address and threw. For the commonest kind of request in the app.
//
// What the scope is read for is `Message.sender` (`createSends` in `events/index.ts`); here it is read directly,
// because what this file is about is whether the scope is set at all.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { assign, createActor, createMachine, type AnyActorRef } from 'xstate';
import { SurfaceScope, useSurface } from '../../src/fe/actor-system.ts';
import { _currentDelivery, type _Delivery } from '../../src/events/delivery.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

/** What the delivery scope held each time the actor was sent to */
let scopes: (_Delivery | undefined)[] = [];

/** A surface actor that records the scope its send ran in, which is the whole subject */
const recording = (id: string) => ({
  id,
  send: () => { scopes.push(_currentDelivery()); },
}) as unknown as AnyActorRef;

/**
 * A real actor, for the one case that is about what the Proxy passes through rather than what it wraps.
 *
 * The fakes above answer `id` and `send` and nothing else, so they cannot show that reading state still works
 * through the wrapper — which is the risk a Proxy introduces and the reason this file can claim the wrapper is
 * safe to hand a component.
 */
const counter = createMachine({
  id: 'counter',
  context: { count: 0 },
  on: { BUMP: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
});

let live: AnyActorRef;

beforeEach(() => {
  scopes = [];
  live = createActor(counter, { id: 'memo-pack/counter' }).start();
  const running: Record<string, AnyActorRef> = {
    'memo-pack/memos': recording('memo-pack/memos'),
    'default-setup/notes': recording('default-setup/notes'),
    'memo-pack/counter': live,
  };
  bindFeHost({ catalog: {} as never,
    application: { system: { get: (ref: string) => running[ref] }, subscribe: () => ({ unsubscribe() {} }) } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
});

afterEach(() => {
  live.stop();
  unbindFeHost();
});

/** A component that does what a click handler does: send to its own surface */
const Sends = defineComponent({
  setup: () => {
    useSurface<AnyActorRef>().send({ type: 'FETCH' });
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
   *
   * Only `send` is wrapped; everything else is passed through bound to the actor. `useSelector` is built on
   * exactly these two — it calls `subscribe` and reads `getSnapshot` — so a Proxy that broke either would make
   * every selector in every surface go stale, silently and everywhere. (`useSelector` itself is not exercised
   * here: `@xstate/vue` is the renderer's dependency, not this package's.)
   */
  it('passes getSnapshot and subscribe through to the actor', async () => {
    const seen: number[] = [];
    let readBefore: number | undefined;
    let readAfter: number | undefined;

    const Reads = defineComponent({
      setup: () => {
        const surface = useSurface<AnyActorRef>();
        surface.subscribe((snapshot) => { seen.push((snapshot.context as { count: number }).count); });
        readBefore = (surface.getSnapshot().context as { count: number }).count;
        surface.send({ type: 'BUMP' });
        readAfter = (surface.getSnapshot().context as { count: number }).count;
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/counter' }, () => h(Reads)));

    expect(readBefore, 'the actor was read through the wrapper').toBe(0);
    expect(readAfter, 'and the send it made reached the real actor').toBe(1);
    expect(seen, 'and a subscriber was told, which is what a selector relies on').toContain(1);
  });

  /**
   * Its members keep their identity too, which is what stops this depending on a library's internals.
   *
   * `@xstate/vue` reads `getSnapshot` and `subscribe` once, so a fresh binding per read happens to work there —
   * but a version that memoised on identity would make every selector in every surface stop updating, silently
   * and visually only. Keeping the bindings removes the question rather than re-checking it on each bump.
   */
  it('hands back the same member each time it is read', async () => {
    let stable: boolean | undefined;
    let sendStable: boolean | undefined;
    const Reads = defineComponent({
      setup: () => {
        const surface = useSurface<AnyActorRef>();
        stable = surface.getSnapshot === surface.getSnapshot && surface.subscribe === surface.subscribe;
        sendStable = surface.send === surface.send;
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/counter' }, () => h(Reads)));

    expect(stable, 'a selector may hold on to either').toBe(true);
    expect(sendStable, 'and the wrapped send is one function, not one per read').toBe(true);
  });

  // The wrapper is per actor, so a component calling useSurface() twice compares equal either way
  it('hands back the same object each time', async () => {
    let first: unknown;
    let second: unknown;
    const Twice = defineComponent({
      setup: () => {
        first = useSurface<AnyActorRef>();
        second = useSurface<AnyActorRef>();
        return () => '';
      },
    });

    await render(() => h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(Twice)));

    expect(first).toBe(second);
  });
});
