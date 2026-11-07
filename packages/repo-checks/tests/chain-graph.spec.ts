// The pre-merge chain's run order is derived from what each step reads and writes — no step declares an
// edge — so what this pins is that the derivation is a topological sort and that a wrong graph fails before
// any step runs: a six-minute chain should not discover a cycle halfway through.
// What it does not pin is the derivation against the `needs` table it replaced: that snapshot existed for
// the one commit that deleted those fields and went with them, since keeping it would be a second record of
// the graph, able to disagree with the first. The property is what survives, here and in `chain-schedule`
// (two conflicting steps never overlap) and `chain-inputs` (the derived ancestors are walked).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, chainSteps, conflictsOf, dependsOn, keptOnFailure, orderedSteps, STEP_TABLES, type ChainStep } from '../../../scripts/lib/chain-steps.ts';
import { unitFor } from '../../../scripts/lib/chain-stamps.ts';
import { declaredAt } from '../../../scripts/lib/chain-output.ts';
import { reachableText, rootScripts, withoutComments } from '../../../scripts/lib/npm-scripts.ts';
import { population } from '@apackdev/sdk/testing';
import { POOL_WIDTH } from '../../../scripts/lib/core-budget.ts';
import { TYPECHECK_LEGS } from '../../../scripts/lib/typecheck-legs.ts';
import { rungForKind, timedOutBecause, TIMEOUT_CLASSES, TIMEOUT_MS } from '../../../scripts/lib/step-timeouts.ts';
import { DEFAULT_FORK_BUDGET_MS } from '../../../tests/acceptance/external-pack/prepare-default-pack-fork.ts';
import { timeoutMsFor } from '../../../scripts/lib/step-timeouts.ts';
import e2eConfig from '../../../playwright.config.ts';

