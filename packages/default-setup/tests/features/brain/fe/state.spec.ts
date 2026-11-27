// When the Brain surface asks for a run's tree. The system answers the window that asks, so the surface asks wherever
// it needs one, and always in a delivery: on its start, when a run starts again, and on an event's pulse — the last
// asked for straight away, since an ask from a timer carries no sender and could not be answered.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { system, type Clock, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import type { BrainStateEvent } from '#features/brain/be/types.ts';
import brainState, { brainChrome, PULSE_DURATION_MS } from '#features/brain/fe/state.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const fakeClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

const RUNNING: BrainStateEvent = { type: 'BRAIN_STATE', rootFlowId: 'Flow-root' as never, paused: false, inspectEnabled: false };

function startBrainSurface() {
  const tells: Array<{ to: string; event: { type: string; [key: string]: unknown } }> = [];
  const made: Array<{ to: string; name: string; args: object; cancelled: boolean; done: (outcome: Outcome<unknown>) => void }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', clock: fakeClock, onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => {
      tells.push({ to, event: event as { type: string; [key: string]: unknown } });
    },
    ask: (to, name, args, _progress, done) => {
      const entry = { to, name, args: args as object, cancelled: false, done };
      made.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/brain', brainState);
  return {
    sys,
    handle,
    tells,
    made,
    asks: () => made.filter((ask) => ask.name === 'REQUEST_SURFACE_DATA').map((ask) => ask.args),
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof brainState>) => sys.send(handle, event),
    pulseTimerRefs: () => Object.keys(sys.snapshot()).filter((ref) => ref.startsWith('default-setup/brain/pulseTimers/')),
    answerTree: async (flowRunNodeId: `${string}-${string}`, state: BrainStateEvent = RUNNING) => {
      made.filter((ask) => ask.name === 'REQUEST_SURFACE_DATA').at(-1)!
        .done({ ok: true, value: { data: { flowRunNodeId, runNodeTree: [], possibleEvents: [], flowHierarchy: [] }, state } });
      await waitFor(sys, handle, (v) => v.at === 'ready.shown');
    },
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('asks for the root run when the shell starts it, and nothing from its own entry', () => {
  const ctx = startBrainSurface();
  try {
    expect(ctx.asks(), 'no delivery names an ask from the entry').toEqual([]);
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    expect(ctx.asks()).toEqual([{}]);
  } finally {
    ctx.cleanup();
  }
});

it('asks for the flow it shows on a pulse, and for the root when a run starts again', async () => {
  const ctx = startBrainSurface();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    await ctx.answerTree('Run-sub');
    ctx.send({ type: 'EVENT_PULSE', eventType: 'user.message' });
    expect(ctx.asks().at(-1), 'at once, in the pulse').toEqual({ flowRunNodeId: 'Run-sub' });
    expect(ctx.read().data.pulsingEventType).toBe('user.message');
    expect(ctx.pulseTimerRefs()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(PULSE_DURATION_MS);
    expect(ctx.read().data.pulsingEventType).toBeUndefined();
    expect(ctx.pulseTimerRefs()).toEqual([]);

    ctx.send({ type: 'BRAIN_STARTED', rootFlowId: 'Flow-root' as never });
    expect(ctx.asks().at(-1), 'a new run is the root').toEqual({});
  } finally {
    ctx.cleanup();
  }
});

it("takes the brain's state from an answer without asking again", async () => {
  const ctx = startBrainSurface();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    await ctx.answerTree('RunNode-root', { type: 'BRAIN_STATE', rootFlowId: 'Flow-root' as never, paused: true, inspectEnabled: true });
    expect(ctx.asks(), 'the one ask, answered').toHaveLength(1);
    expect(ctx.read().data).toMatchObject({ brainIsDead: false, runningRootFlowId: 'Flow-root', brainIsPaused: true, inspectEnabled: true });

    ctx.send({ type: 'BRAIN_STATE', startError: 'No root flow', paused: false, inspectEnabled: false });
    expect(ctx.read().data).toMatchObject({ brainIsDead: true, startError: 'No root flow', runningRootFlowId: undefined });
    expect(ctx.asks()).toHaveLength(1);
  } finally {
    ctx.cleanup();
  }
});

