// Whether a process tree is still working: the CPU it adds and the output it writes, for whatever bounds a process by
// its progress rather than a clock (`scripts/lib/bounded-spawn.ts`, `apack-cli/tests/_support/run-command.ts`, and pack
// code waiting on a process it started). A starved process is slow and still working, and a budget that measures the
// clock kills it for the machine being busy, which is why the ceiling counts CPU time where a tree can be read.
//
// Node-only: it lists processes with `ps`, or PowerShell on Windows. The chain's own runner imports this file by path,
// since it runs before any package is built and `@apackdev/sdk` resolves to `dist` outside a host build.
import { execFile, execFileSync, type ChildProcess, type ExecFileOptions } from 'node:child_process';
import * as fs from 'node:fs';

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
export interface ProcessRow {
  readonly pid: number; readonly ppid: number; readonly pgid: number; readonly ms: number;
  /** `ps`'s state for it, where the listing has one: `D` on Linux and `U` on macOS are a process waiting on a disk */
  readonly state?: string;
  /**
   * When the process was created, where the listing says: Windows keeps a process's parent id after the parent
   * exits and reuses ids freely, so a parent id names the parent only for a process created after it
   */
  readonly createdAt?: number;
}

/** The rows of `ps -A -o pid=,ppid=,pgid=,time=`, with `stat=` after them where the listing asked for it */
const psRows = (listing: string): ProcessRow[] => listing.trim().split('\n').map((line) => line.trim().split(/\s+/))
  .filter((row) => row.length === 4 || row.length === 5)
  .map(([pid, ppid, pgid, time, state]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), ms: parseCpuTime(time!),
    ...(state === undefined ? {} : { state }) }));

/**
 * The rows of `WIN32_PROCESSES`: `pid ppid cpu created`, the CPU in the 100ns units Windows counts in and the
 * creation time as a Windows file time. Windows has no process groups, so each process is its own, and a tree is
 * its root and the root's descendants.
 */
export const win32Rows = (listing: string): ProcessRow[] => listing.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/))
  .filter((row) => row.length === 4 && row.every((field) => /^\d+$/.test(field)))
  .map(([pid, ppid, cpu, created]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pid),
    ms: Math.round(Number(cpu) / 10_000), createdAt: Number(created) }));

/**
 * The CPU time of each process in the tree rooted at `leader`'s process group, from one `ps` listing
 * (`pid ppid pgid time`).
 *
 * The group and every descendant of a member, because a group is not a tree: Playwright starts Electron in a
 * group of its own, so a test run whose runner only waits does its work outside the group it was spawned in.
 * A process reparented to init on its parent's exit is outside both, and the group-kill reaches it anyway.
 */
export function treeCpuMs(listing: string, leader: number): Map<number, number> {
  return treeCpuMsFrom(psRows(listing), leader);
}

/** The CPU of each process in `leader`'s tree, from rows any platform's listing parsed to */
export function treeCpuMsFrom(rows: readonly ProcessRow[], leader: number): Map<number, number> {
  // The leader itself too, for a root that leads no group of its own: a vitest worker, which its pool started
  const members = new Set(rows.filter((row) => row.pgid === leader || row.pid === leader).map((row) => row.pid));
  const created = new Map(rows.map((row) => [row.pid, row.createdAt]));
  // A child is one its parent could have started: created after it. A process older than the one its parent id
  // names had a different parent, whose id was reused — counting it would add a stranger's whole lifetime of CPU
  const childOf = (row: ProcessRow): boolean => {
    const parent = created.get(row.ppid);
    return parent === undefined || row.createdAt === undefined || row.createdAt >= parent;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (!members.has(row.pid) && members.has(row.ppid) && childOf(row)) { members.add(row.pid); grew = true; }
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
    /** How long it is since the tree last made progress: nothing, straight after a reading that found some */
    quietFor(at: number): number { return at - progressAt; },
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

/** Every process's id, parent, CPU and creation on Windows, which has no `ps`: one line each, `pid ppid cpu created` */
const WIN32_PROCESSES = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.UserModeTime + $_.KernelModeTime) $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 })" }';

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
    : { file: 'ps', args: ['-A', '-o', 'pid=,ppid=,pgid=,time=,stat='], parse: psRows }),
  options: { maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
};

