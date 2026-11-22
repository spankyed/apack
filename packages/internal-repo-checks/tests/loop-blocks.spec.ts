import { describe, expect, it } from 'vitest';
import {
  blockFrom, factorText, headroom, IMPLAUSIBLE_FACTOR, lastPerPid, parseSamples, ranked, roleOf,
  RPC_WINDOW_MS, type Sample, TICK_MS, verdict, verdictLine,
} from '../../../scripts/lib/loop-blocks.ts';
import { TICK_MS as SAMPLER_TICK_MS } from '../../../scripts/lib/loop-sample.mjs';

/**
 * What `npm run measure:loop` decides, asserted without running anything.
 *
 * It exists because `[vitest-worker]: Timeout calling` was attributed to the wrong side twice — to the
 * worker count, then to contention in general — each time from reading rather than measuring, and the
 * error text names neither the process that failed to answer nor the one that failed to listen. So what
 * is asserted here is the classification and the arithmetic that turn samples into that answer.
 */

const sample = (over: Partial<Sample> & Pick<Sample, 'pid'>): Sample => ({
  ppid: 1, worker: null, file: null, argv: 'node', wallMs: 1000, eluPct: 50,
  loopMaxMs: 0, worstGapMs: 0, p99Ms: 0, ...over,
});

describe('the longest a loop went without turning', () => {
  it('takes the histogram when it saw the block', () => {
    expect(blockFrom({ loopMaxMs: 38_000, worstGapMs: 0 })).toBe(38_000);
  });

  /**
   * The case that makes the second source necessary. `monitorEventLoopDelay` records a gap only once the
   * loop turns again and begins measuring at the first turn, so measured — twice — a 4s spin followed by
   * an exit read 0ms from it. A probe that reports a clean run over a process that blocked until it died
   * is worse than no probe.
   */
  it('falls back to the gap between its own ticks for a block that ran until the process exited', () => {
    expect(blockFrom({ loopMaxMs: 0, worstGapMs: 4000 })).toBe(4000 - TICK_MS);
  });

  it('subtracts one period, because every gap contains the normal wait', () => {
    expect(blockFrom({ loopMaxMs: 0, worstGapMs: TICK_MS + 5 })).toBe(5);
    expect(blockFrom({ loopMaxMs: 0, worstGapMs: 10 }), 'never negative').toBe(0);
  });

  // One period, declared twice — in the sampler, which is plain .mjs, and in the half that subtracts it
  it('subtracts the period the sampler actually ticks at', () => {
    expect(TICK_MS).toBe(SAMPLER_TICK_MS);
  });
});

