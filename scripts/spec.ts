// `npm run spec` — run the specs that could fail because of what you changed.
//
// Running one spec is the cheapest check this repo has (1-3s against a chain run), and what made it awkward
// was never vitest: it was deciding what to run and then addressing it. A path from a stack trace is
// repo-relative while the command wants a workspace plus a package-relative path; and after editing a source
// file the honest answer to "what covers this?" took a grep, so the reflex was to run the whole package
// suite instead — 543 tests where 25 would do.
//
// So you do not tell it what kind of thing you are giving it:
//
//   npm run spec                            the specs your uncommitted changes affect
//   npm run spec -- <spec path>             that spec
//   npm run spec -- <name>                  every spec whose path contains it — how you run one while working
//   npm run spec -- <directory>             every spec under it
//   npm run spec -- <source file>           every spec that imports it, transitively, in whatever package
//   npm run spec -- <any of the above> -t "case"     anything starting with `-` goes to vitest untouched
//   npm run spec -- --changed HEAD~1        a different base for the change set
//   npm run spec:full [...]                 and the pack suites a rebuilt `dist` would reach
//
// A **source file** is the case worth knowing about. Its own package would be one of the seven suites that
// cover `@apackdev/sdk`: a green run of specs that could not fail for the change. So it runs one vitest over
// every host project, which is what the root `vitest.config.ts` is for.
// That costs what the blast radius costs — a component nothing imports is still 1-3s, a type every pack's
// data flows through is 28s and 104 files. To go back to one spec while iterating, name it.
//
// Where it can, it delegates to the package's own `test` script, so @apackdev/cli's and @app/default-setup's
// pretest guard (`packages:ensure`) and each vitest config still apply. A root run has no such hook, so the
// plan puts `packages:ensure` in front of it.
//
// **Two more edges run through a build, inside a pack.** `src/content/**` compiles to `dist/*.content.json`, which
// `tests/content/` reads against its goldens, and `apack.json` drives codegen into `src/__generated__/`, which
// every spec in the pack imports. The walk still runs — an apply helper the specs import directly is answered by
// it — and carries what it could not see (`Run.beyond`); `npm run spec:full` builds the pack and runs them.
//
// What a module graph cannot reach is a **pack suite**: it resolves the published `dist` while the host
// projects resolve source, so its specs never import `packages/<dep>/src` and no import edge runs from the
// file you edited to the spec that covers it. `npm run spec` says so when it is true — derived from the
// declared dependencies, so editing a package no pack depends on says nothing — and `npm run spec:full`
// answers it, at the cost of a build (14s when stale) and the pack suite (18s).
//
// **Three exit codes, because the three need different next moves and only one is a bug in the code:**
//
//   1  a spec failed — the ordinary one
//   2  a name was wide enough to be a search, so the paths were listed instead of run
//   3  nothing ran and nothing passed: no spec covers the target, or the specs that do sit behind a build
//      this run is not doing (a pack's content sources, its build inputs) — `npm run spec:full` answers those
//
// 3 is the one worth knowing about. `vitest related` exits 0 when the module graph reaches no spec, so until it
// existed "nothing covers this" and "everything covering this passed" were the same output and the same code —
// and five of eight sampled entry modules answered zero. A run only earns that judgement if its route promised
// coverage of a file a spec could cover (`Run.claimsCoverageOf`): a whole-suite run, a `-t` filter that matched
// no case, and a `.md` target all report zero correctly.
//
// **Two flags of its own.** `npm run spec:dry` answers "what would this run, and what did the last run on
// this machine measure it at" without running any of it. It collects — ~1.6s whatever comes back — which the ordinary run never
// does: the collector and the pricing load behind `await import`, and repo-checks asserts that from this
// file's source. And `--no-bail` reports every failure in the plan rather than stopping at the first, for
// when you want the whole picture in one run; bailing is the default because a 1s failure otherwise pays for
// the pack suite behind it.
//
// `scripts/lib/spec-plan.ts` decides all of that and is asserted by a spec; this file runs what it returns.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { SPEC_COUNT_FILE } from './lib/spec-count-reporter.ts';
import { TIMEOUT_MS } from './lib/step-timeouts.ts';
import { ENSURE_LABEL, exitCodeFor, packageOf, planChanged, planTargets, type Run, splitArgs, verdictOf } from './lib/spec-plan.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const { full, bail, dry, targets, flags } = splitArgs(process.argv.slice(2));

