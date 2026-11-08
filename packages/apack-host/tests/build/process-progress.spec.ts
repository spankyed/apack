import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerWhileWorking, cpuAdded, createStallTracker, describeRefusal, execFileWhileWorking, fromNow, parseCpuTime, processWork, threadWork, treeCpuMs, watchWork, type Refusal } from '../../src/build/process-progress.ts';

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
