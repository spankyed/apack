// The run history viewer's flow events: the page of the flow the viewer is on, whatever it asked for before.
//
// One page of one flow is read at a time, and asking for another gives up the one being read — a selection, or a
// re-selection of the same flow while a later page is coming — so the page that lands is always the one last asked
// for. It is placed by the offset it is for: the first replaces the list, a later one adds to it.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { RunTree } from '@apackdev/sdk/steps';
import databaseState from '#features/database/fe/state.ts';

interface RecordedAsk {
  name: string;
  args: Record<string, unknown>;
  stopped: boolean;
  done: (outcome: Outcome<unknown>) => void;
}

/**
 * A run node as the viewer lists it: the two fields it reads, which is deliberately not a whole
 * `RunNode`. **The cast stops here** — the events the cases send are checked, so a misspelled event
 * type is a compile error rather than a send the machine ignores while the case asserts nothing.
 */
const anEvent = (id: string) => ({ id, label: id, children: [] }) as unknown as RunTree;

/** The run history viewer, which is where flow selection is handled */
function viewing() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, args, _progress, done) => {
      const entry: RecordedAsk = { name, args: (args ?? {}) as Record<string, unknown>, stopped: false, done };
      asks.push(entry);
      return () => { entry.stopped = true; };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/database', databaseState);
  const send = (event: EventsOf<typeof databaseState>) => sys.send(handle, event);
  send({ type: 'VIEW_MODE.TOGGLE' });

  const asked = (name: string, nth = 0) => {
    const ask = asks.filter((made) => made.name === name)[nth];
    if (!ask) throw new Error(`no ${name} #${nth} was asked`);
    return ask;
  };

  const answer = async (ask: RecordedAsk, value: unknown) => {
    if (!ask.stopped) ask.done({ ok: true, value });
    await sys.idle();
  };

  return {
    asks,
    asked,
    answer,
    page: (nth: number, ids: string[], hasMore = false) => {
      const ask = asked('GET_FLOW_EVENTS', nth);
      return answer(ask, { flowId: ask.args.flowId, offset: ask.args.offset, hasMore, events: ids.map(anEvent) });
    },
    askedOffsets: () => asks.filter((ask) => ask.name === 'GET_FLOW_EVENTS').map((ask) => ask.args.offset),
    flowEvents: () => sys.read(handle).data.flowEvents.map((event) => event.id),
    read: () => sys.read(handle),
    send,
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('shows the flow last selected, not the answer that arrived last', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
    expect(ctx.read().data.currentFlowId, 'the selection assigns it at once').toBe('f2');

    // f1's answer turns up after the viewer has moved on
    await ctx.page(0, ['from-f1']);
    expect(ctx.flowEvents(), 'not shown under f2').toEqual([]);

    await ctx.page(1, ['from-f2']);
    expect(ctx.flowEvents()).toEqual(['from-f2']);
  } finally {
    ctx.cleanup();
  }
});

it('clears the previous flow\'s events when a new one is selected', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    await ctx.page(0, ['from-f1']);
    expect(ctx.flowEvents()).toEqual(['from-f1']);

    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f2' });
    expect(ctx.flowEvents(), 'the view does not show one flow under another while loading').toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

// Re-selecting puts the viewer back on page one: the second page, still coming, is not the flow
it('drops a page the viewer has paged away from, in the same flow', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    await ctx.page(0, ['one'], true);

    ctx.send({ type: 'RUNS.LOAD_MORE' });
    expect(ctx.askedOffsets(), 'the second page was asked for').toEqual([0, 50]);

    // Back to page one while that page is still coming
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    await ctx.page(1, ['two']);

    expect(ctx.flowEvents(), 'page two is not the flow').toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

// A page is placed by the offset it is for: page one replaces, a later page appends
it('appends a later page and replaces on the first', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });

    await ctx.page(0, ['one'], true);
    expect(ctx.flowEvents()).toEqual(['one']);

    ctx.send({ type: 'RUNS.LOAD_MORE' });
    await ctx.page(1, ['two']);
    expect(ctx.flowEvents(), 'the later page adds to the list').toEqual(['one', 'two']);
  } finally {
    ctx.cleanup();
  }
});

// One page is read at a time: a second click while one is coming would move the offset the list is built from
it('asks for one page at a time', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    await ctx.page(0, ['one'], true);

    ctx.send({ type: 'RUNS.LOAD_MORE' });
    ctx.send({ type: 'RUNS.LOAD_MORE' });

    expect(ctx.askedOffsets(), 'the second click waits for the first page').toEqual([0, 50]);
  } finally {
    ctx.cleanup();
  }
});

// Pages are newest first by offset, so an event the live run hears between two pages moves every one down: the
// next page then starts with the last event of the one before
it('lists an event once when the next page repeats it', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.SELECT_FLOW', flowId: 'f1' });
    await ctx.page(0, ['three', 'two'], true);

    ctx.send({ type: 'RUNS.LOAD_MORE' });
    await ctx.page(1, ['two', 'one']);

    expect(ctx.flowEvents()).toEqual(['three', 'two', 'one']);
  } finally {
    ctx.cleanup();
  }
});

// The flow runs are read as the viewer opens, and the newest is selected for its first page
it('selects the newest flow run once the runs are read', async () => {
  const ctx = viewing();
  try {
    await ctx.answer(ctx.asked('GET_FLOW_RUNS'), { flows: [{ id: 'f-new' }, { id: 'f-old' }] });

    expect(ctx.read().data.currentFlowId).toBe('f-new');
    expect(ctx.asked('GET_FLOW_EVENTS').args).toEqual({ flowId: 'f-new', offset: 0, limit: 50 });
  } finally {
    ctx.cleanup();
  }
});

// Each expanded node's details are asked for on their own, and each answer is that node's
it('reads the details of several nodes at once, each its own', async () => {
  const ctx = viewing();
  try {
    ctx.send({ type: 'RUNS.EXPAND_NODE', nodeId: 'n1' });
    ctx.send({ type: 'RUNS.EXPAND_NODE', nodeId: 'n2' });

    await ctx.answer(ctx.asked('GET_NODE_DETAILS', 1), { nodeId: 'n2', details: { id: 'n2' } });
    await ctx.answer(ctx.asked('GET_NODE_DETAILS', 0), { nodeId: 'n1', details: { id: 'n1' } });

    expect([...ctx.read().data.nodeDetails.keys()].sort()).toEqual(['n1', 'n2']);
  } finally {
    ctx.cleanup();
  }
});
