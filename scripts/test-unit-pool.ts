/**
 * One pool's tests, running only the projects whose inputs changed.
 *
 *     tsx scripts/test-unit-pool.ts host         # the root vitest.config.ts projects, under @apackdev/source
 *     tsx scripts/test-unit-pool.ts pack         # each pack suite, resolving the published dist
 *     tsx scripts/test-unit-pool.ts integration  # the expensive half of every suite that has one
 *
 * What this decides is which projects are stale, how many vitest runs that takes, and when each is stamped.
 * Three things it does not, and does not restate: why the chain has one step per pool (`POOL_STEPS` in
 * `scripts/lib/chain-steps.ts`), what a project's freshness is measured against (`scripts/lib/unit-pool.ts`),
 * and the rule both cache layers hold to (`suiteInputs`, beside the steps).
 *
 * `--all` is read here, from argv, because the chain overriding its own stamps says nothing to a cache it
 * does not know about: the pool steps declare `forceArgs` so the flag arrives.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { diffableStamp, firstChange, freshnessSweep, REPO_ROOT, stampRecord } from '@apackdev/host/build/packages-built';
import type { UnitSuite } from './lib/unit-suites.ts';
import { DIAGNOSTIC_RUN_ENV, holdPoolLock, poolWorkers, POOLS, poolStampFor, poolUnitFor, projectsThatDidNotRun, provenanceOf, prunePoolStamps, recordRun, recordsVerdict, whyItRuns, type Pool, type Provenance } from './lib/unit-pool.ts';
import type { ReportedRun } from './lib/spec-durations-reporter.ts';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { CHAIN_STEPS, poolStepName } from './lib/chain-steps.ts';
import { timeoutMsFor, timedOutBecause } from './lib/step-timeouts.ts';
import { exitOnEpipe } from './lib/exit-on-epipe.ts';
import { asDuration, durationsOf, halfTotal, markedSpecs, trendOf, placementOf, pruneDurationCache, slowestFiles, tailBar, uncheckedNote, UNMARKED_NOTE, writeDurations } from './lib/spec-durations.ts';
import { readReportedRun, SPEC_DURATIONS_FILE } from './lib/spec-durations-reporter.ts';
import { overBudgetLine, overBudgetPasses } from './lib/over-budget.ts';
import { timeoutOverrides } from './lib/test-timeouts.ts';
import { HALVES } from './lib/spec-halves.ts';
import { parseShard, shardArg } from './lib/chain-only.ts';

exitOnEpipe();


/** The diff itself, for the one branch of `whyItRuns` that needs it — over the sweep the decision was made on */
/**
 * Which projects will run, and why — asked of all of them at this one moment, over one reading of the tree.
 *
 * A function rather than a block, so the sweep is unreachable the moment it returns. It caches every byte it
 * reads (14.7MB across the host pool's 2,372 distinct input files), and the run it decides on then spawns vitest
 * for as long as the suites take — `freshnessSweep`'s own rule is that a sweep may not outlive the one question
 * it was made for, and holding one across a test run is the worst way to break it.
 *
 * **Yes, the chain has just hashed these same bytes for the step's own fingerprint, and that is priced
 * rather than a thing to fix.** Measured 2026-10-06 — median of 3 on a box another process was using, so each figure is an upper bound and the proportions are what the conclusion rests on —
 * a fresh host pool step is 0.90s, of which 0.38s is
 * `tsx` starting, 0.30s is the nested `packages:ensure` spawn and ~0.22s is this sweep and the prune. So
 * the duplicate read is the smallest of the three parts, and 0.6-1% of a step that runs any tests.
 * Removing it means one cache layer rather than two, which costs the per-project granularity the layer
 * exists for — a one-package edit running one project instead of eleven. Root `CLAUDE.md` carries why two
 * layers are sound here where they were a defect for `packages:ensure`: these two cannot disagree about
 * freshness, being derived from one input function.
 *
 * The verdict goes through the same sweep as the explanation. That is not only the double read it saves: a
 * verdict and an explanation taken from two readings can describe two different trees, which is the shape the
 * chain's report had removed from it a week ago.
 */
