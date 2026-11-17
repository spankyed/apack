import { describe, expect, it } from 'vitest';
import { packagesNotCurrent, parseShard, selectOnly, shardArg, STRICT_JOBS, strictJobSteps } from '../../../scripts/lib/chain-only.ts';
import { CHAIN_STEPS, needsApp, orderedSteps } from '../../../scripts/lib/chain-steps.ts';
import { TYPECHECK_LEGS } from '../../../scripts/lib/typecheck-legs.ts';

const STEPS = [
  { name: 'produce', dependsOn: [] },
  { name: 'prepare', dependsOn: ['produce'] },
  { name: 'test', dependsOn: ['produce', 'prepare'] },
  { name: 'other', dependsOn: [] },
];

describe('--shard', () => {
  it('reads k/N for 1 <= k <= N and hands vitest the same', () => {
    expect(parseShard('2/3')).toEqual({ index: 2, total: 3 });
    expect(shardArg(parseShard('3/3'))).toBe('--shard=3/3');
  });

  it.each(['0/3', '4/3', '1', '1/0', 'a/b', '1/3/4'])('refuses %s', (value) => {
    expect(() => parseShard(value)).toThrow('--shard takes k/N');
  });
});

describe('--only', () => {
  it('finds packages:ensure current when no published package is stale', () => {
    expect(packagesNotCurrent([])).toBeNull();
  });

  it('refuses a leg that reads packages:ensure while a published package is stale, saying which, why, and what makes it current', () => {
    const why = packagesNotCurrent([
      { workspace: '@apackdev/ears', reason: 'not built (no packages/apack-ears/dist)' },
      { workspace: '@apackdev/sdk', reason: 'its inputs changed since the last successful run' },
    ]);
    expect(why).toBe('@apackdev/ears: not built (no packages/apack-ears/dist); @apackdev/sdk: its inputs changed since the last successful run; '
      + 'name packages:ensure in --only too, or run npm run packages:ensure first');
    expect(() => selectOnly([{ name: 'packages:ensure', dependsOn: [] }, { name: 'build', dependsOn: ['packages:ensure'] }], ['build'],
      (producer) => producer === 'packages:ensure' ? why : null))
      .toThrow(/build reads packages:ensure, which is not current here \(@apackdev\/ears: not built/);
  });

  it('runs the named steps alone, keeping only the edges between them', () => {
    expect(selectOnly(STEPS, ['prepare', 'test'], () => null)).toEqual([
      { name: 'prepare', dependsOn: [] },
      { name: 'test', dependsOn: ['prepare'] },
    ]);
  });

  it('asks about each producer left out, and nothing else', () => {
    const asked: string[] = [];
    selectOnly(STEPS, ['test'], (producer) => { asked.push(producer); return null; });
    expect(asked.sort()).toEqual(['prepare', 'produce']);
  });

  it('refuses a producer whose outputs are not current here, naming who reads it and why', () => {
    expect(() => selectOnly(STEPS, ['test'], (producer) => producer === 'prepare' ? 'no stamp' : null))
      .toThrow(/--only refused[\s\S]*test reads prepare, which is not current here \(no stamp\)/);
  });

  it('refuses a name that is not a step rather than running nothing', () => {
    expect(() => selectOnly(STEPS, ['test', 'tset'], () => null)).toThrow('--only names no chain step: tset');
  });
});

describe('--job', () => {
  const GRAPH = [
    { name: 'build', dependsOn: [] },
    { name: 'fixtures', dependsOn: ['build'] },
    { name: 'leg', dependsOn: [] },
    { name: 'test:integration', dependsOn: ['fixtures'] },
    { name: 'test:native', dependsOn: ['build'] },
    { name: 'app-build', dependsOn: ['build'] },
    { name: 'app-prepare', dependsOn: ['fixtures'] },
    { name: 'app-test', dependsOn: ['app-build', 'app-prepare', 'fixtures'] },
    { name: 'check', dependsOn: ['build'] },
  ];
  const readsApp = (name: string) => name === 'app-test';

  it('makes the producers everything the pools read, transitively, plus the named legs', () => {
    expect(strictJobSteps(GRAPH, 'producers', ['leg'], readsApp)).toEqual(['build', 'fixtures', 'leg']);
    expect(strictJobSteps(GRAPH, 'integration', ['leg'], readsApp)).toEqual(['test:integration']);
  });

  it('gives the app job what reads the app and what that needs beyond the producers, and rest the remainder', () => {
    expect(strictJobSteps(GRAPH, 'app', ['leg'], readsApp)).toEqual(['app-build', 'app-prepare', 'app-test']);
    expect(strictJobSteps(GRAPH, 'rest', ['leg'], readsApp)).toEqual(['check']);
  });

  it('partitions the real table: every step in exactly one job, each reading only the producers and itself', () => {
    const steps = orderedSteps(CHAIN_STEPS);
    const legs = TYPECHECK_LEGS.map((leg) => leg.name);
    const readsRealApp = (name: string) => needsApp(steps.find((step) => step.name === name)!);
    const byJob = Object.fromEntries(STRICT_JOBS.map((job) => [job, strictJobSteps(steps, job, legs, readsRealApp)]));
    expect(Object.values(byJob).flat().sort()).toEqual(steps.map((step) => step.name).sort());
    expect(byJob.app!.length).toBeGreaterThan(0);
    // Each job but the producers runs only on what the producers made, which `selectOnly` then requires
    const producers = new Set(byJob.producers);
    for (const job of STRICT_JOBS) {
      const own = new Set(byJob[job]);
      for (const step of steps.filter((candidate) => own.has(candidate.name))) {
        expect(step.dependsOn.filter((need) => !producers.has(need) && !own.has(need)), `${job}: ${step.name}`).toEqual([]);
      }
    }
  });
});
