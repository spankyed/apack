// The brain view's node details: the panel shows the node the view is on, whatever order answers would arrive in.
//
// Details are loaded by `ready.loads.details`, keyed by `detailsRequest`: selecting another node changes
// `detailsRequest`, which cancels the in-flight ask for the previous node so its answer is discarded.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import type { StepRuntimeError, RunNode } from '@apackdev/sdk/steps';
import brainState from '#features/brain/fe/state.ts';

/**
 * A node's details as the panel reads them, which is deliberately not a whole `RunNode`.
 *
 * **The cast stops at the fixture.** The events the cases send are checked, so a misspelled event type is
 * a compile error rather than a send the machine ignores while the case goes on asserting.
 */
const details = (id: string) => ({ id, label: id }) as unknown as RunNode;

interface RecordedAsk {
  name: string;
  args: { runNodeId?: string };
  stopped: boolean;
  done: (outcome: Outcome<unknown>) => void;
}

async function ready() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, args, _progress, done) => {
      const entry: RecordedAsk = { name, args: args as { runNodeId?: string }, stopped: false, done };
      asks.push(entry);
      return () => {
        entry.stopped = true;
      };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/brain', brainState);
  sys.send(handle, { type: 'SURFACE_STARTED', ownsAppLayout: true });
  asks[0].done({
    ok: true,
    value: {
      data: { flowRunNodeId: 'RunNode-f1', possibleEvents: [], flowHierarchy: [] },
      state: { type: 'BRAIN_STATE', rootFlowId: 'Flow-root', paused: false, inspectEnabled: false },
    },
  });
  await waitFor(sys, handle, (v) => v.at === 'ready.shown');

  const detailAsks = () => asks.filter((ask) => ask.name === 'GET_RUN_NODE_DETAILS');
  const answerDetails = async (nth: number) => {
    const ask = detailAsks()[nth];
    ask.done({ ok: true, value: { runNodeId: ask.args.runNodeId, details: details(ask.args.runNodeId!) } });
    await Promise.resolve();
  };

  return {
    sys,
    handle,
    detailAsks,
    askedAbout: () => detailAsks().map((ask) => ask.args.runNodeId),
    answerDetails,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof brainState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

const runtimeError = (runNodeId?: string) => ({
  type: 'BRAIN_RUNTIME_ERROR' as const,
  error: { errorId: 'e1', message: 'it broke', source: 'step', phase: 'run', ...(runNodeId && { runNodeId }) } as StepRuntimeError,
});

it('shows the node last clicked, not the answer that arrived last', async () => {
  const ctx = await ready();
  try {
    ctx.send({ type: 'NODE.CLICK', nodeId: 'n1' });
    ctx.send({ type: 'NODE.CLICK', nodeId: 'n2' });
    expect(ctx.read().data.selectedStepNode?.id, 'the click sets it at once').toBe('n2');

    expect(ctx.detailAsks()[0].stopped, 'the ask about n1 was given up').toBe(true);

    // n2 answers, then n1's older answer turns up
    await ctx.answerDetails(1);
    await ctx.answerDetails(0);

    expect(ctx.read().data.selectedStepNode).toMatchObject({ id: 'n2', label: 'n2' });
  } finally {
    ctx.cleanup();
  }
});

it('takes the details for the node it is waiting on', async () => {
  const ctx = await ready();
  try {
    ctx.send({ type: 'NODE.CLICK', nodeId: 'n1' });

    await ctx.answerDetails(0);
    expect(ctx.read().data.selectedStepNode).toMatchObject({ id: 'n1', label: 'n1' });
  } finally {
    ctx.cleanup();
  }
});

// A step's error opens the failing node: nothing was selected, and the panel shows the node the user needs to look at
it("opens the failing node's details when a step errors", async () => {
  const ctx = await ready();
  try {
    ctx.send(runtimeError('n-broke'));
    expect(ctx.askedAbout(), 'it asks about the node that failed').toEqual(['n-broke']);

    await ctx.answerDetails(0);

    expect(ctx.read().data.selectedStepNode).toMatchObject({ id: 'n-broke', label: 'n-broke' });
  } finally {
    ctx.cleanup();
  }
});

// An error with no node to blame asks nothing, and leaves whatever the user was looking at alone
it('leaves the selection alone for an error that names no node', async () => {
  const ctx = await ready();
  try {
    ctx.send({ type: 'NODE.CLICK', nodeId: 'n1' });
    await ctx.answerDetails(0);

    ctx.send(runtimeError());

    expect(ctx.askedAbout()).toEqual(['n1']);
    expect(ctx.read().data.selectedStepNode).toMatchObject({ id: 'n1' });
  } finally {
    ctx.cleanup();
  }
});

it.each([
  ['a node click', { type: 'NODE.CLICK' as const, nodeId: 'n-clicked' }],
  ['a step error', runtimeError('n-failed')],
])('selects the node it asks about: %s', async (_what, event) => {
  const ctx = await ready();
  try {
    ctx.send(event);

    const asked = ctx.askedAbout();
    expect(asked, 'it asked about exactly one node').toHaveLength(1);
    expect(ctx.read().data.selectedStepNode?.id, 'and selected the one it asked about')
      .toBe(asked[0]);
  } finally {
    ctx.cleanup();
  }
});