describe('the chain graph', () => {
  it('orders every step after the steps it depends on', () => {
    const order = orderedSteps().map((s) => s.name);
    expect(order).toHaveLength(CHAIN_STEPS.length);
    for (const step of CHAIN_STEPS) {
      for (const need of dependsOn(step)) {
        expect(order.indexOf(need), `${need} must come before ${step.name}`).toBeLessThan(order.indexOf(step.name));
      }
    }
  });

  it('derives the order rather than reading the table\'s, so a table in the wrong order still runs right', () => {
    // The table happens to be written in a valid order, so a sort that merely returned it would pass the test
    // above. Reversed, it is invalid — every step precedes what it needs — and the result must still be valid.
    const reversed = [...CHAIN_STEPS].reverse();
    const order = orderedSteps(reversed).map((s) => s.name);
    expect(order).toHaveLength(CHAIN_STEPS.length);
    for (const step of CHAIN_STEPS) {
      for (const need of dependsOn(step)) {
        expect(order.indexOf(need), `${need} must come before ${step.name}`).toBeLessThan(order.indexOf(step.name));
      }
    }
    expect(order).not.toEqual(reversed.map((s) => s.name));
  });

  /**
   * Two steps each reading what the other writes. A derived graph can still cycle — the derivation only
   * refuses to invent an edge, not to find a circular one — and a six-minute chain must not discover it
   * halfway through.
   */
  it('refuses a cycle', () => {
    const steps: ChainStep[] = [
      { name: 'a', timeout: 'quick', inputs: ['y'], outputs: ['x'] },
      { name: 'b', timeout: 'quick', inputs: ['x'], outputs: ['y'] },
    ];
    expect(() => orderedSteps(steps)).toThrow(/cycle/);
  });

  /**
   * **The same property, through the door the case above does not reach.** A two-step cycle leaves one
   * element in the reduction's candidate list, so its pairwise filter short-circuits and the transitive walk
   * is never called: that case exercises the topological sort and not the derivation. Give the cycle a step
   * with two producers and the walk runs, re-enters an answer still being computed, and the verdict used to
   * be `RangeError: Maximum call stack size exceeded` — a wrong graph failing, but not *naming itself*,
   * which is what the header above promises. Both shapes are kept because neither covers the other.
   */
  it('refuses a cycle reached through a step with two producers, naming it rather than overflowing', () => {
    const steps: ChainStep[] = [
      { name: 'a', timeout: 'quick', inputs: ['x', 'y'], outputs: ['z'] },
      { name: 'b', timeout: 'quick', inputs: ['z'], outputs: ['x'] },
      { name: 'c', timeout: 'quick', inputs: [], outputs: ['y'] },
    ];
    expect(() => orderedSteps(steps)).toThrow(/cycle through a/);
  });

  /**
   * A mutex has no direction, so this one is a preference — and it was held by nothing but the order the
   * two happen to sit in the table.
   *
   * `test:smoke` and `test:e2e` both write `.apack/tests/results`, which makes them a derived mutex: the scheduler will
   * not overlap them, and either order satisfies it. Running the six-second gate before the twenty-six
   * second harness is what anyone wants, and until this case existed, reordering the table would have
   * silently swapped them. Named here rather than declared on a step, because a preference between two
   * steps is not a property of either.
   */
  it('runs the smoke gate before the harness they are mutexed by', () => {
    const order = orderedSteps(chainSteps(['test:e2e'])).map((step) => step.name);
    expect(order, 'the opt-in harness is not in this plan, so there is nothing to order').toContain('test:e2e');
    const smoke = CHAIN_STEPS.find((step) => step.name === 'test:smoke')!;
    expect(conflictsOf(smoke), 'the two no longer share a path, so this preference has lost its subject')
      .toContain('test:e2e');
    expect(order.indexOf('test:smoke')).toBeLessThan(order.indexOf('test:e2e'));
  });

  it('declares and keeps the output directory used by the actual Playwright config', () => {
    expect(e2eConfig.outputDir).toBeDefined();
    const output = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, e2eConfig.outputDir!)).split(path.sep).join('/');
    for (const name of ['test:smoke', 'test:e2e']) {
      const step = CHAIN_STEPS.find(step => step.name === name)!;
      expect(step.evidence, name).toContain(output);
      expect(keptOnFailure(step), name).toContain(output);
    }
  });

  it('keeps evidence out of the cache key, so another writer of it does not make a step stale', () => {
    const smoke = CHAIN_STEPS.find((step) => step.name === 'test:smoke')!;
    const unit = unitFor(smoke);
    expect(smoke.evidence?.length, 'smoke declares evidence, so this case has a subject').toBeGreaterThan(0);
    expect([...unit.outputs, ...unit.inputs].some((file) => smoke.evidence!.some((written) =>
      file === path.join(REPO_ROOT, written) || file.startsWith(path.join(REPO_ROOT, written) + path.sep)))).toBe(false);
  });


  /**
   * Every step can be pointed at, which is what lets a run print where its reasoning lives instead of
   * repeating it.
   *
   * Derived from `STEP_TABLES` rather than from one file, because that is the mistake this replaces:
   * `declaredIn` searched `chain-steps.ts` alone and silently found nothing for the seventeen typecheck legs
   * and the two pool steps, whose names are generated. Nothing noticed, because only a `neverCachedBecause`
   * step prints the pointer and both of those live in the file it did search — so the first leg to become
   * never-cached would have lost it. Drop a table from the list and this fails for seventeen steps.
   */
  it('declares every step somewhere a run can point at', () => {
    const sources = STEP_TABLES.map((file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8'));
    expect(CHAIN_STEPS.length, 'the table emptied, so this would pass over nothing').toBeGreaterThan(25);
    const lost = CHAIN_STEPS.filter((step) => sources.every((source) => declaredAt(source, step.name) === undefined));
    expect(lost.map((step) => step.name), 'nothing names these, so a run cannot point at their reasoning').toEqual([]);
  });

  /**
   * And the line it lands on declares *that* step, which locatable does not say.
   *
   * The case above asks only whether an answer came back, and for the two steps whose names are generated an
   * answer comes from a prefix match — so a line that merely looks like a declaration would satisfy it. The
   * sibling in `chain-output.spec.ts` covers a never-cached step, which is every step that prints a pointer
   * today, and every one of those is written out literally; this is the half that holds the generated ones.
   * What it cannot check is specificity, which has no second generator to be wrong about — a written table
   * carries that case.
   */
  it('lands on a line that declares the step it was asked about', () => {
    const generated = CHAIN_STEPS.filter((step) => STEP_TABLES.every((file) =>
      !fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').includes(`name: '${step.name}'`)));
    expect(generated.map((step) => step.name), 'no step has a generated name, so this would pass over nothing')
      .toEqual(['test:unit:host', 'test:unit:pack']);
    for (const step of generated) {
      for (const file of STEP_TABLES) {
        const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').split('\n');
        const at = declaredAt(lines.join('\n'), step.name);
        if (at === undefined) continue;
        const prefix = /name: `([^$`]*)/.exec(lines[at - 1]!)?.[1];
        expect(prefix, `${file}:${at} is where ${step.name} was placed, and it declares no generated name`).toBeDefined();
        expect(step.name.startsWith(prefix!), `${file}:${at} generates names like ${prefix!}, which ${step.name} is not one of`).toBe(true);
      }
    }
  });

  it('refuses two steps with one name, which would make an edge ambiguous', () => {
    const steps: ChainStep[] = [{ name: 'a', timeout: 'quick', inputs: [] }, { name: 'a', timeout: 'quick', inputs: [] }];
    expect(() => orderedSteps(steps)).toThrow(/Two chain steps named a/);
  });

  /**
   * A step may go uncached for one of two reasons, and both are properties of the step rather than a name.
   *
   * Its pass is not reproducible — the E2E suite, which drives real Electron — or its *effect* is recorded
   * where `fingerprintUnit` cannot see it. `packages:ensure` is the second kind: what it guarantees is that
   * the built packages are current, and whether they are lives in `node_modules/.cache/apack-packages-build`,
   * which is neither among its inputs nor content-hashed as an output. Measured 2026-09-26: with those stamps
   * removed and `dist` still present, the step reported `cached` while `packagesBuiltOrRefuse()` refused, so
   * every step guarding on the built packages failed at collection — nested caches that can disagree, the
   * same class this branch fixed for the two unit pools.
   *
   * Written as the rule so a third uncached step has to earn it: anything that writes the package build
   * outputs cannot be cached on its inputs alone, and anything else needs a reason in the list below.
   */
  it('makes every uncached step say why in a sentence, which is what the chain prints for it', () => {
    expect(CHAIN_STEPS.filter((s) => s.neverCachedBecause !== undefined && s.neverCachedBecause.length < 20)
      .map((s) => s.name), 'an uncached step needs a reason, not a flag: the chain prints this where a cache '
      + 'verdict would go, and the line it replaced was hardcoded about Electron and wrong about the other '
      + 'step that opted out').toEqual([]);
  });

  /**
   * An opt-in step is declared but not gated on. The declarations are the reason it stays: `chain-inputs`
   * reads every step's `inputs` to prove the tracked tree is covered, so deleting the E2E step would leave
   * `tests/e2e` watched by nothing while looking like a simplification.
   */
  describe('a step the chain knows about but does not gate on', () => {
    it('is left out by default and put back when asked for', () => {
      const byDefault = chainSteps().map((s) => s.name);
      expect(byDefault, 'the E2E suite drives the app; it is not a regression gate').not.toContain('test:e2e');
      expect(chainSteps(['test:e2e']).map((s) => s.name), '`--e2e` runs it').toContain('test:e2e');
    });

    it('says why, as an uncached step has to', () => {
      expect(CHAIN_STEPS.filter((s) => s.optInBecause !== undefined && s.optInBecause.length < 20).map((s) => s.name),
        'an opt-in step needs a reason, not a flag').toEqual([]);
    });

    /**
     * The one way this breaks: something depends on a step the default run does not include, so the chain
     * is missing a dependency and finds out halfway through. It fails at the selector instead.
     *
     * Asked of `chainSteps` rather than `orderedSteps`, because that is the only place it can be asked
     * now. Edges derive from the list they are given, so a step filtered out of the list is simply not
     * depended on by it; the refusal has to derive against the *whole* table, which is what `chainSteps`
     * does and why it takes one.
     */
    it('refuses a graph where something depends on one', () => {
      const steps = CHAIN_STEPS.map((s) => (s.name === 'build:runtime' ? { ...s, optInBecause: 'for the case' } : s));
      expect(() => chainSteps([], steps))
        .toThrow(/depends on build:runtime, which is opt-in/);
    });
  });

  it('does not cache the step that guarantees the built packages', () => {
    expect(CHAIN_STEPS.find((s) => s.name === 'packages:ensure')!.neverCachedBecause,
      'it would cache on its inputs while what it guarantees is recorded in stamps the fingerprint cannot '
      + 'see. Measured: with those stamps cleared and dist still present, the step reported `cached` while '
      + 'packagesBuiltOrRefuse() refused, so every step reading the built packages failed at collection')
      .toBeDefined();
  });
});

