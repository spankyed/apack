// Whether a process tree is still working: the CPU it adds and the output it writes, for whatever bounds a process by
// its progress rather than a clock (`scripts/lib/bounded-spawn.ts`, `apack-cli/tests/_support/run-command.ts`, and pack
// code waiting on a process it started). A starved process is slow and still working, and a budget that measures the
// clock kills it for the machine being busy, which is why the ceiling counts CPU time where a tree can be read.
//
// Node-only: it lists processes with `ps`, or PowerShell on Windows. The chain's own runner imports this file by path,
// since it runs before any package is built and `@apackdev/sdk` resolves to `dist` outside a host build.
import { execFile, execFileSync, type ChildProcess, type ExecFileOptions } from 'node:child_process';
import threads, { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

/**
 * How long a process tree may go without CPU or output before whatever watches it ends it as stalled: one number
 * for every watcher — `boundedSpawn`, `runCommand` and the vitest progress guard — so a stall means the same at
 * every layer.
 */
export const IDLE_MS = 120_000;

/**
 * How much CPU a tree has to add to count as working. Not any increase: an idle Node process still runs its
 * timers, and macOS reports CPU to the hundredth of a second, so a tree wedged on a lock with one
 * `setInterval` in it would read as progressing for ever. A second of CPU is ten seconds at a tenth of a
 * core, which a starved compiler clears and a wedged one does not.
 */
const PROGRESS_CPU_MS = 1_000;

/** `[[dd-]hh:]mm:ss[.ss]`, which is `ps -o time` on both macOS and Linux, in milliseconds */
export function parseCpuTime(text: string): number {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  const seconds = clock!.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round((Number(days) * 86_400 + seconds) * 1000);
}

/** One process in a listing of every process: its parent, its group and the CPU it has spent */
export interface ProcessRow { readonly pid: number; readonly ppid: number; readonly pgid: number; readonly ms: number }

/** The rows of `ps -A -o pid=,ppid=,pgid=,time=` */
const psRows = (listing: string): ProcessRow[] => listing.trim().split('\n').map((line) => line.trim().split(/\s+/))
  .filter((row) => row.length === 4)
  .map(([pid, ppid, pgid, time]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), ms: parseCpuTime(time!) }));

/**
 * The rows of `WIN32_PROCESSES`: `pid ppid cpu`, the CPU in the 100ns units Windows counts in. Windows has no
 * process groups, so each process is its own, and a tree is its root and the root's descendants.
 */
export const win32Rows = (listing: string): ProcessRow[] => listing.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/))
  .filter((row) => row.length === 3 && row.every((field) => /^\d+$/.test(field)))
  .map(([pid, ppid, cpu]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pid), ms: Math.round(Number(cpu) / 10_000) }));

/**
 * The CPU time of each process in the tree rooted at `leader`'s process group, from one `ps` listing
 * (`pid ppid pgid time`).
 *
 * The group and every descendant of a member, because a group is not a tree: Playwright starts Electron in a
 * group of its own, so a test run whose runner only waits does its work outside the group it was spawned in.
 * A process reparented to init on its parent's exit is outside both, and the group-kill reaches it anyway.
 */
export function treeCpuMs(listing: string, leader: number): Map<number, number> {
  return treeOf(psRows(listing), leader);
}

function treeOf(rows: readonly ProcessRow[], leader: number): Map<number, number> {
  // The leader itself too, for a root that leads no group of its own: a vitest worker, which its pool started
  const members = new Set(rows.filter((row) => row.pgid === leader || row.pid === leader).map((row) => row.pid));
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (!members.has(row.pid) && members.has(row.ppid)) { members.add(row.pid); grew = true; }
    }
  }
  return new Map(rows.filter((row) => members.has(row.pid)).map((row) => [row.pid, row.ms]));
}

/**
 * The CPU a tree spent between two readings: what each process added, a new one's whole time included.
 *
 * Per process, never the difference of two totals. A process that exits takes its time out of the total, so a
 * tree that keeps starting short builds — a test pool does — reads lower after each one ends, and a total
 * compared with an earlier one says it has done nothing while it works flat out.
 */
