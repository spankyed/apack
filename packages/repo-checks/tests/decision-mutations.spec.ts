// Whether a decision in `scripts/lib/` can be observed at all — by the cases that cover it, or by anything.
//
// Root CLAUDE.md already says a mutation check is worth more than a re-run, and two cases shipped under that
// rule that could not see what they claimed to cover: one watching `settle`'s `skipped` comparison also moved
// a cost, so removing the comparison left every case green; one watching `absentNamed`'s sort derived its two
// suites as the first two `UNIT_SUITES` entries, which are already in alphabetical order, so sorted and
// unsorted output were the same list. Both were found by breaking the source on purpose, and that evidence
// then existed only in a commit message.
//
// So it lives here instead. Each entry breaks one line of the module and calls the same function on the same
// input as the real one: **the two answers must differ.** An entry that stops differing is a decision nothing
// can observe any more, which is the state both of those cases were in.
//
// Be exact about what that buys, because the neighbouring claim is the tempting one and it is false: this
// pins a discriminating input per decision, so a decision cannot be deleted in silence. It does **not** police
// whether the cases in `suite-split.spec.ts` use a discriminating input — their inputs are their own, and what
// keeps that one honest is its own assertion that the answer differs from the order it passed in. Sharing the
// fixtures between the two files would close that, and is the next step if this is ever worth extending.
//
// It covers the breaks the table lists and no others: it makes today's evidence permanent rather than going
// looking for tomorrow's.
//
// **Five modules, and what qualifies one is reachability rather than subject.** It began as one, grew to two
// when the sample-recording primitives moved to `measure.ts`, and took `step-timeouts.ts`,
// `chain-schedule.ts` and `core-budget.ts` when the hand-run version of this ritual was retired: copy the
// file, edit it, run a
// filtered command, read the output, restore. That has three independent ways to lie — a restore that takes
// the index rather than your work, a run that does not run, and a filter that hides the answer — and two of
// the three were observed in one session. Here there is nothing to restore, the suite cannot skip it, and a
// non-discriminating entry *fails*, which the ritual could never do. `docs/archive/plans/vacuous-assertions.md` records why a firing case per check is a
// larger programme than this.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import * as realMeasure from '../../../scripts/lib/measure.ts';
import * as realStepTimeouts from '../../../scripts/lib/step-timeouts.ts';
import * as realChainSchedule from '../../../scripts/lib/chain-schedule.ts';
import * as realCoreBudget from '../../../scripts/lib/core-budget.ts';
import * as realStepTiming from '../../../scripts/lib/step-timing.ts';

/**
 * The modules a mutation may break, by the name an entry gives in `in`.
 *
 * **What a module needs to be here is that a mutant of it resolves from a temp directory**, since that is
 * where `absolute` writes one: no imports, or only node builtins, or only relative specifiers it can
 * rewrite. `chain-output.ts` is the near miss — a bare `@apackdev/host/build/packages-built` has no
 * `node_modules` on the walk-up from `os.tmpdir()`, so it stays out until someone has a reason to write
 * mutants inside the tree.
 *
 * Every entry names its module. It defaulted to `spec-cost.ts` and most of them took that default,
 * until that module was deleted.
 */
const MODULES = {
  measure: { file: 'measure.ts', real: realMeasure as unknown as Lib },
  'step-timeouts': { file: 'step-timeouts.ts', real: realStepTimeouts as unknown as Lib },
  'chain-schedule': { file: 'chain-schedule.ts', real: realChainSchedule as unknown as Lib },
  'core-budget': { file: 'core-budget.ts', real: realCoreBudget as unknown as Lib },
  // Reachable for the same reason the others are: its only imports are siblings in `scripts/lib`, which
  // `absolute()` below rewrites, and a type from `chain-schedule.ts`, which erases
  'step-timing': { file: 'step-timing.ts', real: realStepTiming as unknown as Lib },
} as const;
type Module = keyof typeof MODULES;

/** The intersection, because an entry calls only its own module's exports and the harness is generic over all */
type Lib = typeof realMeasure & typeof realStepTimeouts & typeof realChainSchedule
  & typeof realCoreBudget & typeof realStepTiming;

interface Step { readonly name: string; readonly dependsOn: string[]; readonly conflicts?: string[]; readonly cores?: number }
const sstep = (name: string, dependsOn: string[] = [], extra: Partial<Step> = {}): Step =>
  ({ name, dependsOn, ...extra });

/**
 * What a scheduled run did, as strings — the projection the scheduler's entries compare.
 *
 * **Never the raw `ScheduleResult`.** `threw[].error` holds `Error` objects, which `toEqual` compares by
 * message alone, and a `Map` or `Set` compares order-insensitively — both weaken exactly the discrimination
 * an entry is for. `peak` is how a budget decision is visible at all: the most steps running at once.
 *
 * `run` resolves immediately and that is sufficient, so the `release`/`drain` machinery in
 * `chain-schedule.spec.ts` is deliberately not reproduced here: `schedule`'s dispatch pass is synchronous,
 * so `spent` is already full when the next candidate is judged, while the handlers that release it are
 * microtasks that cannot run until `await Promise.race`.
 */