// Going into a flow run is not given up for a pulse: the run it opens is the tree to show
it('keeps opening a flow run through a pulse', async () => {
  const ctx = startBrainSurface();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    await ctx.answerTree('Run-root');
    ctx.send({ type: 'FLOW.NAVIGATE', runNodeId: 'Run-sub' });
    ctx.send({ type: 'EVENT_PULSE', eventType: 'user.message' });
    expect(ctx.asks(), 'no tree asked for meanwhile').toHaveLength(1);

    ctx.made.find((ask) => ask.name === 'OPEN_RUN_NODE')!.done({
      ok: true,
      value: {
        runNodeId: 'Run-sub',
        data: {
          flowRunNodeId: 'Run-sub',
          runNodeTree: [],
          possibleEvents: [],
          flowHierarchy: [
            { flowRunNodeId: 'Run-root', label: 'Root' },
            { flowRunNodeId: 'Run-sub', label: 'Subflow' },
          ],
        },
      },
    });
    await waitFor(ctx.sys, ctx.handle, (v) => v.at === 'ready.shown');
    expect(ctx.read().data.flowRunNodeId).toBe('Run-sub');
    expect(ctx.read().data.pulsingEventType, 'the pulse still shows').toBe('user.message');

    const readyCrumb = brainChrome.states?.ready?.breadcrumb;
    const crumbs = typeof readyCrumb === 'function' ? readyCrumb(ctx.read()) : readyCrumb;
    expect(crumbs).toEqual([
      { label: 'Brain', target: 'flow:Run-root' },
      { label: 'Subflow', target: 'flow:Run-sub' },
    ]);
  } finally {
    ctx.cleanup();
  }
});

// Inspect mode is the feature's, not a run's: the surface passes a toggle on, and takes what it became, before its
// first tree as after it. A panel beside another surface shows by it (`fallback-panel.ts`), whether or not the Brain
// surface has been opened and loaded
it('passes an inspect toggle on, and takes what it became, before its first tree', () => {
  const ctx = startBrainSurface();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: false });
    ctx.send({ type: 'TOGGLE_INSPECT' });
    expect(ctx.tells.map((t) => t.event.type), 'passed on while loading').toContain('TOGGLE_INSPECT');

    ctx.send({ type: 'INSPECT_TOGGLED', enabled: true });
    expect(ctx.read().data.inspectEnabled).toBe(true);
    ctx.send({ type: 'INSPECT_TOGGLED', enabled: false });
    expect(ctx.read().data.inspectEnabled).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

it('populates the run tree immediately when recovering from brainIsDead', async () => {
  const ctx = startBrainSurface();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    await ctx.answerTree('RunNode-initial');

    // Brain dies -> brainIsDead becomes true
    ctx.send({ type: 'BRAIN_KILLED', startError: 'stopped' });
    expect(ctx.read().data.brainIsDead).toBe(true);

    // Surface activates (or reads again) while brainIsDead is still true, and server answers with a live brain
    ctx.send({ type: 'SURFACE_ACTIVATED' });
    ctx.made.filter((ask) => ask.name === 'REQUEST_SURFACE_DATA').at(-1)!.done({
      ok: true,
      value: {
        data: {
          flowRunNodeId: 'RunNode-recovered',
          runNodeTree: [
            {
              id: 'RunNode-recovered',
              kind: 'flow',
              label: 'Root',
              status: 'active',
              startedAt: 1,
              rootId: 'RunNode-recovered',
              children: [],
            },
          ],
          possibleEvents: [],
          flowHierarchy: [{ flowRunNodeId: 'RunNode-recovered', label: 'Root' }],
        },
        state: RUNNING,
      },
    });
    await waitFor(ctx.sys, ctx.handle, (v) => v.at === 'ready.shown');

    expect(ctx.read().data.brainIsDead).toBe(false);
    expect(ctx.read().data.flowRunNodeId).toBe('RunNode-recovered');
    expect(ctx.read().data.runNodeTree).toHaveLength(1);
    expect(ctx.read().data.normalizedTree?.rootIds).toEqual(['RunNode-recovered']);
    expect(ctx.read().data.flowHierarchy).toEqual([{ flowRunNodeId: 'RunNode-recovered', label: 'Root' }]);
  } finally {
    ctx.cleanup();
  }
});
