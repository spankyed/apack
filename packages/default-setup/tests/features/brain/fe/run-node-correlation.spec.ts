// The brain view's node details: the panel shows the node the view is on, whatever order answers would arrive in.
//
// Details are asked for by one state, which asks about the node selected, and selecting another node leaves that
// state for a new ask — so the ask for a node the view has moved off is given up, and its answer is nobody's.
// **What that rests on: every transition into the state selects first.** The last case asks each asker the same
// question — *is the node you asked about the one you selected?* — and reads the node off the ask rather than
// restating it. The list of triggers is written by hand, so a new asker is a row to add.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { StepRuntimeError, RunNode } from '@apackdev/sdk/steps';

/** The asks the machine has made, in order: what each was, what it carried, and the spec's way to answer it */
const asks = vi.hoisted(() => [] as Array<{ type: string; input: { runNodeId?: string }; stopped: boolean; answer(value: unknown): void }>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    tell: vi.fn(),
    fromAsk: (_to: string, type: string) => fromPromise(({ input, signal }) => new Promise((resolve) => {
      const ask = { type, input: input as { runNodeId?: string }, stopped: false, answer: (value: unknown) => resolve({ ok: true, value }) };
      signal.addEventListener('abort', () => { ask.stopped = true; });
      asks.push(ask);
    })),
  };
});

const { default: brainState } = await import('#features/brain/fe/state.ts');

/**
 * A node's details as the panel reads them, which is deliberately not a whole `RunNode`.
 *
 * **The cast stops at the fixture.** The events the cases send are checked, so a misspelled event type is
 * a compile error rather than a send the machine ignores while the case goes on asserting.
 */
const details = (id: string) => ({ id, label: id }) as unknown as RunNode;

/**
 * A started surface in `ready`, which is where node clicks are handled.
 *
 * The answer to its ask for a tree is what moves it there, and `normalizeFlowRunNodeData` tolerates a missing
 * `runNodeTree`, so nothing here has to build a tree to ask about correlation.
 */
async function ready() {
  const actor = createActor(brainState).start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  asks[0].answer({
    // The fields the machine reads to reach `ready`; the rest of that payload is not this file's subject
    data: { flowRunNodeId: 'RunNode-f1', possibleEvents: [], flowHierarchy: [] },
    state: { type: 'BRAIN_STATE', rootFlowId: 'Flow-root', paused: false, inspectEnabled: false },
  });
  await vi.waitFor(() => expect(actor.getSnapshot().matches('ready')).toBe(true));
  return actor;
}

/** The asks for a node's details, in order */
const detailAsks = () => asks.filter((ask) => ask.type === 'GET_RUN_NODE_DETAILS');

/** Answers the nth ask for details with the node it asked about, and waits for the machine to have heard */
async function answerDetails(nth: number) {
  const ask = detailAsks()[nth];
  ask.answer({ runNodeId: ask.input.runNodeId, details: details(ask.input.runNodeId!) });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  asks.length = 0;
});

it('shows the node last clicked, not the answer that arrived last', async () => {
  const actor = await ready();

  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });
  actor.send({ type: 'NODE.CLICK', nodeId: 'n2' });
  expect(actor.getSnapshot().context.selectedStepNode?.id, 'the click sets it at once').toBe('n2');

  expect(detailAsks()[0].stopped, 'the ask about n1 was given up').toBe(true);

  // n2 answers, then n1's older answer turns up
  await answerDetails(1);
  await answerDetails(0);

  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n2', label: 'n2' });
});

it('takes the details for the node it is waiting on', async () => {
  const actor = await ready();
  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });

  await answerDetails(0);
  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n1', label: 'n1' });
});

/** The nodes details were asked about, in order — read off the ask so a case need not restate them */
const askedAbout = () => detailAsks().map((ask) => ask.input.runNodeId);

const runtimeError = (runNodeId?: string) => ({
  type: 'BRAIN_RUNTIME_ERROR' as const,
  error: { errorId: 'e1', message: 'it broke', source: 'step', phase: 'run', ...(runNodeId && { runNodeId }) } as StepRuntimeError,
});

// A step's error opens the failing node: nothing was selected, and the panel shows the node the user needs to look at
it("opens the failing node's details when a step errors", async () => {
  const actor = await ready();

  actor.send(runtimeError('n-broke'));
  expect(askedAbout(), 'it asks about the node that failed').toEqual(['n-broke']);

  await answerDetails(0);

  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n-broke', label: 'n-broke' });
});

// An error with no node to blame asks nothing, and leaves whatever the user was looking at alone
it('leaves the selection alone for an error that names no node', async () => {
  const actor = await ready();
  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });
  await answerDetails(0);

  actor.send(runtimeError());

  expect(askedAbout()).toEqual(['n1']);
  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n1' });
});

/**
 * The invariant, asked of each event that asks for a node's details and selects as it does.
 *
 * A selected node's update is deliberately absent: it asks only about the node already selected, so the invariant
 * holds there by construction rather than by assignment. `SELECT_AND_SHOW_FIRST_NODE` is absent for a duller reason —
 * it reads the node out of the tree, so it needs a tree built to ask at all, and the two here reach the same
 * assertion without one.
 *
 * **Adding an asker means adding a row.** The assertion does not care which node is involved, so a new
 * row costs one line; what it cannot do is notice an asker nobody listed.
 */
it.each([
  ['a node click', { type: 'NODE.CLICK' as const, nodeId: 'n-clicked' }],
  ['a step error', runtimeError('n-failed')],
])('selects the node it asks about: %s', async (_what, event) => {
  const actor = await ready();

  actor.send(event);

  const asked = askedAbout();
  expect(asked, 'it asked about exactly one node').toHaveLength(1);
  expect(actor.getSnapshot().context.selectedStepNode?.id, 'and selected the one it asked about')
    .toBe(asked[0]);
});
