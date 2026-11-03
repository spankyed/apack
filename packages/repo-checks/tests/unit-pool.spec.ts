// Reading a run's own reporter to find out what it actually covered.
//
// The pool asks for N projects with `--project` and then stamps all N. That is only sound if the filter
// selected them: measured, `--project @apackdev/ears --project @apackdev/no-such-project` runs ears, drops the
// second silently and exits 0. Only a filter matching *nothing at all* is an error. So a suite whose
// workspace stopped matching its vitest project name would be stamped as having passed a run it was
// excluded from — the same "recorded fresh having never run" the pool was already fixed for once.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import { declaredPaths, diffableStamp } from '@apackdev/host/build/packages-built';
import { DIAGNOSTIC_RUN_ENV, CHAIN_CORES_ENV, holdPoolLock, poolWorkers, poolWorkerLimit, POOLS, livePoolStamps, poolLockFor, measureCommandFor, poolStampFor, poolUnitFor, projectsThatDidNotRun, recordRun, recordsVerdict, whyItRuns, type Pool } from '../../../scripts/lib/unit-pool.ts';
import type { ReportedRun } from '../../../scripts/lib/spec-durations-reporter.ts';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { unitFor } from '../../../scripts/lib/chain-stamps.ts';
import { CHAIN_STEPS, poolStepName } from '../../../scripts/lib/chain-steps.ts';
import { coresFor } from '../../../scripts/lib/core-budget.ts';
import { poolDurationLines } from '../../../scripts/lib/unit-pool.ts';
import { writeDurations } from '../../../scripts/lib/spec-durations.ts';
import { CONFIG_BY_HALF, HALVES } from '../../../scripts/lib/spec-halves.ts';
import { CHAIN_RUN_ENV, PROVENANCES, provenanceOf } from '../../../scripts/lib/unit-pool.ts';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';

/** A run as its reporter recorded it, which is the only account the pool reads now */
/**
 * Under what conditions a pass counts, which is a different question from whether the inputs moved.
 *
 * The two cache layers over a pool — the chain's step stamp and the per-project stamps — cannot disagree
 * about *freshness*: a step's inputs are `inputsForSuites`, the union of the same `suiteInputs` each
 * project is keyed on, so a cached step cannot hide a stale project. What they could disagree about is who
 * established the pass, and that is the hole this closes.
 *
 * Three commands reproduced it, observed on 2026-10-06: `npm run test:unit:host` passes serially and
 * writes eleven project stamps; `npm run chain` finds its own step stamp stale and runs the pool; the pool
 * finds every project fresh, runs **zero tests**, and the step records green in 0.8s. The chain had then
 * reported green for suites it never ran under its own concurrency — which is the only condition that
 * reproduces what it was built to catch. The chain already refuses to inherit its *own* lone retry
 * (`DIAGNOSTIC_RUN_ENV`); this is the same rule through the other door.
 */
