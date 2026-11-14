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
 *
 * A file also fails when it ends with a process it started running on out of the worker's reach
 * (`leftover-processes.ts`): the run would otherwise be green and the process would outlive it.
 */
import { Session } from 'node:inspector';
import { isMainThread } from 'node:worker_threads';
import { aroundAll, aroundEach, expect, inject, vi } from 'vitest';
import { IDLE_MS, cpuAdded, describeRefusal, describeTree, readTreeCpuMs, storageHold, unmetWaits, watchWork, type Watch, type WatchClock, type WorkReading } from '@apackdev/sdk/progress';
// What a config provides and a test declares to it are typed with the package's vitest entry, which packs import
import type { ProgressMeta } from './vitest.ts';
import { describeLeftovers, leftoversIn, listProcesses, type Leftover } from './leftover-processes.ts';

/**
 * The real clock and timers, taken as this module loads. A test that fakes timers (`vi.useFakeTimers`) replaces
 * `Date` and `setInterval` for as long as it runs, and a guard reading those would see no time pass and never find
 * the test stalled — a test that fakes timers and then hangs would run for ever.
 */
const realClock: WatchClock = { now: Date.now.bind(Date), every: setInterval, stopEvery: clearInterval };
const realTimeout = setTimeout;

const provided = <K extends 'apack.idleMs' | 'apack.testCpuMs'>(key: K): number | undefined => {
  try { return inject(key); } catch { return undefined; }
};

const idleMs = provided('apack.idleMs') ?? IDLE_MS;

/**
 * **`expect.poll`'s default is this guard's stall window, not Vitest's one second.** A poll cannot turn its clock off,
 * and what one waits for is mostly work in this process and what it starts (`git` above all), which a busy machine
 * makes late and never stops: a second failed git-backed cases under `npm run stress`. A poll spends its timeout only
 * when it never succeeds, so this costs a failing case time and a passing one nothing; a call that names its own
 * `timeout` keeps it, and a poll asserting that something stays put names a short one.
 *
 * Set here because every config loads this file, which `suite-timeouts.spec.ts` holds them to, so host and pack suites
 * have one owner for it. `setConfig` replaces the config's whole `expect`, which is why that spec also refuses a config
 * declaring `expect` options of its own: they would be dropped here without a word.
 */
vi.setConfig({ expect: { poll: { timeout: idleMs } } });
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
/**
 * The readings this guard has started and not seen end: each runs a `ps` as a child of this worker.
 *
 * **Waited for before the file's last hook ends, because a reading outliving its worker is a leftover.** A pool of
 * processes ends a file's worker with it, and a `ps` the worker started and was still running is then reparented with
 * its parent gone and its group the pool's — what the next file's leftover check is for, so a file running beside
 * this one was failed for the guard's own reading. A busy machine slows `ps`, which is when it happened
 */
const readings = new Set<Promise<unknown>>();
function tracked<T>(reading: Promise<T>): Promise<T> {
  readings.add(reading);
  void reading.finally(() => readings.delete(reading)).catch(() => {});
  return reading;
}

function workerWork(): WorkReading & { now(): number } {
  const ownAtStart = process.cpuUsage();
  let lastChildren: ReadonlyMap<number, number> | undefined;
  let childrenMs = 0;
  const now = () => {
    const own = process.cpuUsage(ownAtStart);
    return (own.user + own.system) / 1000 + childrenMs;
  };
  return Object.assign(async () => {
    const tree = await tracked(readTreeCpuMs(process.pid));
    if (tree !== undefined) {
      const children = new Map([...tree].filter(([pid]) => pid !== process.pid));
      // The first reading is the baseline: a child a hook left running did its earlier work for the hook
      if (lastChildren !== undefined) childrenMs += cpuAdded(lastChildren, children);
      lastChildren = children;
    }
    return now();
  // A worker waiting on a disk is slow and not stuck, as any tree is (`storageHold`)
  }, { now, held: () => tracked(storageHold(process.pid)) });
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
    // The worker's own CPU is counted from here (`workerWork`), and a test may hold this timer off for as long as
    // it works synchronously: its first reading is work, not a baseline
    work, idleMs, clock: realClock, ceilingMs: alone?.budgetMs, countsFromWatch: true,
    onRefused: (refusal) => {
      const together = running.length > 1 ? `, with ${running.length - 1} other test${running.length > 2 ? 's' : ''} running beside it` : '';
      const why = refusal.kind === 'stalled'
        ? `stalled: its worker's process tree used no CPU for ${idleMs / 1000}s${together}${refusal.held === undefined ? ''
          : `, after ${Math.round(refusal.held.ms / 1000)}s of waiting on storage that was allowed for (${refusal.held.by})`}. Inspect what it was waiting on; a test that is only slow is never failed for it.`
        : `${describeRefusal(refusal)}. A loop that spins reads as CPU close to its wall time.`;
      const fail = (found = '') => { for (const each of running) each.fail(new Error(`${each.what} ${why}${found}`)); };
      if (refusal.kind !== 'stalled') return fail();
      // What it was waiting on, read before the test is failed and its processes are stopped by its teardown
      void whatWasWaiting().then(fail, () => fail());
    },
  });
  watching = { watch, work };
}

/**
 * Where this worker's own CPU went, sampled for as long as it has run, under `APACK_STALL_PROFILE=1`: for a test
 * that works for minutes and then stops, where what it was waiting on at the end says nothing of what it did
 * before. Off unless asked for, since a sampler in every worker of every run is a cost nothing has measured.
 */
const profiler = process.env.APACK_STALL_PROFILE === '1' ? (() => {
  const session = new Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.setSamplingInterval', { interval: 10_000 });
  session.post('Profiler.start');
  return session;
})() : undefined;

