// The flows editor over its graph view. The canvas hands the machine each result of the open flow's view
// (`FLOW.GRAPH_READ`); the machine opens the flow it asked for on the first, follows the shown flow on the rest, and
// holds a result back while any of its own writes is unanswered — applying it then would undo an edit on screen —
// asking the canvas to read the view again (`writes.refreshes`) once the last is answered. Each write is an ask the
// machine spawns, which stands in here as one the case answers or refuses itself.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { startFeTestRuntime } from '@apackdev/sdk/testing';
import type { NodeEntity } from '#generated/types.ts';
import type { EARS } from '#generated/ears.ts';

/** The asks the machine made, in order: what each was asked with, and how the case ends it */
const asks = vi.hoisted(() => [] as { type: string; args: Record<string, unknown>; end(outcome: object): void }[]);
const layouts = vi.hoisted(() => [] as Array<(positions: Record<string, { x: number; y: number }>) => void>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    fromAsk: (_to: string, type: string) => fromPromise<object, Record<string, unknown>>(({ input }) =>
      new Promise(end => { asks.push({ type, args: input, end }); })),
  };
});
vi.mock('#features/flows/fe/canvas/layout-utils.ts', async original => ({
  ...await original<typeof import('#features/flows/fe/canvas/layout-utils.ts')>(),
  calculateLayoutAsync: vi.fn(() => new Promise<Record<string, { x: number; y: number }>>(resolve => layouts.push(resolve))),
}));
const { default: flowsState } = await import('#features/flows/fe/state.ts');
const actors: ReturnType<typeof createActor<typeof flowsState>>[] = [];
const start = () => { const actor = createActor(flowsState).start(); actors.push(actor); return actor; };

const node = (id: string, label = id) => ({ id, entityType: 'Node', createdAt: 1, nodeType: 'listener', label, scope: 'entry', eventType: 'flow.entry' }) as unknown as NodeEntity;
const read = (flowId: string, ...nodes: NodeEntity[]) => ({ type: 'FLOW.GRAPH_READ' as const, flowId: flowId as EARS.EntityId, data: { nodes, edges: [] } });
const gone = (flowId: string) => ({ type: 'FLOW.GRAPH_READ' as const, flowId: flowId as EARS.EntityId, data: null });
/** The nth ask of `type` the machine made */
const asked = (type: string, nth = 0) => asks.filter(ask => ask.type === type)[nth];
/** Ends an ask as the backend would, and lets the machine take how it ended */
const end = async (ask: (typeof asks)[number], outcome: object) => { ask.end(outcome); await new Promise(setImmediate); };
const answer = (ask: (typeof asks)[number], value?: unknown) => end(ask, { ok: true, value });
const refuse = (ask: (typeof asks)[number], message: string) => end(ask, { ok: false, failure: { kind: 'failed', message } });
const context = (actor: ReturnType<typeof start>) => actor.getSnapshot().context;
const labels = (actor: ReturnType<typeof start>) => context(actor).graph.nodes.map(each => each.label);

beforeEach(() => {
  asks.length = 0;
  layouts.length = 0;
});
afterEach(() => actors.splice(0).forEach(actor => actor.stop()));

/** A flow open in the editor, as its first graph read left it */
function open(flowId = 'Flow-first', ...nodes: NodeEntity[]) {
  const actor = start();
  actor.send({ type: 'OPEN_ENTITY', id: flowId as EARS.EntityId });
  actor.send(read(flowId, ...(nodes.length ? nodes : [node('Node-first')])));
  return actor;
}

it('opens a flow on its graph view\'s first read, asking the backend nothing', () => {
  const actor = start();
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
  expect(asks).toEqual([]);
  expect(context(actor).pendingFlow?.flowId).toBe('Flow-first');

  actor.send(read('Flow-other', node('Node-other')));
  expect(context(actor).selectedFlowId, 'another flow\'s read opens nothing').toBeUndefined();
  actor.send(read('Flow-first', node('Node-first')));
  expect(context(actor)).toMatchObject({ selectedFlowId: 'Flow-first', editingNodeId: 'Node-first', selectedNodeId: 'Node-first', pendingFlow: undefined });
  expect(actor.getSnapshot().matches('view')).toBe(true);
});

