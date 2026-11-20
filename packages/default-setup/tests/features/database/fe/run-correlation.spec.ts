// The run history viewer's flow events: a reply that names which page of which flow it is, against a view that
// has moved on.
//
// Every `GET_FLOW_EVENTS` assigns `currentFlowId` and the offset it asked for before it sends — both the
// auto-select on the flow list and an explicit selection — so the reply's own `flowId` and `offset` tell
// it from an answer the viewer has left behind. Without the flow half, clicking two flows quickly shows
// the first one's events under the second.
//
// **The offset half was the gap this file used to describe rather than cover.** The answer to
// `GET_FLOW_EVENTS` echoed `flowId` and `hasMore` only, and `setFlowEvents` decided append-or-replace from whatever offset
// the context had since reached — so re-selecting a flow while a later page was in flight let that page
// *replace* the whole list, page two shown as if it were the flow. The reply carries its `offset` now,
// which is what lets the viewer place an answer by the page it is for instead of by where it has got to.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { RunTree } from '@apackdev/sdk/steps';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

const { default: databaseState } = await import('#features/database/fe/state.ts');

/**
 * A run node as the viewer lists it: the two fields it reads, which is deliberately not a whole
 * `RunNode`. **The cast stops here** — the events the cases send are checked, so a misspelled event
 * type is a compile error rather than a send the machine ignores while the case asserts nothing.
 */
const anEvent = (id: string) => ({ id, label: id, children: [] }) as unknown as RunTree;

/** An answer, which says which page of which flow it is */
const page = (flowId: string, offset: number, ids: string[], hasMore = false) =>
  ({ type: 'ASK_ANSWERED' as const, asked: 'GET_FLOW_EVENTS' as const, answer: { flowId, offset, hasMore, events: ids.map(anEvent) } });

/** The run history viewer, which is where flow selection is handled */
function viewing() {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'VIEW_MODE.TOGGLE' });
  return actor;
}

const flowEvents = (actor: ReturnType<typeof viewing>) =>
  actor.getSnapshot().context.flowEvents.map((event: { id: string }) => event.id);

const askedOffsets = () => sendToSystem.mock.calls
  .map(([, event]) => event as { type: string; offset?: number })
  .filter((event) => event.type === 'GET_FLOW_EVENTS')
  .map((event) => event.offset);

beforeEach(() => {
  sendToSystem.mockReset();
});

it('shows the flow last selected, not the answer that arrived last', () => {
  const actor = viewing();

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
  expect(actor.getSnapshot().context.currentFlowId, 'the selection assigns it at once').toBe('f2');

  // f1's answer turns up after the viewer has moved on
  actor.send(page('f1', 0, ['from-f1']));
  expect(flowEvents(actor), 'not shown under f2').toEqual([]);

  actor.send(page('f2', 0, ['from-f2']));
  expect(flowEvents(actor)).toEqual(['from-f2']);
});

it('clears the previous flow\'s events when a new one is selected', () => {
  const actor = viewing();

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send(page('f1', 0, ['from-f1']));
  expect(flowEvents(actor)).toEqual(['from-f1']);

  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
  expect(flowEvents(actor), 'the view does not show one flow under another while loading').toEqual([]);
});

/**
 * The case the offset exists for: a page the viewer has left behind must not land, and the flow id cannot
 * say so because it is the same flow.
 *
 * Re-selecting puts the viewer back on page one. The second page, still in flight, then answers — and
 * before the offset was echoed it *replaced* the list, so the flow appeared to consist of its own page two.
 */
it('drops a page the viewer has paged away from, in the same flow', () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send(page('f1', 0, ['one'], true));

  actor.send({ type: 'RUNS.LOAD_MORE' });
  expect(askedOffsets(), 'the second page was asked for').toEqual([0, 50]);

  // Back to page one while that page is still coming
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send(page('f1', 50, ['two']));

  expect(flowEvents(actor), 'page two is not the flow').toEqual([]);
});

// A page is placed by the offset it is for: page one replaces, a later page appends
it('appends a later page and replaces on the first', () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });

  actor.send(page('f1', 0, ['one'], true));
  expect(flowEvents(actor)).toEqual(['one']);

  actor.send({ type: 'RUNS.LOAD_MORE' });
  actor.send(page('f1', 50, ['two']));
  expect(flowEvents(actor), 'the later page adds to the list').toEqual(['one', 'two']);
});

/**
 * One page in flight at a time, which the offset correlation requires rather than merely prefers: a second
 * click would move the offset the viewer awaits and strand the page already asked for.
 */
it('asks for one page at a time', () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send(page('f1', 0, ['one'], true));

  actor.send({ type: 'RUNS.LOAD_MORE' });
  actor.send({ type: 'RUNS.LOAD_MORE' });

  expect(askedOffsets(), 'the second click waits for the first page').toEqual([0, 50]);
});

// Pages are newest first by offset, so an event the live run hears between two pages moves every one down: the
// next page then starts with the last event of the one before
it('lists an event once when the next page repeats it', () => {
  const actor = viewing();
  actor.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
  actor.send(page('f1', 0, ['three', 'two'], true));

  actor.send({ type: 'RUNS.LOAD_MORE' });
  actor.send(page('f1', 50, ['two', 'one']));

  expect(flowEvents(actor)).toEqual(['three', 'two', 'one']);
});