export function cpuAdded(before: ReadonlyMap<number, number>, after: ReadonlyMap<number, number>): number {
  let added = 0;
  for (const [pid, ms] of after) added += Math.max(0, ms - (before.get(pid) ?? 0));
  return added;
}

/**
 * Whether a tree has stalled, from its readings and its output, with the times given rather than read: the
 * watchdog's whole decision, so it is tested over made-up readings and no clock. What a tree has spent is
 * `watchWork`'s, which owns the one definition of it.
 */
export function createStallTracker(idleMs: number, startedAt: number) {
  let last: ReadonlyMap<number, number> | undefined;
  let work = 0;
  let progressAt = startedAt;
  return {
    output(at: number): void { progressAt = at; },
    /** Records a reading and answers whether the tree has now gone `idleMs` without progress */
    reading(now: ReadonlyMap<number, number>, at: number): boolean {
      // The first reading is only the baseline, so a tree has to keep working to count as working
      if (last !== undefined) work += cpuAdded(last, now);
      last = now;
      if (work >= PROGRESS_CPU_MS) {
        work = 0;
        progressAt = at;
        return false;
      }
      return at - progressAt >= idleMs;
    },
  };
}

/** Every process's id, parent and CPU on Windows, which has no `ps`: one line each, `pid ppid cpu` */
const WIN32_PROCESSES = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.UserModeTime + $_.KernelModeTime)" }';

/**
 * How long one listing of every process answers every reading taken in this process. A listing describes the whole
 * machine, so watchers reading at once need only one, which matters where taking one means starting PowerShell.
 */
const LISTING_REUSE_MS = 1_000;

/** The real clock, held before a spec's fake timers could replace it: a listing reused for ever is no reading */
const realNow = Date.now.bind(Date);

let latest: { readonly at: number; readonly rows: Promise<ProcessRow[] | undefined> } | undefined;

/** Every process on the machine, or nothing where no listing could be taken */
function listProcesses(): Promise<ProcessRow[] | undefined> {
  const at = realNow();
  if (latest !== undefined && at - latest.at < LISTING_REUSE_MS) return latest.rows;
  const rows = new Promise<ProcessRow[] | undefined>((resolve) => {
    execFile(LISTING.file, [...LISTING.args], LISTING.options, (error, stdout) => {
      resolve(error ? undefined : LISTING.parse(stdout));
    });
  });
  latest = { at, rows };
  return rows;
}

/** How this platform lists every process, and how the listing reads */
const LISTING: {
  readonly file: string; readonly args: readonly string[]; readonly parse: (listing: string) => ProcessRow[];
  readonly options: { readonly maxBuffer: number; readonly windowsHide: boolean; readonly encoding: 'utf8' };
} = {
  ...(process.platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WIN32_PROCESSES], parse: win32Rows }
    : { file: 'ps', args: ['-A', '-o', 'pid=,ppid=,pgid=,time='], parse: psRows }),
  options: { maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
};

/**
 * One reading of the tree's CPU taken synchronously, for a caller that cannot await: a wait inside a synchronous
 * function, which then decides with `createStallTracker` as `watchWork` does. Nothing where no listing could be taken.
 */
export function readTreeCpuMsSync(leader: number): Map<number, number> | undefined {
  try {
    return treeOf(LISTING.parse(execFileSync(LISTING.file, [...LISTING.args], LISTING.options)), leader);
  } catch {
    return undefined;
  }
}

/** One reading of the tree's CPU, or nothing when no listing could be taken */
export const readTreeCpuMs = async (leader: number): Promise<Map<number, number> | undefined> => {
  const rows = await listProcesses();
  return rows === undefined ? undefined : treeOf(rows, leader);
};

/**
 * How much work a party has done since the reading began, in milliseconds of CPU, or nothing where it cannot be
 * read. Where it begins is the reading's to say: `processWork` over a child just spawned counts from its start, and
 * `fromNow` makes any reading count from its first, for a party that was running before anyone watched it.
 */
export type WorkReading = () => Promise<number | undefined>;

/** A reading that counts from its own first value: what a party does under the watch, not over its lifetime */
export function fromNow(work: WorkReading): WorkReading {
  let first: number | undefined;
  return async () => {
    const total = await work();
    if (total === undefined) return undefined;
    first ??= total;
    return total - first;
  };
}