/** What git reports as changed, repo-relative. `planChanged` derives the packages and reads the paths itself */
function changed(): string[] {
  const out = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf-8' }).stdout ?? '';
  return out.split('\n').filter(Boolean).map((l) => l.slice(3).trim().split(' -> ').pop()!);
}

/** Runs the plan and answers its exit code: set rather than exited with, so streamed output is never cut */
async function main(): Promise<number> {
  const changedPaths = targets.length > 0 ? [] : changed();

  if (targets.length === 0 && changedPaths.length === 0) {
    console.log('Nothing changed, and no spec named — nothing to run.');
    return 0;
  }

  const { runs, unmatched, ambiguous } = targets.length > 0
    ? planTargets(targets, flags, ROOT, { full })
    : planChanged(changedPaths, flags, ROOT, { full });

  // A change set with nothing a spec could cover: the plan is no runs, and saying so is the whole answer
  if (runs.length === 0 && targets.length === 0) {
    console.log('Nothing changed that a spec could cover — no spec run.');
    return 0;
  }

  if (unmatched.length > 0) {
    console.error(`No spec or file matches ${unmatched.map((t) => `"${t}"`).join(', ')}`);
    return 1;
  }

  // A name wide enough to be a search is answered with the paths, not by running them: the one to run is a copy away,
  // and running two dozen across eight suites because a word was short is not the narrowest thing that could fail.
  if (ambiguous.length > 0) {
    for (const { query, specs } of ambiguous) {
      console.error(`"${query}" matches ${specs.length} specs across ${new Set(specs.map((f) => packageOf(path.relative(ROOT, f)))).size} suites:\n`);
      for (const f of specs) console.error(`  ${path.relative(ROOT, f)}`);
      console.error(`\nRun one, or several:\n  npm run spec -- ${path.relative(ROOT, specs[0])}`);
    }
    return 2;
  }

  /**
   * A named target the plan reaches no run for — a package with no suite, or a source directory whose specs
   * live elsewhere.
   *
   * **This is the documented exit 3, and it was silent.** The per-run `uncovered` report at the foot can only
   * speak for runs that happened, so a plan with *no* runs in it reported nothing and exited 0: `npm run spec
   * -- packages/preload` printed not one line and passed. That is the shape this command exists to refuse —
   * "a check that reports nothing may have looked at nothing, and a green run cannot tell you which" — in the
   * command that every other claim of coverage is made with. Found by running it against a package with no
   * vitest config, to answer whether a goal's "spec over each touched package" was met.
   *
   * `--dry` reports a plan rather than a result, so an empty one is still a report: it says the sentence and
   * exits 0.
   */
  if (runs.length === 0) {
    console.error(`\nNo spec covers ${targets.map((t) => `"${t}"`).join(', ')} — nothing ran, so nothing passed.`);
    // Through `exitCodeFor`, so the code is not written twice: the targets are the uncovered things
    return dry ? 0 : exitCodeFor({ failed: 0, uncovered: targets.length, noCount: 0 });
  }

  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-count-'));
  const COUNT_REPORTER = path.join(import.meta.dirname, 'lib', 'spec-count-reporter.ts');

  /**
   * How many spec files a run executed, which its exit status cannot say: `vitest related` exits 0 for a file
   * nothing covers. `spec-count-reporter.ts` records it and prints nothing; see its header for why vitest's own
   * `json` reporter is not used.
   *
   * `--reporter=default` goes alongside because naming any reporter *replaces* the human output. Skipped when the
   * caller already chose one, so `--reporter=verbose` does not become three reporters.
   */
  function counted(run: Run, index: number): { args: string[]; env: NodeJS.ProcessEnv; read: () => number | undefined } {
    const file = path.join(reports, `${index}`);
    const chose = [...run.args].some((a) => a.startsWith('--reporter'));
    return {
      args: [...run.args, ...(chose ? [] : ['--reporter=default']), `--reporter=${COUNT_REPORTER}`],
      env: { ...process.env, [SPEC_COUNT_FILE]: file },
      // `undefined` for a file that never arrived, which is not the same as zero and must not read as a pass:
      // a reporter that stopped being called is how this whole check would go quiet
      read: () => (fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf-8')) : undefined),
    };
  }

  /**
   * What the plan would run, and what the last run on this machine measured it at, collecting rather than
   * running.
   *
   * Collection is flat in the size of the answer — 1.6s for 0 specs and 1.6s for 150, measured, because it is
   * the eleven project configs being loaded rather than a graph being walked. Worth it against a 20s root run
   * and not against a 3s one, which is why it is its own command rather than something the ordinary run pays.
   */
  if (dry) {
    const { collectFor, checkedSpecs, specsOfSuites, needsAppForRun, pricedSpecs } = await import('./lib/spec-dry.ts');
    const { asDuration, asLocalTime } = await import('./lib/spec-durations.ts');
    // Each distinct note once, as the run itself says them: two targets in one package carry the same sentence
    const said = new Set<string>();
    let listed = 0;
    let measured = 0;
    let unpriced = 0;
    let oldest: string | undefined;

    for (const run of runs) {
      console.log(`\n→ ${run.label}${needsAppForRun(run, ROOT) === true ? '  [needs the app]' : ''}`);
      let specs: readonly string[];
      if (run.collects !== undefined) {
        specs = checkedSpecs(await collectFor(run, ROOT));
      } else if (run.specs !== undefined) {
        specs = checkedSpecs([...run.specs].sort());
      } else if (run.covers !== undefined) {
        specs = specsOfSuites(run.covers, ROOT);
      } else {
        console.log('   no specs of its own: it builds, or makes the packages current');
        continue;
      }
      listed += specs.length;
      const price = pricedSpecs(specs, ROOT);
      // What each one cost, and what it cost at the far end of the window where there is one. The pools show
      // a trend for the five slowest of a half; here the caller named the spec, so every one of them can have
      // it without a threshold deciding which are worth mentioning.
      for (const spec of specs) {
        const moved = price.trend.get(spec);
        console.log(`   ${spec}${moved === undefined ? '' : `  (was ${asDuration(moved.was)} over ${moved.runs} runs)`}`);
      }
      measured += price.ms;
      unpriced += price.unpriced.length;
      if (price.measuredAt !== undefined && (oldest === undefined || price.measuredAt < oldest)) oldest = price.measuredAt;
      console.log(`   ${specs.length} spec${specs.length === 1 ? '' : 's'}${price.priced === 0 ? '' : `, ${asDuration(price.ms)} of file time`}`);
      // Named rather than counted free, which is the whole difference between a partial total and a wrong one
      if (price.unpriced.length > 0) {
        console.log(`   ${price.unpriced.length} not measured on this machine yet: ${price.unpriced.slice(0, 3).join(', ')}${price.unpriced.length > 3 ? `, and ${price.unpriced.length - 3} more` : ''}`);
      }
      for (const note of run.notes ?? []) if (!said.has(note)) { console.log(`   ${note}`); said.add(note); }
      if (run.beyond !== undefined) {
        console.log(`   not in this answer: ${run.beyond.covers} — ${run.beyond.how}`);
      }
    }

    // **File time summed across workers, never a wall estimate** — measured on one target three days apart,
    // the ratio between the two was 1.55:1 and 2.18:1, so a wall figure here would be wrong by more than it
    // is worth. And it is the last run on this machine rather than a record: nothing is committed, so there
    // is no number to go stale and a clone that has run nothing says so instead of guessing.
    const where = oldest === undefined ? 'nothing measured on this machine yet' : `${asDuration(measured)} of file time, measured here ${asLocalTime(oldest)}`;
    console.log(`\n${listed} spec${listed === 1 ? '' : 's'} across ${runs.length} run${runs.length === 1 ? '' : 's'}; ${where}${unpriced === 0 ? '' : ` (${unpriced} unmeasured)`}.`);
    if (oldest !== undefined) console.log('File time, not wall: a pool runs it across workers. Run the unit pools to refresh it.');
    return 0;
  }

  let failed = 0;
  /** The runs a bail did not reach, named rather than silently skipped */
  let notReached: readonly Run[] = [];
  const uncovered: Run[] = [];
  const noCount: string[] = [];
  // Each distinct note once: two source-file targets are two root runs carrying the same sentence about the
  // pack suites, and a limit worth stating is not worth stating twice
  const said = new Set<string>();
  try {
    for (const [index, run] of runs.entries()) {
      if (run.label !== ENSURE_LABEL) console.log(`\n→ ${run.label}`);
      const counter = run.claimsCoverageOf === undefined ? undefined : counted(run, index);
      // Bounded for its process group: a vitest that dies on a worker's native abort leaves no workers behind
      const result = await boundedSpawn(run.command, counter?.args ?? [...run.args], TIMEOUT_MS.scenario.ms,
        { cwd: run.cwd, stream: true, ...(counter?.env !== undefined && { env: counter.env }) });
      const verdict = verdictOf(run, result.code, counter?.read());
      if (verdict === 'fail') {
        failed++;
        // The failure is the answer, and every run behind it is a bill for information already in hand
        if (bail) { notReached = runs.slice(index + 1); break; }
      }
      if (verdict === 'uncovered') uncovered.push(run);
      if (verdict === 'no count') noCount.push(run.label);
      for (const note of run.notes ?? []) if (!said.has(note)) { console.log(`   ${note}`); said.add(note); }
      // Said only when the run answered something: when it did not, the edge is the whole answer and is
      // reported below instead, where it replaces a sentence that would be false
      if (run.beyond !== undefined && verdict === 'pass') {
        console.log(`   not in this answer: ${run.beyond.covers} — ${run.beyond.how}`);
      }
    }
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }

  // Both are said, even though only one can be the exit code: a hole found beside a failure is information
  // already in hand, and dropping it means finding it on the next run instead
  if (notReached.length > 0) {
    console.error(`\nStopped at the first failure, so ${notReached.length} run${notReached.length === 1 ? ' was' : 's were'} not reached:`);
    for (const run of notReached) console.error(`  ${run.label}`);
    console.error('  npm run spec -- --no-bail … runs them anyway.');
  }

  // Two sentences for one emptiness, because they are opposite facts: a gap in the suite, and specs that
  // exist behind a build this run did not do. A content source is the second, never the first
  for (const run of uncovered) {
    const target = run.claimsCoverageOf!;
    console.error(run.beyond === undefined
      ? `\nNo spec covers ${target} — nothing ran, so nothing passed.`
      : `\nNothing ran for ${target}. It is covered by ${run.beyond.covers} — an edge that runs through a `
        + `build, so no module graph connects the two.\n  ${run.beyond.how}`);
  }
  // Loud rather than assumed, because assuming it ran something is how the check would stop checking
  for (const label of noCount) {
    console.error(`\n${label}: the spec count never arrived, so whether anything ran is unknown.`
      + `\n  ${path.relative(ROOT, COUNT_REPORTER)} did not write it — is it still a reporter vitest calls?`);
  }
  return exitCodeFor({ failed, uncovered: uncovered.length, noCount: noCount.length });
}

process.exitCode = await main();