function decide(suites: readonly UnitSuite[], pool: Pool, all: boolean, provenance: Provenance, workers?: number): Array<{ suite: UnitSuite; why: string }> {
  const sweep = freshnessSweep();
  return suites.flatMap((suite) => {
    const stamp = poolStampFor(suite, POOLS[pool].half, provenance);
    const unit = poolUnitFor(suite, pool, provenance, workers);
    const read = diffableStamp(stampRecord(stamp));
    if (!all && sweep.staleReason(unit, stamp) === null) return [];
    // The stamp is read once and handed to both halves, rather than fetched again inside the diff
    const moved = () => (read.stamp === undefined ? '' : firstChange(sweep.changedInputs(unit, read.stamp)));
    return [{ suite, why: all ? '--all' : whyItRuns(read, moved) }];
  });
}

/**
 * What the run that just finished says about its own files: a ranking, and whether every `@slow:` marker
 * in it is still true.
 *
 * Over the output the run already produced, so it adds a parse and no work. The ranking is what vitest
 * does not give — it prints every file's time, in the order the files finished — and the gate is the one
 * question a marker makes checkable.
 *
 * **It throws from inside the stamped thunk.** A gate that reported after the stamps were written would be
 * green on the next run having never re-asked, which is the defect `DIAGNOSTIC_RUN_ENV` exists for.
 */
function reportDurations(kind: Pool, covered: readonly UnitSuite[], reported: ReportedRun): void {
  const rows = durationsOf(reported, covered);
  // A run whose every file was skipped reports no durations, and a ranking of nothing is not a finding.
  // **Not "all cached"**, which this cannot be reached for — `main` returns before building `runs` when
  // nothing is stale. Nor a reporter that did not run: it writes no file, which `readReportedRun` answers
  // `undefined` for and the caller refuses on.
  if (rows.length === 0) return;
  // Written whether or not this run may record a verdict. A duration is a measurement, true whoever asked
  // for it — the same reason `recordRun` suppresses a stamp and `ensurePackagesBuilt` does not suppress a
  // build. What reads it is `spec:dry`, which prices a plan and gates nothing.
  writeDurations(REPO_ROOT, rows);

  const marked = new Map(covered.map((suite) => [suite.dir, markedSpecs(path.join(REPO_ROOT, 'packages', suite.dir))]));
  // A pool runs the projects whose inputs moved, so most runs are partial — and a bar taken from part of a
  // half cannot say a marked spec has left that half's tail. `Placement.stale` has the measurement.
  const all = POOLS[kind].suites();
  const placement = placementOf(rows, marked, { whole: covered.length === all.length });
  // Only the ones `placementOf` found in the tail, not every ranked file without a marker: a run of one
  // small project has a slowest five like any other, and annotating those read as five findings about a
  // suite whose slowest file takes 100ms
  const missing = new Set(placement.unmarked.map((row) => `${row.dir}/${row.file}`));

  for (const half of HALVES) {
    const ranked = slowestFiles(rows, half);
    if (ranked.length === 0) continue;
    const bar = tailBar(rows, half)!;
    const total = halfTotal(rows, half);
    console.log(`${kind} pool: the ${half} half is ${asDuration(total.ms)} of file time over ${total.files} file(s); its slowest (p90 ${asDuration(bar)})`);
    const width = Math.max(...ranked.map((row) => `${row.dir}/${row.file}`.length));
    for (const row of ranked) {
      const named = `${row.dir}/${row.file}`;
      const trend = trendOf(REPO_ROOT, row.dir, half, row.file);
      const moved = trend === undefined ? '' : ` (was ${asDuration(trend.was)} over ${trend.runs} runs)`;
      const note = `${marked.get(row.dir)?.get(row.file) ?? (missing.has(named) ? 'no @slow: marker' : '')}${moved}`.trim();
      console.log(`  ${asDuration(row.ms).padStart(7)}  ${note === '' ? named : `${named.padEnd(width)}  ${note}`}`);
    }
    // What `no @slow: marker` above is worth, said once. It is the one of the two directions a loaded run
    // can fabricate, and so the one that is reported rather than failed — where the failure below carries
    // that reasoning in full and this carried none, leaving a reader to meet an annotation with no way to
    // know it is not a result they are obliged to clear.
    //
    // Per half rather than per row, for the reason `missing` is narrowed at all: a note on every row is
    // where annotation stops being read. The trend beside each row is what says whether one of these has
    // been slow for ten runs or is this run's load, so the prompt needs no figure of its own.
    const unmarked = placement.unmarked.filter((row) => row.half === half).length;
    if (unmarked > 0) {
      console.log(`${kind} pool: ${unmarked} of those ${unmarked === 1 ? 'carries' : 'carry'} `
        + `no @slow: marker — ${UNMARKED_NOTE}`);
    }
  }
  for (const { half, files, why } of placement.unplaceable) {
    console.log(`${kind} pool: no marker checked in the ${half} half — `
      + uncheckedNote(why, { files, covered: covered.length, all: all.length }));
  }
  if (placement.stale.length > 0) {
    const lines = placement.stale.map(({ dir, file, ms, bar, reason }) =>
      `  ${dir}/${file} ran in ${asDuration(ms)}, inside its half's ${asDuration(bar)} p90 — "${reason}"`);
    throw new Error([
      `${placement.stale.length} spec(s) carry a @slow: marker and are no longer in their half's slow tail:`,
      ...lines,
      'Drop the marker, or replace it with what makes the spec slow now. Load can only inflate a duration,',
      'never shorten one, so a marked spec reading fast is a fact about the spec rather than about the machine.',
    ].join('\n'));
  }
}

