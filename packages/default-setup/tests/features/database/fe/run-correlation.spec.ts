// The run history viewer's flow events: the page of the flow the viewer is on, whatever it asked for before.
//
// One page of one flow is read at a time, and asking for another gives up the one being read — a selection, or a
// re-selection of the same flow while a later page is coming — so the page that lands is always the one last asked
// for. It is placed by the offset it is for: the first replaces the list, a later one adds to it.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { RunTree } from '@apackdev/sdk/steps';

/** The asks the machine has made, in order: what each was, what it carried, and the spec's way to end it */
const asks = vi.hoisted(() => [] as Array<{ type: string; input: Record<string, unknown>; stopped: boolean; settle(outcome: unknown): void }>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    fromAsk: (_to: string, type: string) => fromPromise(({ input, signal }) => new Promise((resolve) => {
      const ask = { type, input: input as Record<string, unknown>, stopped: false, settle: resolve };
      signal.addEventListener('abort', () => { ask.stopped = true; });
      asks.push(ask);
    })),
  };
});
// The schema is not these cases' subject: a view that is never delivered
vi.mock('#generated/fe.ts', async () => {
  const { fromCallback } = await import('xstate');
  return { fromView: () => fromCallback(() => {}) };
});

const { default: databaseState } = await import('#features/database/fe/state.ts');

/** The nth ask of `type` the machine made */
const asked = (type: string, nth = 0) => {
  const ask = asks.filter((made) => made.type === type)[nth];
  if (!ask) throw new Error(`no ${type} #${nth} was asked`);
  return ask;
};

/** Ends an ask as its system would, unless the machine gave it up, and waits for the machine to have heard */
async function end(ask: (typeof asks)[number], outcome: unknown) {
  // An ask that was stopped is never answered: its answer, when it comes, is nobody's
  if (!ask.stopped) ask.settle(outcome);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const answer = (ask: (typeof asks)[number], value: unknown) => end(ask, { ok: true, value });

/**
 * A run node as the viewer lists it: the two fields it reads, which is deliberately not a whole
 * `RunNode`. **The cast stops here** — the events the cases send are checked, so a misspelled event
 * type is a compile error rather than a send the machine ignores while the case asserts nothing.
 */
const anEvent = (id: string) => ({ id, label: id, children: [] }) as unknown as RunTree;

/** Answers the nth ask for a page with these events: the answer says which page of which flow it is, as it was asked */
const page = (nth: number, ids: string[], hasMore = false) => {
  const ask = asked('GET_FLOW_EVENTS', nth);
  return answer(ask, { flowId: ask.input.flowId, offset: ask.input.offset, hasMore, events: ids.map(anEvent) });
};

/** The run history viewer, which is where flow selection is handled */
function viewing() {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'VIEW_MODE.TOGGLE' });
  return actor;
}

const flowEvents = (actor: ReturnType<typeof viewing>) =>
  actor.getSnapshot().context.flowEvents.map((event: { id: string }) => event.id);

const askedOffsets = () => asks.filter((ask) => ask.type === 'GET_FLOW_EVENTS').map((ask) => ask.input.offset);

beforeEach(() => {
  asks.length = 0;
});

it('shows the flow last selected, not the answer that arrived last', async () => {
  const actor = viewing();

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
  expect(actor.getSnapshot().context.currentFlowId, 'the selection assigns it at once').toBe('f2');

  // f1's answer turns up after the viewer has moved on
  await page(0, ['from-f1']);
  expect(flowEvents(actor), 'not shown under f2').toEqual([]);

  await page(1, ['from-f2']);
  expect(flowEvents(actor)).toEqual(['from-f2']);
});

it('clears the previous flow\'s events when a new one is selected', async () => {
  const actor = viewing();

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  await page(0, ['from-f1']);
  expect(flowEvents(actor)).toEqual(['from-f1']);

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
  expect(flowEvents(actor), 'the view does not show one flow under another while loading').toEqual([]);
});

// Re-selecting puts the viewer back on page one: the second page, still coming, is not the flow
it('drops a page the viewer has paged away from, in the same flow', async () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  await page(0, ['one'], true);

  actor.send({ type: 'RUNS.LOAD_MORE' });
  expect(askedOffsets(), 'the second page was asked for').toEqual([0, 50]);

  // Back to page one while that page is still coming
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  await page(1, ['two']);

  expect(flowEvents(actor), 'page two is not the flow').toEqual([]);
});

// A page is placed by the offset it is for: page one replaces, a later page appends
it('appends a later page and replaces on the first', async () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });

  await page(0, ['one'], true);
  expect(flowEvents(actor)).toEqual(['one']);

  actor.send({ type: 'RUNS.LOAD_MORE' });
  await page(1, ['two']);
  expect(flowEvents(actor), 'the later page adds to the list').toEqual(['one', 'two']);
});

// One page is read at a time: a second click while one is coming would move the offset the list is built from
it('asks for one page at a time', async () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  await page(0, ['one'], true);

  actor.send({ type: 'RUNS.LOAD_MORE' });
  actor.send({ type: 'RUNS.LOAD_MORE' });

  expect(askedOffsets(), 'the second click waits for the first page').toEqual([0, 50]);
});

// Pages are newest first by offset, so an event the live run hears between two pages moves every one down: the
// next page then starts with the last event of the one before
it('lists an event once when the next page repeats it', async () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  await page(0, ['three', 'two'], true);

  actor.send({ type: 'RUNS.LOAD_MORE' });
  await page(1, ['two', 'one']);

  expect(flowEvents(actor)).toEqual(['three', 'two', 'one']);
});

// The flow runs are read as the viewer opens, and the newest is selected for its first page
it('selects the newest flow run once the runs are read', async () => {
  const actor = viewing();
  await answer(asked('GET_FLOW_RUNS'), { flows: [{ id: 'f-new' }, { id: 'f-old' }] });

  expect(actor.getSnapshot().context.currentFlowId).toBe('f-new');
  expect(asked('GET_FLOW_EVENTS').input).toEqual({ flowId: 'f-new', offset: 0, limit: 50 });
});

// Each expanded node's details are asked for on their own, and each answer is that node's
it('reads the details of several nodes at once, each its own', async () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.EXPAND_NODE', nodeId: 'n1' });
  actor.send({ type: 'RUNS.EXPAND_NODE', nodeId: 'n2' });

  await answer(asked('GET_NODE_DETAILS', 1), { nodeId: 'n2', details: { id: 'n2' } });
  await answer(asked('GET_NODE_DETAILS', 0), { nodeId: 'n1', details: { id: 'n1' } });

  expect([...actor.getSnapshot().context.nodeDetails.keys()].sort()).toEqual(['n1', 'n2']);
});