it('opens the flow asked for last, whichever read arrives', () => {
  const actor = start();
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-second', nodeId: 'Node-second' });
  actor.send(read('Flow-first', node('Node-first')));
  actor.send(read('Flow-second', node('Node-second')));
  expect(context(actor)).toMatchObject({ selectedFlowId: 'Flow-second', editingNodeId: 'Node-second' });
});

it('reveals a node of the shown flow at once, and says so when the flow no longer has it', () => {
  const actor = open();
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
  expect(context(actor).editingNodeId).toBe('Node-first');
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-missing' });
  expect(context(actor).canvasError).toContain('Node-missing');
  expect(context(actor).pendingFlow).toBeUndefined();
});

it.each(['leave', 'list'] as const)('opens nothing once the user has gone to %s', where => {
  const actor = start();
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
  if (where === 'leave') actor.send({ type: 'SURFACE_DEACTIVATED' });
  else actor.send({ type: 'TRAIL_CLICK', target: 'list' });
  actor.send(read('Flow-first', node('Node-first')));
  expect(context(actor).selectedFlowId).toBeUndefined();
});

it('follows the shown flow\'s later reads, keeping the open node editor and leaving other flows\' alone', () => {
  const actor = open();
  actor.send({ type: 'NODE.DOUBLE_CLICK', nodeId: 'Node-first' });
  actor.send(read('Flow-second', node('Node-second')));
  expect(context(actor).selectedFlowId).toBe('Flow-first');
  actor.send(read('Flow-first', node('Node-first', 'renamed elsewhere'), node('Node-added')));
  expect(labels(actor)).toEqual(['renamed elsewhere', 'Node-added']);
  expect(context(actor).editingNodeId).toBe('Node-first');
});

it('holds a read behind an unanswered write, and reads the view again once the write is answered', async () => {
  const actor = open('Flow-first', node('Node-first', 'stored'));
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
  const write = asked('UPDATE_NODE');
  // A read from before the write landed would put the old label back under the user's typing
  actor.send(read('Flow-first', node('Node-first', 'stored')));
  expect(labels(actor)).toEqual(['typed']);

  const before = context(actor).writes.refreshes;
  await answer(write);
  expect(context(actor).writes.refreshes, 'the held read may predate the write: read again').toBe(before + 1);
  actor.send(read('Flow-first', node('Node-first', 'typed')));
  expect(labels(actor)).toEqual(['typed']);
});

it('takes the next read as it comes when nothing was held behind an answered write', async () => {
  const actor = open('Flow-first', node('Node-first', 'stored'));
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
  const before = context(actor).writes.refreshes;
  await answer(asked('UPDATE_NODE'));
  expect(context(actor).writes.refreshes, 'nothing held, so nothing to read again').toBe(before);
  actor.send(read('Flow-first', node('Node-first', 'typed')));
  expect(context(actor).writes.pending).toEqual({});
});

it('waits for every write to be answered before applying anything', async () => {
  const actor = open('Flow-first', node('Node-first', 'stored'));
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'ty' } });
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
  await answer(asked('UPDATE_NODE', 0));
  // The first write's result, arriving while the second is still unanswered
  actor.send(read('Flow-first', node('Node-first', 'ty')));
  expect(labels(actor)).toEqual(['typed']);
  const before = context(actor).writes.refreshes;
  await answer(asked('UPDATE_NODE', 1));
  expect(context(actor).writes.refreshes).toBe(before + 1);
});

it('shows a refused write\'s reason and reads the flow as stored again', async () => {
  const actor = open();
  actor.send({ type: 'EDGE.DISCONNECT', edgeId: 'Edge-1' });
  const before = context(actor).writes.refreshes;
  await refuse(asked('DELETE_EDGE'), 'No such edge');
  expect(context(actor).canvasError).toBe('No such edge');
  expect(context(actor).writes.refreshes, 'the edit on screen is not what is stored').toBe(before + 1);
});

it('holds no read behind an ask that is not a write over the graph', async () => {
  const actor = open();
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
  actor.send({ type: 'ROOT_FLOW.SET', flowId: 'Flow-first' });
  expect(Object.keys(context(actor).writes.pending)).toHaveLength(1);
  await refuse(asked('SET_ROOT_FLOW'), 'No such flow');
  expect(context(actor).canvasError).toBe('No such flow');
  expect(Object.keys(context(actor).writes.pending), 'the node\'s write is still unanswered').toHaveLength(1);
});

