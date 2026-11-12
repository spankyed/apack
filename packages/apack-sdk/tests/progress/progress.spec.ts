import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOOSE_CEILING_FACTOR, STORAGE_ALLOWANCE_FACTOR, answerWhileWorking, cpuAdded, createStallTracker, describeRefusal, execFileWhileWorking, fromNow, parseCpuTime, processWork, sleepsInStorage, threadWork, trackWait, treeProcessRows, treeProcessesIn, unmetWaits, treeCpuMs, treeCpuMsFrom, watchWork, win32Rows, type Refusal } from '../../src/progress.ts';

/** A reading that adds `step` milliseconds of work each time it is taken */
const working = (step: number) => { let total = 0; return async () => (total += step); };
const IDLE = 20_000;

describe('waiting for an answer while the party works', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('waits past any fixed time for a party that keeps working, and takes its answer', async () => {
    let answer!: (value: string) => void;
    const waiting = answerWhileWorking(new Promise<string>((resolve) => { answer = resolve; }), { work: working(2_000), what: 'The worker', idleMs: IDLE });
    // Ten idle windows of a party that is computing throughout: late, never stuck
    await vi.advanceTimersByTimeAsync(10 * IDLE);
    answer('done');
    await expect(waiting).resolves.toBe('done');
  });

  it('refuses a party that does no work for the idle window, naming it', async () => {
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work: async () => 5_000, what: 'The worker', idleMs: IDLE });
    const refused = expect(waiting).rejects.toThrow(`The worker did not answer, and did no work for ${IDLE / 1000}s`);
    await vi.advanceTimersByTimeAsync(IDLE + IDLE / 4);
    await refused;
  });

  it('bounds a party nothing can read by its silence', async () => {
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work: async () => undefined, what: 'The helper', idleMs: IDLE });
    const refused = expect(waiting).rejects.toThrow('did no work');
    await vi.advanceTimersByTimeAsync(IDLE + IDLE / 4);
    await refused;
  });

  it('counts a reading that cannot be taken as no work, so one between two good ones adds none', async () => {
    // A party stuck at 5s of CPU whose every other reading fails: read as 0 then 5s, the gap would be new work each time
    let readable = false;
    const work = async () => {
      readable = !readable;
      return readable ? 5_000 : undefined;
    };
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work, what: 'The helper', idleMs: IDLE });
    const refused = expect(waiting).rejects.toThrow('did no work');
    await vi.advanceTimersByTimeAsync(IDLE + IDLE / 4);
    await refused;
  });

  it('reads a reader that throws as one giving no reading, and keeps reading', async () => {
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work: async () => { throw new Error('ps went away'); }, what: 'The helper', idleMs: IDLE });
    const refused = expect(waiting).rejects.toThrow('did no work');
    await vi.advanceTimersByTimeAsync(IDLE + IDLE / 4);
    await refused;
  });

  it('refuses a party that keeps working and never answers, at its CPU ceiling, counted from the wait', async () => {
    // Its lifetime total starts high, and a reading from now counts only what it spends during the wait
    let total = 100_000;
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work: fromNow(async () => (total += 2_000)), what: 'The worker', idleMs: IDLE, ceilingMs: 10_000 });
    const refused = expect(waiting).rejects.toThrow('The worker did not answer, and spent its 10s CPU budget: 10s of CPU');
    await vi.advanceTimersByTimeAsync(6 * (IDLE / 4));
    await refused;
  });

  it('passes the answer\'s own failure through', async () => {
    await expect(answerWhileWorking(Promise.reject(new Error('refused')), { work: working(2_000), what: 'x', idleMs: IDLE })).rejects.toThrow('refused');
  });
});

describe('the readings', () => {
  it('sums a process tree\'s work across readings, keeping what a process did before it exited', async () => {
    const trees = [new Map([[1, 1_000], [2, 3_000]]), new Map([[1, 1_500]]), new Map([[1, 1_500], [3, 700]])];
    const read = vi.fn(async () => trees.shift());
    const work = processWork(1, read);
    expect(await work()).toBe(4_000);
    expect(await work()).toBe(4_500);
    expect(await work()).toBe(5_200);
    expect(await work()).toBeUndefined();
  });

  it('reads a worker thread\'s own CPU from the first reading, which grows while it computes', async () => {
    // It burns only when told and says when it is done, so one reading is before the work and one after it
    const worker = new Worker(`const { parentPort } = require('node:worker_threads');
      parentPort.once('message', () => { const end = Date.now() + 400; while (Date.now() < end) {} parentPort.postMessage('burnt'); });
      setInterval(() => {}, 1000);`, { eval: true });
    try {
      const work = threadWork(worker);
      await new Promise((resolve) => worker.once('online', resolve));
      expect(await work()).toBe(0);
      worker.postMessage('go');
      await new Promise((resolve) => worker.once('message', resolve));
      expect(await work()).toBeGreaterThan(200);
    } finally {
      await worker.terminate();
    }
  });

  it('reads nothing for a thread whose runtime has no per-thread usage', async () => {
    expect(await threadWork({})()).toBeUndefined();
  });
});

