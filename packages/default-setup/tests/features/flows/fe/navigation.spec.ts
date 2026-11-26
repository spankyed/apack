// The flows editor over its graph view. The canvas hands the machine each result of the open flow's view
// (`FLOW.GRAPH_READ`); the machine opens the flow it asked for on the first, follows the shown flow on the rest, and
// holds a result back while any of its own writes is unanswered — applying it then would undo an edit on screen —
// asking the canvas to read the view again (`writes.refreshes`) once the last is answered. Each write is an ask the
// machine makes, which stands in here as one the case answers or refuses itself.
import { beforeEach, expect, it, vi } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { startFeTestRuntime } from '@apackdev/sdk/testing';
import type { NodeEntity } from '#generated/types.ts';
import type { EARS } from '#generated/ears.ts';

const layouts = vi.hoisted(() => [] as Array<(positions: Record<string, { x: number; y: number }>) => void>);
vi.mock('#features/flows/fe/canvas/layout-utils.ts', async original => ({
  ...await original<typeof import('#features/flows/fe/canvas/layout-utils.ts')>(),
  calculateLayoutAsync: vi.fn(() => new Promise<Record<string, { x: number; y: number }>>(resolve => layouts.push(resolve))),
}));

const { default: flowsState } = await import('#features/flows/fe/state.ts');

interface RecordedAsk {
  name: string;
  args: Record<string, unknown>;
  done: (outcome: Outcome<unknown>) => void;
}

const node = (id: string, label = id) => ({ id, entityType: 'Node', createdAt: 1, nodeType: 'listener', label, scope: 'entry', eventType: 'flow.entry' }) as unknown as NodeEntity;
const read = (flowId: string, ...nodes: NodeEntity[]) => ({ type: 'FLOW.GRAPH_READ' as const, flowId: flowId as EARS.EntityId, data: { nodes, edges: [] } });
const gone = (flowId: string) => ({ type: 'FLOW.GRAPH_READ' as const, flowId: flowId as EARS.EntityId, data: null });

function start() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, args, _progress, done) => {
      asks.push({ name, args: (args ?? {}) as Record<string, unknown>, done });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/flows', flowsState);

  const asked = (name: string, nth = 0) => {
    const ask = asks.filter(a => a.name === name)[nth];
    if (!ask) throw new Error(`no ${name} #${nth} was asked`);
    return ask;
  };
  const end = async (ask: RecordedAsk, outcome: Outcome<unknown>) => {
    ask.done(outcome);
    await sys.idle();
  };

  return {
    sys,
    asks,
    asked,
    answer: (ask: RecordedAsk, value?: unknown) => end(ask, { ok: true, value }),
    refuse: (ask: RecordedAsk, message: string) => end(ask, { ok: false, failure: { kind: 'failed', message } }),
    read: () => sys.read(handle),
    data: () => sys.read(handle).data,
    labels: () => sys.read(handle).data.graph.nodes.map(each => each.label),
    send: (event: EventsOf<typeof flowsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

/** A flow open in the editor, as its first graph read left it */
function open(flowId = 'Flow-first', ...nodes: NodeEntity[]) {
  const ctx = start();
  ctx.send({ type: 'OPEN_ENTITY', id: flowId as EARS.EntityId });
  ctx.send(read(flowId, ...(nodes.length ? nodes : [node('Node-first')])));
  return ctx;
}

beforeEach(() => {
  layouts.length = 0;
});

it('opens a flow on its graph view\'s first read, asking the backend nothing', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
    expect(ctx.asks).toEqual([]);
    expect(ctx.data().pendingFlow?.flowId).toBe('Flow-first');

    ctx.send(read('Flow-other', node('Node-other')));
    expect(ctx.data().selectedFlowId, 'another flow\'s read opens nothing').toBeUndefined();
    ctx.send(read('Flow-first', node('Node-first')));
    expect(ctx.data()).toMatchObject({ selectedFlowId: 'Flow-first', editingNodeId: 'Node-first', selectedNodeId: 'Node-first', pendingFlow: undefined });
    expect(ctx.read().at).toBe('view');
  } finally {
    ctx.cleanup();
  }
});

it('opens the flow asked for last, whichever read arrives', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-second', nodeId: 'Node-second' });
    ctx.send(read('Flow-first', node('Node-first')));
    ctx.send(read('Flow-second', node('Node-second')));
    expect(ctx.data()).toMatchObject({ selectedFlowId: 'Flow-second', editingNodeId: 'Node-second' });
  } finally {
    ctx.cleanup();
  }
});