/**
 * How long one synchronous listing may take. It is the reading itself, so no progress can bound it, and a caller
 * blocked on it cannot be interrupted: a `ps` or PowerShell that hangs would hang that caller for good. Generous,
 * since a listing takes well under a second, and a listing that runs out reads as no reading.
 */
const SYNC_LISTING_TIMEOUT_MS = 30_000;

/**
 * One reading of the tree's CPU taken synchronously, for a caller that cannot await: a wait inside a synchronous
 * function, which then decides with `createStallTracker` as `watchWork` does. Nothing where no listing could be taken.
 */
export function readTreeCpuMsSync(leader: number): Map<number, number> | undefined {
  try {
    return treeCpuMsFrom(LISTING.parse(execFileSync(LISTING.file, [...LISTING.args], { ...LISTING.options, timeout: SYNC_LISTING_TIMEOUT_MS })), leader);
  } catch {
    return undefined;
  }
}

/** One reading of the tree's CPU, or nothing when no listing could be taken */
export const readTreeCpuMs = async (leader: number): Promise<Map<number, number> | undefined> => {
  const rows = await listProcesses();
  return rows === undefined ? undefined : treeCpuMsFrom(rows, leader);
};

/** A wait whose condition has not held yet: when it began, how often it has been tried, and what it last failed with */
interface UnmetWait { readonly since: number; attempts: number; last: unknown }

/**
 * The waits of this process that have not been met. On `globalThis` under a registered symbol, because whatever
 * reads it and whatever waits can each load a copy of this module — one from source, one from a built bundle — and
 * a set in module scope would be two sets.
 */
function unmetWaitSet(): Set<UnmetWait> {
  const key = Symbol.for('@apackdev/sdk/progress:unmet-waits');
  const holder = globalThis as { [key: symbol]: Set<UnmetWait> | undefined };
  return holder[key] ??= new Set();
}

/**
 * Follows one wait for a condition, so that whatever ends its caller for making no progress can say what the
 * caller was waiting for (`unmetWaits`): `unmet(error)` each time the condition does not hold, `met()` once it does.
 *
 * A wait bounded by progress rather than a clock never fails by itself. The failure belongs to whatever was
 * watching, which knows that nothing happened and not what was meant to.
 */
export function trackWait(): { unmet(error: unknown): void; met(): void } {
  const wait: UnmetWait = { since: Date.now(), attempts: 0, last: undefined };
  return {
    unmet(error) { wait.attempts++; wait.last = error; unmetWaitSet().add(wait); },
    met() { unmetWaitSet().delete(wait); },
  };
}

/** What every unmet wait of this process last failed with, one line each. Empty when nothing is waiting */
export function unmetWaits(now = Date.now()): string[] {
  return [...unmetWaitSet()].map(({ since, attempts, last }) => {
    const message = last instanceof Error ? last.message : String(last);
    return `${message.split('\n')[0]} (tried ${attempts} times over ${Math.round((now - since) / 1000)}s)`;
  });
}

/** One process of a tree as a stall report shows it */
export interface TreeProcess {
  readonly pid: number; readonly ppid: number;
  /** `ps`'s state: `R` running, `S` asleep on an event, `D` waiting on a disk and uninterruptible, `T` stopped, `Z` exited */
  readonly state: string;
  /** How long it has been running, as `ps` words it */
  readonly elapsed: string;
  /** The CPU it has spent, as `ps` words it */
  readonly cpu: string;
  /** Where in the kernel it sleeps, where the system says: `-` when it does not, or is not asleep */
  readonly waitingIn: string;
  readonly command: string;
}