describe('a process bounded by its work, as promisify(execFile) is by the clock', () => {
  it('resolves with what it printed, and rejects a failing exit with what it printed', async () => {
    await expect(execFileWhileWorking(process.execPath, ['-e', 'console.log("out"); console.error("err")'])).resolves.toEqual({ stdout: 'out\n', stderr: 'err\n' });
    await expect(execFileWhileWorking(process.execPath, ['-e', 'console.error("refused"); process.exit(3)'])).rejects.toMatchObject({ code: 3, stderr: 'refused\n' });
  });

  it('leaves a process alone that outlives its timeout on the clock while spending no CPU', async () => {
    // Twice its timeout in wall time: the clock would have ended it, and its CPU is nowhere near the ceiling
    const started = Date.now();
    await expect(execFileWhileWorking(process.execPath, ['-e', 'setTimeout(() => console.log("waited"), 2_000)'], { timeout: 1_000 })).resolves.toMatchObject({ stdout: 'waited\n' });
    expect(Date.now() - started).toBeGreaterThan(1_000);
  });

  it('ends a process that spins at its CPU ceiling, saying so', async () => {
    await expect(execFileWhileWorking(process.execPath, ['-e', 'for (;;) {}'], { timeout: 1_500 })).rejects.toThrow(/was ended: it spent its 1\.5s CPU budget/);
  });
});

describe('reading a process tree for the watchdog', () => {
  it.each([
    ['0:00.03', 30],
    ['1:02.50', 62_500],
    ['00:01:02', 62_000],
    ['01:00:00', 3_600_000],
    ['2-00:00:01', 172_801_000],
  ])('reads ps time %s', (text, ms) => {
    expect(parseCpuTime(text)).toBe(ms);
  });

  it('sums the group and every descendant, and nothing else', () => {
    // pid ppid pgid time: 100 leads the group; 200 left it (its own group) and 300 is its child; 400 and
    // 500 are unrelated, 500 a child of another process with 100's number as neither parent nor group
    const listing = [
      '  100     1   100   0:01.00',
      '  101   100   100   0:02.00',
      '  200   101   200   0:04.00',
      '  300   200   200   0:08.00',
      '  400     1   400   0:16.00',
      '  500   400   400   0:32.00',
    ].join('\n');
    expect(treeCpuMs(listing, 100)).toEqual(new Map([[100, 1_000], [101, 2_000], [200, 4_000], [300, 8_000]]));
  });

  it('reads nothing for a group that has gone', () => {
    expect(treeCpuMs('  400     1   400   0:16.00\n', 100).size).toBe(0);
  });

  it("reads Windows's listing, in 100ns units, skipping a process with no CPU to report", () => {
    // PowerShell's lines end in CRLF, and the System Idle Process reports an empty sum
    expect(win32Rows('100 4 12500000 900\r\n101 100 30000 950\r\n0 0  0\r\n')).toEqual([
      { pid: 100, ppid: 4, pgid: 100, ms: 1_250, createdAt: 900 },
      { pid: 101, ppid: 100, pgid: 101, ms: 3, createdAt: 950 },
    ]);
  });

  /**
   * Windows keeps a process's parent id after its parent exits, and reuses ids: a service started by some long-gone
   * process 100 names 100 as its parent, and once this tree's leader is a new 100 it would read as a child, adding a
   * stranger's lifetime of CPU at once. A process older than the one its parent id names is not its child.
   */
  it('counts no process its parent could not have started', () => {
    const rows = win32Rows('100 4 10000000 5000\r\n101 100 20000000 6000\r\n200 100 9990000000 1000\r\n');
    expect(treeCpuMsFrom(rows, 100)).toEqual(new Map([[100, 1_000], [101, 2_000]]));
  });

  it('counts what each process added, a new one whole and one that exited as nothing', () => {
    const before = new Map([[100, 1_000], [101, 9_000]]);
    // 101 exited with 9s; 102 is new with 0.5s; 100 added 0.25s. The totals fell from 10s to 1.75s
    const after = new Map([[100, 1_250], [102, 500]]);
    expect(cpuAdded(before, after)).toBe(750);
  });
});