/**
 * A process tree's work, from the readings the watchdog takes: what each process in it added, summed over every
 * reading, so a process that exits keeps the work it did (`cpuAdded`). Nothing where `ps` gives no reading.
 */
export function processWork(pid: number, read: typeof readTreeCpuMs = readTreeCpuMs): WorkReading {
  let last = new Map<number, number>();
  let total = 0;
  return async () => {
    const tree = await read(pid);
    if (tree === undefined) return undefined;
    total += cpuAdded(last, tree);
    last = tree;
    return total;
  };
}

/**
 * A worker thread's work: its own CPU, which a thread sharing its process's pid can't be read for any other way.
 * `Worker.cpuUsage` is newer than the Node types this repo compiles against, so it is reached as optional, and a
 * runtime without it reads as nothing, which bounds the wait by silence.
 */
export function threadWork(worker: object): WorkReading {
  const usage = (worker as { cpuUsage?: () => Promise<{ user: number; system: number }> }).cpuUsage?.bind(worker);
  // A thread's usage is its lifetime's, and it was running before the watch
  return fromNow(async () => {
    if (usage === undefined) return undefined;
    try {
      const { user, system } = await usage();
      return (user + system) / 1000;
    } catch {
      // A thread that has exited has no usage to read, and its exit is what its waiter hears instead
      return undefined;
    }
  });
}

/** Why a watch gave up on the party it watched, for the caller to word: `describeRefusal` is the common wording */
export type Refusal =
  | { readonly kind: 'stalled'; readonly idleMs: number }
  | { readonly kind: 'ceiling'; readonly ceilingMs: number; readonly spentMs: number; readonly wallMs: number;
      /** How long since the party's last output: `null` if it never wrote any, absent where output is not watched */
      readonly sinceOutputMs?: number | null }
  | { readonly kind: 'clock'; readonly fallbackMs: number };

/** Whole seconds, and tenths below ten, where a whole second would round a short bound to nothing */
const seconds = (ms: number): string => `${ms < 10_000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000)}s`;

/**
 * A refusal as the end of a sentence about the party — "it did no work for 120s". A ceiling says what was spent
 * against how long it took, so a spin reads as one at a glance: CPU close to its wall time and no recent output.
 */
export function describeRefusal(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'stalled': return `did no work for ${seconds(refusal.idleMs)}`;
    case 'clock': return `ran past ${seconds(refusal.fallbackMs)} on the clock, its work unreadable`;
    case 'ceiling': {
      const quiet = refusal.sinceOutputMs === undefined ? ''
        : refusal.sinceOutputMs === null ? ', with no output at all' : `, its last output ${seconds(refusal.sinceOutputMs)} ago`;
      return `spent its ${seconds(refusal.ceilingMs)} CPU budget: ${seconds(refusal.spentMs)} of CPU in ${seconds(refusal.wallMs)} of wall time${quiet}`;
    }
  }
}

/** The time and timers a watch runs on: the process's own, unless a caller holds the real ones apart from fakes */
export interface WatchClock {
  now(): number;
  every(run: () => void, ms: number): ReturnType<typeof setInterval>;
  stopEvery(timer: ReturnType<typeof setInterval>): void;
}

const processClock: WatchClock = { now: () => Date.now(), every: (run, ms) => setInterval(run, ms), stopEvery: (timer) => clearInterval(timer) };

/** A running watch: stop it when the work is done, and tell it when the party writes output, which is progress too */
export interface Watch {
  stop(): void;
  output(): void;
  /** What the party has spent, as its reading counts it: a lower bound, a short-lived process being unseen */
  spentMs(): number;
}

/**
 * Watches another party's work and says when it should be given up on: when its work stops growing for `idleMs` —
 * the stall decision (`createStallTracker`) — or when it has spent `ceilingMs` of CPU since the watch began, which
 * only a loop that spins reaches. Every bound in the repo that would otherwise end work on a fixed time is one of
 * these: `boundedSpawn`'s, `runCommand`'s, the vitest progress guard's, and the waits below.
 *
 * Spent is the reading's own count (`WorkReading`), so a party watched after it started is held to what it does
 * under the watch by a reading that says so (`fromNow`). A reading that cannot be taken repeats the last
 * one that could, so it adds no work: a party nothing can read is still bounded by `idleMs` of silence, and a
 * failed reading between two good ones cannot pass off the whole total as new work. Where readings cannot be taken
 * at all — a system with neither `ps` nor PowerShell — `fallbackMs` is the bound on the clock from the first one that failed.
 */
