/**
 * A vitest setup file: a test, or a file's hooks, fails when it stops making progress, never because the clock ran.
 *
 * A busy machine makes a test slow and never stuck, so a deadline measured on the clock fails healthy tests for the
 * load they ran under. This watches the worker's process tree instead — the worker and everything it started — with
 * the same reading `boundedSpawn` and `runCommand` take, and fails what is running when that tree goes `IDLE_MS`
 * without CPU. A test that spins is the other hang, and it fails when its tree has spent its CPU budget: the test's
 * `meta: cpuBudget(ms)`, or the config's `apack.testCpuMs`. Under `APACK_CEILING=loose` (the Linux test container, whose
 * VM counts the host's load as its own CPU) that budget is held at ten times its size.
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
import { IDLE_MS, cpuAdded, describeRefusal, readTreeCpuMs, watchWork, type Watch, type WatchClock, type WorkReading } from '@apackdev/sdk/progress';
// What a config provides and a test declares to it are typed with the package's vitest entry, which packs import
import type { ProgressMeta } from './vitest.ts';

/**
 * The real clock and timers, taken as this module loads. A test that fakes timers (`vi.useFakeTimers`) replaces
 * `Date` and `setInterval` for as long as it runs, and a guard reading those would see no time pass and never find
 * the test stalled — a test that fakes timers and then hangs would run for ever.
 */
const realClock: WatchClock = { now: Date.now.bind(Date), every: setInterval, stopEvery: clearInterval };

const provided = <K extends 'apack.idleMs' | 'apack.testCpuMs'>(key: K): number | undefined => {
  try { return inject(key); } catch { return undefined; }
};

const idleMs = provided('apack.idleMs') ?? IDLE_MS;
const defaultBudgetMs = provided('apack.testCpuMs');

interface Running {
  readonly what: string;
  readonly budgetMs: number | undefined;
  /**
   * Set once another test ran beside this one (`test.concurrent`): the worker's CPU is then theirs together and
   * cannot be split, so this one has no budget to be held to and records no spend, and only their stall is judged
   */
  shared: boolean;
  readonly fail: (error: Error) => void;
}

/**
 * The worker's work from now: its own CPU, exact and free (`process.cpuUsage`), and what the processes it started
 * have spent, from `ps`. `now()` is what it has read so far, which a test that ends between two readings is told.
 */
function workerWork(): WorkReading & { now(): number } {
  const ownAtStart = process.cpuUsage();
  let lastChildren: ReadonlyMap<number, number> | undefined;
  let childrenMs = 0;
  const now = () => {
    const own = process.cpuUsage(ownAtStart);
    return (own.user + own.system) / 1000 + childrenMs;
  };
  return Object.assign(async () => {
    const tree = await readTreeCpuMs(process.pid);
    if (tree !== undefined) {
      const children = new Map([...tree].filter(([pid]) => pid !== process.pid));
      // The first reading is the baseline: a child a hook left running did its earlier work for the hook
      if (lastChildren !== undefined) childrenMs += cpuAdded(lastChildren, children);
      lastChildren = children;
    }
    return now();
  }, { now });
}

/**
 * What is running, in two kinds. A file's hooks nest, so they are a stack and the innermost is judged. Tests do not
 * nest but may run together, so they are a group judged as one: the tree stalling stalls all of them, since none of
 * them is doing anything. Whatever is judged has one watch, made afresh whenever what is judged changes, since the
 * quiet before it was something else's.
 */
const hooks: Running[] = [];
const tests = new Set<Running>();
let watching: { watch: Watch; work: ReturnType<typeof workerWork> } | undefined;

const judged = (): readonly Running[] => (tests.size > 0 ? [...tests] : hooks.slice(-1));

function judgeAfresh(): void {
  watching?.watch.stop();
  const running = judged();
  if (running.length === 0) { watching = undefined; return; }
  const alone = running.length === 1 && !running[0]!.shared ? running[0] : undefined;
  const work = workerWork();
  const watch = watchWork({
    // `watchWork` loosens the ceiling under APACK_CEILING=loose, as it does for every bound
    work, idleMs, clock: realClock, ceilingMs: alone?.budgetMs,
    onRefused: (refusal) => {
      const together = running.length > 1 ? `, with ${running.length - 1} other test${running.length > 2 ? 's' : ''} running beside it` : '';
      const why = refusal.kind === 'stalled'
        ? `stalled: its worker's process tree used no CPU for ${idleMs / 1000}s${together}. Inspect what it was waiting on; a test that is only slow is never failed for it.`
        : `${describeRefusal(refusal)}. A loop that spins reads as CPU close to its wall time.`;
      for (const each of running) each.fail(new Error(`${each.what} ${why}`));
    },
  });
  watching = { watch, work };
}

function watch(kind: 'hooks' | 'test', what: string, budgetMs: number | undefined, run: () => Promise<unknown>,
  ended?: (entry: Running, spentMs: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      settled = true;
      ended?.(entry, watching?.work.now() ?? 0);
      if (kind === 'test') tests.delete(entry);
      else hooks.splice(hooks.indexOf(entry), 1);
      judgeAfresh();
    };
    const entry: Running = {
      what, budgetMs, shared: false,
      fail: (error) => { if (!settled) { leave(); reject(error); } },
    };
    if (kind === 'test') {
      if (tests.size > 0) { entry.shared = true; for (const other of tests) other.shared = true; }
      tests.add(entry);
    } else {
      hooks.push(entry);
    }
    judgeAfresh();
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
  await watch('test', `"${context.task.name}"`, budget, async () => { await runTest(); }, (entry, spentMs) => {
    // A shared test's spend is its siblings' too, so it records none rather than one a reporter would misread
    if (!entry.shared) meta.cpuMs = Math.round(spentMs);
  });
});