describe('one row per process', () => {
  it('keeps the newest sample, because the histogram is cumulative', () => {
    const rows = lastPerPid([sample({ pid: 7, loopMaxMs: 10 }), sample({ pid: 7, loopMaxMs: 900 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.loopMaxMs, 'the first sample is a process that had barely started').toBe(900);
  });

  // Null until the worker picks a spec up and null again once it lets go, so the newest line often lacks it
  it('carries forward the spec any sample saw', () => {
    const rows = lastPerPid([sample({ pid: 7, file: 'a.spec.ts' }), sample({ pid: 7, file: null })]);
    expect(rows[0]!.file).toBe('a.spec.ts');
  });
});

/**
 * Derived from the recorded process tree, never from what a process is called.
 *
 * The version of this that matched tinypool's entry file by name would have called every process `other`
 * the day tinypool renamed it, and reported a clean run over a pool it could no longer see — the same
 * failure as the spawn gate that read three of twelve files because it restated what to look for.
 */
describe('what each process was', () => {
  const main = sample({ pid: 100, ppid: 1 });
  const worker = sample({ pid: 200, ppid: 100, worker: '1', argv: 'anything-at-all.js' });
  const spawned = sample({ pid: 300, ppid: 200, worker: '1', argv: 'tsc -p' });
  const roles = Object.fromEntries(roleOf([main, worker, spawned]).map((row) => [row.pid, row.role]));

  it('names a pool worker from the tree, whatever its entry file is called', () => {
    expect(roles[200]).toBe('worker');
  });

  // tinypool sets the id in the worker's env, so a compiler the worker spawns carries it too
  it('does not count what a worker spawned, though it inherits the same worker id', () => {
    expect(roles[300]).toBe('spawned');
  });

  it('names the main process as the parent its workers share', () => {
    expect(roles[100]).toBe('main');
  });

  it('leaves a run with no pool as plain processes', () => {
    expect(roleOf([sample({ pid: 100 })])[0]!.role).toBe('process');
  });
});

describe('what the run licenses you to say', () => {
  // A worker, because only a worker has a birpc window — `verdict` ignores everything else
  // ppid 999 is outside the sample set, so each row is the topmost holder of its worker id — a row that
  // is its own parent reads as something a worker spawned, which is what `roleOf` is built to tell apart
  const at = (pid: number, blockMs: number): Sample =>
    sample({ pid, ppid: 999, worker: '1', loopMaxMs: blockMs });
  const rows = roleOf([at(1, 38_000), at(2, 9500), at(3, 0)]);

  /**
   * The block alone reads as fine until it is not: 38s against a 60s window looks comfortable and is one
   * busy afternoon from failing. Reported as 1.6x, it is a sentence someone can act on.
   */
  it('says how much slower a run would have to be to breach', () => {
    expect(headroom(38_000)).toBeCloseTo(RPC_WINDOW_MS / 38_000, 5);
    expect(headroom(0), 'no slowdown brings a process that never blocked into range').toBe(Infinity);
  });

  it('puts the worst block first, so the first line is the answer', () => {
    expect(ranked(rows).map((row) => row.pid)).toEqual([1, 2, 3]);
  });

  it('names the worst and whatever has already breached', () => {
    const { breached, worst } = verdict(rows);
    expect(breached).toEqual([]);
    expect(worst!.pid).toBe(1);
  });

  /**
   * One helper, because the ceiling has to hold everywhere the factor is quoted. It did not: the verdict
   * suppressed an 11ms block's `5454.5x` while the table beside it printed `438.0x` on its own rows.
   */
  it('quotes a factor only where it is a thing that could happen', () => {
    expect(factorText(10_000)).toBe('6.0x');
    expect(factorText(11), 'an 11ms block is arithmetic, not a finding').toBe('');
    expect(factorText(0), 'and nothing at all still blocked nothing').toBe('');
  });

  it('reports a breach as a breach', () => {
    expect(verdict(roleOf([at(1, RPC_WINDOW_MS + 1)])).breached).toHaveLength(1);
  });

  // The window is birpc's DEFAULT_TIMEOUT, hardcoded there and raised by no vitest config
  it('measures against the window vitest actually gives a call', () => {
    expect(RPC_WINDOW_MS).toBe(60_000);
  });
});

/**
 * Said on every run, including the ones where nothing is wrong.
 *
 * The first version printed only when something was already within the factor, so a healthy run printed a
 * table and no judgement — and that is the run somebody quotes as proof that the flake is gone.
 */
describe('the verdict', () => {
  // A worker, because only a worker has a birpc window — `verdict` ignores everything else
  // ppid 999 is outside the sample set, so each row is the topmost holder of its worker id — a row that
  // is its own parent reads as something a worker spawned, which is what `roleOf` is built to tell apart
  const at = (pid: number, blockMs: number): Sample =>
    sample({ pid, ppid: 999, worker: '1', loopMaxMs: blockMs });

  it('names a breach as the failure it causes', () => {
    expect(verdictLine(roleOf([at(1, RPC_WINDOW_MS + 1)]))).toContain('Timeout calling');
  });

  it('says how much room is left on a run where nothing breached', () => {
    const line = verdictLine(roleOf([at(1, 10_000)]));
    expect(line).toContain('6.0x slower breaches');
    expect(line, 'the sentence the table cannot say').toContain('not evidence the flake is gone');
  });

  /**
   * A compiler blocking for 25s is doing its job and cannot fail the way a worker can. Measured under a
   * full chain, four of the five longest blocks were `vue-tsc` and `vite build`, and the verdict quoted
   * the worst of them as "a run 2.4x slower breaches" — true of nothing.
   */
  it('ignores a process that is not a pool worker, since only a worker has a window', () => {
    expect(verdictLine(roleOf([sample({ pid: 9, loopMaxMs: 30_000 })]))).toContain('No pool worker');
  });

  it('still says something when nothing blocked at all', () => {
    expect(verdictLine(roleOf([at(1, 0)]))).toContain('No pool worker');
    expect(verdictLine([]), 'and over no processes at all').toContain('No pool worker');
  });

  // "a run 5454.5x slower breaches" is true, and a report carrying one number like that is read more
  // sceptically for the rest of them
  it('does not quote a factor that is arithmetic rather than a thing that could happen', () => {
    expect(verdictLine(roleOf([at(1, 11)])), 'an 11ms block is not news').toContain('No pool worker');
    expect(verdictLine(roleOf([at(1, RPC_WINDOW_MS / (IMPLAUSIBLE_FACTOR - 1))]))).toContain('slower breaches');
  });
});

describe('reading what the sampler wrote', () => {
  it('skips the partial last line an interrupted run leaves', () => {
    const text = `${JSON.stringify(sample({ pid: 1 }))}\n{"pid":2,"ppi`;
    expect(parseSamples(text).samples.map((row) => row.pid)).toEqual([1]);
  });

  /**
   * Counted, not swallowed. ~200 processes append to one file, so a torn line is a process missing from
   * the answer — measured, 957 lines across three runs were all intact, because a line is about 270 bytes
   * and an `O_APPEND` write under `PIPE_BUF` is atomic. Which is the point: a value that should never
   * appear still has to be reportable, or the first run where it does looks clean.
   */
  it('counts what it could not read rather than dropping it silently', () => {
    expect(parseSamples(`{"pid":2,"ppi\n${JSON.stringify(sample({ pid: 1 }))}\nalso not json`))
      .toMatchObject({ dropped: 2 });
  });

  it('is empty for an empty file rather than throwing', () => {
    expect(parseSamples('\n')).toEqual({ samples: [], dropped: 0 });
  });
});
