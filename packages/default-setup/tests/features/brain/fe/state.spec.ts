// When the Brain surface asks for a run's tree. The system answers the window that asks, so the surface asks wherever
// it needs one, and always in a delivery: on its start, when a run starts again, and on an event's pulse — the last
// asked for straight away, since an ask from a timer carries no sender and could not be answered.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { BrainStateEvent } from '#features/brain/be/types.ts';

const tell = vi.hoisted(() => vi.fn());
/** The asks the machine has made, in order: what each was, what it carried, and the spec's way to answer it */
const made = vi.hoisted(() => [] as Array<{ type: string; input: object; answer(value: unknown): void }>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    tell,
    fromAsk: (_to: string, type: string) => fromPromise(({ input }) => new Promise((resolve) => {
      made.push({ type, input: input as object, answer: (value: unknown) => resolve({ ok: true, value }) });
    })),
  };
});
const { default: brainState } = await import('#features/brain/fe/state.ts');

/** What each ask for a tree carried, in order */
const asks = () => made.filter((ask) => ask.type === 'REQUEST_SURFACE_DATA').map((ask) => ask.input);

const RUNNING: BrainStateEvent = { type: 'BRAIN_STATE', rootFlowId: 'Flow-root' as never, paused: false, inspectEnabled: false };

/** Answers the latest ask for a tree, which carries the brain's state beside it, and waits for the machine to hear */
async function answerTree(flowRunNodeId: `${string}-${string}`, state: BrainStateEvent = RUNNING) {
  made.filter((ask) => ask.type === 'REQUEST_SURFACE_DATA').at(-1)!
    .answer({ data: { flowRunNodeId, runNodeTree: [], possibleEvents: [], flowHierarchy: [] }, state });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => { tell.mockReset(); made.length = 0; });

it('asks for the root run when the shell starts it, and nothing from its own entry', () => {
  const actor = createActor(brainState).start();
  expect(asks(), 'no delivery names an ask from the entry').toEqual([]);
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  expect(asks()).toEqual([{}]);
  actor.stop();
});

it('asks for the flow it shows on a pulse, and for the root when a run starts again', async () => {
  const actor = createActor(brainState).start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await answerTree('Run-sub');
  actor.send({ type: 'EVENT_PULSE', eventType: 'user.message' });
  expect(asks().at(-1), 'at once, in the pulse').toEqual({ flowRunNodeId: 'Run-sub' });

  actor.send({ type: 'BRAIN_STARTED', rootFlowId: 'Flow-root' as never });
  expect(asks().at(-1), 'a new run is the root').toEqual({});
  actor.stop();
});

it("takes the brain's state from an answer without asking again", async () => {
  const actor = createActor(brainState).start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await answerTree('RunNode-root', { type: 'BRAIN_STATE', rootFlowId: 'Flow-root' as never, paused: true, inspectEnabled: true });
  expect(asks(), 'the one ask, answered').toHaveLength(1);
  expect(actor.getSnapshot().context).toMatchObject({ brainIsDead: false, runningRootFlowId: 'Flow-root', brainIsPaused: true, inspectEnabled: true });

  actor.send({ type: 'BRAIN_STATE', startError: 'No root flow', paused: false, inspectEnabled: false });
  expect(actor.getSnapshot().context).toMatchObject({ brainIsDead: true, startError: 'No root flow', runningRootFlowId: undefined });
  expect(asks()).toHaveLength(1);
  actor.stop();
});

// Going into a flow run is not given up for a pulse: the run it opens is the tree to show
it('keeps opening a flow run through a pulse', async () => {
  const actor = createActor(brainState).start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await answerTree('Run-root');
  actor.send({ type: 'FLOW.NAVIGATE', runNodeId: 'Run-sub' });
  actor.send({ type: 'EVENT_PULSE', eventType: 'user.message' });
  expect(asks(), 'no tree asked for meanwhile').toHaveLength(1);

  made.find((ask) => ask.type === 'OPEN_RUN_NODE')!.answer({ data: { flowRunNodeId: 'Run-sub', runNodeTree: [], possibleEvents: [], flowHierarchy: [] } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(actor.getSnapshot().context.flowRunNodeId).toBe('Run-sub');
  expect(actor.getSnapshot().context.pulsingEventType, 'the pulse still shows').toBe('user.message');
  actor.stop();
});

// Inspect mode is the feature's, not a run's: the surface passes a toggle on, and takes what it became, before its
// first tree as after it. A panel beside another surface shows by it (`fallback-panel.ts`), whether or not the Brain
// surface has been opened and loaded
it('passes an inspect toggle on, and takes what it became, before its first tree', () => {
  const actor = createActor(brainState).start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: false });
  actor.send({ type: 'TOGGLE_INSPECT' });
  expect(tell.mock.calls.map(([, event]) => event.type), 'passed on while loading').toContain('TOGGLE_INSPECT');

  actor.send({ type: 'INSPECT_TOGGLED', enabled: true });
  expect(actor.getSnapshot().context.inspectEnabled).toBe(true);
  actor.send({ type: 'INSPECT_TOGGLED', enabled: false });
  expect(actor.getSnapshot().context.inspectEnabled).toBe(false);
  actor.stop();
});