it('reveals a node of the shown flow at once, and says so when the flow no longer has it', () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
    expect(ctx.data().editingNodeId).toBe('Node-first');
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-missing' });
    expect(ctx.data().canvasError).toContain('Node-missing');
    expect(ctx.data().pendingFlow).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it.each(['leave', 'list'] as const)('opens nothing once the user has gone to %s', where => {
  const ctx = start();
  try {
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
    if (where === 'leave') ctx.send({ type: 'SURFACE_DEACTIVATED' });
    else ctx.send({ type: 'TRAIL_CLICK', target: 'list' });
    ctx.send(read('Flow-first', node('Node-first')));
    expect(ctx.data().selectedFlowId).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it('follows the shown flow\'s later reads, keeping the open node editor and leaving other flows\' alone', () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.DOUBLE_CLICK', nodeId: 'Node-first' });
    ctx.send(read('Flow-second', node('Node-second')));
    expect(ctx.data().selectedFlowId).toBe('Flow-first');
    ctx.send(read('Flow-first', node('Node-first', 'renamed elsewhere'), node('Node-added')));
    expect(ctx.labels()).toEqual(['renamed elsewhere', 'Node-added']);
    expect(ctx.data().editingNodeId).toBe('Node-first');
  } finally {
    ctx.cleanup();
  }
});

it('holds a read behind an unanswered write, and reads the view again once the write is answered', async () => {
  const ctx = open('Flow-first', node('Node-first', 'stored'));
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
    const write = ctx.asked('UPDATE_NODE');
    // A read from before the write landed would put the old label back under the user's typing
    ctx.send(read('Flow-first', node('Node-first', 'stored')));
    expect(ctx.labels()).toEqual(['typed']);

    const before = ctx.data().writes.refreshes;
    await ctx.answer(write);
    expect(ctx.data().writes.refreshes, 'the held read may predate the write: read again').toBe(before + 1);
    ctx.send(read('Flow-first', node('Node-first', 'typed')));
    expect(ctx.labels()).toEqual(['typed']);
  } finally {
    ctx.cleanup();
  }
});

it('takes the next read as it comes when nothing was held behind an answered write', async () => {
  const ctx = open('Flow-first', node('Node-first', 'stored'));
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
    const before = ctx.data().writes.refreshes;
    await ctx.answer(ctx.asked('UPDATE_NODE'));
    expect(ctx.data().writes.refreshes, 'nothing held, so nothing to read again').toBe(before);
    ctx.send(read('Flow-first', node('Node-first', 'typed')));
    expect(ctx.data().writes.pending).toEqual({});
  } finally {
    ctx.cleanup();
  }
});

it('waits for every write to be answered before applying anything', async () => {
  const ctx = open('Flow-first', node('Node-first', 'stored'));
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'ty' } });
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
    await ctx.answer(ctx.asked('UPDATE_NODE', 0));
    // The first write's result, arriving while the second is still unanswered
    ctx.send(read('Flow-first', node('Node-first', 'ty')));
    expect(ctx.labels()).toEqual(['typed']);
    const before = ctx.data().writes.refreshes;
    await ctx.answer(ctx.asked('UPDATE_NODE', 1));
    expect(ctx.data().writes.refreshes).toBe(before + 1);
  } finally {
    ctx.cleanup();
  }
});

it('shows a refused write\'s reason and reads the flow as stored again', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'EDGE.DISCONNECT', edgeId: 'Edge-1' });
    const before = ctx.data().writes.refreshes;
    await ctx.refuse(ctx.asked('DELETE_EDGE'), 'No such edge');
    expect(ctx.data().canvasError).toBe('No such edge');
    expect(ctx.data().writes.refreshes, 'the edit on screen is not what is stored').toBe(before + 1);
  } finally {
    ctx.cleanup();
  }
});

it('holds no read behind an ask that is not a write over the graph', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
    ctx.send({ type: 'ROOT_FLOW.SET', flowId: 'Flow-first' });
    expect(Object.keys(ctx.data().writes.pending)).toHaveLength(1);
    await ctx.refuse(ctx.asked('SET_ROOT_FLOW'), 'No such flow');
    expect(ctx.data().canvasError).toBe('No such flow');
    expect(Object.keys(ctx.data().writes.pending), 'the node\'s write is still unanswered').toHaveLength(1);
  } finally {
    ctx.cleanup();
  }
});

it('keeps no ask that has ended among its pending calls', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'typed' } });
    expect(Object.keys(ctx.read().pending.updateNode)).toHaveLength(1);
    await ctx.answer(ctx.asked('UPDATE_NODE'));
    expect(Object.keys(ctx.read().pending.updateNode)).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