describe('the stall decision', () => {
  const IDLE = 120_000;
  const tree = (ms: number) => new Map([[100, ms]]);

  it('stalls a tree that adds no CPU for the idle window, and not before', () => {
    const stall = createStallTracker(IDLE, 0);
    expect(stall.reading(tree(5_000), 5_000)).toBe(false);
    expect(stall.reading(tree(5_000), IDLE - 1)).toBe(false);
    expect(stall.reading(tree(5_000), IDLE)).toBe(true);
  });

  it('keeps a tree that adds a second of CPU within each window', () => {
    const stall = createStallTracker(IDLE, 0);
    for (let at = 0, cpu = 0; at <= 10 * IDLE; at += IDLE / 2, cpu += 1_000) {
      expect(stall.reading(tree(cpu), at)).toBe(false);
    }
  });

  it('does not count timer ticks as progress', () => {
    // A wedged Node process ticking a timer: 10ms of CPU every reading
    const stall = createStallTracker(IDLE, 0);
    let stalled = false;
    for (let at = 0, cpu = 0; at <= IDLE; at += 5_000, cpu += 10) stalled = stall.reading(tree(cpu), at);
    expect(stalled).toBe(true);
  });

  it('counts output as progress', () => {
    const stall = createStallTracker(IDLE, 0);
    stall.reading(tree(0), 0);
    stall.output(IDLE - 1);
    expect(stall.reading(tree(0), IDLE)).toBe(false);
    expect(stall.reading(tree(0), 2 * IDLE - 1)).toBe(true);
  });

  it('counts processes that come and go, though the total keeps falling', () => {
    const stall = createStallTracker(IDLE, 0);
    stall.reading(new Map([[100, 0], [101, 60_000]]), 0);
    // 101 exited; each reading a new short build has spent 2s, and the live total never reaches 60s again
    for (let i = 1; i <= 10; i++) {
      expect(stall.reading(new Map([[100, 0], [101 + i, 2_000]]), i * IDLE / 2)).toBe(false);
    }
  });
});

describe('what a watch says it spent, which a ceiling measures', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('counts what a reading counts: from its start for a child, from now for a party that was already running', async () => {
    // A thread or this process: a lifetime of 100s before the watch, 3s while it ran
    const totals = [100_000, 101_000, 103_000];
    const watch = watchWork({ work: fromNow(async () => totals.shift()), idleMs: IDLE, onRefused: () => {} });
    await vi.advanceTimersByTimeAsync(3 * (IDLE / 4));
    expect(watch.spentMs()).toBe(3_000);
    watch.stop();
  });

  /**
   * The container's VM counts host load as guest CPU, so there a ceiling held to its size fires on a busy host; held at
   * ten times it, a spin is still ended, which a dropped ceiling never did. A stall still means a stall
   */
  it('holds a ceiling at ten times its size under APACK_CEILING=loose, and still ends a party that stops working', async () => {
    vi.stubEnv('APACK_CEILING', 'loose');
    try {
      let refused: Refusal | undefined;
      let total = 0;
      const spinning = watchWork({ work: async () => (total += 2_000), idleMs: IDLE, ceilingMs: 5_000, onRefused: (refusal) => { refused = refusal; } });
      await vi.advanceTimersByTimeAsync(6 * (IDLE / 4));
      expect(refused, 'a ceiling held to its size under APACK_CEILING=loose').toBeUndefined();
      await vi.advanceTimersByTimeAsync(20 * (IDLE / 4));
      expect(refused).toMatchObject({ kind: 'ceiling', ceilingMs: 5_000 * LOOSE_CEILING_FACTOR });
      spinning.stop();
      refused = undefined;
      const idle = watchWork({ work: async () => 0, idleMs: IDLE, ceilingMs: 5_000, onRefused: (refusal) => { refused = refusal; } });
      await vi.advanceTimersByTimeAsync(IDLE + IDLE / 4);
      expect(refused).toMatchObject({ kind: 'stalled' });
      idle.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses at its ceiling with what it spent against how long it took, and how long since its output', async () => {
    let refused: Refusal | undefined;
    let total = 0;
    const watch = watchWork({ work: async () => (total += 2_000), idleMs: IDLE, ceilingMs: 5_000, watchesOutput: true, onRefused: (refusal) => { refused = refusal; } });
    watch.output();
    await vi.advanceTimersByTimeAsync(3 * (IDLE / 4));
    expect(refused).toMatchObject({ kind: 'ceiling', ceilingMs: 5_000, spentMs: 6_000, wallMs: 3 * (IDLE / 4), sinceOutputMs: 3 * (IDLE / 4) });
  });
});