export function watchWork({ work, idleMs = IDLE_MS, ceilingMs, fallbackMs, onRefused, watchesOutput = false, clock = processClock }: {
  readonly work: WorkReading; readonly idleMs?: number; readonly ceilingMs?: number; readonly fallbackMs?: number;
  readonly onRefused: (refusal: Refusal) => void;
  /** Whether the caller reports the party's output (`output()`), so a refusal can say how long it has been silent */
  readonly watchesOutput?: boolean;
  readonly clock?: WatchClock;
}): Watch {
  const startedAt = clock.now();
  const tracker = createStallTracker(idleMs, startedAt);
  let lastTotal: number | undefined;
  let outputAt: number | null = null;
  let unreadableSince: number | undefined;
  let reading = false;
  let done = false;
  const spentMs = () => lastTotal ?? 0;
  const stop = () => { done = true; clock.stopEvery(timer); };
  const refuse = (refusal: Refusal) => { stop(); onRefused(refusal); };
  const timer = clock.every(() => {
    if (reading || done) return;
    reading = true;
    // A reader that throws has given no reading, which is the same as one that cannot be taken
    void work().catch(() => undefined).then((total) => {
      reading = false;
      if (done) return;
      const at = clock.now();
      if (total === undefined) unreadableSince ??= at;
      lastTotal = total ?? lastTotal;
      if (fallbackMs !== undefined && unreadableSince !== undefined && at - unreadableSince >= fallbackMs) refuse({ kind: 'clock', fallbackMs });
      else if (tracker.reading(new Map([[0, lastTotal ?? 0]]), at)) refuse({ kind: 'stalled', idleMs });
      else if (ceilingMs !== undefined && spentMs() >= ceilingMs) {
        refuse({ kind: 'ceiling', ceilingMs, spentMs: spentMs(), wallMs: at - startedAt,
          ...(watchesOutput ? { sinceOutputMs: outputAt === null ? null : at - outputAt } : {}) });
      }
    });
  }, Math.min(5_000, idleMs / 4));
  (timer as { unref?: () => void }).unref?.();
  return {
    stop,
    output: () => { outputAt = clock.now(); tracker.output(outputAt); },
    spentMs,
  };
}

/**
 * Waits for another process or thread to answer for as long as it is working, rather than for a fixed time.
 *
 * A party that is busy answers late and never fails to, so a deadline on the clock refuses it for the load it ran
 * under: a compiler worker given two seconds to accept a request missed them at a load of 40. So the wait ends only
 * when `watchWork` gives up on the party, or when the answer arrives, whichever is first.
 */
export function answerWhileWorking<T>(answer: Promise<T>, { work, what, idleMs, ceilingMs }: {
  readonly work: WorkReading; readonly what: string; readonly idleMs?: number; readonly ceilingMs?: number;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const watch = watchWork({ work, idleMs, ceilingMs, onRefused: (refusal) => reject(new Error(`${what} did not answer, and ${describeRefusal(refusal)}`)) });
    answer.then(
      (value) => { watch.stop(); resolve(value); },
      (error: unknown) => { watch.stop(); reject(error); },
    );
  });
}

/**
 * Polls `probe` until it answers, for as long as the party that will make it answer keeps working: a file another
 * process writes, a port it opens. Rejects with `what` and why the watch gave up; never on the clock.
 */
export function pollWhileWorking<T>(probe: () => T | undefined, { work, what, pollMs = 100, idleMs }: {
  readonly work: WorkReading; readonly what: string; readonly pollMs?: number; readonly idleMs?: number;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = watchWork({ work, idleMs, onRefused: (refusal) => {
      clearTimeout(timer);
      reject(new Error(`${what}, and the process that would make it ${describeRefusal(refusal)}`));
    } });
    const attempt = () => {
      let found: T | undefined;
      try { found = probe(); } catch (error) { watch.stop(); reject(error); return; }
      if (found !== undefined) { watch.stop(); resolve(found); return; }
      timer = setTimeout(attempt, pollMs);
    };
    attempt();
  });
}