describe('the chain budget bounds actual Vitest pools', () => {
  const pools = Object.keys(POOLS) as Pool[];

  it('keeps standalone config defaults and converts the chain budget to each pool width', () => {
    for (const pool of pools) {
      expect(poolWorkers(pool, {})).toBeUndefined();
      expect(poolWorkers(pool, { [CHAIN_CORES_ENV]: '2' })).toBe(Math.min(2, poolWorkerLimit(pool)));
    }
    expect(poolWorkers('integration', { [CHAIN_CORES_ENV]: '10' })).toBe(Math.min(5, poolWorkerLimit('integration')));
    expect(poolWorkers('host', { [CHAIN_CORES_ENV]: '10' })).toBe(Math.min(9, poolWorkerLimit('host')));
    for (const pool of pools) expect(poolWorkers(pool, { [CHAIN_CORES_ENV]: '1000' })).toBe(poolWorkerLimit(pool));
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('refuses invalid budget handoff %s', value => {
    expect(() => poolWorkers('integration', { [CHAIN_CORES_ENV]: value })).toThrow(CHAIN_CORES_ENV);
  });

  it('gives Vitest the worker cap as an option it reads, down to a one-worker run', () => {
    for (const pool of pools) {
      const workers = poolWorkers(pool, { [CHAIN_CORES_ENV]: '1' });
      for (const run of POOLS[pool].run(POOLS[pool].suites(), workers)) {
        const args = run.args.filter(arg => arg.startsWith('--maxWorkers'));
        const { options } = parseCLI(['vitest', 'run', ...args]);
        expect(Number(options.maxWorkers), pool).toBe(1);
      }
    }
  });

  it('keys both cache layers by the worker configuration that actually ran', () => {
    for (const pool of pools) {
      const step = CHAIN_STEPS.find(step => step.name === poolStepName(pool))!;
      const suite = POOLS[pool].suites()[0]!;
      expect(unitFor(step, 2).command === unitFor(step, 10).command, pool)
        .toBe(poolWorkerLimit(pool, 2) === poolWorkerLimit(pool, 10));
      expect(unitFor(step, 1000).command, pool).toBe(unitFor(step).command);
      expect(poolUnitFor(suite, pool, 'chain', 1).command, pool)
        .not.toBe(poolUnitFor(suite, pool, 'chain', 5).command);
      expect(measureCommandFor(step.name, 1), pool).toContain('--maxWorkers=1');
    }
    const build = CHAIN_STEPS.find(step => step.name === 'build:runtime')!;
    expect(unitFor(build, 2).command).toBe(unitFor(build, 10).command);
  });
});

describe('a pass under the chain and a pass alone are different records', () => {
  const suite = UNIT_SUITES.find((one) => one.kind === 'host')!;

  it('reads the chain\'s own signal, and calls everything else alone', () => {
    expect(provenanceOf({ [CHAIN_RUN_ENV]: '1' })).toBe('chain');
    expect(provenanceOf({})).toBe('alone');
    // Only the exact signal, as `recordsVerdict` treats its own: a stray value is not the chain
    expect(provenanceOf({ [CHAIN_RUN_ENV]: 'true' })).toBe('alone');
  });

  /**
   * The preimage differs, which is the half that decides anything.
   *
   * `unitStaleReason` consults the fingerprint and nothing else, by design — it recomputes its own side —
   * so a record found under one name carrying the other's preimage reads as **fresh**. Putting the
   * provenance only in the path would leave the hole exactly where it was, which is the mistake the half
   * was added to this key to fix.
   */
  it('hashes differently, so neither reads the other as fresh', () => {
    const [chain, alone] = PROVENANCES.map((provenance) => poolUnitFor(suite, 'host', provenance));
    expect(chain!.command).not.toBe(alone!.command);
    expect(declaredPaths(chain!), 'the inputs are the same work either way').toEqual(declaredPaths(alone!));
  });

  it('keeps them in separate files, so a reader of the cache can tell them apart', () => {
    const [chain, alone] = PROVENANCES.map((provenance) => poolStampFor(suite, 'fast', provenance));
    expect(chain).not.toBe(alone);
  });

  /**
   * And a prune keeps both, which is the thing easiest to get wrong here.
   *
   * `livePoolStamps` is what `prunePoolStamps` spares. Derived over one provenance it would delete the
   * other's records on every run — so the chain would clear a developer's loop and the loop would clear
   * the chain's, and each would look like a cache that never warms.
   */
  it('spares both from a prune', () => {
    const live = livePoolStamps();
    for (const provenance of PROVENANCES) {
      expect(live, `${provenance} records would be pruned on every run`)
        .toContain(path.basename(poolStampFor(suite, 'fast', provenance)));
    }
    expect(live.size, 'one record per suite, half and provenance').toBe(
      (Object.keys(POOLS) as Pool[]).reduce((sum, name) => sum + POOLS[name].suites().length, 0) * PROVENANCES.length,
    );
  });
});

it('forwards integration fail-fast to project configs through the CLI', () => {
  const [{ args }] = POOLS.integration.run(POOLS.integration.suites(), 2);
  expect(args).toContain('--bail=1');
});

/**
 * Every way this repo runs a unit suite carries the durations reporter.
 *
 * **This is the check the defect it covers went without.** `scripts/test-unit.ts` ran the suites through
 * its own copy of what a pool is and spawned vitest directly, so `npm run test:unit` — the command a person
 * runs by hand — carried no reporter, checked no `@slow:` marker and wrote no duration. Nothing failed,
 * because nothing asked. The durations are now a thing a run has to opt into, which makes "did every
 * launcher opt in" the question worth gating, and both halves of it are derived rather than listed.
 */
describe('a unit suite is never run without the durations reporter', () => {
  const REPORTER = 'spec-durations-reporter.ts';

  it('is passed by every pool, for every run it builds', () => {
    const pools = Object.keys(POOLS) as Pool[];
    expect(pools.length, 'no pools derived, so this passes over nothing').toBeGreaterThan(2);
    for (const pool of pools) {
      const runs = POOLS[pool].run(POOLS[pool].suites());
      expect(runs.length, `${pool} builds no run`).toBeGreaterThan(0);
      for (const { args } of runs) {
        expect(args.some((arg) => arg.includes(REPORTER)), `${pool}: ${args.join(' ')}`).toBe(true);
        // Naming any reporter replaces the human output, so the default has to be asked for back
        expect(args, `${pool} would lose vitest's own output`).toContain('--reporter=default');
      }
    }
  });

  /**
   * And no other script launches one, which is the half that would have caught the defect.
   *
   * A pool's own args are easy to keep right; what went wrong was a *second launcher*. So this asks the
   * tree instead: any script naming `vitest` as the thing it runs has to be one of the pools or carry a
   * reason. The reasons are specific — `spec-plan.ts` builds the `npm run spec` runs, which are a
   * different question (which specs cover a change) and carry their own counting reporter.
   */
  const LAUNCHES_VITEST_BY_DESIGN: Record<string, string> = {
    'lib/spec-plan.ts': 'the runs `npm run spec` builds — a different question from a pool, and they carry '
      + "spec-count-reporter.ts, whose count is what tells a covered run from one that did nothing",
    'lib/unit-pool.ts': 'the pools themselves, whose args the case above checks',
  };

  const launchers = (): string[] => {
    const root = path.join(REPO_ROOT, 'scripts');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
    // `'vitest'` as an argument, which is how a spawn names the binary — not the word in a comment or a
    // path like `vitest.config.ts`, which every chain step declares
    return walk(root)
      .filter((file) => /['"`]vitest['"`]\s*,/.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(root, file))
      .sort();
  };

  it('finds the launchers, so this is not vacuous', () => {
    expect(launchers().length, 'no script names vitest as a spawn, so the rule below sees nothing')
      .toBeGreaterThan(0);
  });

  it('leaves no script launching one outside the pools', () => {
    const stray = launchers().filter((file) => !(file in LAUNCHES_VITEST_BY_DESIGN));
    expect(stray, 'run the suites through scripts/test-unit-pool.ts, or add a reason here: a launcher of '
      + 'its own gets no durations reporter, so it checks no @slow: marker and records nothing').toEqual([]);
  });

  // A list of exceptions is honest only while each entry is still one
  it('lists no exception that has stopped launching one', () => {
    const live = new Set(launchers());
    expect(Object.keys(LAUNCHES_VITEST_BY_DESIGN).filter((file) => !live.has(file)),
      'drop these from LAUNCHES_VITEST_BY_DESIGN').toEqual([]);
  });
});

/**
 * Each pool's chain step, which is two declarations held to each other rather than one generator.
 *
 * `poolStepName` cannot *be* the table's name: `declaredAt` finds a generated step by matching the
 * template literal it came from, so a call there left all three pool steps unlocatable and a run unable to
 * point at their reasoning. So the table writes the names and this checks the reverse lookup lands on a
 * real step — which is the firing case for a rename of either one alone.
 */
describe('poolStepName', () => {
  it('names a step the table really has, for every pool', () => {
    const names = new Set(CHAIN_STEPS.map((step) => step.name));
    for (const pool of Object.keys(POOLS) as Pool[]) {
      expect(names, `${pool} pool's step`).toContain(poolStepName(pool));
    }
  });

  it('gives each pool its own step, so no two report from one', () => {
    const named = (Object.keys(POOLS) as Pool[]).map(poolStepName);
    expect(new Set(named).size, named.join(', ')).toBe(named.length);
  });
});

/**
 * The command a report hands a reader to measure one step on its own.
 *
 * **The defect it exists to prevent is advice that measures nothing.** All three pools cache inside
 * themselves, so `npm run test:integration` a second time finds every project up to date and returns at
 * once — and the report this feeds is only ever read *after* a run, when that cache is warm. So a pool has
 * to name the invocation underneath, which is why this is derived from `POOLS[pool].run` rather than
 * templated from the step's name.
 */
describe('measureCommandFor', () => {
  const pools = (): Pool[] => Object.keys(POOLS) as Pool[];

  it('never hands a pool step its own npm script, which would measure a warm cache', () => {
    expect(pools().length, 'no pools derived, so this passes over nothing').toBeGreaterThan(2);
    for (const pool of pools()) {
      const step = poolStepName(pool);
      expect(measureCommandFor(step), `${pool} pool`).not.toBe(`npm run ${step}`);
    }
  });

  /**
   * The whole pool, because the step's cost is the whole pool's: a command that ran the stale subset would
   * answer a cheaper question and read as a step that had shrunk.
   */
  it('names every suite the pool has, not a subset', () => {
    for (const pool of pools()) {
      const said = measureCommandFor(poolStepName(pool));
      const suites = POOLS[pool].suites();
      expect(suites.length, `${pool} pool has no suites`).toBeGreaterThan(0);
      for (const suite of suites) {
        expect(said, `${pool} pool omits ${suite.workspace}`).toContain(suite.workspace);
      }
    }
  });

  // Derived rather than copied: it runs whatever the pool runs, so a change to a pool's command carries
  it("runs what the pool runs, down to the executable", () => {
    for (const pool of pools()) {
      const [first] = POOLS[pool].run(POOLS[pool].suites());
      expect(first, `${pool} builds no run`).toBeDefined();
      expect(measureCommandFor(poolStepName(pool)).startsWith(`${first!.command} `), `${pool} pool`).toBe(true);
    }
  });

  /**
   * Two things a person has to be able to paste. The durations reporter is machinery rather than
   * measurement — and it is an absolute path, in a line printed to a terminal — and npm's `--` forwards
   * the flags after it, so with the reporter gone a trailing one forwards nothing and reads as a typo.
   */
  it('leaves out the durations reporter, and the separator that was only there for it', () => {
    for (const pool of pools()) {
      const said = measureCommandFor(poolStepName(pool));
      expect(said, `${pool} pool`).not.toContain('spec-durations-reporter');
      expect(said.endsWith(' --'), `${pool} pool: ${said}`).toBe(false);
    }
  });

  it("gives every other step its npm script, since nothing else caches inside itself", () => {
    const poolSteps = new Set(pools().map(poolStepName));
    const others = CHAIN_STEPS.filter((step) => !poolSteps.has(step.name));
    expect(others.length, 'no other steps, so this passes over nothing').toBeGreaterThan(0);
    for (const step of others) {
      expect(measureCommandFor(step.name), step.name).toBe(`npm run ${step.name}`);
    }
  });
});

const ran = (...projects: string[]): ReportedRun => ({ projects, modules: [] });

/**
 * What a run covered, and what it did not.
 *
 * **This used to read vitest's console labels, and the cases that went with it are worth knowing about.**
 * `formatProjectName` writes `|name|` when colour is unsupported and a space-padded coloured name when it
 * is, so there were two spellings to handle, one of them copied byte for byte from a real run after a
 * version that guessed at it failed every coloured run while reporting that no project had run. Two cases
 * also encoded limits that were the *parse's* and not the question's: a single-project run prints no label
 * at all, so absence proved nothing there, and a project that ran zero files appeared in no output.
 *
 * The reporter names every project the run started, so none of that survives: there is no spelling, no
 * minimum project count, and no case this cannot answer.
 */
describe('projectsThatDidNotRun', () => {
  const asked = ['@apackdev/ears', '@app/main'];

  it('names a project that was asked for and never reported', () => {
    expect(projectsThatDidNotRun(asked, ran('@apackdev/ears'))).toEqual(['@app/main']);
  });

  it('says nothing when every project reported', () => {
    expect(projectsThatDidNotRun(asked, ran('@apackdev/ears', '@app/main'))).toEqual([]);
  });

  it('names them all when the filter matched none of several', () => {
    expect(projectsThatDidNotRun(asked, ran())).toEqual(asked);
  });

  /**
   * And it answers for a single-project run, which the parse could not.
   *
   * The pack pool runs exactly one project per invocation, so this was the common case and the one with
   * no coverage: vitest prints no label for it, and the old check returned `[]` for any run of fewer than
   * two projects. A pack suite whose workspace name had drifted would have been stamped on a run it was
   * excluded from, and nothing could have said so.
   */
  it('answers for a one-project run, where a label was never printed', () => {
    expect(projectsThatDidNotRun(['@app/default-setup'], ran())).toEqual(['@app/default-setup']);
    expect(projectsThatDidNotRun(['@app/default-setup'], ran('@app/default-setup'))).toEqual([]);
  });

  // A project the run started and found no file for is still a project that ran, and it is nameable from
  // nowhere else: it appears in no reporter's output, only in the specifications the run began with
  it('counts a project that reported no files, which no output could have shown', () => {
    expect(projectsThatDidNotRun(['@apackdev/ui'], { projects: ['@apackdev/ui'], modules: [] })).toEqual([]);
  });
});

/**
 * A pool runs a subset, so every non-empty run claims something about which projects moved — and `--dry` cannot
 * settle it, because it reports on the step, a different unit with a different input set.
 */
describe('whyItRuns', () => {
  // Through the reader the caller uses, so these cases cannot drift from what it accepts: the signature takes a
  // read rather than a record precisely so a caller cannot reach the digests without having been told they are
  // readable, and a fixture built by hand would be free of that
  const read = (record: Parameters<typeof diffableStamp>[0]) => diffableStamp(record);
  const stamped = { fingerprint: 'abc', declared: ['packages/x/src'], files: { 'packages/x/src/a.ts': 'd' } };

  it('names what moved, which is the whole of what the line adds', () => {
    expect(whyItRuns(read(stamped), () => 'changed packages/x/src/a.ts (and 2 more)'))
      .toBe('changed packages/x/src/a.ts (and 2 more)');
  });

  /**
   * Live in this store, not hypothetical: `apack-unit-pool/apack-ears.json` is a 175-byte stamp from before
   * the digests were recorded, and `node_modules/.cache` is never cleared, so it is what a machine has today.
   */
  it('says so when the stamp predates the digests, rather than guessing', () => {
    expect(whyItRuns(read({ fingerprint: 'abc' }), () => 'changed a.ts'))
      .toBe('its last run recorded no per-file digests');
  });

  it('distinguishes a project that has never run from one whose inputs moved', () => {
    expect(whyItRuns(read(undefined), () => 'changed a.ts')).toBe('has not run yet');
    expect(whyItRuns(read({}), () => 'changed a.ts')).toBe('has not run yet');
  });

  /** The diff can come back empty on a walk-time race; the line still has to say something true */
  it('falls back to the verdict when the diff names nothing', () => {
    expect(whyItRuns(read(stamped), () => '')).toBe('its inputs changed');
  });

  /**
   * The defect as a property rather than a string: a stamp this reader will not hand over must not be diffed at
   * all. It was — the digests were read and a file named, beside a reason saying the stamp could not be read —
   * so the thing to hold is that the diff is never reached, not merely that the words came out right.
   *
   * The subject used to be a version the reader did not recognise. It is now a digest map holding something
   * that is not a digest, which is the same state for this line's purpose and one the bytes on disk declare for
   * themselves rather than one a human had to remember to announce.
   */
  it('never computes the diff for a stamp it may not compare', () => {
    let asked = false;
    const unreadable = read({ ...stamped, files: { 'packages/x/src/a.ts': 7 } });
    expect(whyItRuns(unreadable, () => { asked = true; return 'changed packages/x/src/a.ts'; }))
      .toBe('its record of what it read is in a shape this cannot read');
    expect(asked, 'it diffed digests whose shape says nothing about the tree').toBe(false);
  });
});


// What a pool is, and what two of them may not share.
//
// A suite with an expensive half runs twice over one input set, and the two runs are not interchangeable: its
// fast half can have passed while the integration half never has. So the stamp is keyed by the half as well as
// the directory, and the invariant that makes the integration pool safe to cache at all is that no two
// (suite, half) pairs any pool asks for land on one file. One key for both would let the second be skipped on
// the first's record — the hole that kept the expensive half from being pooled until now.
//
// The subject is derived from `POOLS` rather than listed, so a fourth pool is covered on arrival.
describe('the pools', () => {
  const names = Object.keys(POOLS) as Pool[];
  /**
   * Every record a pool could write: a suite, in a pool, under a provenance.
   *
   * The provenance joined this on 2026-10-06 and the two uniqueness cases below are what hold it. A pass
   * established alone is not a pass under the chain — the rule the chain already applies to its own retry —
   * so the two keep separate stamps, and nothing but a distinct preimage makes that true.
   */
  const entries = names.flatMap((name) => POOLS[name].suites().flatMap((suite) =>
    PROVENANCES.map((provenance) => ({ name, suite, provenance, half: POOLS[name].half }))));

  it('there are some, and none of them is empty', () => {
    expect(names).not.toEqual([]);
    for (const name of names) expect(POOLS[name].suites(), `the ${name} pool covers no suite`).not.toEqual([]);
  });

  it('give no two of their projects the same stamp', () => {
    const keys = entries.map(({ suite, half, provenance }) => poolStampFor(suite, half, provenance));
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicated, 'two pools would write one stamp, so running either would mark the other fresh')
      .toEqual([]);
  });

  /**
   * And the content twin of that case, which is the one that can give a wrong answer.
   *
   * A distinct path is where a record is kept; what says *which* record it is has to be in the preimage,
   * because `unitStaleReason` recomputes its own side and consults nothing else on the stamp. Until the
   * command joined `poolUnitFor`, the three two-half suites hashed identical preimages, and a stamp read
   * under the wrong key would have come out **fresh** — the expensive half skipped on the fast half's
   * record, which is the hole this pool was fixed for once already.
   *
   * On the preimage rather than the digest of it: `fingerprintUnit` would walk every input of fifteen units,
   * seconds of hashing for a question about identity, and the bytes are the one part that is the same for
   * both halves by definition. These two are what the hash is a function of beside them.
   */
  it('give no two of their projects the same preimage', () => {
    const identity = entries.map(({ name, suite, provenance }) => {
      const unit = poolUnitFor(suite, name, provenance);
      return JSON.stringify([declaredPaths(unit), unit.command]);
    });
    const duplicated = identity.filter((key, index) => identity.indexOf(key) !== index);
    expect(duplicated, 'two units hash the same preimage, so either one\'s stamp reads as fresh for the other')
      .toEqual([]);
  });

  /**
   * What makes them differ, named — so the case above cannot pass on an accident of the declared set.
   *
   * The command is taken from the pool's own `run`, which is why it is specific enough to be worth hashing:
   * the integration pool names the config it passes, and the host pool the wrapper that supplies the
   * `@apackdev/source` condition. Two pools running one suite two ways is the whole subject.
   */
  it('record what each pool would run, as its command', () => {
    // Counted over pools, not entries: every suite has an entry per provenance, so counting those called
    // each one "in two pools" and picked a suite that is in one
    const [both] = entries.filter(({ suite }) =>
      (Object.keys(POOLS) as Pool[]).filter((name) => POOLS[name].suites().some((one) => one.dir === suite.dir)).length > 1);
    expect(both, 'no suite is in two pools, so this case has nothing to be about').toBeDefined();
    const commands = (Object.keys(POOLS) as Pool[])
      .filter((name) => POOLS[name].suites().some((suite) => suite.dir === both!.suite.dir))
      .map((name) => poolUnitFor(both!.suite, name, 'chain').command ?? '');
    expect(commands.filter((command) => command.includes('vitest.integration.config.ts')).length,
      'no command names the config that makes it the expensive half').toBe(1);
    expect(new Set(commands).size, 'two pools run this suite and their commands do not differ').toBe(commands.length);
  });

  it('reach every unit suite, each in exactly one of the fast pools', () => {
    // One provenance, since the question is which pool covers a suite and not how many records it keeps
    const fast = entries.filter(({ half, provenance }) => half === 'fast' && provenance === 'chain')
      .map(({ suite }) => suite.dir);
    expect(fast.sort()).toEqual(UNIT_SUITES.map((suite) => suite.dir).sort());
  });

  /**
   * What prune keeps. The dead files it has to recognise are the shapes the key used to have: a stamp named
   * for the directory alone, from before the half joined it, and one named for the directory and half, from
   * before the provenance did. Either would be read as some other record's — which is the whole reason both
   * components are in the key.
   */
  it('count their own stamps live and nothing else', () => {
    const live = livePoolStamps();
    expect(live.size).toBe(entries.length);
    const shape = new RegExp(`\\.(${HALVES.join('|')})\\.(${PROVENANCES.join('|')})\\.json$`);
    expect([...live].filter((file) => !shape.test(file)),
      'a stamp keyed by less than the suite, half and provenance is an earlier shape, which prune must drop')
      .toEqual([]);
  });
});

/**
 * What a run is allowed to record. A run that covers only part of a suite — a shard — must record no project
 * stamp, or the next run would skip projects it never finished.
 */
describe('a diagnostic run', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A unit over one real file, since the fingerprint is of bytes on disk */
  function fixture(): { unit: { inputs: string[]; outputs: never[]; command: string }; stamp: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-record-run-'));
    made.push(dir);
    const input = path.join(dir, 'input.ts');
    fs.writeFileSync(input, 'export const x = 1;\n');
    return { unit: { inputs: [input], outputs: [], command: 'a command' }, stamp: path.join(dir, 'stamp.json') };
  }

  it('is what the environment says it is, and an ordinary run is the default', () => {
    expect(recordsVerdict({})).toBe(true);
    expect(recordsVerdict({ [DIAGNOSTIC_RUN_ENV]: '1' })).toBe(false);
  });

  it('does the work and records none of it, where an ordinary run records what it covered', async () => {
    const ordinary = fixture();
    let ran = 0;
    await recordRun([{ label: 'ordinary', unit: ordinary.unit, stamp: ordinary.stamp }], () => { ran += 1; }, {});
    expect(fs.existsSync(ordinary.stamp), 'an ordinary run must still stamp, or nothing is ever cached').toBe(true);

    const diagnostic = fixture();
    await recordRun([{ label: 'diagnostic', unit: diagnostic.unit, stamp: diagnostic.stamp }],
      () => { ran += 1; }, { [DIAGNOSTIC_RUN_ENV]: '1' });
    expect(ran, 'a diagnostic run still does the work').toBe(2);
    expect(fs.existsSync(diagnostic.stamp),
      'a diagnostic run recorded a verdict it did not establish for the whole suite').toBe(false);
  });

  /**
   * And it leaves alone what it may not write. `stampedRunAll` clears a stamp before the run, so reaching it at
   * all would invalidate a record this run is not permitted to replace — a pass it cannot report.
   */
  it('neither writes nor clears an existing record', async () => {
    const { unit, stamp } = fixture();
    await recordRun([{ label: 'first', unit, stamp }], () => {}, {});
    const recorded = fs.readFileSync(stamp, 'utf-8');

    await recordRun([{ label: 'second', unit, stamp }], () => {}, { [DIAGNOSTIC_RUN_ENV]: '1' });
    expect(fs.readFileSync(stamp, 'utf-8')).toBe(recorded);
  });
});

/**
 * The lines a finished pool run prints, which nothing could assert until the function took its root.
 *
 * It is the most-read output in this subsystem — every chain run and every `npm run test:unit` shows it —
 * and it was checked nowhere, because it read the real cache and this machine's core count. Both come from
 * the caller now, so a cache can be planted under a temp root and every line read back. The partial-run
 * guard below had no case at all before this; it rested on one hand-run check.
 */
describe('poolDurationLines', () => {
  const temp: string[] = [];
  afterEach(() => {
    for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A root holding a cache, and the package tree the marker scan walks.
   *
   * Both, because the lines are built from two readings of the root: the duration records, and each
   * covered suite's specs, which `markedSpecs` walks for `@slow:` headers. A fixture with only the first
   * is not a stand-in for a repo root — it throws on the walk.
   */
  const planted = (perSuite: Record<string, { file: string; ms: number; overheadMs: number }[]>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-lines-'));
    temp.push(root);
    for (const suite of POOLS.host.suites()) {
      fs.mkdirSync(path.join(root, 'packages', suite.dir, 'tests'), { recursive: true });
    }
    for (const [dir, files] of Object.entries(perSuite)) {
      writeDurations(root, files.map((f) => ({ dir, half: 'fast' as const, ...f })), new Date().toISOString());
    }
    return root;
  };

  /** Every suite the host pool covers, so a planted cache can be a whole half */
  const hostSuites = POOLS.host.suites().map((suite) => suite.dir);
  const one = (ms: number, overheadMs: number) => [{ file: 'tests/a.spec.ts', ms, overheadMs }];
  const whole = (files: Record<string, { file: string; ms: number; overheadMs: number }[]>) =>
    planted({ ...Object.fromEntries(hostSuites.map((dir) => [dir, one(10, 10)])), ...files });

  const lines = (root: string, workers = 10): string[] =>
    poolDurationLines('host', 6, new Date(0), { root, workers });

  it('leads with the half it measured, and what it cost around the tests', () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/a.spec.ts', ms: 4000, overheadMs: 1000 }] });
    expect(lines(root)[0]).toMatch(/fast half, \d+ file\(s\) this run measured, .* of import and setup around them/);
  });

  // The figure whose absence let an 18.3s floor read as binding: `work/cores` against the floor, and which wins
  it('says which of the floor and the work bounds the run', () => {
    // Work-bound: many files of middling cost, so the total over ten cores beats any one of them
    const work = planted(Object.fromEntries(hostSuites.map((dir) =>
      [dir, Array.from({ length: 20 }, (_, n) => ({ file: `tests/a${n}.spec.ts`, ms: 3000, overheadMs: 500 }))])));
    expect(lines(work)[1]).toMatch(/work\/cores against a .* floor — work-bound/);
    // Floor-bound: one file larger than everything else put together
    const floor = whole({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 60_000, overheadMs: 1000 }] });
    expect(lines(floor)[1]).toMatch(/floor — floor-bound/);
  });

  /**
   * And says what the verdict is not, where the reader is.
   *
   * Both figures are measured inside the pool, so they compare with each other and with nothing else —
   * and a reader who takes `floor-bound` as "split that file and the run shortens" is doing what this repo
   * already did: the integration half's largest file came apart as intended, 42.1s to 19.6s and 18.3s,
   * while the pool went 49.9s to 51.4s. The caveat is long on `halfBound` and no use there to someone
   * reading a chain run, which is why it is a clause and why this case holds it to the line.
   */
  it('says the verdict is the larger figure and not a prediction', () => {
    const floor = whole({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 60_000, overheadMs: 1000 }] });
    expect(lines(floor)[1]).toContain('not a prediction of the wall');
  });

  /**
   * And the remainder, where the caller measured the step.
   *
   * `max(floor, work/cores)` is a lower bound and a real run sits above it — nineteen seconds above, on the
   * integration half. Two numbers side by side cannot show that, which is how the pair came to be read as a
   * prediction; the third makes the gap a fact. A spec reading the cache passes no wall and gets no line.
   */
  it('names what neither figure accounts for, once a caller measures the step', () => {
    // Overhead non-zero, or `halfBound` reads the record as predating the field and withholds the verdict —
    // which is the other reason this line can be absent, and is covered above
    const root = whole({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 19_000, overheadMs: 1000 }] });
    const bound = lines(root)[1]!;
    expect(bound, 'the fixture is floor-bound on its one big file').toContain('20.0s floor');

    const measured = poolDurationLines('host', 6, new Date(0), { root, workers: 10, wallMs: 32_000 });
    expect(measured.find((line) => line.includes('is neither figure')),
      "the step's 32s over a 20s bound leaves 12s")
      .toMatch(/12\.0s\s+of the step's 32\.0s is neither figure/);

    expect(lines(root).join('\n'), 'and nothing of the sort without a wall to compare against')
      .not.toContain('is neither figure');
  });

  /**
   * And draws no verdict where overhead was never recorded, rather than the wrong one.
   *
   * A record written before that field reads with overhead zero, which understates the work and so makes
   * the floor look binding — the reading that split a 96-case file for nothing.
   */
  it('withholds the verdict where a record predates overhead', () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/a.spec.ts', ms: 4000, overheadMs: 0 }] });
    expect(lines(root)[1]).toMatch(/which binds is unknown: \d+ file\(s\) predate overhead/);
  });

  /**
   * The partial-run guard, in both directions.
   *
   * "Out of line with its half" is unanswerable from part of one: a run covering a single suite's
   * integration half read 23.2s over 9.1s across 7 files, which is 2.54x and an artefact of the population.
   * A pool runs only the projects whose inputs moved, so a partial run is the ordinary case.
   */
  it('names an outlier when it measured the whole half', () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 30_000, overheadMs: 1000 }] });
    expect(lines(root).join('\n')).toMatch(/out of line with its half, so a candidate for splitting/);
  });

  it('names none from a half it measured in part, however wide the gap', () => {
    const root = planted({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 30_000, overheadMs: 1000 },
      { file: 'tests/small.spec.ts', ms: 100, overheadMs: 100 }] });
    expect(lines(root).join('\n'), 'one suite of eleven is not a half').not.toMatch(/out of line with its half/);
  });

  // An outlier is judged on what a file cost, so the ranking beside it is ordered the same way — otherwise
  // the line can name a file the list does not show
  it('ranks by cost, so the file it names is the one listed first', () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/setup-heavy.spec.ts', ms: 100, overheadMs: 30_000 },
      { file: 'tests/test-heavy.spec.ts', ms: 5000, overheadMs: 100 }] });
    const printed = lines(root);
    // Indexed from the end, because the ranking is the trailing block and the verdicts above it vary in
    // number — the outlier, the unmarked tail and the marker reach each appear only when they apply. Five
    // rows, `costliestFiles`' limit, this fixture's half having twelve files
    const ranking = printed.slice(-5);
    expect(ranking[0], 'the costliest file leads the ranking').toContain('tests/setup-heavy.spec.ts');
    expect(printed.join('\n')).toMatch(/setup-heavy\.spec\.ts[^\n]*out of line|out of line[^\n]*setup-heavy/);
  });

  /**
   * The reported half of the gate, which was computed and printed where a passing run could not show it.
   *
   * `placementOf`'s `unmarked` list was only ever written by the pool's own stdout, which both callers
   * buffer and print on failure alone — so the direction deliberately left as a report was visible only
   * when something else broke. These two cases are what fails if that line goes again.
   *
   * Named rather than counted, because the ranking is ordered by cost and this list by test time, so an
   * unmarked file in the tail need not be among the rows a reader can see.
   */
  it('names a file in the slow tail that carries no marker', () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/loud.spec.ts', ms: 30_000, overheadMs: 100 }] });
    const printed = lines(root).join('\n');
    expect(printed).toMatch(/in the slow tail and unmarked:[^\n]*apack-sdk\/tests\/loud\.spec\.ts/);
    expect(printed, 'with what makes it a report rather than a failure').toContain('reported, not failed');
  });

  /**
   * And on a partial run it reports why it drew no verdict, rather than printing nothing.
   *
   * Twenty files in one suite of eleven: enough that the half has a tail, so this reaches `a partial run`
   * rather than the `too few files` branch the two-file fixture above lands on.
   */
  it('checks no marker on a partial run, and says which run it was', () => {
    const root = planted({ 'apack-sdk': [{ file: 'tests/big.spec.ts', ms: 30_000, overheadMs: 100 },
      ...Array.from({ length: 19 }, (_, n) => ({ file: `tests/small${n}.spec.ts`, ms: 100, overheadMs: 10 }))] });
    expect(lines(root).join('\n')).toMatch(/no @slow: marker checked here — this run covered 1 of \d+ project\(s\)/);
  });

  /**
   * The count that makes the gate's deletion condition answerable.
   *
   * Measured 2026-10-06, every marker in the repo is in a package with one vitest config, so the move the
   * gate's remedy names costs a new config rather than a rename — and a condition turning on a year
   * passing with no spec moving halves cannot tell that apart from the gate having been found useless.
   */
  it('counts the markers whose package has nowhere to move a spec', () => {
    const root = whole({});
    fs.writeFileSync(path.join(root, 'packages', 'apack-sdk', 'tests', 'a.spec.ts'),
      '// @slow: it builds a program per case\nimport x from \'y\';\n');
    expect(lines(root).join('\n')).toMatch(/1\s+of 1 @slow: marker\(s\) sit in a package with no second half/);
  });

  it('says nothing of reach once the marked package has a half to move to', () => {
    const root = whole({});
    fs.writeFileSync(path.join(root, 'packages', 'apack-sdk', 'tests', 'a.spec.ts'),
      '// @slow: it builds a program per case\nimport x from \'y\';\n');
    // Both configs, which is what `hasSplit` reads — the line is about what the repo makes possible
    for (const config of Object.values(CONFIG_BY_HALF)) {
      fs.writeFileSync(path.join(root, 'packages', 'apack-sdk', config), '');
    }
    expect(lines(root).join('\n')).not.toMatch(/sit in a package with no second half/);
  });

  /**
   * The divisor is the pool's own worker count, not the machine's.
   *
   * `work/cores` asks how many of a half's files run at once, which the scheduler already declares per step
   * (`POOL_WIDTH`, read through `coresFor`): the two unit pools take the box less one and the integration
   * pool half of it. Handing `halfBound` `availableParallelism()` instead understated the integration half's
   * work by 2x, and the gap line above then reported 47% of that step's wall as belonging to neither figure.
   * It belonged to this.
   *
   * Skipped on a box too small to tell the two apart, which says so rather than passing vacuously.
   */
  it.skipIf(os.availableParallelism() < 3)("divides the work by the pool's workers, not the machine's cores", () => {
    const root = whole({ 'apack-sdk': [{ file: 'tests/a.spec.ts', ms: 80_000, overheadMs: 10_000 }] });
    const declared = coresFor(poolStepName('host'));
    expect(declared, 'an uncapped pool is the box less one, so there is something to tell apart')
      .toBeLessThan(os.availableParallelism());

    const byDefault = poolDurationLines('host', 6, new Date(0), { root })[1];
    expect(byDefault, 'the default is the declared width')
      .toBe(poolDurationLines('host', 6, new Date(0), { root, workers: declared })[1]);
    expect(byDefault, "and the machine's cores are a different answer, which is what this replaced")
      .not.toBe(poolDurationLines('host', 6, new Date(0), { root, workers: os.availableParallelism() })[1]);
  });

  it('says nothing at all where no run has measured anything', () => {
    expect(lines(fs.mkdtempSync(path.join(os.tmpdir(), 'pool-lines-empty-')))).toEqual([]);
  });
});