/** Where each run's reporter writes, one file per run, removed with the process */
const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-durations-'));

async function main(): Promise<void> {
  // Refused rather than defaulted. With two pools a typo ran the host pool, which at least ran something;
  // with three it would report a pool green having run another one's projects, and the stamps would agree.
  const asked = process.argv[2] ?? '';
  if (!(asked in POOLS)) throw new Error(`no pool named '${asked}' — one of ${Object.keys(POOLS).join(', ')}`);
  const kind = asked as Pool;
  const step = CHAIN_STEPS.find(step => step.name === poolStepName(kind));
  if (!step) throw new Error(`No chain step declares the ${kind} pool's deadline`);
  const preparation = CHAIN_STEPS.find(step => step.name === 'packages:ensure');
  if (!preparation) throw new Error('No chain step declares the packages:ensure deadline');
  const workers = poolWorkers(kind);
  // npm `pretest` hooks do not fire under a root run, so the freshness guard the suites share has nothing
  // to rebuild them. Without this, editing anything a published package is built from — this repo's own
  // package.json included — fails a dozen specs at that guard rather than running them, and the pool
  // quietly collects 162 fewer tests. It is a stat and a return when nothing is stale.
  const prepared = await boundedSpawn('npm', ['run', preparation.name], timeoutMsFor(preparation.timeout), { stream: true });
  if (prepared.code !== 0) {
    throw new Error(prepared.timedOut
      ? timedOutBecause({ what: preparation.name, timeout: preparation.timeout, stalled: prepared.stalled })
      : `${preparation.name} failed (exit ${prepared.code})`);
  }
  // One run of this pool at a time, from here on: everything below stamps the projects it runs, and two runs
  // would each record what the other's vitest was still doing. Released by `exclusive-lock.ts`'s own exit and
  // interrupt handlers, so a Ctrl-C'd pool leaves no lock behind
  holdPoolLock(kind);
  prunePoolStamps();
  pruneDurationCache(REPO_ROOT);
  const { half, suites: suitesOf, run } = POOLS[kind];
  const suites = suitesOf();
  const all = process.argv.includes('--all');
  // One shard of the pool's specs (`chain-only.ts`), passed to vitest as given. A shard is part of each suite,
  // so it records no stamp and runs every suite whatever their stamps say
  const shardFlag = process.argv.find((arg) => arg.startsWith('--shard='));
  const shard = shardFlag === undefined ? undefined : parseShard(shardFlag.slice('--shard='.length));

  // Under what conditions this run counts. A pass by itself is not a pass under the chain, so the two keep
  // separate records — `CHAIN_RUN_ENV` has the sequence that made this necessary.
  const provenance = provenanceOf();
  // The sweep lives and dies inside this call, and what comes back is text
  const running = decide(suites, kind, all || shard !== undefined, provenance, workers);
  const stale = running.map(({ suite }) => suite);
  if (stale.length === 0) {
    console.log(`${kind} pool: all ${suites.length} project(s) up to date`);
    return;
  }
  // Why each one runs, not just that it does. A pool exists to run a subset, so every non-empty run makes a
  // claim about which projects moved — and `npm run chain -- --dry` cannot answer it, because it reports on the
  // *step*, a different unit with a different input set. It can say what moved under `test:unit:host` while
  // being unable to say which of the eleven projects inside it that was
  console.log(`${kind} pool: ${stale.length} of ${suites.length} project(s) to run${provenance === 'chain' ? '' : ' (not under the chain, so recorded apart from it)'}`);
  const width = Math.max(...stale.map((suite) => suite.workspace.length));
  for (const { suite, why } of running) {
    console.log(`  ${suite.workspace.padEnd(width)}  ${why}`);
  }

  // What each run covers is the pool's to say; a suite is stamped only by the run that included it.
  const runs = run(stale, workers).map((each) => shard === undefined ? each : { ...each, args: [...each.args, shardArg(shard)] });
  // Said out loud, because a run that records nothing looks exactly like one that does until the next run
  // repeats it. `recordsVerdict` has why.
  if (!recordsVerdict()) console.log(`${kind} pool: recording nothing — this is a diagnostic run`);
  else if (shard !== undefined) console.log(`${kind} pool: shard ${shard.index} of ${shard.total}, recording nothing — a shard is part of each suite`);

  for (const { suites: covered, command, args } of runs) {
    // `stampedRunAll`, under `recordRun`, fingerprints every suite this run covers before it starts and writes
    // each stamp only if it returned — so a failure leaves all of them unstamped and none is measured against a
    // tree the run has already begun touching. `recordRun` is what keeps a diagnostic re-run from writing any of
    // them: its verdict is not the chain's to keep, and recording it skipped the step on the next chain.
    await recordRun(
      // The label is what the stamp records as its `workspace`, and it names the half for the same reason the
      // filename does: a person opening the cache directory has to be able to tell two records apart. Nothing
      // reads it — `unitStaleReason` consults the fingerprint and nothing else — so this is a diagnostic, and
      // what keeps the two records *distinct* is the command inside that fingerprint.
      covered.map((suite) => ({ label: `${suite.dir} (${half}, ${provenance})`, unit: poolUnitFor(suite, kind, provenance, workers), stamp: poolStampFor(suite, half, provenance) })),
      async () => {
        const reportFile = path.join(reports, `${covered.map((suite) => suite.dir).join('+')}.json`);
        const { code, timedOut, stalled } = await boundedSpawn(command, [...args], timeoutMsFor(step.timeout),
          { stream: true, env: { ...process.env, [SPEC_DURATIONS_FILE]: reportFile } });
        if (code !== 0) {
          // No recorded cost: the chain reports one for the whole step, and this run may cover only part of it
          throw new Error(timedOut
            ? timedOutBecause({ what: poolStepName(kind), timeout: step.timeout, stalled })
            : `${kind} pool failed (exit ${code})`);
        }
        // Only what the run reported may be stamped: a `--project` filter matching nothing is dropped
        // silently while the others run, so exiting 0 is not evidence that every project was covered.
        // The reporter's own account of the run, which is what every verdict below reads. A missing file
        // is refused rather than read as an empty run: a reporter that stopped being called would
        // otherwise leave the project check with nothing to find absent and the marker gate with nothing
        // to check, both reporting success.
        const reported = readReportedRun(reportFile);
        if (reported === undefined) {
          throw new Error(`${kind} pool ran and its durations reporter wrote nothing to ${reportFile} — the reporter did not run, so nothing in this run was measured, no @slow: marker was checked and no project was confirmed to have reported. scripts/lib/spec-durations-reporter.ts pins its hooks against vitest's own interface, so a typecheck will name the cause`);
        }
        // A shard can hold no file of a project at all, so only a whole run can expect every project to report
        const absent = shard === undefined ? projectsThatDidNotRun(covered.map((suite) => suite.workspace), reported) : [];
        if (absent.length > 0) {
          throw new Error(`${kind} pool asked vitest for ${covered.length} projects and ${absent.join(', ')} never reported — a --project filter matched nothing, so their names and vitest's project names have diverged`);
        }
        reportDurations(kind, covered, reported);
        // A pass past its budget is a reading, never a failure: printed one line each, for the chain to show
        for (const pass of overBudgetPasses(reported, covered, (file) => timeoutOverrides(path.join(REPO_ROOT, file), REPO_ROOT))) {
          console.log(overBudgetLine(pass));
        }
      },
      shard === undefined ? process.env : { ...process.env, [DIAGNOSTIC_RUN_ENV]: '1' },
    );
  }
}

// A throw here would otherwise surface as an unhandled rejection, printing a stack on top of the suite
// output that is the thing worth reading. `process.exitCode` rather than `process.exit()`, which would
// truncate that output — the rule `orchestrator-exit.spec.ts` holds for every script here that reprints a
// captured buffer.
try {
  await main();
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
