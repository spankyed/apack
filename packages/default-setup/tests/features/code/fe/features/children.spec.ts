// A panel's ask reaches the backend from inside the surface's own send, which is the only send that names the surface
// as its sender, so the backend can answer it.
//
// `useSurface()` hands a component the surface with its `send` run inside a delivery naming the surface; a send straight
// to a child runs in none, so what the child asks the backend carries no sender and its answer is dropped. The stand-in
// below records whether a backend send was made inside that `send`, which is the fact the real delivery turns into a
// sender.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, sendTo, setup, type AnyActorRef } from 'xstate';

const asks = vi.hoisted(() => [] as { type: string; insideSurfaceSend: boolean }[]);
const insideSurfaceSend = vi.hoisted(() => ({ value: false }));
vi.mock('#generated/events.ts', () => ({
  sendToSystem: (_to: string, event: { type: string }) => asks.push({ type: event.type, insideSurfaceSend: insideSurfaceSend.value }),
}));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({ getParentContext: () => ({ baseDirectory: '/work' }) }));

const { searchState } = await import('#features/code/fe/features/search/state.ts');
const { panelChild } = await import('#features/code/fe/features/children.ts');

/** The code surface as far as a panel reaches it: a search child, and events routed to it by their prefix */
const surfaceMachine = setup({ actors: { searchState } }).createMachine({
  invoke: { id: 'search', src: 'searchState' },
  on: { '*': { actions: sendTo('search', ({ event }) => event) } },
});

let actor: ReturnType<typeof createActor<typeof surfaceMachine>>;
/** The surface as `useSurface()` gives it: its `send` is the one that names the surface */
let surface: AnyActorRef;

beforeEach(() => {
  asks.length = 0;
  actor = createActor(surfaceMachine).start();
  surface = new Proxy(actor, {
    get: (target, prop) => prop === 'send'
      ? (event: { type: string }) => {
          insideSurfaceSend.value = true;
          try { target.send(event); } finally { insideSurfaceSend.value = false; }
        }
      : (Reflect.get(target, prop, target) as unknown),
  }) as AnyActorRef;
});
afterEach(() => actor.stop());

it("asks the backend from inside the surface's send, so the answer has somewhere to go", () => {
  panelChild(surface, 'search')!.send({ type: 'search.START', query: 'needle' });

  expect(asks).toEqual([{ type: 'search.SEARCH_FILES', insideSurfaceSend: true }]);
});

it('reads the state of the child it was asked for', () => {
  const search = panelChild(surface, 'search')!;
  search.send({ type: 'search.START', query: 'needle' });

  expect(search.getSnapshot().context.searchQuery).toBe('needle');
  expect(search.getSnapshot().context.isSearching).toBe(true);
});

it('hands back nothing for a child the surface has not spawned', () => {
  expect(panelChild(surface, 'commit')).toBeUndefined();
});