it('keeps no ask that has ended among its children', async () => {
  const actor = open();
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
  expect(Object.keys(actor.getSnapshot().children)).toHaveLength(1);
  await answer(asked('UPDATE_NODE'));
  expect(Object.keys(actor.getSnapshot().children)).toEqual([]);
});

it('puts the node the backend made in place of the one drawn, and reads the view again for the rest', async () => {
  // Creating a node reads the step palette, which the window's frontend host holds
  const stopFe = startFeTestRuntime({ catalog: { status: () => 'ready', problem: () => undefined, references: () => [],
    frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => [], subscribe: () => () => {} } });
  try {
    const actor = open();
    actor.send({ type: 'NODE.CREATE', nodeType: 'transform' });
    const tempId = asked('CREATE_NODE').args.tempId as string;
    actor.send(read('Flow-first', node('Node-first')));
    expect(context(actor).graph.nodes.map(each => each.id), 'the drawn node stays while its write is unanswered').toContain(tempId);

    await answer(asked('CREATE_NODE'), { tempId, nodeId: 'Node-new' as EARS.EntityId, node: { ...node('Node-new'), nodeType: 'transform' } as NodeEntity });
    expect(context(actor).graph.nodes.map(each => each.id)).toEqual(['Node-first', 'Node-new']);
    expect(context(actor).selectedNodeId).toBe('Node-new');
  } finally { stopFe(); }
});

it('leaves the shown flow when its view reads it gone, and gives up opening one that is', () => {
  const actor = open();
  actor.send(gone('Flow-first'));
  expect(actor.getSnapshot().matches('list')).toBe(true);
  expect(context(actor).selectedFlowId).toBeUndefined();

  actor.send({ type: 'FLOW.SELECT', flowId: 'Flow-deleted' as EARS.EntityId });
  actor.send(gone('Flow-deleted'));
  expect(context(actor).pendingFlow).toBeUndefined();
  expect(context(actor).canvasError).toContain('Flow-deleted');
});

it('opens the flow it asked the backend to create, by the answer', async () => {
  const actor = start();
  actor.send({ type: 'FLOW.CREATE' });
  await answer(asked('CREATE_FLOW'), { flowId: 'Flow-new' as EARS.EntityId });
  expect(actor.getSnapshot().matches('view')).toBe(true);
  expect(context(actor).pendingFlow?.flowId).toBe('Flow-new');
  actor.send(read('Flow-new', node('Node-entry')));
  expect(context(actor).selectedFlowId).toBe('Flow-new');
});

it('labels its breadcrumb from what the list view read', () => {
  const actor = open();
  actor.send({ type: 'FLOWS.READ', labels: { 'Flow-first': 'Main' }, rootFlowId: 'Flow-first' as EARS.EntityId });
  expect(context(actor)).toMatchObject({ flowLabels: { 'Flow-first': 'Main' }, rootFlowId: 'Flow-first' });
});

it('asks for the model catalog as it starts, and takes what it is answered', async () => {
  const actor = start();
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await answer(asked('GET_MODEL_CATALOG'), { models: [{ id: 'anthropic:claude' }] });
  expect(context(actor).models).toEqual([{ id: 'anthropic:claude' }]);
});

it('does not apply a late layout to a different graph', async () => {
  const actor = start();
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
  actor.send(read('Flow-first', node('Node-first')));
  actor.send({ type: 'NODE.REVEAL', flowId: 'Flow-second', nodeId: 'Node-second' });
  actor.send(read('Flow-second', node('Node-second')));
  layouts[0]({ 'Node-first': { x: 10, y: 20 } }); await Promise.resolve();
  expect(context(actor).graph.positions).toEqual({});
  layouts[1]({ 'Node-second': { x: 30, y: 40 } }); await Promise.resolve();
  expect(context(actor).graph.positions).toEqual({ 'Node-second': { x: 30, y: 40 } });
});

it('applies a layout to the same flow even when its graph was rebuilt while the layout ran', async () => {
  const actor = open();
  actor.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'Renamed' } });
  layouts[0]({ 'Node-first': { x: 10, y: 20 } }); await Promise.resolve();
  expect(context(actor).graph.positions).toEqual({ 'Node-first': { x: 10, y: 20 } });
  expect(labels(actor)).toEqual(['Renamed']);
});
