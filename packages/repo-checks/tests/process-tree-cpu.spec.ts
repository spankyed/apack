import { describe, expect, it } from 'vitest';
import { cpuAdded, createStallTracker, parseCpuTime, treeCpuMs } from '../../../scripts/lib/bounded-spawn.ts';
import { watchdogEnabled } from '../../../scripts/lib/step-timeouts.ts';

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

describe('APACK_WATCHDOG', () => {
  it.each([[undefined, true], ['on', true], ['off', false]])('reads %s', (value, enabled) => {
    expect(watchdogEnabled(value === undefined ? {} : { APACK_WATCHDOG: value })).toBe(enabled);
  });

  it('refuses a value that is neither', () => {
    expect(() => watchdogEnabled({ APACK_WATCHDOG: 'false' })).toThrow(/set it to off/);
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
