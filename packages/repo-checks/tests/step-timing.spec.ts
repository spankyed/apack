// The pure readings of a run's timings: the floor lanes could reach, what a run measured, and which passing
// steps are already stale.
import { describe, expect, it } from 'vitest';
import { criticalPath, measurementsFrom, willNotCache } from '../../../scripts/lib/step-timing.ts';
import type { BudgetClass } from '../../../scripts/lib/step-budgets.ts';
import type { SchedulableStep } from '../../../scripts/lib/chain-schedule.ts';

/** A step as the timing readers see it */
type TimedStep = SchedulableStep & { readonly forceArgs?: readonly string[]; readonly timeout?: BudgetClass };

const step = (name: string, dependsOn: string[] = [], extra: Partial<TimedStep> = {}): TimedStep =>
  ({ name, dependsOn, ...extra });

describe('criticalPath', () => {
  it('is the longest path by seconds, not the longest by step count', () => {
    const steps = [
      step('a', [], { seconds: 1 }),
      step('short', ['a'], { seconds: 50 }),
      step('one', ['a'], { seconds: 2 }),
      step('two', ['one'], { seconds: 2 }),
      step('three', ['two'], { seconds: 2 }),
    ];
    expect(criticalPath(steps)).toEqual({ names: ['a', 'short'], seconds: 51 });
  });

  it('ignores a need that is not in the set, so a cached step costs nothing', () => {
    // `b` needs `a`, but only `b` ran — the answer is b alone, not a crash
    expect(criticalPath([step('b', ['a'], { seconds: 4 })])).toEqual({ names: ['b'], seconds: 4 });
  });

  it('counts a step with no measurement as free rather than dropping the path', () => {
    expect(criticalPath([step('a', [], {}), step('b', ['a'], { seconds: 3 })])).toEqual({ names: ['a', 'b'], seconds: 3 });
  });
});

/**
 * What a run measured, which is not the same as what each of its steps took.
 *
 * **A killed step's elapsed time is its deadline, not its cost.** `boundedSpawn` returns when the budget runs
 * out, so a wedged `test:integration` reports ~300s — and every reader of that map takes it for a measurement:
 * the duration window would record 300s as the cost, and `criticalPath` puts the deadline on the floor.
 * Neither is wrong about the number; the number is not a measurement.
 *
 * A step that failed *without* being killed is kept: it ran and stopped early, so its time is real and under,
 * and the window takes only passing steps anyway.
 */
describe('measurementsFrom', () => {
  it('leaves out a step whose time is the deadline it was killed at', () => {
    const measured = measurementsFrom([
      { step: 'build:default-setup', ms: 13_000 },
      { step: 'test:integration', ms: 300_400, timedOut: true },
    ]);

    expect([...measured.keys()], 'a killed step measured nothing').toEqual(['build:default-setup']);
  });

  it('keeps a step that failed early, whose time is real', () => {
    // A failure carries no `timedOut` — only a kill does, which is why the exit code is not a parameter here
    const measured = measurementsFrom([{ step: 'typecheck:renderer', ms: 4_000 }]);

    expect(measured.get('typecheck:renderer'), 'it ran and stopped; the time is under, not invented').toBe(4_000);
  });

  it('keeps every step of a clean run', () => {
    const results = [{ step: 'a', ms: 1_000 }, { step: 'b', ms: 2_000 }];
    expect([...measurementsFrom(results)]).toEqual([['a', 1_000], ['b', 2_000]]);
  });
});

describe('willNotCache', () => {
  const steps = [{ name: 'a' }, { name: 'b' }, { name: 'e2e', neverCachedBecause: 'it drives real Electron' }];
  const passed = new Set(['a', 'b', 'e2e']);

  it('names a step that passed and is already stale again', () => {
    expect(willNotCache(steps, passed, (s) => (s.name === 'b' ? 'its inputs changed since the last successful run' : null)))
      .toEqual([{ name: 'b', reason: 'its inputs changed since the last successful run' }]);
  });

  it('says nothing when every step stayed fresh', () => {
    expect(willNotCache(steps, passed, () => null)).toEqual([]);
  });

  // A step that opts out of caching has no stamp to contradict, so its fingerprint moving means nothing
  it('ignores a step that is never cached', () => {
    expect(willNotCache(steps, passed, (s) => (s.name === 'e2e' ? 'stale' : null))).toEqual([]);
  });

  // A failed step writes no stamp on purpose, so of course it reads as stale; saying so would be noise
  it('ignores a step that did not pass, whose stamp was deliberately not written', () => {
    expect(willNotCache(steps, new Set<string>(), () => 'stale')).toEqual([]);
    expect(willNotCache(steps, new Set(['a']), () => 'stale')).toEqual([{ name: 'a', reason: 'stale' }]);
  });
});
