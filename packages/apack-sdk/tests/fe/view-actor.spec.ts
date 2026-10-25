// A view followed by a machine: `untypedFromView` is actor logic a surface's machine spawns with the view's arguments.
// It subscribes over the window's client for as long as the actor lives, hands the machine each result as the event the
// caller builds, and nothing an ended subscription delivers late reaches the machine.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assign, createActor, setup, stopChild } from 'xstate';
import type { ViewRequest, ViewUpdate } from '../../src/framework/views.ts';
import { untypedFromView } from '../../src/fe/view-actor.ts';
import { startFeTestRuntime } from '../../src/testing/fe-runtime.ts';

let subscriptions: Array<{ request: ViewRequest; deliver: (update: ViewUpdate) => void; open: boolean }>;
let stop: () => void;

beforeEach(() => {
  subscriptions = [];
  stop = startFeTestRuntime({
    client: {
      watchView: (request, observer) => {
        const subscription = { request, deliver: observer, open: true };
        subscriptions.push(subscription);
        return () => { subscription.open = false; };
      },
    },
  });
});
afterEach(() => stop());

type Read = { type: 'PAGE.READ'; page: number; titles: string[] | null };

const machine = setup({
  types: { context: {} as { reads: Array<{ page: number; titles: string[] | null }> }, events: {} as Read | { type: 'STOP' } },
  actors: {
    page: untypedFromView<string[], { page: number }, Read>('notes/notes', 'page', (update, args) =>
      ({ type: 'PAGE.READ', page: args.page, titles: update.ok ? update.value : null })),
  },
}).createMachine({
  context: { reads: [] },
  invoke: { id: 'page', src: 'page', input: { page: 2 } },
  on: {
    'PAGE.READ': { actions: assign(({ context, event }) => ({ reads: [...context.reads, { page: event.page, titles: event.titles }] })) },
    STOP: { actions: stopChild('page') },
  },
});

it('subscribes with the arguments it was given, and hands the machine each result as the event it builds', () => {
  const actor = createActor(machine).start();
  expect(subscriptions.map((subscription) => subscription.request)).toEqual([{ ref: 'notes/notes', view: 'page', args: { page: 2 } }]);

  subscriptions[0].deliver({ ok: true, value: ['a'], commit: 1 });
  subscriptions[0].deliver({ ok: false, error: 'the view threw', commit: 2 });
  expect(actor.getSnapshot().context.reads).toEqual([{ page: 2, titles: ['a'] }, { page: 2, titles: null }]);
  actor.stop();
});

it('ends its subscription when it is stopped, and drops what arrives after', () => {
  const actor = createActor(machine).start();
  const [subscription] = subscriptions;
  actor.send({ type: 'STOP' });
  expect(subscription.open).toBe(false);

  subscription.deliver({ ok: true, value: ['late'], commit: 3 });
  expect(actor.getSnapshot().context.reads).toEqual([]);
  actor.stop();
});