describe('every spawn an orchestrator makes is bounded', () => {
  const REPO = REPO_ROOT;
  const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

  /**
   * The classes the repo's npm scripts bound a direct run at, from the manifest's text.
   *
   * Text rather than a resolved config, for `capsInText`'s reason (`core-budget.spec.ts`): what is being asked
   * is what the manifest *says*, and a pure function over it is what lets the scan be mutated rather than
   * trusted.
   */
  type Scripts = { scripts: Record<string, string> };
  const boundedIn = (scripts: Record<string, string>): { name: string; className: string }[] =>
    Object.entries(scripts).flatMap(([name, command]) =>
      [...command.matchAll(/scripts\/bounded\.ts\s+(\S+)/g)].map((hit) => ({ name, className: hit[1]! })));

  // An unbounded run cannot fail — it waits until a person notices and kills it by pid, which is how this
  // repo collected an orphaned build at 99% CPU for a day. `boundedSpawn` bounds the wall clock and kills
  // the process group rather than the child, so nothing outlives the run that started it.
  // Four files, not two: `typecheck.ts` and `test-unit-pool.ts` spawn as well, and both were missing from
  // this list while it read as the repo's answer to "does anything spawn unbounded".
  it.each(['scripts/chain.ts', 'scripts/test-unit.ts', 'scripts/typecheck.ts', 'scripts/test-unit-pool.ts'])(
    '%s spawns only through boundedSpawn', (file) => {
    const source = read(file);
    expect(source, `${file} imports spawn directly`).not.toMatch(/import \{[^}]*\bspawn\b[^}]*\} from 'node:child_process'/);
    expect(source).toContain('boundedSpawn');
  });

  /**
   * **No deadline anywhere is a function of a recorded measurement.** This is the greppable property
   * `docs/archive/plans/costs-across-machines.md` asks Phase 1 to end on, and it is greppable on purpose: the rule
   * is about a shape rather than a value, so a reader can check it and so can this.
   *
   * It was `budgetFor(seconds)` — four times a ten-core measurement — which made every kill deadline in the
   * repo this machine's deadline. A box with a third of the cores ran the same bound over a step three to
   * four times slower, and `test:unit:host` came out at 130-170s against a 168s deadline: a flake that reads
   * as a code failure.
   *
   * The shell scripts are in the population because they were the half that nearly got missed. Their bounds
   * are *inner*, nested inside the chain's, and two of the three were already the binding constraint — 90s
   * inside against 144s outside — so coarsening only the chain's would have changed nothing for them.
   *
   * **Two halves, because the negative one alone is weak.** Refusing `budgetFor(` catches the old shape
   * coming back and nothing else: someone writing `classFor(step.seconds)` passes it. So the positive half
   * asserts each of these files takes its bound from the ladder. What neither catches is a *new* function
   * that thresholds a cost into a class inside `step-timeouts.ts` itself — that one is a comment on
   * `TIMEOUT_MS`, and the edit to watch is the one that gives a step its class by comparing `seconds`.
   */
  it('sizes no deadline from a measurement, in any file that spawns or any script that bounds one', () => {
    const spawners = ['scripts/chain.ts', 'scripts/test-unit.ts', 'scripts/typecheck.ts',
      'scripts/test-unit-pool.ts', 'scripts/bounded.ts'];
    for (const file of population('the bounding files', spawners)) {
      // Comments stripped, because prose about the old rule is not the old rule — `withoutComments`, for the
      // reason it was written: a script explaining why it does *not* do a thing otherwise reads as doing it.
      // Three of these files name `budgetFor` in a sentence recording what it was.
      expect(withoutComments(read(file), false), `${file} derives a deadline from a cost; a class carries no machine`)
        .not.toMatch(/budgetFor\s*\(/);
    }
    // The positive half: the bound comes from the ladder rather than from anywhere else
    for (const file of spawners) {
      expect(read(file), `${file} spawns without taking its deadline from step-timeouts.ts`)
        .toContain('step-timeouts.ts');
    }
    // And the shell bounds name a class rather than a number of seconds, which is the same rule one layer out
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const numeric = Object.entries(scripts)
      .filter(([, command]) => /scripts\/bounded\.ts\s+\d/.test(command))
      .map(([name]) => name);
    expect(numeric, 'these bound a script with a number of seconds, which is a deadline from one machine')
      .toEqual([]);
  });

  // A shell script run through the chain is bounded by the step's budget, but the direct run is the one
  // people and agents use, and it had no bound at all. test-packaged-authoring.sh is why: its expect block
  // sets `timeout 120`, which covers a pattern match and not the `wait` after it, and it once hung a machine.
  it('every npm script that runs a shell script bounds it', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const unbounded = Object.entries(scripts)
      .filter(([, command]) => command.includes('tests/acceptance/') && !command.includes('scripts/bounded.ts'))
      .map(([name]) => name);
    expect(unbounded, 'these run a shell script with no wall-clock budget').toEqual([]);
  });

  /**
   * Every step declares a timeout class, which is what actually bounds it.
   *
   * Required on the type, so this cannot fail by a step omitting one — what it catches is the other way, a
   * class that is not in the ladder, which `TIMEOUT_MS` answers `undefined` for. Since a rung became an
   * object that is a throw at the spawn rather than a deadline of NaN, which is the better failure and still
   * not one to discover six minutes into a chain. That is `unit-pool.spec.ts`' hazard moved to its new home.
   */
  it('bounds every step with a class the ladder has', () => {
    const unknown = CHAIN_STEPS.filter((step) => TIMEOUT_MS[step.timeout]?.ms === undefined);
    expect(unknown.map((step) => step.name), 'a class off the ladder has no deadline at all').toEqual([]);
  });

  /**
   * And the rung a step declares is the one its *kind of work* puts it on.
   *
   * **This one classifies.** The criterion `step-timeouts.ts` states is a kind of work, and without this
   * whether a step is on the right kind would be carried by prose: a bundle left on `quick` is killed early,
   * and one compiler declared `suite` gets 600s to die rather than 60s with nothing saying a word.
   *
   * The three facts are gathered here and the criterion is `rungForKind`'s, beside the ladder it formalizes.
   * `fansOut` uses declared pool widths, excluding flattened compiler legs, never what `coresFor` returns — that resolves
   * against the running machine, so on a one-core box every width-declaring step reads as one core and this
   * answer would change with the hardware.
   */
  describe('the rung matches the kind of work', () => {
    /** A step whose rung the facts cannot derive, and why. An entry that stops applying is reported. */
    const DECLARED_AGAINST_THE_FACTS: Record<string, string> = {
      'test:external-pack:fork': 'composes a cold shipped-pack build, separately bounded archive verification '
        + 'and owned temporary-tree cleanup; a single bundle deadline does not cover these serial operations',
      'test:integration': 'complete compiler/runtime acceptance includes repeated cold builds, watchers '
        + 'and lifecycle combinations across projects; generic fan-out facts cannot distinguish that '
        + 'workload from an ordinary unit suite. Only this pool and the native one use the acceptance aggregate bound',
      'test:native': 'native runtime and live-watcher scenarios: cold compiler captures, watcher rebuild cycles and '
        + 'native loader probes across one pooled run, the same acceptance aggregate the integration pool takes',
      'test:external-pack:app': 'drives the built app once per fixture pack, where `test:smoke` also launches '
        + 'an app and is a suite — no fact in the table separates them, so this is a judgement rather than a '
        + 'rule to widen',
      'test:smoke': 'launches the built Electron app and drives it through Playwright; its results are evidence '
        + 'rather than outputs, so no fact in the table records the app launch that makes it a suite',
      'test:e2e': 'launches the built Electron app for every spec, as `test:smoke` does for its four',
      'test:packaged-authoring:app': 'launches the app through `apack pack test`, and the install that would '
        + 'derive its rung is in the author half — so the facts read it as a bare check where it is one '
        + 'Electron launch. A suite, as `test:smoke` is for launching one',
    };

    const all = rootScripts();
    /** An install, and not `attw --pack`, which is a tarball being analysed rather than a dependency tree */
    const installs = (name: string): boolean => /npm (ci|install)\b/.test(reachableText(name, all).text);
    const factsFor = (step: ChainStep) => ({
      installs: installs(step.name),
      // Flattened compiler legs can use background CPU without running independent tasks.
      fansOut: POOL_WIDTH[step.name] !== undefined && !TYPECHECK_LEGS.some(leg => leg.name === step.name),
      builds: (step.outputs ?? []).length > 0,
    });

    /** One path for the rule and for the mutations, so a mutation exercises the rule rather than a copy */
    const misdeclared = (steps: readonly ChainStep[]): string[] => steps.flatMap((step) => {
      const derived = rungForKind(factsFor(step));
      if (derived === step.timeout || DECLARED_AGAINST_THE_FACTS[step.name] !== undefined) return [];
      return [`${step.name} declares ${step.timeout} and its work is ${derived}`];
    });

    it('declares the rung its work implies', () => {
      expect(misdeclared(CHAIN_STEPS), 'a rung is chosen by kind of work (`step-timeouts.ts`), so one of '
        + 'these is a step bounded as something it is not — a bundle on `quick` dies too early, one compiler '
        + 'on `suite` takes ten minutes to die').toEqual([]);
    });

    it('keeps the pack typecheck on quick when its compiler reserves background CPU', () => {
      const step = CHAIN_STEPS.find(step => step.name === 'typecheck:pack')!;
      expect(POOL_WIDTH[step.name]).toEqual({ cores: 2 });
      expect(factsFor(step).fansOut).toBe(false);
      expect(step.timeout).toBe('quick');
    });

    it('asks it of every step, so the rule passes over nothing', () => {
      const asked = CHAIN_STEPS.filter((step) => DECLARED_AGAINST_THE_FACTS[step.name] === undefined);
      // Derived from the table rather than a literal, so adding an exception does not quietly re-baseline
      // this case: it read `- 1` while the table held one entry, and a second would have passed over it
      expect(asked.length, 'the exception table swallowed the table')
        .toBe(CHAIN_STEPS.length - Object.keys(DECLARED_AGAINST_THE_FACTS).length);
      expect(asked.length, 'and most of the table is still asked').toBeGreaterThan(CHAIN_STEPS.length / 2);
    });

    it('lists no exception that has stopped applying', () => {
      const stale = Object.keys(DECLARED_AGAINST_THE_FACTS).flatMap((name) => {
        const step = CHAIN_STEPS.find((candidate) => candidate.name === name);
        if (step === undefined) return [`${name}: no step declares it any more`];
        return rungForKind(factsFor(step)) === step.timeout
          ? [`${name}: the facts derive its rung now, so it needs no exception`] : [];
      });
      expect(stale).toEqual([]);
    });

    /**
     * The three firing cases, mutating the data rather than trusting that the rule could fail. Each is the
     * shape of a real mistake: a build left on `quick` is the 2026-10-03 defect, a check moved to `suite`
     * is the unwatched direction, and an installing step on either is a scenario bounded as something else.
     */
    it('names a build left on quick', () => {
      const lint = CHAIN_STEPS.find((step) => step.name === 'lint:check')!;
      expect(misdeclared([{ ...lint, outputs: ['packages/apack-sdk/dist'] }]))
        .toEqual(['lint:check declares quick and its work is suite']);
    });

    it('names one compiler left on suite', () => {
      const lint = CHAIN_STEPS.find((step) => step.name === 'lint:check')!;
      expect(misdeclared([{ ...lint, timeout: 'suite' }]))
        .toEqual(['lint:check declares suite and its work is quick']);
    });

    it('names an installing step that is not a scenario', () => {
      const authoring = CHAIN_STEPS.find((step) => step.name === 'test:packaged-authoring:author')!;
      expect(factsFor(authoring).installs, 'it stopped installing, so this case is about nothing').toBe(true);
      expect(misdeclared([{ ...authoring, timeout: 'suite' }]))
        .toEqual(['test:packaged-authoring:author declares suite and its work is scenario']);
    });
  });

  describe('what a timed-out step reports', () => {
    it('reports the bound and the usual cost without diagnosing stalled work', () => {
      const why = timedOutBecause({ what: 'test:integration', timeout: 'suite', seconds: 60 });
      expect(why).toContain('1200s (suite)');
      expect(why).toContain('usually takes 60s here');
      expect(why).toContain('budget of CPU time');
      expect(why).not.toMatch(/wedged|deadlock/);
    });

    it.each([undefined, 0])('does not invent a recorded cost for %s', seconds => {
      const why = timedOutBecause({ what: 'bash tests/acceptance/x.sh', timeout: 'scenario', seconds });
      expect(why).toContain('1800s (scenario)');
      expect(why).toContain('no recorded cost');
      expect(why).not.toContain('usually takes');
    });
  });

  /**
   * `scripts/bounded.ts` takes a class on its command line, so a rung is reachable from a direct npm run
   * without any chain step at all. Every class those scripts name must be on the ladder, which `timeoutMsFor`
   * otherwise only refuses at runtime — and the set must not be empty, since a regex that matched nothing
   * would pass.
   */
  it('reaches a rung from a direct npm run too, and the ladder knows every class those name', () => {
    const bounded = boundedIn((JSON.parse(read('package.json')) as Scripts).scripts);

    expect(population('the scripts that bound a direct run', bounded).length).toBeGreaterThan(0);
    for (const { name, className } of bounded) {
      expect(TIMEOUT_CLASSES, `${name} bounds at ${className}, which is no rung on the ladder`)
        .toContain(className);
    }
  });

  // The mutation, over data rather than the real manifest: a regex that matched nothing would satisfy every
  // assertion above, which is what the emptiness guard alone cannot tell you
  it('finds a class a script bounds at, which is what the case above rests on', () => {
    expect(boundedIn({ 'x': 'npm run packages:ensure && tsx scripts/bounded.ts quick bash tests/acceptance/x.sh' }))
      .toEqual([{ name: 'x', className: 'quick' }]);
    expect(boundedIn({ 'y': 'tsx scripts/bounded.ts nonsense bash y.sh' })[0]!.className)
      .not.toBeOneOf([...TIMEOUT_CLASSES]);
    expect(boundedIn({ 'z': 'npm test' }), 'a script that bounds nothing contributes nothing').toEqual([]);
  });

  /**
   * And where both records exist, they name the same rung.
   *
   * **Three steps declare their kill deadline twice**: `ChainStep.timeout` in the table, and a class on
   * `scripts/bounded.ts`'s command line in the npm script the chain runs. Both apply — the chain bounds the
   * step it spawns and `bounded.ts` bounds the work inside it — so a divergence does not lift the deadline,
   * it makes the surviving one a surprise: the tighter wins, and if that is the inner class the chain's
   * timeout message reasons from a rung that never fired.
   *
   * Two records of one fact agreeing today is the state in which a second record is least checked.
   *
   * A script that is not a chain step is skipped rather than excused: `test:external-pack` bounds the two
   * halves by hand and has no row to agree with, so there is no second record to keep honest.
   */
  /** The step a bounded script belongs to, or nothing where the script is not a chain step */
  const rowFor = (name: string) => CHAIN_STEPS.find((candidate) => candidate.name === name);

  /**
   * The rule, over whatever pairs it is given — which is what lets the case below hand it one that breaks.
   *
   * Extracted rather than filtered inline for `uncollected`'s reason (`spec-placement.spec.ts`): a firing
   * case that restates the comparison proves the fixture diverges and not that the rule reports it, so a
   * change to the rule would leave the case passing over a question it no longer asks.
   */
  const divergent = (pairs: readonly { name: string; className: string }[]): string[] =>
    pairs.flatMap(({ name, className }) => {
      const step = rowFor(name);
      return step === undefined || step.timeout === className
        ? []
        : [`${name} bounds at ${className} and the table declares ${step.timeout}`];
    });

  it('names the same rung in the step table and in the script that bounds it', () => {
    const pairs = boundedIn((JSON.parse(read('package.json')) as Scripts).scripts);

    expect(population('the steps whose rung is written twice',
      pairs.filter(({ name }) => rowFor(name) !== undefined)).length).toBeGreaterThan(0);
    expect(divergent(pairs),
      'one of these two records is the deadline that fires and the other is the one a message reads from')
      .toEqual([]);
  });

  /** Over data, since the manifest agrees today and an assertion over agreement cannot fail on its own */
  it('would name a step whose two records disagree', () => {
    const step = CHAIN_STEPS.find((candidate) => candidate.timeout === 'suite')!;
    const diverged = boundedIn({ [step.name]: 'tsx scripts/bounded.ts scenario bash tests/acceptance/x.sh' });

    expect(diverged.map(({ className }) => className), 'the script half of the pair').toEqual(['scenario']);
    expect(divergent(diverged)).toEqual([`${step.name} bounds at scenario and the table declares suite`]);
  });

  /**
   * No rung exists that nothing uses, which is the argument `SIZE_MS` makes against a third bucket — "two
   * buckets, because two is what has consumers". Three survive it only while three kinds are nameable, and
   * this is what says they still are.
   */
  it('uses every rung of the ladder, so none is a value nothing distinguishes', () => {
    const used = new Set(CHAIN_STEPS.map((step) => step.timeout));
    expect([...used].sort(), 'a rung nothing uses is one to delete').toEqual([...TIMEOUT_CLASSES].sort());
  });

  /**
   * What licenses `PACKAGES_PREBUILT_ENV`, which the chain sets on every step but `packages:ensure`.
   *
   * Under that flag a package found stale is reported rather than rebuilt, and that is only the right answer
   * when the step cannot be the one with building left to do — which is a property of this graph, not of the
   * step table: nothing declares an edge to `packages:ensure`, the edges come from its outputs meeting another
   * step's inputs, and the ordering is transitive (`test:unit:host` reaches it through `build:default-setup`). So a new
   * step that reads none of the built packages would be unordered against it, run beside it, and refuse on a
   * package the other step is still building.
   *
   * The flag had no writer between 2026-09-24 and 2026-10-02, so `PackagesWentStale` could not be thrown and a
   * package rewritten under a reader raced a rebuild instead. This is the condition that keeps it honest.
   */
  it('orders every other step after packages:ensure, which is what lets the rest assume it ran', () => {
    const reaches = (name: string, seen = new Set<string>()): boolean =>
      dependsOn(CHAIN_STEPS.find((step) => step.name === name)!).some((need) =>
        need === 'packages:ensure' || (!seen.has(need) && (seen.add(need), reaches(need, seen))));

    const others = CHAIN_STEPS.filter((step) => step.name !== 'packages:ensure');
    expect(others.length, 'no steps besides packages:ensure, so this would pass over nothing').toBeGreaterThan(1);
    expect(others.filter((step) => !reaches(step.name)).map((step) => step.name),
      'these steps can run beside packages:ensure, so telling them the packages are already built is a claim '
      + 'the graph does not support — they would refuse on a package it is still building').toEqual([]);
  });

  it('composes fork preparation from bounded build, archive and housekeeping phases', () => {
    const producer = CHAIN_STEPS.find(step => step.name === 'test:external-pack:fork')!;
    expect(Object.values(DEFAULT_FORK_BUDGET_MS).reduce((total, budget) => total + budget, 0))
      .toBeLessThanOrEqual(timeoutMsFor(producer.timeout));
  });

  it('prepares the default fork independently of fixture contracts before app consumption', () => {
    const output = 'node_modules/.cache/apack-fixtures/default-fork';
    const producer = CHAIN_STEPS.find(step => step.name === 'test:external-pack:fork')!;
    expect(producer).toBeDefined();
    expect(CHAIN_STEPS.filter(step => step.outputs?.includes(output)).map(step => step.name))
      .toEqual([producer.name]);
    expect(dependsOn(producer)).toContain('build:default-setup');
    const app = CHAIN_STEPS.find(step => step.name === 'test:external-pack:app')!;
    expect(dependsOn(app)).toEqual(expect.arrayContaining([producer.name, 'test:external-pack:contract']));
    const scripts = rootScripts();
    expect(reachableText('test:external-pack:contract', scripts).text).not.toContain('prepare-default-pack-fork');
    expect(scripts[producer.name]).toContain('bounded.ts scenario tsx tests/acceptance/external-pack/prepare-default-pack-fork.ts');
    const combined = read('tests/acceptance/external-pack/test-external-pack.sh');
    expect(combined.indexOf('test-external-pack-contract.sh')).toBeLessThan(combined.indexOf('prepare-default-pack-fork.ts'));
    expect(combined.indexOf('prepare-default-pack-fork.ts')).toBeLessThan(combined.indexOf('test-external-pack-app.sh'));
  });

  it('checks the current built facade after its producer without running codegen', () => {
    expect(rootScripts()['facade:check']).toContain('--from-build');
    const step = CHAIN_STEPS.find((candidate) => candidate.name === 'facade:check');
    expect(step, 'no facade:check step, so this would pass over nothing').toBeDefined();

    expect(dependsOn(step!)).toContain('build:default-setup');
  });

  it('prepares external fixture frontends before integration reads their module graph', () => {
    const integration = CHAIN_STEPS.find(step => step.name === 'test:integration')!;
    const producer = CHAIN_STEPS.find(step => step.name === 'test:external-pack:contract')!;
    expect(producer.outputs?.length).toBeGreaterThan(0);
    expect(dependsOn(integration)).toContain(producer.name);
    const excluded = { ...integration, excludes: [...integration.excludes ?? [], ...producer.outputs!] };
    expect(dependsOn(excluded, CHAIN_STEPS.map(step => step === integration ? excluded : step)))
      .not.toContain(producer.name);
  });
});
