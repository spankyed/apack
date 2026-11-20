// The brain view's node details: a reply that names the node it describes, against a view that has
// already moved on.
//
// `answersSelectedNode` admits a reply only for the node in `selectedStepNode`, so the reply is
// identifiable without a request id — a handler that takes whatever arrives shows the wrong panel after
// two quick clicks. **What that costs is an invariant: every action that asks must select first**, and an
// action that forgets is not wrong loudly, it is answered into a guard that drops it.
//
// This file used to assert the invariant over two of the four asking actions and state it as a fact about
// all of them. The fourth was the counterexample: a step's error asked for the failing node's details and
// never selected it, so the panel that exists to show them was never given any.
//
// The last case asks each asker the same question — *is the node you asked about the one you selected?* —
// and reads the node off the send rather than restating it, so the **assertion** holds for an asker nobody
// has written yet. The **list of triggers is still written by hand**, so a fifth asker has to be added to
// it; that is a line, and saying so is better than leaving the list looking derived.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { StepRuntimeError, RunNode } from '@apackdev/sdk/steps';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

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
function ready() {
  const actor = createActor(brainState).start();
  actor.send({
    type: 'ASK_ANSWERED',
    asked: 'REQUEST_SURFACE_DATA',
    answer: {
      // The fields the machine reads to reach `ready`; the rest of that payload is not this file's subject,
      // and the cast sits on it rather than on the event so the type above stays checked
      data: { flowRunNodeId: 'RunNode-f1', possibleEvents: [], flowHierarchy: [] } as never,
      state: { type: 'BRAIN_STATE', rootFlowId: 'Flow-root' as never, paused: false, inspectEnabled: false },
    },
  });
  return actor;
}

beforeEach(() => {
  sendToSystem.mockReset();
});

it('shows the node last clicked, not the answer that arrived last', () => {
  const actor = ready();

  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });
  actor.send({ type: 'NODE.CLICK', nodeId: 'n2' });
  expect(actor.getSnapshot().context.selectedStepNode?.id, 'the click sets it at once').toBe('n2');

  // n2 answers, then n1's older answer turns up
  actor.send({ type: 'ASK_ANSWERED', asked: 'GET_RUN_NODE_DETAILS', answer: { runNodeId: 'n2' as never, details: details('n2') } });
  actor.send({ type: 'ASK_ANSWERED', asked: 'GET_RUN_NODE_DETAILS', answer: { runNodeId: 'n1' as never, details: details('n1') } });

  expect(actor.getSnapshot().context.selectedStepNode?.id).toBe('n2');
});

it('takes the details for the node it is waiting on', () => {
  const actor = ready();
  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });

  actor.send({ type: 'ASK_ANSWERED', asked: 'GET_RUN_NODE_DETAILS', answer: { runNodeId: 'n1' as never, details: details('n1') } });
  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n1', label: 'n1' });
});

/** The nodes details were asked about, in order — read off the send so a case need not restate them */
const askedAbout = () => sendToSystem.mock.calls
  .map(([, event]) => event as { type: string; runNodeId?: string })
  .filter((event) => event.type === 'GET_RUN_NODE_DETAILS')
  .map((event) => event.runNodeId);

const runtimeError = (runNodeId?: string) => ({
  type: 'BRAIN_RUNTIME_ERROR' as const,
  error: { errorId: 'e1', message: 'it broke', source: 'step', phase: 'run', ...(runNodeId && { runNodeId }) } as StepRuntimeError,
});

/**
 * A step's error opens the failing node, which is the case the invariant was being broken for.
 *
 * Nothing is selected, so before the fix the answer was dropped and the details panel stayed empty for the
 * one node the user needs to look at.
 */
it("opens the failing node's details when a step errors", () => {
  const actor = ready();

  actor.send(runtimeError('n-broke'));
  expect(askedAbout(), 'it asks about the node that failed').toEqual(['n-broke']);

  actor.send({ type: 'ASK_ANSWERED', asked: 'GET_RUN_NODE_DETAILS', answer: { runNodeId: 'n-broke' as never, details: details('n-broke') } });

  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n-broke', label: 'n-broke' });
});

// An error with no node to blame asks nothing, and leaves whatever the user was looking at alone
it('leaves the selection alone for an error that names no node', () => {
  const actor = ready();
  actor.send({ type: 'NODE.CLICK', nodeId: 'n1' });
  actor.send({ type: 'ASK_ANSWERED', asked: 'GET_RUN_NODE_DETAILS', answer: { runNodeId: 'n1' as never, details: details('n1') } });

  actor.send(runtimeError());

  expect(askedAbout()).toEqual(['n1']);
  expect(actor.getSnapshot().context.selectedStepNode).toMatchObject({ id: 'n1' });
});

/**
 * The invariant, asked of each action that sends a `GET_RUN_NODE_DETAILS` and selects as it does.
 *
 * `refreshNodeDetailsIfSelected` is deliberately absent: it asks only about the node already selected, so
 * the invariant holds there by construction rather than by assignment. `selectAndShowFirstNode` is absent
 * for a duller reason — it reads the node out of `normalizedTree`, so it needs a tree built to ask at all,
 * and the two here reach the same assertion without one.
 *
 * **Adding an asker means adding a row.** The assertion does not care which node is involved, so a new
 * row costs one line; what it cannot do is notice an asker nobody listed.
 */
it.each([
  ['a node click', { type: 'NODE.CLICK' as const, nodeId: 'n-clicked' }],
  ['a step error', runtimeError('n-failed')],
])('selects the node it asks about: %s', (_what, event) => {
  const actor = ready();

  actor.send(event);

  const asked = askedAbout();
  expect(asked, 'it asked about exactly one node').toHaveLength(1);
  expect(actor.getSnapshot().context.selectedStepNode?.id, 'and selected the one it asked about')
    .toBe(asked[0]);
});