describe('how a refusal reads', () => {
  it('says each kind as the end of a sentence about the party', () => {
    expect(describeRefusal({ kind: 'stalled', idleMs: 120_000 })).toBe('did no work for 120s');
    expect(describeRefusal({ kind: 'clock', fallbackMs: 60_000 })).toBe('ran past 60s on the clock, its work unreadable');
    expect(describeRefusal({ kind: 'ceiling', ceilingMs: 600_000, spentMs: 600_200, wallMs: 612_400, sinceOutputMs: 540_000 }))
      .toBe('spent its 600s CPU budget: 600s of CPU in 612s of wall time, its last output 540s ago');
    expect(describeRefusal({ kind: 'ceiling', ceilingMs: 10_000, spentMs: 10_000, wallMs: 11_000, sinceOutputMs: null })).toContain('with no output at all');
    expect(describeRefusal({ kind: 'ceiling', ceilingMs: 10_000, spentMs: 10_000, wallMs: 11_000 })).not.toContain('output');
  });
});


describe('what a tree that stopped working was doing', () => {
  // pid ppid pgid stat etime time wchan args, as `ps` on Linux prints them
  const listing = [
    '    1     0     1 Ss   02:10:00 00:00:01 do_epoll_wait /sbin/init',
    '  100     1   100 Sl      12:00 00:00:40 do_epoll_wait node vitest run',
    '  140   100   100 Sl      11:58 00:01:12 futex_wait    node worker.js --pool forks',
    '  201   140   201 D       00:31 00:00:02 io_schedule   node cli.js pack build --out "a b"',
    '  202   201   201 Z       00:30 00:00:00 -             [sh] <defunct>',
    '  300     1   300 R       05:00 00:04:59 -             node unrelated.js',
  ].join('\n');

  it('reads each process with its state, where it sleeps, and its command whole', () => {
    expect(treeProcessRows(listing).find((row) => row.pid === 201)).toEqual({
      pid: 201, ppid: 140, pgid: 201, state: 'D', elapsed: '00:31', cpu: '00:00:02', waitingIn: 'io_schedule',
      command: 'node cli.js pack build --out "a b"',
    });
  });

  it('takes the tree as the watchdog counts it: the group, and what its members started in groups of their own', () => {
    const tree = treeProcessesIn(treeProcessRows(listing), 100);
    expect(tree.map((each) => each.pid)).toEqual([100, 140, 201, 202]);
  });

  it('leaves out a process the tree did not start', () => {
    expect(treeProcessesIn(treeProcessRows(listing), 100).some((each) => each.pid === 300)).toBe(false);
  });
});

describe('what a caller was still waiting for', () => {
  it('lists a wait from its first failure until it is met, with what it last failed with', () => {
    const wait = trackWait();
    expect(unmetWaits()).toEqual([]);
    wait.unmet(new Error('expected 0 to be greater than 0\n    at somewhere'));
    wait.unmet(new Error('the watcher started no rebuild'));
    const [line, ...others] = unmetWaits(Date.now() + 61_000);
    expect(others).toEqual([]);
    expect(line).toMatch(/^the watcher started no rebuild \(tried 2 times over 6[01]s\)$/);
    wait.met();
    expect(unmetWaits()).toEqual([]);
  });
});

