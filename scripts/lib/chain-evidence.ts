// What a run leaves behind for whoever reads it afterwards: one file per step that ran, holding exactly the
// bytes the step produced.
//
// **Two things a run keeps per step: what it said, and — when it failed — what it wrote.** `<step>.log` is
// its output; `<step>.files/` is the files themselves. The second exists because the first is not always
// enough: a step whose runner clears its output directory on the way in has what it wrote taken by the next
// run of it. `evidence` (`chain-steps.ts`) is where a step says which files those are.
//
// Without this a failure's output would live only in terminal scrollback, so piping or backgrounding a run
// would lose it.
//
// It is a module of its own because `chain.ts` runs the chain on import (a top-level `await main()`), so a
// spec can only reach these decisions by their being here — the same reason `chain-stamps.ts`,
// `chain-lock.ts` and `chain-flags.ts` exist. The command over it is `chain.ts`.
//
// **Nothing here is specific to the chain**, which is deliberate but not yet exercised: `scripts/typecheck.ts`
// and `scripts/test-unit-pool.ts` buffer a child's output in the same shape (`EvidenceResult` is what both
// their result types already are) and keep none of it either. They do not need this yet, because both write
// what matters to their parent's stdout — and the chain is that parent, so a chain run's files already hold a
// typecheck leg's failure and a pool project's output. What is missing there is a *passing* leg's output on a
// direct run, which is a run someone is watching. A second orchestrator adopting this is what decides how two
// of them share `runs/`; a field here for one that does not exist yet would be dead rather than ready.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { STAMP_DIR, flatStepName } from './chain-stamps.ts';

/**
 * Beside the stamps, in a subdirectory of its own.
 *
 * **The name must not end in `.json`, and that is load-bearing twice over.** `pruneStamps` in `chain.ts`
 * walks this directory removing every `.json` file that is not a live step's stamp, and it calls `rmSync`
 * with no `recursive` — so a directory named that way is both a candidate for deletion and an `EISDIR`
 * throw reported as "the chain itself failed". `CHAIN_LOCK` is beside it under the same rule, and
 * `packages-built.ts`' `reads/` is the precedent for the shape.
 */
export const RUNS_DIR = path.join(STAMP_DIR, 'runs');

/**
 * How many runs' evidence is kept.
 *
 * Declared rather than measured: there is no threshold here for a reading to be wrong about, and a run is a
 * few megabytes against an already-gitignored cache. Enough that the green run before a failure is still
 * there to compare against, which is what an unreproducible failure needs and what no amount of re-running
 * recovers.
 */
export const KEEP_RUNS = 5;

/** What a run's directory is called, and the only shape `runsToPrune` will remove */
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d+$/;

/**
 * A run's own name: when it started and which process it was.
 *
 * **Sorting these as strings sorts them by time**, which is what lets the prune keep the newest without
 * stat-ing anything — the date leads, fixed width, most significant first. The pid breaks a tie between two
 * runs in the same second; it cannot happen under the chain's lock, and costs nothing to be right about.
 *
 * Colons are flattened for the reason `flatStepName` flattens them: illegal in a Windows filename. **The `Z`
 * stays**, which a flattened stamp makes easy to drop: this is UTC, and without it the name reads as local
 * time to the one person who will ever compare it against when they remember running the chain — four hours
 * out here, and silently so.
 */
export function runId(startedAt: Date, pid: number): string {
  const when = startedAt.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${when}-${pid}`;
}

/** What a step's output is called inside a run's directory — one spelling per step, shared with its stamp */
export function evidenceFile(dir: string, label: string): string {
  return path.join(dir, `${flatStepName(label)}.log`);
}

/** Enough of a finished step to say how it ended; `Result` in `chain.ts` and `Outcome` in `typecheck.ts` both are this */
export interface EvidenceResult {
  readonly code: number;
  readonly ms: number;
  readonly output: string;
  readonly timedOut?: true;
}

/**
 * The first line of a step's file.
 *
 * A bare log does not say how its step ended, and the summary that would have said so is the thing not in
 * scrollback tomorrow. So each file answers that for itself.
 */
const DEADLINE_WORDS = new RegExp([
  String.raw`(?:Test|Hook) timed out in \d+ms`,
  String.raw`Test timeout of \d+ms exceeded`,
  String.raw`Worker teardown timeout of \d+ms exceeded`,
  String.raw`Fixture "[^"]+" timeout of \d+ms exceeded`,
  String.raw`"[^"]+" hook timeout of \d+ms exceeded`,
  String.raw`Tearing down "[^"]+" exceeded the test timeout of \d+ms`,
  String.raw`running past the \d+ms ceiling`,
].join('|'), 'g');