const scheduled = async (lib: Lib, steps: readonly Step[], budget: number, options: {
  readonly failing?: readonly string[];
  readonly skipping?: readonly string[];
} = {}) => {
  let live = 0;
  let peak = 0;
  const result = await lib.schedule({
    steps,
    budget,
    skip: (step) => (options.skipping ?? []).includes(step.name),
    run: async (step) => {
      peak = Math.max(peak, ++live);
      await Promise.resolve();
      live -= 1;
      return !(options.failing ?? []).includes(step.name);
    },
  });
  return {
    started: result.started.join(','),
    skipped: result.skipped.join(','),
    failed: result.failed ?? 'none',
    peak,
  };
};

/**
 * One break, and the call that has to notice it.
 *
 * `call` projects to something stable rather than returning the record whole: a fresh `measuredAt` differs
 * between any two runs, so comparing it directly would pass for every mutation and prove nothing.
 */
interface Mutation {
  readonly why: string;
  /** Which module holds the line. Required, since the default it used to take is gone */
  readonly in: Module;
  readonly from: string;
  readonly to: string;
  readonly call: (lib: Lib) => unknown;
}

const MUTATIONS: readonly Mutation[] = [
  {
    // The flip is the whole decision: dropping it reports the idle share of the box as the busy one, which on
    // the reading this exists for turns a pool still running at 6.6 cores into one apparently at 3.4 — the
    // exact misreading it was added to prevent. The asymmetric input matters, since a half-idle box reads the
    // same either way
    why: 'coresBusy reports the busy share of the box rather than the idle one',
    in: 'measure',
    from: '(1 - idleFrom(before, after)) * cores',
    to: 'idleFrom(before, after) * cores',
    call: (lib) => lib.coresBusy({ idle: 0, total: 0 }, { idle: 340, total: 1000 }, 10),
  },

  // The wording is a decision too, and it is the one the defect actually was: a string telling a reader to
  // rename a file into a half that does not exist.
  /**
   * The scheduler's seven. Every one projects through `scheduled` above, and the inputs are chosen so the
   * decision is the only thing that moves — which is why each carries the two answers in its comment where
   * they are not obvious.
   */
  {
    why: 'the budget admits on what the live steps already hold',
    in: 'chain-schedule',
    from: 'if (spent > 0 && spent + (step.cores ?? 1) > budget) continue;',
    to: '',
    // Three four-core steps and ten to spend: `c` waits, so two run at once. Without the clause all three do
    call: (lib) => scheduled(lib, [sstep('a', [], { cores: 4 }), sstep('b', [], { cores: 4 }), sstep('c', [], { cores: 4 })], 10),
  },
  {
    why: 'the budget is soft, so a step wider than all of it still runs',
    in: 'chain-schedule',
    from: 'spent > 0 && ',
    to: '',
    // A hard comparison holds it for ever: nothing is running, so nothing will ever free the budget it
    // needs, and the loop exits having started it never. `started` is the whole answer.
    call: (lib) => scheduled(lib, [sstep('huge', [], { cores: 20 })], 10),
  },
  {
    why: 'a mutex holds in the direction the running step declares it, not only the candidate',
    in: 'chain-schedule',
    from: '          || (steps.find((candidate) => candidate.name === name)?.conflicts ?? []).includes(step.name);',
    to: ';',
    // `lock` names `b`; `b` names nothing. Only the second clause sees that, so without it the pair overlaps
    call: (lib) => scheduled(lib, [sstep('lock', [], { conflicts: ['b'] }), sstep('b')], 10),
  },
  {
    why: 'a step waits for what it depends on',
    in: 'chain-schedule',
    from: 'if (!step.dependsOn.every((need) => done.has(need))) continue;',
    to: '',
    // `b` sits first in the table and needs `a`, so the order is the answer: a,b against b,a
    call: (lib) => scheduled(lib, [sstep('b', ['a']), sstep('a')], 10),
  },
  {
    why: 'a skipped step counts as passed, so what needed it becomes ready',
    in: 'chain-schedule',
    from: `            skipped.push(step.name);
            done.add(step.name);`,
    to: '            skipped.push(step.name);',
    // Without the credit `b` is never ready, nothing is running, and the loop exits with it unstarted
    call: (lib) => scheduled(lib, [sstep('a'), sstep('b', ['a'])], 10, { skipping: ['a'] }),
  },
  {
    why: 'the first failure is the one reported, not the last',
    in: 'chain-schedule',
    from: 'else failed ??= step.name;',
    to: 'else failed = step.name;',
    // Two failing steps, both admitted in one pass. No case in `chain-schedule.spec.ts` has two.
    call: (lib) => scheduled(lib, [sstep('a'), sstep('b')], 10, { failing: ['a', 'b'] }),
  },
  {
    /**
     * The one entry that cannot simply call and compare: with the exit gone, `Promise.race` over an empty
     * map never settles, so the mutant hangs rather than answering. It is raced against a timer and
     * projected to a word. The losing promise is left pending on purpose — there is nothing to cancel, and
     * the alternative is no entry at all for the branch that stops the loop.
     */
    why: 'the loop stops when nothing is running and nothing was dispatched',
    in: 'chain-schedule',
    from: 'if (!turnedAway || failed !== undefined) break;',
    to: 'await new Promise(() => {});',
    call: async (lib) => {
      const ran = scheduled(lib, [sstep('orphan', ['absent'])], 10).then(() => 'returned');
      return Promise.race([ran, new Promise((resolve) => setTimeout(() => resolve('hung'), 250))]);
    },
  },
  /**
   * `step-timeouts.ts` has no spec of its own. `chain-graph` reaches what a kill reports through
   * `timedOutBecause`, but nothing there pins a rung's *deadline*, so changing `quick` to six seconds still
   * leaves every case in the repo green. These three are what observes the rest.
   */
  {
    // The mutation is the *permissive* answer rather than a crash, because that is the decision: "a budget is
    // a ceiling, so the confident wrong answer is the permissive one". Dropping the guard would now throw a
    // TypeError on `rung.ms`, which differs from the named error and so would pass this — while testing that
    // reading a field of `undefined` fails, not that the function refuses
    why: 'timeoutMsFor refuses a class the ladder has not got, rather than defaulting to one',
    in: 'step-timeouts',
    from: '    throw new Error(`No such timeout class: ${className} — one of ${TIMEOUT_CLASSES.join(\', \')}`);',
    to: '    return TIMEOUT_MS.quick.ms;',
    call: (lib) => lib.timeoutMsFor('nonsense'),
  },
  {
    // Not the values themselves, which an entry cannot assert without restating them: the property the
    // ladder has to have is that a rung is slower than the one below, which is what makes `quick` a
    // meaningful thing to give a step. `suite` dropping under `quick` breaks it.
    why: 'the ladder climbs, so a class is slower than the one below it',
    in: 'step-timeouts',
    from: '  suite: { ms: 600_000 },',
    to: '  suite: { ms: 30_000 },',
    call: (lib) => {
      const ms = lib.TIMEOUT_CLASSES.map((className) => lib.TIMEOUT_MS[className].ms);
      return ms.every((value, at) => at === 0 || value > ms[at - 1]!) ? 'climbs' : 'does not climb';
    },
  },
  {
    why: 'timeoutText says a class in seconds, not milliseconds',
    in: 'step-timeouts',
    from: '`${TIMEOUT_MS[className].ms / 1000}s (${className})`',
    to: '`${TIMEOUT_MS[className].ms}s (${className})`',
    call: (lib) => lib.timeoutText('quick'),
  },
  {
    /**
     * Dropping the filter hands every reader a killed step's deadline as its cost — the drift report offers
     * it as an edit. The number is right and it is not a measurement.
     */
    why: 'measurementsFrom leaves out a step whose time is the deadline it was killed at',
    in: 'step-timing',
    from: 'results.filter((result) => result.timedOut !== true)',
    to: 'results',
    call: (lib) => [...lib.measurementsFrom([
      { step: 'build:default-setup', ms: 13_000 },
      { step: 'test:integration', ms: 300_400, timedOut: true },
    ])],
  },
  /**
   * `core-budget.ts`'s four. What a step takes of the machine is the chain's admission weight, so a wrong
   * answer here is an over- or under-admitted chain rather than a failure, which is why none of these has a
   * case that would notice.
   *
   * Every one passes `cores` explicitly. The parameter exists so a case can ask about a ten-core box from
   * whatever box it runs on, and an entry that let it default would be an entry about this machine.
   *
   * **`UNCAPPED` is a `Symbol`, so the mutant module has its own.** Nothing here passes one across the
   * seam: each entry names a step and lets `POOL_WIDTH` resolve the width inside the module being asked.
   */
  {
    why: 'coresFor weighs a step with no declared width at one core',
    in: 'core-budget',
    from: 'if (width === undefined) return 1;',
    to: 'if (false) return 1;',
    // `typecheck` declares no width. Without the arm it falls to `'cores' in undefined`, which throws
    call: (lib) => lib.coresFor('typecheck', 10),
  },
  {
    why: 'an uncapped pool takes one less than the box, which is vitest’s default',
    in: 'core-budget',
    from: 'if (width === UNCAPPED) return Math.max(1, cores - 1);',
    to: 'if (width === UNCAPPED) return Math.max(1, cores);',
    // 9 against 10. The whole claim the symbol makes is the `- 1`, and nothing else in the repo reads it
    call: (lib) => lib.coresFor('test:unit:host', 10),
  },
  {
    why: 'a fixed width is clamped to the machine, so it cannot exceed the budget it is spent from',
    in: 'core-budget',
    from: 'Math.min(width.cores, cores)',
    to: 'width.cores',
    // A one-core box against `build:default-setup`'s two: 1 against 2. On any box wider than the width the clamp is
    // invisible, which is why this asks about the smallest machine rather than a plausible one
    call: (lib) => lib.coresFor('build:default-setup', 1),
  },
  {
    why: 'a share rounds to the nearest core rather than down',
    in: 'core-budget',
    from: 'Math.round(width.share * cores)',
    to: 'Math.floor(width.share * cores)',
    // An **odd** box, which is what makes the rounding observable at all: half of nine is 5 rounded and 4
    // floored. Both of `core-budget.spec.ts`'s share cases use even counts, so neither can see this
    call: (lib) => lib.coresFor('test:integration', 9),
  },
];