describe('a party that is waiting on storage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const HELD = 'pid 7 sleeps in btrfs_sync_log';
  /** A party whose work is `total()` and which is held by whatever `by()` answers */
  const party = (total: () => number, by: () => string | undefined) => Object.assign(async () => total(), { held: async () => by() });

  it('is not refused for the time it waits, over several idle windows of doing nothing', async () => {
    let refused: Refusal | undefined;
    const watch = watchWork({ work: party(() => 0, () => HELD), idleMs: IDLE, onRefused: (refusal) => { refused = refusal; } });
    await vi.advanceTimersByTimeAsync(5 * IDLE);
    expect(refused).toBeUndefined();
    watch.stop();
  });

  it('is refused one idle window after it stops waiting, if it then does nothing, saying what it had waited on', async () => {
    let refused: Refusal | undefined;
    let waiting = true;
    watchWork({ work: party(() => 0, () => (waiting ? HELD : undefined)), idleMs: IDLE, onRefused: (refusal) => { refused = refusal; } });
    await vi.advanceTimersByTimeAsync(3 * IDLE);
    waiting = false;
    await vi.advanceTimersByTimeAsync(IDLE - IDLE / 4);
    expect(refused, 'not before a whole window of quiet with nothing holding it').toBeUndefined();
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(refused).toMatchObject({ kind: 'stalled', held: { by: HELD } });
    expect(describeRefusal(refused!)).toContain(`waiting on storage that was allowed for (${HELD})`);
  });

  it('is allowed ten idle windows of it and no more, so a disk that never answers still ends the wait', async () => {
    let refused: Refusal | undefined;
    watchWork({ work: party(() => 0, () => HELD), idleMs: IDLE, onRefused: (refusal) => { refused = refusal; } });
    await vi.advanceTimersByTimeAsync(STORAGE_ALLOWANCE_FACTOR * IDLE);
    expect(refused).toBeUndefined();
    await vi.advanceTimersByTimeAsync(IDLE + IDLE / 2);
    expect(refused).toMatchObject({ kind: 'stalled' });
    expect((refused as Extract<Refusal, { kind: 'stalled' }>).held!.ms).toBeGreaterThanOrEqual(STORAGE_ALLOWANCE_FACTOR * IDLE);
  });

  it('is allowed afresh once it has worked', async () => {
    let refused: Refusal | undefined;
    let total = 0;
    const watch = watchWork({ work: party(() => total, () => HELD), idleMs: IDLE, onRefused: (refusal) => { refused = refusal; } });
    await vi.advanceTimersByTimeAsync(8 * IDLE);
    total += 2_000;
    await vi.advanceTimersByTimeAsync(8 * IDLE);
    expect(refused, 'sixteen windows of waiting in all, with work between').toBeUndefined();
    watch.stop();
  });

  it('is told from one waiting on anything else by where its threads sleep', () => {
    const filesystems = ['btrfs', 'ext4'];
    expect(sleepsInStorage('btrfs_sync_log', filesystems)).toBe(true);
    expect(sleepsInStorage('io_schedule_timeout', filesystems)).toBe(true);
    expect(sleepsInStorage('futex_wait_queue', filesystems)).toBe(false);
    expect(sleepsInStorage('do_epoll_wait', filesystems)).toBe(false);
    expect(sleepsInStorage('pipe_read', filesystems)).toBe(false);
    // A filesystem this kernel does not keep on a disk is not one a process can be waiting on a disk in
    expect(sleepsInStorage('xfs_log_force', filesystems)).toBe(false);
  });
});

describe('a party that held its watcher off while it worked', () => {
  /** A clock a case moves by hand, and the one reading a watch takes on it */
  const held = () => {
    let now = 0;
    let tick: (() => void) | undefined;
    const clock = { now: () => now, every: (run: () => void) => { tick = run; return 0 as unknown as ReturnType<typeof setInterval>; }, stopEvery: () => {} };
    return { clock, move: (ms: number) => { now += ms; }, read: async () => { tick!(); await new Promise((resolve) => { setImmediate(resolve); }); } };
  };

  it('is not refused at a first reading that comes late, when the reading counts the work it did meanwhile', async () => {
    const { clock, move, read } = held();
    let refused: Refusal | undefined;
    // Three minutes of synchronous work: no reading until it ends, and then one that says three minutes of CPU
    watchWork({ work: async () => 180_000, idleMs: IDLE, countsFromWatch: true, clock, onRefused: (refusal) => { refused = refusal; } });
    move(180_000);
    await read();
    expect(refused).toBeUndefined();
  });

  it('is still refused when that first reading says it did nothing', async () => {
    const { clock, move, read } = held();
    let refused: Refusal | undefined;
    watchWork({ work: async () => 0, idleMs: IDLE, countsFromWatch: true, clock, onRefused: (refusal) => { refused = refusal; } });
    move(180_000);
    await read();
    expect(refused).toMatchObject({ kind: 'stalled' });
  });

  it('has a first reading over a lifetime taken as a baseline, which is what it is', async () => {
    const { clock, move, read } = held();
    let refused: Refusal | undefined;
    // A process that had spent an hour before anyone watched it, and nothing since
    watchWork({ work: async () => 3_600_000, idleMs: IDLE, clock, onRefused: (refusal) => { refused = refusal; } });
    move(IDLE + 1);
    await read();
    expect(refused).toMatchObject({ kind: 'stalled' });
  });
});
