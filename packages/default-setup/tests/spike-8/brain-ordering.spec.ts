import { describe, expect, it } from 'vitest';
import type { RunHistory, RunNodeId } from '@apackdev/sdk/services';
import { testRunHistory } from '@apackdev/sdk/testing';
import { system, within, type Handle } from '@apackdev/state';
import { defectGuard, everyOrder, onSchedule, sample } from '@apackdev/state/testing';
import type { EARS } from '#generated/ears.ts';
import {
  createBrainMachines,
  type BrainEvent,
  type BrainScheduler,
  type FlowBlueprint,
  type StepBlueprint,
} from './brain-prototype.ts';

const eid = (s: string) => s as EARS.EntityId;

/** Wraps a real LMDB-backed `RunHistory` to detect any attempt to overwrite a `'stopped'` RunNode. */
function auditedRunHistory(inner: RunHistory) {
  const overwrittenStopped: Array<{ id: RunNodeId; op: 'update' | 'finish'; attempted: string }> = [];
  const wrapped: RunHistory = {
    start: (node) => inner.start(node),
    finish: (id, status) => {
      const before = inner.get(id);
      if (before?.status === 'stopped') {
        overwrittenStopped.push({ id, op: 'finish', attempted: status });
      }
      inner.finish(id, status);
    },
    update: (id, patch) => {
      const before = inner.get(id);
      if (before?.status === 'stopped') {
        overwrittenStopped.push({ id, op: 'update', attempted: JSON.stringify(patch) });
      }
      inner.update(id, patch);
    },
    get: (id) => inner.get(id),
    findChildren: (id, page) => inner.findChildren(id, page),
    tree: (id) => inner.tree(id),
    findRuns: (opts) => inner.findRuns(opts),
    stopActive: () => inner.stopActive(),
    prune: (opts) => inner.prune(opts),
  };
  return { runHistory: wrapped, overwrittenStopped };
}

function createTrackedScheduler(): BrainScheduler & {
  activeKeys(): string[];
  fireAll(): void;
} {
  const schedules = new Map<string, () => void>();
  return {
    registerSchedule(key, _cron, tick) {
      schedules.set(key, tick);
    },
    unregisterByPrefix(prefix) {
      for (const key of Array.from(schedules.keys())) {
        if (key.startsWith(`${prefix}:`)) schedules.delete(key);
      }
    },
    clearAllSchedules() {
      schedules.clear();
    },
    activeKeys: () => [...schedules.keys()],
    fireAll() {
      for (const tick of Array.from(schedules.values())) tick();
    },
  };
}

function makeStandardBlueprints(): Map<EARS.EntityId, FlowBlueprint> {
  const subflowId = eid('Flow-Sub');
  const rootFlowId = eid('Flow-Root');

  const subflow: FlowBlueprint = {
    id: subflowId,
    label: 'Subflow',
    triggers: [
      {
        id: eid('Trig-SubEntry'),
        label: 'entry',
        triggerType: 'listener',
        eventType: 'flow.entry',
        stepIds: [eid('Step-SubWork')],
      },
    ],
    steps: {
      [eid('Step-SubWork')]: {
        id: eid('Step-SubWork'),
        label: 'sub-work',
        nodeType: 'action',
        delayMs: 15,
      },
    },
  };

  const rootFlow: FlowBlueprint = {
    id: rootFlowId,
    label: 'Root Flow',
    root: true,
    triggers: [
      {
        id: eid('Trig-Entry'),
        label: 'entry',
        triggerType: 'listener',
        eventType: 'flow.entry',
        stepIds: [eid('Step-KeepAlive')],
      },
      {
        id: eid('Trig-Work'),
        label: 'on work',
        triggerType: 'listener',
        eventType: 'work.requested',
        // Parallel steps: fast step + slow late-resolving step + subflow step!
        stepIds: [eid('Step-Fast'), eid('Step-SlowLate'), eid('Step-CallSub')],
      },
      {
        id: eid('Trig-Cron'),
        label: 'cron tick',
        triggerType: 'schedule',
        eventType: 'schedule.Trig-Cron',
        cronExpression: '*/5 * * * *',
        stepIds: [eid('Step-CronTask')],
      },
    ],
    steps: {
      [eid('Step-KeepAlive')]: {
        id: eid('Step-KeepAlive'),
        label: 'keep-alive',
        nodeType: 'keep-alive',
      },
      [eid('Step-Fast')]: {
        id: eid('Step-Fast'),
        label: 'fast-step',
        nodeType: 'action',
        delayMs: 5,
        nextStepId: eid('Step-AfterFast'),
      },
      [eid('Step-AfterFast')]: {
        id: eid('Step-AfterFast'),
        label: 'after-fast',
        nodeType: 'action',
        delayMs: 5,
      },
      [eid('Step-SlowLate')]: {
        id: eid('Step-SlowLate'),
        label: 'slow-late-step',
        nodeType: 'action',
        delayMs: 30,
        ignoreAbort: true,
      },
      [eid('Step-CallSub')]: {
        id: eid('Step-CallSub'),
        label: 'run-subflow',
        nodeType: 'subflow',
        subflowId,
        nextStepId: eid('Step-AfterSub'),
      },
      [eid('Step-AfterSub')]: {
        id: eid('Step-AfterSub'),
        label: 'after-subflow',
        nodeType: 'action',
        delayMs: 5,
      },
      [eid('Step-CronTask')]: {
        id: eid('Step-CronTask'),
        label: 'cron-task',
        nodeType: 'action',
        delayMs: 10,
      },
    },
  };

  return new Map([
    [rootFlowId, rootFlow],
    [subflowId, subflow],
  ]);
}

