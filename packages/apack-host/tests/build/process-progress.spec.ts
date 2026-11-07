import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerWhileWorking, execFileWhileWorking, processWork, threadWork } from '../../src/build/process-progress.ts';

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
    // Its lifetime total starts high: only what it spends during the wait counts towards the ceiling
    let total = 100_000;
    const waiting = answerWhileWorking(new Promise<never>(() => {}), { work: async () => (total += 2_000), what: 'The worker', idleMs: IDLE, ceilingMs: 10_000 });
    const refused = expect(waiting).rejects.toThrow('The worker did not answer, and spent 10s of CPU trying');
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

  it('reads a worker thread\'s own CPU, which grows while it computes', async () => {
    // It says when its burn is done, so the reading is taken after the work it is about rather than after a guess
    const worker = new Worker(`const { parentPort } = require('node:worker_threads');
      const end = Date.now() + 400; while (Date.now() < end) {}
      parentPort.postMessage('burnt'); setInterval(() => {}, 1000);`, { eval: true });
    try {
      const work = threadWork(worker);
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
    await expect(execFileWhileWorking(process.execPath, ['-e', 'for (;;) {}'], { timeout: 1_500 })).rejects.toThrow(/was ended: it spent \d+s of CPU/);
  });
});