/**
 * One run per pool. Two runs of the same pool each stamp the projects the other's vitest is still running, so
 * neither record describes a run that happened — which is the one thing a per-project cache is for.
 *
 * **Per pool, not per directory**, which is narrower than the rule in `pipeline-lessons.md` and is the right
 * unit: a stamp's name carries its pool's half and provenance, so two pools write disjoint files, and
 * `prunePoolStamps` derives `live` from every pool's keys so one pool's prune cannot take another's. The cases
 * assert that partition rather than taking it on trust, since it is what licenses the narrower lock.
 */
describe('one run per pool', () => {
  const pools = Object.keys(POOLS) as Pool[];

  it('gives each pool its own lock, under a name prunePoolStamps will not delete', () => {
    const files = pools.map((pool) => poolLockFor(pool));

    expect(new Set(files).size, 'one lock each, or two pools share one and neither can run beside the other').toBe(pools.length);
    // The live predicate, which is what prunes: a `.json` lock would be removed by the next run mid-hold
    for (const file of files) expect(path.basename(file).endsWith('.json'), file).toBe(false);
  });

  // The partition the per-pool lock rests on: no two pools can write one stamp file
  it('keeps every pool\'s stamps disjoint from every other pool\'s', () => {
    const byPool = pools.map((pool) => new Set(POOLS[pool].suites().map((suite) => poolStampFor(suite, POOLS[pool].half, 'chain'))));
    const all = byPool.flatMap((set) => [...set]);

    expect(new Set(all).size, 'two pools stamping one file would need the directory locked, not the pool').toBe(all.length);
  });

  it('refuses a second run of the same pool, naming the one that holds it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-lock-'));
    const file = path.join(dir, 'host.lock');
    try {
      const held = holdPoolLock('host', file);

      // Asked once, and that is not fussiness: a refused take releases before it throws, and in *this* process
      // the holder's pid is ours — so a second `toThrow` finds the file gone, takes the lock, and passes
      // having tested nothing. Between two real processes the pid differs and the holder's lock is untouched.
      expect(() => holdPoolLock('host', file)).toThrow(/another host pool run holds[\s\S]*would stamp the projects the other is still running/);

      held.release();
      expect(fs.existsSync(file), 'released, so the next run may take it').toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