/** The rows of `ps -A -o pid=,ppid=,pgid=,stat=,etime=,time=,wchan=,args=`, each with the group it is in */
export function treeProcessRows(listing: string): Array<TreeProcess & { readonly pgid: number }> {
  return listing.split('\n').flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    return row ? [{ pid: Number(row[1]), ppid: Number(row[2]), pgid: Number(row[3]), state: row[4]!, elapsed: row[5]!,
      cpu: row[6]!, waitingIn: row[7]!, command: row[8]! }] : [];
  });
}

/** The processes of `leader`'s tree in a listing, as `treeCpuMsFrom` counts a tree, parents before their children */
export function treeProcessesIn(rows: ReadonlyArray<TreeProcess & { readonly pgid: number }>, leader: number): TreeProcess[] {
  const members = treeCpuMsFrom(rows.map((row) => ({ pid: row.pid, ppid: row.ppid, pgid: row.pgid, ms: 0 })), leader);
  return rows.filter((row) => members.has(row.pid)).sort((a, b) => a.pid - b.pid);
}

/**
 * How long the listing a stall report takes may run. The report is taken at the moment a tree is about to be
 * ended for doing nothing, and a `ps` that hung would keep it alive.
 */
const TREE_LISTING_TIMEOUT_MS = 10_000;

/**
 * What each process of `leader`'s tree is doing, for a report that the tree stopped working: nothing where no
 * listing could be taken, which Windows has none of.
 *
 * **A tree that used no CPU is not one fact.** A process waiting on a disk and one waiting for an event that
 * never came both spend nothing and write nothing, and a stall that says only that reads the same for a slow
 * drive, a lost file event and a child that hung. The state says which: `D` is the disk, `S` an event, and the
 * kernel's own name for where it sleeps says which event where the system gives one.
 */
export function describeTree(leader: number): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,etime=,time=,wchan=,args='],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', timeout: TREE_LISTING_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        if (error) return resolve(undefined);
        const tree = treeProcessesIn(treeProcessRows(stdout), leader);
        if (tree.length === 0) return resolve(undefined);
        resolve(`Its process tree when it was found doing nothing (state D waits on a disk, S on an event, R runs, Z has exited):\n${
          tree.map((each) => `  pid ${each.pid} (parent ${each.ppid}) ${each.state}, ${each.cpu} CPU in ${each.elapsed}${
            each.waitingIn === '-' ? '' : `, asleep in ${each.waitingIn}`}: ${each.command.slice(0, 220)}${threadsOf(each.pid)}`).join('\n')}\n${machineWaits()}`);
      });
  });
}

/** A file under `/proc` as text, or nothing where there is none: every reading here is one a system may not give */
const procText = (file: string): string | undefined => {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return undefined; }
};

/**
 * Where each thread of a process sleeps, counted by place, on a system that says (Linux's `/proc`): a process
 * is one line in a listing, and the line is its first thread's. A compiler's work is in worker threads, and a
 * process whose first thread waits on them looks idle whichever of them is the one that is stuck.
 */
function threadsOf(pid: number): string {
  let threads: string[];
  try { threads = fs.readdirSync(`/proc/${pid}/task`); } catch { return ''; }
  const places = new Map<string, number>();
  for (const thread of threads) {
    // The state is the field after the name, which is in brackets and may hold anything
    const state = procText(`/proc/${pid}/task/${thread}/stat`)?.replace(/^.*\) /, '').split(' ')[0] ?? '?';
    const place = procText(`/proc/${pid}/task/${thread}/wchan`);
    const where = `${state}${place === undefined || place === '' || place === '0' ? '' : ` in ${place}`}`;
    places.set(where, (places.get(where) ?? 0) + 1);
  }
  return `\n    its ${threads.length} thread${threads.length === 1 ? '' : 's'}: ${[...places].map(([where, count]) => `${count} ${where}`).join(', ')}`;
}