interface ProfileNode { callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; id: number; children?: number[] }

/** The functions this worker spent the most time in itself, and the callers it spent the most time under */
function whereTheCpuWent(): Promise<string> {
  if (profiler === undefined) return Promise.resolve('');
  return new Promise((resolve) => {
    profiler.post('Profiler.stop', (error, result) => {
      profiler.post('Profiler.start');
      if (error || !result) return resolve('');
      const nodes = result.profile.nodes as ProfileNode[];
      const name = (node: ProfileNode) => `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.replace(/^.*\/(packages|node_modules)\//, '$1/')}:${node.callFrame.lineNumber + 1}`;
      const total = nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0) || 1;
      const self = new Map<string, number>();
      for (const node of nodes) self.set(name(node), (self.get(name(node)) ?? 0) + (node.hitCount ?? 0));
      // What each function spent with everything it called, which names the work rather than its innermost loop
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const within = new Map<string, number>();
      const inclusive = (node: ProfileNode, seen: Set<string>): number => {
        const mine = name(node);
        const fresh = !seen.has(mine);
        if (fresh) seen.add(mine);
        let hits = node.hitCount ?? 0;
        for (const child of node.children ?? []) hits += inclusive(byId.get(child)!, seen);
        if (fresh) { within.set(mine, (within.get(mine) ?? 0) + hits); seen.delete(mine); }
        return hits;
      };
      if (nodes[0]) inclusive(nodes[0], new Set());
      const top = (counts: Map<string, number>, skip: (key: string) => boolean) => [...counts].filter(([key]) => !skip(key))
        .sort((a, b) => b[1] - a[1]).slice(0, 14).map(([key, hits]) => `  ${(100 * hits / total).toFixed(1).padStart(5)}%  ${key}`).join('\n');
      resolve(`Where this worker's own CPU went (${total} samples):\n${top(self, () => false)}\nand under which calls of this repository's:\n${
        top(within, (key) => !key.includes(' packages/'))}\n`);
    });
  });
}

/**
 * What a worker that stopped working was waiting on, as far as anything here can say: the waits its test had not
 * met (`settles`), what its event loop was holding open, and the state of each process it started.
 *
 * **Because "used no CPU" is three different failures.** A process waiting on a disk, a file event that never
 * arrived and a child that hung all spend nothing, and a report that stops there sends whoever reads it to rerun
 * the suite and hope. Each of these lines is one of them ruled in or out without a rerun.
 */
async function whatWasWaiting(): Promise<string> {
  const waits = unmetWaits(realClock.now());
  const held = new Map<string, number>();
  for (const resource of process.getActiveResourcesInfo()) held.set(resource, (held.get(resource) ?? 0) + 1);
  const tree = await describeTree(process.pid);
  const spent = await whereTheCpuWent();
  return [
    '',
    waits.length > 0 ? `Still waiting for:\n${waits.map((wait) => `  ${wait}`).join('\n')}` : 'No wait of its own was unmet (`settles`): it was awaiting something that never answered.',
    `Its event loop held: ${[...held].map(([resource, count]) => `${count} ${resource}`).join(', ') || 'nothing'}`,
    tree ?? 'Its process tree could not be listed.',
    spent,
  ].join('\n');
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

/**
 * How long a process still running when its file ends is given to go, in looks further and further apart. A spec
 * that signals its child and does not wait for the exit, and a helper that ends itself when its fixture is deleted,
 * are both on their way out, and a busy machine only makes that slower. Nothing reports a process that is not this
 * one's child exiting, so the listing is read again; a file that leaves nothing takes one listing and waits for none.
 */
const LEFTOVER_LOOKS_MS = [50, 100, 200, 400, 800, 1_600, 1_850];

/** The processes a worker has already failed a file for, so a later file in the same worker is not failed for them */
const reported: Set<number> = ((globalThis as { apackReportedLeftovers?: Set<number> }).apackReportedLeftovers ??= new Set());

/** What this worker's file left running, once it has had the time to go */
async function leftBehind(since: number): Promise<Leftover[]> {
  // A pool of threads runs every file in one process, whose descendants are every file's
  if (!isMainThread) return [];
  for (const waitMs of [0, ...LEFTOVER_LOOKS_MS]) {
    if (waitMs > 0) await new Promise((resolve) => { realTimeout(resolve, waitMs); });
    const rows = await listProcesses();
    if (!rows) return [];
    const left = leftoversIn(rows, process.pid, since).filter(({ process: each }) => !reported.has(each.pid));
    if (left.length === 0) return [];
    if (waitMs === LEFTOVER_LOOKS_MS.at(-1)) return left;
  }
  return [];
}

aroundAll(async (runSuite) => {
  const file = fileName();
  const startedAt = realClock.now();
  try {
    await watch('hooks', `${file} (its beforeAll, afterAll and the time between tests)`, undefined, async () => {
      await runSuite();
      const left = await leftBehind(startedAt);
      if (left.length === 0) return;
      for (const { process: each } of left) reported.add(each.pid);
      throw new Error(await describeLeftovers(file, left));
    });
  } finally {
    // Nothing is judged any more, so no reading starts after these: the worker may now end without leaving one
    await Promise.allSettled(readings);
  }
});

aroundEach(async (runTest, context) => {
  const meta = context.task.meta as ProgressMeta;
  const budget = meta.cpuBudgetMs ?? defaultBudgetMs;
  await watch('test', `"${context.task.name}"`, budget, async () => { await runTest(); }, (entry, spentMs) => {
    // A shared test's spend is its siblings' too, so it records none rather than one a reporter would misread
    if (!entry.shared) meta.cpuMs = Math.round(spentMs);
  });
});