it('puts the node the backend made in place of the one drawn, and reads the view again for the rest', async () => {
  // Creating a node reads the step palette, which the window's frontend host holds
  const stopFe = startFeTestRuntime({ catalog: { status: () => 'ready', problem: () => undefined, references: () => [],
    frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => [], subscribe: () => () => {} } });
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.CREATE', nodeType: 'transform' });
    const tempId = ctx.asked('CREATE_NODE').args.tempId as string;
    ctx.send(read('Flow-first', node('Node-first')));
    expect(ctx.data().graph.nodes.map(each => each.id), 'the drawn node stays while its write is unanswered').toContain(tempId);

    await ctx.answer(ctx.asked('CREATE_NODE'), { tempId, nodeId: 'Node-new' as EARS.EntityId, node: { ...node('Node-new'), nodeType: 'transform' } as NodeEntity });
    expect(ctx.data().graph.nodes.map(each => each.id)).toEqual(['Node-first', 'Node-new']);
    expect(ctx.data().selectedNodeId).toBe('Node-new');
  } finally {
    ctx.cleanup();
    stopFe();
  }
});

it('leaves the shown flow when its view reads it gone, and gives up opening one that is', () => {
  const ctx = open();
  try {
    ctx.send(gone('Flow-first'));
    expect(ctx.read().at).toBe('list');
    expect(ctx.data().selectedFlowId).toBeUndefined();

    ctx.send({ type: 'FLOW.SELECT', flowId: 'Flow-deleted' as EARS.EntityId });
    ctx.send(gone('Flow-deleted'));
    expect(ctx.data().pendingFlow).toBeUndefined();
    expect(ctx.data().canvasError).toContain('Flow-deleted');
  } finally {
    ctx.cleanup();
  }
});

it('opens the flow it asked the backend to create, by the answer', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'FLOW.CREATE' });
    await ctx.answer(ctx.asked('CREATE_FLOW'), { flowId: 'Flow-new' as EARS.EntityId });
    expect(ctx.read().at).toBe('view');
    expect(ctx.data().pendingFlow?.flowId).toBe('Flow-new');
    ctx.send(read('Flow-new', node('Node-entry')));
    expect(ctx.data().selectedFlowId).toBe('Flow-new');
  } finally {
    ctx.cleanup();
  }
});

it('labels its breadcrumb from what the list view read', () => {
  const ctx = open();
  try {
    ctx.send({ type: 'FLOWS.READ', labels: { 'Flow-first': 'Main' }, rootFlowId: 'Flow-first' as EARS.EntityId });
    expect(ctx.data()).toMatchObject({ flowLabels: { 'Flow-first': 'Main' }, rootFlowId: 'Flow-first' });
  } finally {
    ctx.cleanup();
  }
});

it('asks for the model catalog as it starts, and takes what it is answered', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    await ctx.answer(ctx.asked('GET_MODEL_CATALOG'), { models: [{ id: 'anthropic:claude' }] });
    expect(ctx.data().models).toEqual([{ id: 'anthropic:claude' }]);
  } finally {
    ctx.cleanup();
  }
});

it('does not apply a late layout to a different graph', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-first', nodeId: 'Node-first' });
    ctx.send(read('Flow-first', node('Node-first')));
    ctx.send({ type: 'NODE.REVEAL', flowId: 'Flow-second', nodeId: 'Node-second' });
    ctx.send(read('Flow-second', node('Node-second')));
    layouts[0]({ 'Node-first': { x: 10, y: 20 } });
    await Promise.resolve();
    await ctx.sys.idle();
    expect(ctx.data().graph.positions).toEqual({});
    layouts[1]({ 'Node-second': { x: 30, y: 40 } });
    await Promise.resolve();
    await ctx.sys.idle();
    expect(ctx.data().graph.positions).toEqual({ 'Node-second': { x: 30, y: 40 } });
  } finally {
    ctx.cleanup();
  }
});

it('applies a layout to the same flow even when its graph was rebuilt while the layout ran', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NODE.UPDATE', nodeId: 'Node-first' as EARS.EntityId, updates: { label: 'Renamed' } });
    layouts[0]({ 'Node-first': { x: 10, y: 20 } });
    await Promise.resolve();
    await ctx.sys.idle();
    expect(ctx.data().graph.positions).toEqual({ 'Node-first': { x: 10, y: 20 } });
    expect(ctx.labels()).toEqual(['Renamed']);
  } finally {
    ctx.cleanup();
  }
});