/**
 * What the machine itself was waiting on, where it says: how much of the last seconds its tasks spent stalled on
 * storage, and how much written data had not reached a disk. A tree that waits on a write the disk has not taken
 * is not one that stopped, and these are the two numbers that tell the two apart.
 */
function machineWaits(): string {
  const pressure = procText('/proc/pressure/io');
  const memory = procText('/proc/meminfo');
  const unwritten = memory?.split('\n').filter((line) => /^(Dirty|Writeback):/.test(line)).map((line) => line.replace(/\s+/g, ' ')).join(', ');
  return [
    pressure === undefined ? undefined : `Tasks stalled on storage (/proc/pressure/io): ${pressure.replace(/\n/g, '; ')}`,
    unwritten === undefined || unwritten === '' ? undefined : `Written and not yet on a disk: ${unwritten}`,
  ].filter((line) => line !== undefined).map((line) => `${line}\n`).join('');
}

/**
 * How much work a party has done since the reading began, in milliseconds of CPU, or nothing where it cannot be
 * read. Where it begins is the reading's to say: `processWork` over a child just spawned counts from its start, and
 * `fromNow` makes any reading count from its first, for a party that was running before anyone watched it.
 *
 * `held` is what the party is waiting on that is not its to hurry, where that can be told (`storageHold`): a party
 * held does no work and has not stopped, so a watch asks before it counts a quiet interval against it.
 */
export type WorkReading = (() => Promise<number | undefined>) & { readonly held?: () => Promise<string | undefined> };

/** A reading that counts from its own first value: what a party does under the watch, not over its lifetime */
export function fromNow(work: WorkReading): WorkReading {
  let first: number | undefined;
  return Object.assign(async () => {
    const total = await work();
    if (total === undefined) return undefined;
    first ??= total;
    return total - first;
  }, work.held === undefined ? {} : { held: work.held });
}

/**
 * Whether a place in the kernel a thread sleeps in is storage: a function of a filesystem that lives on a disk, or
 * of the layer that queues writes to one. `filesystems` are the names of the first, as the system lists them.
 */
export function sleepsInStorage(place: string, filesystems: readonly string[]): boolean {
  return filesystems.some((name) => place.startsWith(`${name}_`))
    || /^(io_schedule|blk_|bio_|submit_bio|rq_qos_|wbt_|jbd2_|balance_dirty_pages|folio_wait|wait_on_page|wb_wait|writeback_)/.test(place);
}

let diskFilesystems: readonly string[] | undefined;

/** The filesystems this kernel keeps on a disk: `/proc/filesystems` without the ones marked `nodev`. Linux alone */
function filesystemsOnDisks(): readonly string[] {
  if (diskFilesystems !== undefined) return diskFilesystems;
  let listed = '';
  try { listed = fs.readFileSync('/proc/filesystems', 'utf8'); } catch { /* not Linux, or no /proc: nothing to name */ }
  return diskFilesystems = listed.split('\n').filter((line) => line !== '' && !line.startsWith('nodev')).map((line) => line.trim());
}

/**
 * What in `leader`'s tree is waiting on storage, as one line, or nothing when nothing is — or nothing can tell.
 *
 * **A tree waiting on a disk spends no CPU and writes nothing, which is all a stall is measured by.** On a slow
 * disk a filesystem flushing what was written to it holds every process that touches it, for as long as the flush
 * takes: over two minutes was measured in the Linux test container, whose disk is an image on an external drive,
 * and the test it happened to was failed as stalled. Which is the machine being slow, and never a reason to end
 * work: so a watch asks this before it counts a quiet interval (`watchWork`).
 *
 * From the listing's state for each process — uninterruptible is `D` on Linux and `U` on macOS, and is what waiting
 * on a disk is — and, where the kernel says where each thread sleeps (Linux's `/proc`), from that.
 */
