// When the Brain surface asks for a run's tree. The system answers the window that asks, so the surface asks wherever
// it needs one, and always in a delivery: on its start, when a run starts again, and on an event's pulse — the last
// asked for straight away, since an ask from a timer carries no sender and could not be answered.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
const { default: brainState } = await import('#features/brain/fe/state.ts');

const asks = () => sendToSystem.mock.calls.filter(([, event]) => event.type === 'REQUEST_SURFACE_DATA').map(([, event]) => event);
const tree = (flowRunNodeId: `${string}-${string}`) => ({ type: 'RECEIVE_SURFACE_DATA' as const, data: { flowRunNodeId, runNodeTree: [], possibleEvents: [], flowHierarchy: [] } });

beforeEach(() => { sendToSystem.mockReset(); });

it('asks for the root run when the shell starts it, and nothing from its own entry', () => {
  const actor = createActor(brainState).start();
  expect(asks(), 'no delivery names an ask from the entry').toEqual([]);
  actor.send({ type: 'SURFACE_STARTED' });
  expect(asks()).toEqual([{ type: 'REQUEST_SURFACE_DATA' }]);
  actor.stop();
});

it('asks for the flow it shows on a pulse, and for the root when a run starts again', () => {
  const actor = createActor(brainState).start();
  actor.send(tree('Run-sub'));
  actor.send({ type: 'EVENT_PULSE', eventType: 'user.message' });
  expect(asks().at(-1), 'at once, in the pulse').toEqual({ type: 'REQUEST_SURFACE_DATA', flowRunNodeId: 'Run-sub' });

  actor.send({ type: 'BRAIN_STARTED', rootFlowId: 'Flow-root' as never });
  expect(asks().at(-1), 'a new run is the root').toEqual({ type: 'REQUEST_SURFACE_DATA' });
  actor.stop();
});
