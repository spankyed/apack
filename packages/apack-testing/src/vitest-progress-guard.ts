/**
 * A vitest setup file: a test, or a file's hooks, fails when it stops making progress, never because the clock ran.
 *
 * A busy machine makes a test slow and never stuck, so a deadline measured on the clock fails healthy tests for the
 * load they ran under. This watches the worker's process tree instead — the worker and everything it started — with
 * the same reading `boundedSpawn` and `runCommand` take, and fails what is running when that tree goes `IDLE_MS`
 * without CPU. A test that spins is the other hang, and it fails when its tree has spent its CPU budget: the test's
 * `meta: cpuBudget(ms)`, or the config's `apack.testCpuMs`. Under `APACK_CEILING=off` (the Linux test container, whose
 * VM counts the host's load as its own CPU) only the stall is judged.
 *
 * `aroundEach` holds a test with its `beforeEach` and `afterEach`; `aroundAll` holds a file's `beforeAll`,
 * `afterAll` and the time between its tests. One reading serves both, and while a test runs only it is judged, so a
 * stalled test fails as itself and not as its file. Tests running together (`test.concurrent`) are judged as one:
 * their stall fails them all, and their CPU is theirs together, so none of them is held to a budget of its own.
 *
 * What it cannot see is a worker blocked in synchronous code, whose timers never run: vitest's own RPC window
 * reports that one, and the step that started the pool bounds it by its process tree.
 */
import { aroundAll, aroundEach, expect, inject } from 'vitest';
import { IDLE_MS, cpuAdded, createStallTracker, readTreeCpuMs } from '@apackdev/host/build/process-progress';
// What a config provides and a test declares to it are typed with the package's vitest entry, which packs import
import type { ProgressMeta } from './vitest.ts';

interface Watch {
  readonly what: string;
  readonly budgetMs: number | undefined;
  readonly startedAt: number;
  /** The worker's own CPU when it started, exact: `process.cpuUsage` costs nothing, where `ps` costs a process */
  readonly ownAtStart: NodeJS.CpuUsage;
  /** What the processes it started have spent, from the readings: a lower bound, a short-lived child being unseen */
  childrenMs: number;
  /**
   * Set once another test ran beside this one (`test.concurrent`): the worker's CPU is then theirs together and
   * cannot be split, so this one has no budget to be held to and records no spend, and only their stall is judged
   */
  shared: boolean;
  readonly fail: (error: Error) => void;
}

/** What a watch has spent: the worker's own CPU since it started, and its children's */
function spentMs(watch: Watch): number {
  const own = process.cpuUsage(watch.ownAtStart);
  return (own.user + own.system) / 1000 + watch.childrenMs;
}

/**
 * The real clock and timers, taken as this module loads. A test that fakes timers (`vi.useFakeTimers`) replaces
 * `Date` and `setInterval` for as long as it runs, and a guard reading those would see no time pass and never find
 * the test stalled — a test that fakes timers and then hangs would run for ever.
 */
const now = Date.now.bind(Date);
const every = setInterval;
const stopEvery = clearInterval;

const provided = <K extends 'apack.idleMs' | 'apack.testCpuMs'>(key: K): number | undefined => {
  try { return inject(key); } catch { return undefined; }
};

const idleMs = provided('apack.idleMs') ?? IDLE_MS;
const defaultBudgetMs = provided('apack.testCpuMs');
const ceiling = process.env.APACK_CEILING !== 'off';

/**
 * What is running, in two kinds. A file's hooks nest, so they are a stack and the innermost is judged. Tests do not
 * nest but may run together, so they are a group judged as one: the tree stalling stalls all of them, since none of
 * them is doing anything. Whichever is judged has the one tracker, made afresh whenever what is judged changes, since
 * the quiet before it was something else's.
 */
const hooks: Watch[] = [];
const tests = new Set<Watch>();
let tracker = createStallTracker(idleMs, now());
let lastChildren: ReadonlyMap<number, number> = new Map();
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
/** Bumped whenever what is judged changes, so a reading taken across a change is dropped rather than misattributed */
let generation = 0;

const judged = (): readonly Watch[] => (tests.size > 0 ? [...tests] : hooks.slice(-1));

function judgeAfresh(): void {
  generation += 1;
  tracker = createStallTracker(idleMs, now());
}

function sample(): void {
  if (reading || judged().length === 0) return;
  reading = true;
  const taken = generation;
  void readTreeCpuMs(process.pid).then((tree) => {
    reading = false;
    if (tree === undefined || taken !== generation) return;
    const at = now();
    const children = new Map([...tree].filter(([pid]) => pid !== process.pid));
    const added = cpuAdded(lastChildren, children);
    lastChildren = children;
    const watches = judged();
    for (const each of watches) each.childrenMs += added;
    if (tracker.reading(tree, at)) {
      const together = watches.length > 1 ? `, with ${watches.length - 1} other test${watches.length > 2 ? 's' : ''} running beside it` : '';
      for (const each of watches) {
        each.fail(new Error(`${each.what} stalled: its worker's process tree used no CPU for ${idleMs / 1000}s${together}. `
          + 'Inspect what it was waiting on; a test that is only slow is never failed for it.'));
      }
      return;
    }
    if (!ceiling) return;
    for (const each of watches) {
      if (each.shared || each.budgetMs === undefined || spentMs(each) < each.budgetMs) continue;
      each.fail(new Error(`${each.what} spent its ${each.budgetMs / 1000}s CPU budget: `
        + `${Math.round(spentMs(each) / 1000)}s of CPU in ${Math.round((at - each.startedAt) / 1000)}s of wall time. `
        + 'A loop that spins reads as CPU close to its wall time.'));
    }
  });
}

function watch(kind: 'hooks' | 'test', what: string, budgetMs: number | undefined, run: () => Promise<unknown>,
  ended?: (entry: Watch) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      settled = true;
      ended?.(entry);
      if (kind === 'test') tests.delete(entry);
      else hooks.splice(hooks.indexOf(entry), 1);
      judgeAfresh();
      if (tests.size === 0 && hooks.length === 0 && timer !== undefined) { stopEvery(timer); timer = undefined; }
    };
    const entry: Watch = {
      what, budgetMs, startedAt: now(), ownAtStart: process.cpuUsage(), childrenMs: 0, shared: false,
      fail: (error) => { if (!settled) { leave(); reject(error); } },
    };
    if (kind === 'test') {
      if (tests.size > 0) { entry.shared = true; for (const other of tests) other.shared = true; }
      tests.add(entry);
    } else {
      hooks.push(entry);
    }
    judgeAfresh();
    if (timer === undefined) {
      timer = every(sample, Math.min(5_000, idleMs / 4));
      timer.unref();
    }
    run().then(
      () => { if (!settled) { leave(); resolve(); } },
      (error: unknown) => { if (!settled) { leave(); reject(error); } },
    );
  });
}

const fileName = (): string => expect.getState().testPath ?? 'this file';

aroundAll(async (runSuite) => {
  await watch('hooks', `${fileName()} (its beforeAll, afterAll and the time between tests)`, undefined, async () => { await runSuite(); });
});

aroundEach(async (runTest, context) => {
  const meta = context.task.meta as ProgressMeta;
  const budget = meta.cpuBudgetMs ?? defaultBudgetMs;
  await watch('test', `"${context.task.name}"`, budget, async () => { await runTest(); }, (entry) => {
    // A shared test's spend is its siblings' too, so it records none rather than one a reporter would misread
    if (!entry.shared) meta.cpuMs = Math.round(spentMs(entry));
  });
});