export async function storageHold(leader: number): Promise<string | undefined> {
  const rows = await listProcesses();
  if (rows === undefined) return undefined;
  const members = treeCpuMsFrom(rows, leader);
  for (const row of rows) {
    if (!members.has(row.pid)) continue;
    if (row.state !== undefined && /^[DU]/.test(row.state)) return `pid ${row.pid} waits on a disk`;
    const place = threadSleepingInStorage(row.pid);
    if (place !== undefined) return `pid ${row.pid} sleeps in ${place}`;
  }
  return undefined;
}

/** Where a thread of `pid` sleeps in storage, the first found, on a system that says where its threads sleep */
function threadSleepingInStorage(pid: number): string | undefined {
  let threads: string[];
  try { threads = fs.readdirSync(`/proc/${pid}/task`); } catch { return undefined; }
  const filesystems = filesystemsOnDisks();
  for (const thread of threads) {
    let place: string;
    try { place = fs.readFileSync(`/proc/${pid}/task/${thread}/wchan`, 'utf8').trim(); } catch { continue; }
    if (place !== '' && place !== '0' && sleepsInStorage(place, filesystems)) return place;
  }
  return undefined;
}

/**
 * A process tree's work, from the readings the watchdog takes: what each process in it added, summed over every
 * reading, so a process that exits keeps the work it did (`cpuAdded`). Nothing where `ps` gives no reading.
 *
 * What holds the tree is asked of the system only when the system is what reads it. A caller that hands in its
 * own `read` has said where the tree's readings come from, and the system's listing knows nothing of that tree:
 * asking it would start a process for a tree a spec made up, and one a spec's clock does not move.
 */
export function processWork(pid: number, read: typeof readTreeCpuMs = readTreeCpuMs): WorkReading {
  let last = new Map<number, number>();
  let total = 0;
  return Object.assign(async () => {
    const tree = await read(pid);
    if (tree === undefined) return undefined;
    total += cpuAdded(last, tree);
    last = tree;
    return total;
  }, read === readTreeCpuMs ? { held: () => storageHold(pid) } : {});
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
  | { readonly kind: 'stalled'; readonly idleMs: number;
      /** What it had been waiting on before that, and for how long, when the watch had made allowance for it */
      readonly held?: { readonly ms: number; readonly by: string } }
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
    case 'stalled': return `did no work for ${seconds(refusal.idleMs)}${refusal.held === undefined ? ''
      : `, after ${seconds(refusal.held.ms)} of waiting on storage that was allowed for (${refusal.held.by})`}`;
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
  /** How long, in all, the party was found waiting on storage and not counted idle for it: a reading */
  heldMs(): number;
}

/**
 * How far a CPU ceiling is loosened under `APACK_CEILING=loose`, which the Linux test container sets because its VM
 * counts the host's load as the guest's CPU, so a ceiling held to its size there fires on a busy host rather than on a
 * spin. Loosened rather than dropped, because a ceiling is the only bound on a party that spins: the stall rule reads
 * spinning as working. A declared class, not a measurement: well past what load adds to healthy work, and finite.
 */
export const LOOSE_CEILING_FACTOR = 10;

/**
 * How many idle windows of waiting on storage a watch allows a party for, between one piece of work and the next
 * (`WorkReading.held`). Allowed rather than counted, because a disk that is slow is the machine being slow; and
 * finite, because a disk that never answers is a party that never will, and a run that cannot end cannot fail.
 * A declared class: twenty minutes at the default window, against the two a slow disk was measured taking.
 */
export const STORAGE_ALLOWANCE_FACTOR = 10;