/**
 * An `AbortSignal` that aborts when `watchWork` gives up on a process tree: for work handed a signal rather than a
 * process, such as an in-process build whose workers are this process's children. `stop` once the work is done.
 */
export function workSignal(options: Omit<Parameters<typeof watchWork>[0], 'onRefused'>): { signal: AbortSignal; stop(): void } {
  const controller = new AbortController();
  const watch = watchWork({ ...options, onRefused: (refusal) => controller.abort(new Error(`The work ${describeRefusal(refusal)}`)) });
  return { signal: controller.signal, stop: () => watch.stop() };
}

/** What `execFileWhileWorking` takes: `execFile`'s options, with `timeout` the CPU its process tree may spend */
export type ExecFileWhileWorkingOptions = Omit<ExecFileOptions, 'timeout'> & {
  /** The CPU the process tree may spend, in milliseconds, and the bound on the clock where its CPU cannot be read */
  readonly timeout?: number;
  /** How its output is decoded: always to text, as `promisify(execFile)` with a string encoding answers */
  readonly encoding?: BufferEncoding;
};

/**
 * `promisify(execFile)`, bounded by the process's progress rather than the clock: it resolves with `stdout` and
 * `stderr` and rejects on a non-zero exit as that does, and `timeout` is the CPU its tree may spend. The process is
 * ended when it goes `IDLE_MS` without working, or past `timeout` of CPU, and where its CPU cannot be read, past
 * `timeout` on the clock. A process that is only slow on a busy machine is never ended for it.
 */
export function execFileWhileWorking(file: string, args: readonly string[], options: ExecFileWhileWorkingOptions = {}): Promise<{ stdout: string; stderr: string }> & { child: ChildProcess } {
  const { timeout, signal, ...rest } = options;
  const ended = new AbortController();
  let why: string | undefined;
  let watch: Watch | undefined;
  let settle!: { resolve(value: { stdout: string; stderr: string }): void; reject(error: unknown): void };
  const done = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => { settle = { resolve, reject }; });
  const child = execFile(file, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...rest,
    signal: signal === undefined ? ended.signal : AbortSignal.any([signal, ended.signal]) }, (error, stdout, stderr) => {
    watch?.stop();
    if (error) {
      if (why !== undefined) error.message = `${file} ${args.join(' ')} was ended: it ${why}\n${error.message}`;
      settle.reject(Object.assign(error, { stdout, stderr }));
    } else settle.resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
  if (child.pid !== undefined) {
    watch = watchWork({
      work: processWork(child.pid), ceilingMs: timeout, fallbackMs: timeout,
      onRefused: (refusal) => { why = describeRefusal(refusal); ended.abort(new Error(why)); },
    });
  }
  // The child too, as `promisify(execFile)`'s promise carries it, for a caller that waits on its close
  return Object.assign(done, { child });
}

/**
 * What runs a bridged process, in a worker of its own: only builtins, so it loads nothing of the code that started
 * it. It starts the process, feeds its stdin, reports its pid and its end through `state`, and kills it when the
 * waiting thread raises the kill flag. `state` is `[done, pid, kill]`.
 */
const BRIDGE_WORKER = `
const { workerData } = require('node:worker_threads');
const { execFile } = require('node:child_process');
const { file, args, options, input, state, port } = workerData;
const answer = (message) => { port.postMessage(message); Atomics.store(state, 0, 1); Atomics.notify(state, 0); };
try {
  const kill = setInterval(() => { if (Atomics.load(state, 2) === 1) child.kill('SIGKILL'); }, 20);
  const child = execFile(file, args, options, (error, stdout, stderr) => {
    clearInterval(kill);
    answer({ stdout: String(stdout), stderr: String(stderr),
      failed: error ? { message: error.message, code: error.code, signal: error.signal } : undefined });
  });
  Atomics.store(state, 1, child.pid ?? -1);
  if (input !== undefined) child.stdin.end(input);
} catch (error) {
  // Thrown before the process existed: answered at once, or the waiting thread would wait on nothing
  answer({ stdout: '', stderr: '', failed: { message: String(error && error.message || error), code: error && error.code } });
}
`;

