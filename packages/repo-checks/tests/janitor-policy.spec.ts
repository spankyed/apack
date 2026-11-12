import { describe, expect, it } from 'vitest';
import {
  type IncrementalUnit, type ProfileOutput, CRITICAL_FREE_BYTES, IN_USE_WINDOW_MS, LOW_FREE_BYTES, limitsFor, planIdleProfileClearing,
  planIncrementalEviction, planTmpRemoval, TEST_TMP_AGE_MS,
} from '../../../scripts/lib/janitor-policy.ts';

const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 1);
const unit = (name: string, gbs: number, ageMs: number): IncrementalUnit =>
  ({ path: name, profileDir: 'target/debug', bytes: gbs * GB, mtimeMs: NOW - ageMs });

describe('planIncrementalEviction', () => {
  it('evicts the least recently compiled units until the rest fit the budget', () => {
    const units = [unit('newest', 2, 2 * IN_USE_WINDOW_MS), unit('oldest', 2, 30 * IN_USE_WINDOW_MS), unit('middle', 2, 10 * IN_USE_WINDOW_MS)];
    expect(planIncrementalEviction(units, 3 * GB, NOW).map((u) => u.path)).toEqual(['oldest', 'middle']);
  });

  it('evicts nothing within the budget', () => {
    expect(planIncrementalEviction([unit('a', 1, 10 * IN_USE_WINDOW_MS)], 3 * GB, NOW)).toEqual([]);
  });

  it('never evicts a unit a build may be compiling, even over the budget', () => {
    const units = [unit('building', 5, IN_USE_WINDOW_MS / 2), unit('stale', 1, 5 * IN_USE_WINDOW_MS)];
    expect(planIncrementalEviction(units, 1 * GB, NOW).map((u) => u.path)).toEqual(['stale']);
  });
});

describe('limitsFor', () => {
  it('tightens every limit when the disk runs low', () => {
    const roomy = limitsFor(LOW_FREE_BYTES * 2);
    const low = limitsFor(LOW_FREE_BYTES - 1);
    expect(low.incrementalBudgetBytes).toBeLessThan(roomy.incrementalBudgetBytes);
    expect(low.sweepDays).toBeLessThan(roomy.sweepDays);
  });
});

describe('planIdleProfileClearing', () => {
  const profile = (profileDir: string, ageMs: number): ProfileOutput => ({ profileDir, bytes: 4 * GB, builtMs: NOW - ageMs });
  const HOUR = IN_USE_WINDOW_MS;

  it('clears nothing while the disk has room, however long a checkout has sat', () => {
    const { idleProfileMs } = limitsFor(LOW_FREE_BYTES * 2);
    expect(planIdleProfileClearing([profile('old/target/debug', 30 * 24 * HOUR)], idleProfileMs, NOW)).toEqual([]);
  });

  it('clears the checkouts nobody has built in for half a day when the disk is low, and leaves the ones in use', () => {
    const { idleProfileMs } = limitsFor(LOW_FREE_BYTES - 1);
    const profiles = [profile('sat/target/debug', 20 * HOUR), profile('working/target/debug', 3 * HOUR), profile('sat/target/release', 13 * HOUR)];
    expect(planIdleProfileClearing(profiles, idleProfileMs, NOW).map((each) => each.profileDir)).toEqual(['sat/target/debug', 'sat/target/release']);
  });

  it('keeps only what was compiled into within the hour once the disk is nearly full', () => {
    const { idleProfileMs } = limitsFor(CRITICAL_FREE_BYTES - 1);
    const profiles = [profile('working/target/debug', 3 * HOUR), profile('building/target/debug', HOUR / 2)];
    expect(planIdleProfileClearing(profiles, idleProfileMs, NOW).map((each) => each.profileDir)).toEqual(['working/target/debug']);
  });

  it('never clears a profile a build may be writing, whatever it is asked', () => {
    expect(planIdleProfileClearing([profile('building/target/debug', HOUR / 2)], 0, NOW)).toEqual([]);
  });
});

describe('planTmpRemoval', () => {
  it('removes leftovers older than any test, keeping recent ones and the committed .gitignore', () => {
    const entries = [
      { name: '.gitignore', mtimeMs: NOW - 10 * TEST_TMP_AGE_MS },
      { name: '.tmpOld', mtimeMs: NOW - 2 * TEST_TMP_AGE_MS },
      { name: '.tmpRunning', mtimeMs: NOW - 60_000 },
    ];
    expect(planTmpRemoval(entries, NOW).map((e) => e.name)).toEqual(['.tmpOld']);
  });
});