/** What every ceiling is multiplied by here. Read where every bound is built, so a caller passing a ceiling cannot forget it */
const ceilingFactor = (): number => (process.env.APACK_CEILING === 'loose' ? LOOSE_CEILING_FACTOR : 1);

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
 *
 * **An interval the party spent waiting on storage is not counted as idle** (`WorkReading.held`, `storageHold`):
 * it is asked after every reading that found no work, and a party found held has its window start again. Up to
 * `STORAGE_ALLOWANCE_FACTOR` windows between one piece of work and the next; past that it is refused as stalled,
 * and the refusal says how long it was allowed for and what held it.
 */
export function watchWork({ work, idleMs = IDLE_MS, ceilingMs: requestedCeilingMs, fallbackMs, onRefused, watchesOutput = false, countsFromWatch = false, clock = processClock }: {
  readonly work: WorkReading; readonly idleMs?: number; readonly ceilingMs?: number; readonly fallbackMs?: number;
  readonly onRefused: (refusal: Refusal) => void;
  /**
   * Whether `work` counts from the moment this watch began, so that its first reading is already work done under
   * the watch rather than a baseline to measure the next against.
   *
   * **For a party that can keep its watcher from reading it.** A watch in the same process as the work reads on a
   * timer, and synchronous work holds that timer off: a test that read and hashed a package tree for three minutes
   * was read for the first time when it had finished, and a first reading taken as a baseline says a party that
   * spent every one of those minutes on CPU had done nothing since the watch began. Left off for a reading over a
   * lifetime (`processWork` of a process that was already running), whose first value is no measure of now.
   */
  readonly countsFromWatch?: boolean;
  /** Whether the caller reports the party's output (`output()`), so a refusal can say how long it has been silent */
  readonly watchesOutput?: boolean;
  readonly clock?: WatchClock;
}): Watch {
  const ceilingMs = requestedCeilingMs === undefined ? undefined : requestedCeilingMs * ceilingFactor();
  const startedAt = clock.now();
  const tracker = createStallTracker(idleMs, startedAt);
  // Nothing done at the start is the baseline such a reading is measured against
  if (countsFromWatch) tracker.reading(new Map([[0, 0]]), startedAt);
  let lastTotal: number | undefined;
  let outputAt: number | null = null;
  let unreadableSince: number | undefined;
  let reading = false;
  let done = false;
  /** How long the party has been allowed for waiting on storage since it last worked, and what held it */
  let held: { ms: number; by: string } | undefined;
  let heldInAll = 0;
  let readAt = startedAt;
  const spentMs = () => lastTotal ?? 0;
  const stop = () => { done = true; clock.stopEvery(timer); };
  const refuse = (refusal: Refusal) => { stop(); onRefused(refusal); };
  const timer = clock.every(() => {
    if (reading || done) return;
    reading = true;
    // A reader that throws has given no reading, which is the same as one that cannot be taken
    void work().catch(() => undefined).then(async (total) => {
      const at = clock.now();
      const sinceLast = at - readAt;
      readAt = at;
      if (total === undefined) unreadableSince ??= at;
      lastTotal = total ?? lastTotal;
      let stalled = tracker.reading(new Map([[0, lastTotal ?? 0]]), at);
      if (tracker.quietFor(at) === 0) held = undefined;
      // Quiet, and not yet past what storage is allowed: asked what holds it before the quiet is counted
      else if (work.held !== undefined && (held?.ms ?? 0) < idleMs * STORAGE_ALLOWANCE_FACTOR) {
        const by = await work.held().catch(() => undefined);
        if (by !== undefined) {
          held = { ms: (held?.ms ?? 0) + sinceLast, by };
          heldInAll += sinceLast;
          tracker.output(at);
          stalled = false;
        }
      }
      reading = false;
      if (done) return;
      if (fallbackMs !== undefined && unreadableSince !== undefined && at - unreadableSince >= fallbackMs) refuse({ kind: 'clock', fallbackMs });
      else if (stalled) refuse({ kind: 'stalled', idleMs, ...(held === undefined ? {} : { held }) });
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
    heldMs: () => heldInAll,
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