describe('Phase 2 #8 Spike — brain/be 3-level flattened DAG + real temp runHistory DB ordering harness', () => {
  it('100-seed sample against real temp LMDB runHistory: parallel steps, subflow, cron, late async step, PAUSE/RESUME, RESTART, KILL', async () => {
    // Real temp LMDB runHistory DB managed by `@apackdev/sdk/testing` (`_openTestRunHistory` + `_createRunHistory`)
    const baseHistory = testRunHistory();
    const flows = makeStandardBlueprints();

    const explored = await sample((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'brain'), onDefect: guard.onDefect });
      const { runHistory, overwrittenStopped } = auditedRunHistory(baseHistory);
      const scheduler = createTrackedScheduler();

      let brainHandleRef: Handle<unknown, BrainEvent, {}> | undefined;
      const cronLane = { label: 'cron-tick' };

      const { brainState } = createBrainMachines({
        runHistory,
        scheduler,
        getRootFlow: () => [...flows.values()].find((f) => f.root),
        getFlowById: (id) => flows.get(id),
        runStepWork: async (step: StepBlueprint, signal, sleep) => {
          if (step.ignoreAbort) {
            // Simulate a step whose underlying Promise resolves even after abort/kill
            return await schedule.work(`late:${step.label}`, { ok: true, step: step.label });
          }
          if (step.delayMs && step.delayMs > 0) {
            await sleep(step.delayMs);
          }
          if (signal.aborted) return undefined;
          if (step.shouldFail) throw new Error(`step ${step.label} failed`);
          return { ok: true, step: step.label };
        },
        emitBrainEvent: (event) => {
          schedule.later(cronLane, () => {
            if (brainHandleRef) sys.send(brainHandleRef, event);
          });
        },
      });

      const brainHandle = sys.start('default-setup/brain', brainState);
      brainHandleRef = brainHandle;

      const initialSnap = sys.read(brainHandle);
      const initialRootId = within(initialSnap, 'running') ? initialSnap.data.rootRunId : null;
      expect(initialRootId).not.toBeNull();

      const observedRootIds = new Set<RunNodeId>();
      if (initialRootId) observedRootIds.add(initialRootId);
      let sawRestartedRoot = false;
      let lastRestartedRootId: RunNodeId | null = null;

      const unsub = sys.subscribe(() => {
        const snap = sys.read(brainHandle);
        if (snap && within(snap, 'running') && snap.data.rootRunId) {
          observedRootIds.add(snap.data.rootRunId);
          if (initialRootId && snap.data.rootRunId !== initialRootId) {
            sawRestartedRoot = true;
            lastRestartedRootId = snap.data.rootRunId;
          }
        }
      });

      // Interleave parallel steps + subflow + cron + pause/resume + restart + kill
      schedule.does(
        'events-and-cron',
        ['fire work.requested', () => sys.send(brainHandle, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'work.requested', payload: { x: 1 } })],
        ['cron tick', () => scheduler.fireAll()],
        ['fire second work', () => sys.send(brainHandle, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'work.requested', payload: { x: 2 } })],
      );

      schedule.does(
        'pause-control',
        ['pause brain', () => sys.send(brainHandle, { type: 'PAUSE_BRAIN' })],
        ['resume brain', () => sys.send(brainHandle, { type: 'RESUME_BRAIN' })],
      );

      schedule.does(
        'lifecycle',
        ['restart brain', () => sys.send(brainHandle, { type: 'RESTART_BRAIN' })],
        ['kill brain', () => sys.send(brainHandle, { type: 'KILL_BRAIN' })],
      );

      return () => {
        try {
          unsub();
          const finalSnap = sys.read(brainHandle);
          expect(finalSnap.at).toBe('stopped');
          expect(sys.idle()).toBe(true);

          // Invariant 1: ZERO `'stopped'` RunNodes were ever overwritten by late async steps
          expect(overwrittenStopped).toEqual([]);

          // Invariant 2: ZERO leaked cron schedules remain after kill
          expect(scheduler.activeKeys()).toEqual([]);

          // Invariant 3: RESTART_BRAIN produced a brand-new rootRunId distinct from initialRootId
          expect(sawRestartedRoot).toBe(true);
          expect(lastRestartedRootId).not.toBeNull();
          expect(lastRestartedRootId).not.toBe(initialRootId);
          expect(observedRootIds.size).toBeGreaterThanOrEqual(2);

          // Verify in real LMDB runHistory DB: every node under both root sessions is terminal (never `'active'`)
          for (const rootId of observedRootIds) {
            const tree = runHistory.tree(rootId);
            expect(tree).toBeDefined();
            const stack = tree ? [tree] : [];
            while (stack.length > 0) {
              const node = stack.pop()!;
              expect(node.status).not.toBe('active');
              for (const c of node.children) stack.push(c);
            }
          }
          // Initial root specifically ended as `'stopped'` (not overwritten to `'completed'`)
          expect(runHistory.get(initialRootId!)?.status).toBe('stopped');
        } finally {
          unsub();
          sys.stop();
          guard.assertNone();
        }
      };
    }, { seed: 20260409, runs: 100 });

    expect(explored.failure).toBeUndefined();
    expect(explored.orderings).toBe(100);
  });

  it('everyOrder: late-resolving async step racing with KILL_BRAIN and RESTART_BRAIN never overwrites stopped RunNodes', async () => {
    const baseHistory = testRunHistory();
    const flows = makeStandardBlueprints();

    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'brain'), onDefect: guard.onDefect });
      const { runHistory, overwrittenStopped } = auditedRunHistory(baseHistory);
      const scheduler = createTrackedScheduler();

      let brainHandleRef: Handle<unknown, BrainEvent, {}> | undefined;
      const { brainState } = createBrainMachines({
        runHistory,
        scheduler,
        getRootFlow: () => [...flows.values()].find((f) => f.root),
        getFlowById: (id) => flows.get(id),
        runStepWork: async (step) => {
          if (step.ignoreAbort) {
            return await schedule.work(`late:${step.label}`, { done: true });
          }
          return { done: true };
        },
        emitBrainEvent: (ev) => {
          if (brainHandleRef) sys.send(brainHandleRef, ev);
        },
      });

      const handle = sys.start('default-setup/brain', brainState);
      brainHandleRef = handle;

      const firstSnap = sys.read(handle);
      const firstRootId = within(firstSnap, 'running') ? firstSnap.data.rootRunId! : null;
      expect(firstRootId).not.toBeNull();

      schedule.does(
        'driver',
        ['trigger work (spawns late async step + subflow)', () => sys.send(handle, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'work.requested' })],
        ['restart brain', () => sys.send(handle, { type: 'RESTART_BRAIN' })],
      );

      return async () => {
        try {
          const snap = sys.read(handle);
          expect(snap.at).toBe('running.active');
          expect(overwrittenStopped).toEqual([]);

          if (within(snap, 'running')) {
            const secondRootId = snap.data.rootRunId!;
            expect(secondRootId).not.toBe(firstRootId);
            // First root MUST be `'stopped'` and never overwritten
            expect(runHistory.get(firstRootId!)?.status).toBe('stopped');
            // Second root MUST be `'active'` (created AFTER stopActive ran!)
            expect(runHistory.get(secondRootId)?.status).toBe('active');
            // Only the second root's cron schedule is registered (first root's cleared!)
            expect(scheduler.activeKeys()).toEqual([`${secondRootId}:Trig-Cron`]);
          }

          sys.send(handle, { type: 'KILL_BRAIN' });
          // Flush microtask queue so cancelled keep-alive run promise settles
          await Promise.resolve();
          await Promise.resolve();
          expect(sys.read(handle).at).toBe('stopped');
          expect(scheduler.activeKeys()).toEqual([]);
          expect(overwrittenStopped).toEqual([]);
          expect(sys.idle()).toBe(true);
        } finally {
          sys.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });

  it('everyOrder: two parallel brain systems isolate PAUSE_BRAIN/RESUME_BRAIN with zero module-level globals', async () => {
    const sharedHistory = testRunHistory();
    const flows = makeStandardBlueprints();

    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const sysA = system({ side: 'backend', ...onSchedule(schedule, 'brainA'), onDefect: guard.onDefect });
      const sysB = system({ side: 'backend', ...onSchedule(schedule, 'brainB'), onDefect: guard.onDefect });
      const schedA = createTrackedScheduler();
      const schedB = createTrackedScheduler();

      const make = (runHistory: RunHistory, scheduler: BrainScheduler) =>
        createBrainMachines({
          runHistory,
          scheduler,
          getRootFlow: () => [...flows.values()].find((f) => f.root),
          getFlowById: (id) => flows.get(id),
          runStepWork: async (step) => ({ step: step.label }),
          emitBrainEvent: () => undefined,
        }).brainState;

      const handleA = sysA.start('default-setup/brain', make(sharedHistory, schedA));
      const handleB = sysB.start('default-setup/brain', make(sharedHistory, schedB));

      const rootA = sysA.read(handleA);
      const rootB = sysB.read(handleB);
      const rootIdA = within(rootA, 'running') ? rootA.data.rootRunId! : null;
      const rootIdB = within(rootB, 'running') ? rootB.data.rootRunId! : null;

      // Pause A on one lane while B runs concurrently on its own lane: proves zero global BRAIN_PAUSED bleed
      schedule.does(
        'brain-a',
        ['pause A', () => sysA.send(handleA, { type: 'PAUSE_BRAIN' })],
        ['send work to A (queued while paused)', () => sysA.send(handleA, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'work.requested' })],
        ['resume A (replays queued work)', () => sysA.send(handleA, { type: 'RESUME_BRAIN' })],
      );
      schedule.does(
        'brain-b',
        ['send work to B (must run unpaused!)', () => sysB.send(handleB, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'work.requested' })],
      );

      return async () => {
        try {
          expect(sysA.read(handleA).at).toBe('running.active');
          expect(sysB.read(handleB).at).toBe('running.active');

          // Both A (after resume) and B (immediately) ran the work event and completed the subflow + continuation step
          const treeA = sharedHistory.tree(rootIdA!)!;
          const treeB = sharedHistory.tree(rootIdB!)!;
          const labelsOf = (tree: ReturnType<RunHistory['tree']>) => {
            const out: string[] = [];
            const walk = (n: NonNullable<typeof tree>) => {
              out.push(`${n.label}:${n.status}`);
              for (const c of n.children) walk(c);
            };
            if (tree) walk(tree);
            return out;
          };
          expect(labelsOf(treeA)).toContain('after-subflow:completed');
          expect(labelsOf(treeB)).toContain('after-subflow:completed');

          sysA.send(handleA, { type: 'KILL_BRAIN' });
          sysB.send(handleB, { type: 'KILL_BRAIN' });
          await Promise.resolve();
          await Promise.resolve();
          expect(schedA.activeKeys()).toEqual([]);
          expect(schedB.activeKeys()).toEqual([]);
          expect(sysA.idle()).toBe(true);
          expect(sysB.idle()).toBe(true);
        } finally {
          sysA.stop();
          sysB.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });
});