export function evidenceHeader(label: string, result: EvidenceResult): string {
  const ended = result.timedOut === true ? 'timed out' : `exit ${result.code}`;
  const deadlines = deadlinesNote(result);
  return `# ${label} — ${ended} after ${(result.ms / 1000).toFixed(1)}s${deadlines ? `, ${deadlines}` : ''}`;
}

/**
 * What a failed step's output says of tests running out of time, in vitest's and Playwright's words and `runCommand`'s. A
 * deadline hit is a different finding from an assertion, usually about the machine, and which one it was is the first thing
 * to know about a failure. Counts messages, not tests, since a report can repeat one. A reading, deciding nothing
 */
export function deadlinesNote(result: EvidenceResult): string | undefined {
  if (result.code === 0) return undefined;
  const messages = result.output.match(DEADLINE_WORDS)?.length ?? 0;
  return messages === 0 ? undefined : `${messages} deadline message${messages === 1 ? '' : 's'} in its output`;
}

/**
 * Which of `entries` to remove to leave the newest `keep` runs.
 *
 * Only entries named like a run, so anything else in this directory is left alone — the same conservatism
 * `pruneStamps` applies to a name it does not recognise. A cache that only grows is the failure
 * `pruneDurationCache` records, and nothing else prunes here: `pruneStamps` skips this directory by its
 * name, which is what keeps it from being deleted and also what leaves it to this.
 */
export function runsToPrune(entries: readonly string[], keep: number): string[] {
  return entries.filter((entry) => RUN_ID.test(entry))
    .sort()
    .reverse()
    .slice(keep);
}

/** Removes all but the newest `keep` runs. Takes no lock: its caller holds the chain's. */
export function pruneRunEvidence(keep = KEEP_RUNS): void {
  if (!fs.existsSync(RUNS_DIR)) return;
  for (const entry of runsToPrune(fs.readdirSync(RUNS_DIR), keep)) {
    fs.rmSync(path.join(RUNS_DIR, entry), { recursive: true, force: true });
  }
}

/** Where this run's evidence is, for whoever reads it after the run — printed only when there is some */
export function evidenceLine(dir: string, kept: number): string {
  return `evidence from this run in ${path.relative(REPO_ROOT, dir)} (${kept} step${kept === 1 ? '' : 's'})`;
}

export interface RunEvidence {
  /** This run's directory, which does not exist until something is kept */
  readonly dir: string;
  keep(label: string, result: EvidenceResult): void;
  /**
   * Copies the files a failed step left on disk, before anything runs that would overwrite them.
   *
   * Returns the paths it took, so a caller can say what it has — and skips one that is not there rather
   * than throwing, because a step can fail before writing anything and that is not a second failure.
   */
  keepFiles(label: string, paths: readonly string[]): string[];
  /** How many files are in it, which is how the caller knows whether to name it */
  kept(): number;
}

/**
 * Opens this run's evidence.
 *
 * **The directory is made on the first `keep`, not here**, so a run that writes nothing leaves nothing: a
 * `--dry` plan and a run where every step was cached both create no directory and name no path. Writes are
 * synchronous and happen as each step ends rather than at the end of the run, so a run that is interrupted
 * still has the evidence of the steps that finished — which is one of the ways a failure got lost.
 *
 * `root` is for a spec, which must not write into the store a chain run beside it is using — the suite that
 * holds that spec is itself a chain step. The chain passes none.
 */
export function openRunEvidence(options: { startedAt: Date; pid: number; root?: string }): RunEvidence {
  const dir = path.join(options.root ?? RUNS_DIR, runId(options.startedAt, options.pid));
  let written = 0;
  return {
    dir,
    keep(label, result) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(evidenceFile(dir, label), `${evidenceHeader(label, result)}\n${result.output}`);
      written += 1;
    },
    keepFiles(label, paths) {
      const taken: string[] = [];
      for (const target of paths) {
        const from = path.join(REPO_ROOT, target);
        if (!fs.existsSync(from)) continue;
        const into = path.join(dir, `${flatStepName(label)}.files`, path.basename(target));
        fs.mkdirSync(path.dirname(into), { recursive: true });
        fs.cpSync(from, into, { recursive: true });
        taken.push(target);
        written += 1;
      }
      return taken;
    },
    kept: () => written,
  };
}