/**
 * A value or the message it threw, so a break that turns a refusal into a return still compares.
 *
 * **It awaits, and that is not a convenience.** `Mutation.call` returns `unknown`, so a subject that is
 * async type-checks and then compares wrongly: vitest's `toEqual` reads two distinct Promises as *equal* —
 * no own enumerable keys, and its `className` switch has no Promise case — so `.not.toEqual` would fail
 * every async entry unconditionally, reporting "breaking this changed nothing" about a break that worked.
 * Two further hazards go with it: a `try/catch` around an un-awaited call cannot catch a rejection, so a
 * mutation that makes the subject reject becomes an unhandled rejection rather than `{ threw }`; and an
 * unsettled promise leaves work running past the case.
 *
 * Awaiting a non-thenable is identity, so the entries that are synchronous are unaffected — checked by
 * running all of them before and after, by name, not by the absence of a failure.
 */
const outcome = async (run: () => unknown): Promise<unknown> => {
  try {
    return { ok: await run() };
  } catch (error) {
    return { threw: (error as Error).message.slice(0, 120) };
  }
};

describe('every decision these modules make is one something can see', () => {
    const sources = new Map<Module, string>();

  /** Where the mutants are written. It held a fixture pack tree too, until the module needing one went */
  const mutants: { root: string } = { root: '' };

  beforeAll(() => {
    for (const [name, { file }] of Object.entries(MODULES)) {
      sources.set(name as Module, fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', file), 'utf-8'));
    }
    mutants.root = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-mutations-'));
  });

  afterAll(() => fs.rmSync(mutants.root, { recursive: true, force: true }));

  it('has mutations to run, since an empty table would report nothing', () => {
    expect(MUTATIONS.length).toBeGreaterThan(10);
    // Every module registered is one some entry names, or it is a mutant nothing writes
    expect([...new Set(MUTATIONS.map((entry) => entry.in))].sort(),
      'a registered module no entry names is scaffolding for a case that is gone')
      .toEqual(Object.keys(MODULES).sort());
  });

  // Anchors are text, so a refactor turns an entry into a no-op that still passes. Checked first and named,
  // the same way `EXPENSIVE_BY_NATURE` is held to naming something that is still expensive
  /**
   * The mutant is written to a temp directory, so a relative import in the source would not resolve from
   * there. Rewriting them is what lets the module under test have imports at all — it had none, and that
   * looked like a property of the module when it was a property of this spec.
   */
  const absolute = (body: string): string =>
    body.replace(/from '\.\/([\w.-]+)'/g, (_, file: string) => `from '${pathToFileURL(path.join(REPO_ROOT, 'scripts', 'lib', file)).href}'`);

  it.each(MUTATIONS)('finds the line for: $why', ({ from, in: where }) => {
    const source = sources.get(where)!;
    expect(source.split(from).length - 1,
      `this mutation no longer applies; update its \`from\` (or its \`in\`):\n${from}`).toBe(1);
  });

  it.each(MUTATIONS)('$why', async ({ from, to, call, in: where }) => {
    const file = path.join(mutants.root, `mutant-${MUTATIONS.findIndex((entry) => entry.from === from)}.ts`);
    fs.writeFileSync(file, absolute(sources.get(where)!.replace(from, to)));
    const mutant = await import(pathToFileURL(file).href) as Lib;

    expect(await outcome(() => call(mutant)),
      'breaking this changed nothing the case looks at, so the case is watching something else')
      .not.toEqual(await outcome(() => call(MODULES[where].real)));
  });
});
