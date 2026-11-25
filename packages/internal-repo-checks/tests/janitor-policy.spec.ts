import { describe, expect, it } from 'vitest';
import {
  type IncrementalUnit, type ProfileOutput, type SystemTmpEntry, CRITICAL_FREE_BYTES, IN_USE_WINDOW_MS, LOW_FREE_BYTES,
  classifySystemTmpName, limitsFor, planIdleProfileClearing, planIncrementalEviction, planSystemTmpRemoval, planTmpRemoval,
  psHasCargoMutants, TEST_TMP_AGE_MS,
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

describe('classifySystemTmpName', () => {
  it('classifies only owned temp directory prefixes and rejects unrelated or UID-scoped names', () => {
    expect(classifySystemTmpName('cargo-mutants-elmdb-U6J3Dy.tmp')).toBe('cargo-mutants');
    expect(classifySystemTmpName('apack-published-wRh16J')).toBe('apack-published');
    expect(classifySystemTmpName(`apack-authoring-${'a'.repeat(64)}`)).toBe('apack-authoring');
    expect(classifySystemTmpName('apack-starter-role-switch.cg4odhqQ')).toBe('apack-scratch');
    expect(classifySystemTmpName('apack-claude-post-clear-resume.Z7AlgZ')).toBe('apack-scratch');
    expect(classifySystemTmpName('cc-child-1234-abc')).toBe('apack-scratch');
    expect(classifySystemTmpName('apack-claude-background-501')).toBeUndefined();
    expect(classifySystemTmpName('claude-501')).toBeUndefined();
    expect(classifySystemTmpName('cc-socks')).toBeUndefined();
    expect(classifySystemTmpName('apack-authoring-unrelated')).toBeUndefined();
    expect(classifySystemTmpName(`apack-authoring-${'a'.repeat(63)}`)).toBeUndefined();
    expect(classifySystemTmpName(`apack-authoring-${'g'.repeat(64)}`)).toBeUndefined();
    expect(classifySystemTmpName('node-compile-cache')).toBeUndefined();
  });
});

describe('psHasCargoMutants', () => {
  it('detects cargo-mutants on macOS full paths and Linux comms while ignoring other processes and self', () => {
    expect(psHasCargoMutants('  101 /Users/dev/.cargo/bin/cargo-mutants\n', 999)).toBe(true);
    expect(psHasCargoMutants('  202 cargo-mutants\n', 999)).toBe(true);
    expect(psHasCargoMutants('  303 /usr/bin/node\n  304 cargo\n', 999)).toBe(false);
    expect(psHasCargoMutants('  999 cargo-mutants\n', 999)).toBe(false);
  });
});

describe('planSystemTmpRemoval', () => {
  const HOUR = IN_USE_WINDOW_MS;
  const entry = (
    name: string,
    kind: SystemTmpEntry['kind'],
    ageMs: number,
    extra: Partial<Pick<SystemTmpEntry, 'ownerLive' | 'checkoutExists'>> = {},
  ): SystemTmpEntry => ({ name, path: `/tmp/${name}`, kind, activityMs: NOW - ageMs, ...extra });

  it('removes orphaned cargo-mutants copies past the in-use window when no cargo-mutants process is running, and skips all when one is', () => {
    const { idleProfileMs } = limitsFor(LOW_FREE_BYTES * 2);
    const entries = [
      entry('cargo-mutants-orphaned.tmp', 'cargo-mutants', 2 * HOUR),
      entry('cargo-mutants-running.tmp', 'cargo-mutants', HOUR / 2),
    ];
    expect(planSystemTmpRemoval(entries, idleProfileMs, NOW).map((e) => e.name)).toEqual(['cargo-mutants-orphaned.tmp']);
    expect(planSystemTmpRemoval(entries, 0, NOW).map((e) => e.name)).toEqual(['cargo-mutants-orphaned.tmp']);
    expect(planSystemTmpRemoval(entries, 0, NOW, { cargoMutantsRunning: true })).toEqual([]);
  });

  it('removes apack-published and apack-scratch leftovers after a day when roomy, tightening when low without cutting active runs', () => {
    const entries = [
      entry('apack-published-old', 'apack-published', 2 * TEST_TMP_AGE_MS),
      entry('apack-starter-old.abc123', 'apack-scratch', 2 * TEST_TMP_AGE_MS),
      entry('apack-claude-halfday.xyz789', 'apack-scratch', 13 * HOUR),
      entry('cc-child-recent', 'apack-scratch', 3 * HOUR),
      entry('apack-published-running', 'apack-published', HOUR / 2),
      entry('apack-starter-running', 'apack-scratch', HOUR / 2),
    ];
    expect(planSystemTmpRemoval(entries, limitsFor(LOW_FREE_BYTES * 2).idleProfileMs, NOW).map((e) => e.name))
      .toEqual(['apack-published-old', 'apack-starter-old.abc123']);
    expect(planSystemTmpRemoval(entries, limitsFor(LOW_FREE_BYTES - 1).idleProfileMs, NOW).map((e) => e.name))
      .toEqual(['apack-published-old', 'apack-starter-old.abc123', 'apack-claude-halfday.xyz789']);
    expect(planSystemTmpRemoval(entries, limitsFor(CRITICAL_FREE_BYTES - 1).idleProfileMs, NOW).map((e) => e.name))
      .toEqual(['apack-published-old', 'apack-starter-old.abc123', 'apack-claude-halfday.xyz789', 'cc-child-recent']);
  });

  it('never removes live-owned apack-authoring dirs, sweeps gone checkouts immediately, and reclaims idle checkouts only when low', () => {
    const entries = [
      entry(`apack-authoring-${'1'.repeat(64)}`, 'apack-authoring', 10 * TEST_TMP_AGE_MS, { ownerLive: true, checkoutExists: false }),
      entry(`apack-authoring-${'2'.repeat(64)}`, 'apack-authoring', HOUR / 4, { ownerLive: false, checkoutExists: false }),
      entry(`apack-authoring-${'3'.repeat(64)}`, 'apack-authoring', 20 * HOUR, { ownerLive: false, checkoutExists: true }),
      entry(`apack-authoring-${'4'.repeat(64)}`, 'apack-authoring', 3 * HOUR, { ownerLive: false, checkoutExists: true }),
      entry(`apack-authoring-${'5'.repeat(64)}`, 'apack-authoring', 20 * HOUR, { ownerLive: false, checkoutExists: undefined }),
    ];
    expect(planSystemTmpRemoval(entries, limitsFor(LOW_FREE_BYTES * 2).idleProfileMs, NOW).map((e) => e.name))
      .toEqual([`apack-authoring-${'2'.repeat(64)}`]);
    expect(planSystemTmpRemoval(entries, limitsFor(LOW_FREE_BYTES - 1).idleProfileMs, NOW).map((e) => e.name))
      .toEqual([`apack-authoring-${'2'.repeat(64)}`, `apack-authoring-${'3'.repeat(64)}`, `apack-authoring-${'5'.repeat(64)}`]);
    expect(planSystemTmpRemoval(entries, limitsFor(CRITICAL_FREE_BYTES - 1).idleProfileMs, NOW).map((e) => e.name))
      .toEqual([`apack-authoring-${'2'.repeat(64)}`, `apack-authoring-${'3'.repeat(64)}`, `apack-authoring-${'4'.repeat(64)}`, `apack-authoring-${'5'.repeat(64)}`]);
  });
});