/** What `execFileSyncWhileWorking` takes: `execFileWhileWorking`'s options, and the text to write to its stdin */
export type ExecFileSyncWhileWorkingOptions = Omit<ExecFileWhileWorkingOptions, 'signal'> & { readonly input?: string };

/**
 * `execFileSync`, bounded by the process's progress rather than the clock: for a caller that must answer
 * synchronously — a module hook, a `--require` preload — and so cannot await `execFileWhileWorking`.
 *
 * The process runs from a worker thread while this one blocks, waking every few seconds to read the process tree's
 * CPU (`readTreeCpuMsSync`) and take `watchWork`'s decision: ended after `IDLE_MS` with no work, or past `timeout`
 * of CPU, and where its CPU cannot be read, past `timeout` on the clock. It answers `{ stdout, stderr }`, and throws
 * on a non-zero exit with `code`, `signal`, `stdout` and `stderr` as `execFileSync`'s error carries them.
 *
 * **The worker is the platform's own**, reached past any proxy a host installed on `Worker` (a proxied class keeps
 * its constructor on its prototype), with no `execArgv`: it runs no preload, and is no thread of the caller's.
 */
export function execFileSyncWhileWorking(file: string, args: readonly string[], options: ExecFileSyncWhileWorkingOptions = {}): { stdout: string; stderr: string } {
  const { timeout, input, ...rest } = options;
  const state = new Int32Array(new SharedArrayBuffer(12));
  const { port1, port2 } = new MessageChannel();
  const PlatformWorker = threads.Worker.prototype.constructor as typeof threads.Worker;
  const worker = new PlatformWorker(BRIDGE_WORKER, {
    eval: true, execArgv: [],
    workerData: { file, args: [...args], input, state, port: port2,
      options: { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...rest, env: rest.env ?? process.env } },
    transferList: [port2],
  });
  const started = Date.now();
  const tracker = createStallTracker(IDLE_MS, started);
  let last = new Map<number, number>();
  let spent = 0;
  let unreadableSince: number | undefined;
  let why: string | undefined;
  while (Atomics.wait(state, 0, 0, Math.min(5_000, IDLE_MS / 4)) === 'timed-out') {
    const pid = Atomics.load(state, 1);
    const now = Date.now();
    // A worker that never started the process has nothing to read and nothing to kill: its silence is the bound
    if (pid === 0 && now - started >= IDLE_MS) {
      void worker.terminate();
      throw new Error(`${file} ${args.join(' ')} was never started: its worker did nothing for ${Math.round(IDLE_MS / 1000)}s`);
    }
    if (why !== undefined || pid <= 0) continue;
    const tree = readTreeCpuMsSync(pid);
    if (tree === undefined) unreadableSince ??= now;
    else { spent += cpuAdded(last, tree); last = tree; }
    const refusal: Refusal | undefined =
      timeout !== undefined && unreadableSince !== undefined && now - unreadableSince >= timeout ? { kind: 'clock', fallbackMs: timeout }
        : tracker.reading(tree ?? last, now) ? { kind: 'stalled', idleMs: IDLE_MS }
          : timeout !== undefined && spent >= timeout ? { kind: 'ceiling', ceilingMs: timeout, spentMs: spent, wallMs: now - started }
            : undefined;
    if (refusal !== undefined) {
      why = describeRefusal(refusal);
      Atomics.store(state, 2, 1);
    }
  }
  const answer = receiveMessageOnPort(port1)?.message as
    { stdout: string; stderr: string; failed?: { message: string; code?: unknown; signal?: unknown } } | undefined;
  port1.close();
  void worker.terminate();
  if (answer === undefined) throw new Error(`${file} ${args.join(' ')} ended without an answer`);
  if (answer.failed !== undefined) {
    const message = why === undefined ? answer.failed.message : `${file} ${args.join(' ')} was ended: it ${why}\n${answer.failed.message}`;
    throw Object.assign(new Error(message), { code: answer.failed.code, signal: answer.failed.signal, stdout: answer.stdout, stderr: answer.stderr });
  }
  return { stdout: answer.stdout, stderr: answer.stderr };
}
