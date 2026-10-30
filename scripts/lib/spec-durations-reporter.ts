/**
 * A vitest reporter that prints nothing and records what each spec file took, and which projects ran.
 *
 * It replaces a regex over vitest's console output. That parse worked, and the reason to stop is what it
 * was reading: the pretty-printer. It had to strip ANSI, handle **two** project-label spellings — vitest's
 * `formatProjectName` writes `|name|` when colour is unsupported and a space-padded coloured name when it
 * is, so which one arrives depends on `FORCE_COLOR` — and recover a file's owning suite from its path when
 * no label was printed at all. This repo has already been bitten there once: `projectsThatRan` read only
 * the uncoloured spelling and reported all eleven host projects absent from a run every one of them had
 * passed.
 *
 * **The duration here is the field the console prints, not a reconstruction of it.** `diagnostic().duration`
 * is what `getDurationPrefix` rounds for display, so the two agree by construction. That is also why
 * vitest's own `json` reporter is not used: it carries no per-file duration at all, only a span between the
 * first and last *test*, which excludes file-level hooks and collection — measured 0.5ms to 42ms low per
 * file, and ~30% low on a small one. For a gate whose bar is a quantile over these numbers, that is a
 * different quantity than the markers were calibrated against. `json` also carries no project name.
 *
 * Why a reporter of our own rather than `json` or `junit`, beyond the numbers: both print
 * `<FORMAT> report written to <path>` through the logger whenever `outputFile` is set, unconditionally and
 * with no option to silence it, so every run would end with a line about a temp file. The alternative —
 * filtering the child's stdout — costs the TTY, because vitest renders differently when its output is not
 * a terminal. `spec-count-reporter.ts` records the same reasoning; this is the second reporter to need it.
 *
 * The path comes from the environment rather than a reporter option so that nothing has to be threaded
 * through vitest's config resolution, as `spec-count-reporter.ts` does.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Reporter } from 'vitest/reporters';
import { DEADLINE_FACTOR } from './unit-suites.ts';

/** The environment variable the pool puts the destination in */
export const SPEC_DURATIONS_FILE = 'SPEC_DURATIONS_FILE';

/** Optional append-only diagnostics, separate from the completed run used for verdicts. */
export const SPEC_DURATIONS_PROGRESS_FILE = 'SPEC_DURATIONS_PROGRESS_FILE';

/**
 * The hooks, named once and checked against vitest's own interface.
 *
 * This is what makes a vitest upgrade a compile error rather than a silent regression: rename or remove
 * either hook and `typecheck` fails here. Without it the reporter would simply stop being called — no file
 * written — and the consumer's refusal is what turns that into a failure rather than a quiet pass. Not
 * hypothetical: `onFinished`, the hook `spec-count-reporter.ts` used first, is already
 * `@deprecated use onTestRunEnd instead` in vitest 3.2.4.
 */
const STARTED = 'onTestRunStart' satisfies keyof Reporter;
const ENDED = 'onTestRunEnd' satisfies keyof Reporter;
const QUEUED = 'onTestModuleQueued' satisfies keyof Reporter;
const MODULE_ENDED = 'onTestModuleEnd' satisfies keyof Reporter;

/**
 * The hooks' parameter types, taken from `Reporter` rather than imported by name.
 *
 * `vitest/reporters` exports `Reporter` and not `TestModule` or `TestSpecification`, so the choice is
 * between these two aliases and the `unknown[]` that `spec-count-reporter.ts` settled for. Deriving them
 * keeps the fields below checked against vitest's declarations, which is the whole point of pinning the
 * hook names above: a signature that changes shape fails here instead of at runtime.
 */
type Modules = Parameters<NonNullable<Reporter[typeof ENDED]>>[0];
type Specifications = Parameters<NonNullable<Reporter[typeof STARTED]>>[0];

/** One spec file, as the run that executed it saw it */
export interface ReportedModule {
  /** vitest's own name for the project, which is the workspace name a pool asked for */
  readonly project: string;
  /** The spec's path relative to its project's root, which is how every consumer names a spec */
  readonly file: string;
  /** `diagnostic().duration`: the accumulated time of the module's tests and hooks */
  readonly ms: number;
  /**
   * Everything the module cost its worker beyond its tests and hooks: import, setup, environment, prepare.
   *
   * **Recorded because `ms` alone cannot answer what a run costs, and because `collect` alone cannot
   * either.** `ms` is tests and hooks only. The first attempt at this field recorded
   * `collectDuration` by itself, which is right for the host pool — 68-85s of collection against 71-92s of
   * tests — and wrong for the pack pool, whose per-file cost is `setupDuration`: measured 2026-10-06,
   * `harness-app-stop` is 3,984ms of tests against 1,716ms of setup and 21ms of collection, and
   * `content-parity` is 753ms of tests against 1,703ms of setup. For that file the tests are 30% of what it
   * cost. So the quantity worth keeping is the sum, which is what `work/cores` needs.
   *
   * One figure rather than four, because no decision here wants the breakdown: a reader asking why a half
   * is heavy reads the vitest summary, which prints all of them. **Record the four separately when someone
   * takes on the overhead itself** — the pack pool is 19.9s of tests against 163.8s of this, the largest
   * single cost in the suite, and `goal-one-job-pool.md` identified it and deferred it. That work would
   * want to know which of setup and collection to attack per file, and the four are on the same
   * `diagnostic()` call. Until then a breakdown is storage sizing no decision.
   *
   * The console prints no such figure, so unlike `ms` this one is not checkable against it — which is why
   * the agreement case pins it only as present and positive.
   */
  readonly overheadMs: number;
  /**
   * Whether the module ran at all.
   *
   * Recorded rather than filtered here, so the consumer decides. It matters because a skipped module
   * reports a duration of 0 rather than no duration — `default-setup`'s `claude-code-permission-flow`
   * is one today, behind a `describe.skipIf` — and counting those as readings would drag a half's
   * quantile bar down with files that never executed.
   */
  readonly skipped: boolean;
  /**
   * The tests that passed past their size budget: the project's `testTimeout` over `DEADLINE_FACTOR`, which is
   * what every config declares. A slow pass is reported rather than failed, and this is where it is recorded.
   *
   * A test with a timeout of its own is recorded too, against the project's budget, because vitest's reporter
   * API exposes no test's own timeout; the pool leaves those out, having the overrides from the spec's syntax
   * tree (`timeoutOverrides`).
   */
  readonly overBudget: readonly { readonly name: string; readonly ms: number; readonly budgetMs: number }[];
}

export interface ReportedRun {
  /**
   * Every project the run started, which no built-in reporter can tell you.
   *
   * A project whose files all matched nothing appears in no reporter's *output*, so the only place it can
   * be named is the specifications the run began with. That is the blind spot `projectsThatDidNotRun`
   * documents and could not close: a `--project` filter matching nothing is silently dropped as long as
   * one other filter matched, so a suite whose workspace name had drifted from its vitest project name
   * would be stamped as having passed a run it was excluded from.
   */
  readonly projects: readonly string[];
  readonly modules: readonly ReportedModule[];
}

/** The states in which a module actually executed; everything else carries no duration worth reading */
const RAN = new Set(['passed', 'failed']);

/** Attribute named subprojects only to the workspace whose package.json confirms their prefix. */
function workspaceName(name: string, root: string): string {
  if (name !== '' && !name.includes(':')) return name;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { name?: string };
    const workspace = manifest.name;
    const prefix = `${workspace}:`;
    return name === '' ? workspace ?? ''
      : workspace && name.startsWith(prefix) && name.length > prefix.length ? workspace : name;
  } catch {
    return name;
  }
}

type ReportedModuleTask = Modules[number];

/** The passing tests of a module that ran past the project's budget */
function overBudget(module: ReportedModuleTask): ReportedModule['overBudget'] {
  const budget = module.project.config.testTimeout / DEADLINE_FACTOR;
  const over: { name: string; ms: number; budgetMs: number }[] = [];
  for (const test of module.children.allTests()) {
    const ms = test.diagnostic()?.duration;
    if (test.result().state === 'passed' && ms !== undefined && ms > budget) over.push({ name: test.name, ms, budgetMs: budget });
  }
  return over;
}

export default class SpecDurationsReporter implements Reporter {
  readonly #started = new Set<string>();

  #progress(event: 'queued' | 'ended', module: ReportedModuleTask): void {
    const base = process.env[SPEC_DURATIONS_PROGRESS_FILE];
    if (base === undefined) return;
    const diagnostic = event === 'ended' ? module.diagnostic() : undefined;
    const out = `${base}.${process.pid}.jsonl`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, `${JSON.stringify({
      event, at: new Date().toISOString(),
      project: workspaceName(module.project.name, module.project.config.root),
      file: path.relative(module.project.config.root, module.moduleId),
      ...(diagnostic === undefined ? {} : {
        state: module.state(), duration: diagnostic.duration,
        collectDuration: diagnostic.collectDuration, setupDuration: diagnostic.setupDuration,
        environmentSetupDuration: diagnostic.environmentSetupDuration, prepareDuration: diagnostic.prepareDuration,
      }),
    })}\n`);
  }

  [QUEUED](module: Parameters<NonNullable<Reporter[typeof QUEUED]>>[0]): void {
    this.#progress('queued', module);
  }

  [MODULE_ENDED](module: Parameters<NonNullable<Reporter[typeof MODULE_ENDED]>>[0]): void {
    this.#progress('ended', module);
  }

  [STARTED](specifications: Specifications): void {
    for (const specification of specifications) {
      this.#started.add(workspaceName(specification.project.name, specification.project.config.root));
    }
  }

  [ENDED](modules: Modules): void {
    const out = process.env[SPEC_DURATIONS_FILE];
    if (out === undefined) return;
    const reported: ReportedModule[] = modules.map((module) => {
      const diagnostic = module.diagnostic();
      return ({
      project: workspaceName(module.project.name, module.project.config.root),
      file: path.relative(module.project.config.root, module.moduleId),
      ms: diagnostic.duration,
      overheadMs: diagnostic.collectDuration + diagnostic.setupDuration
        + diagnostic.environmentSetupDuration + diagnostic.prepareDuration,
      skipped: !RAN.has(module.state()),
      overBudget: overBudget(module),
      });
    });
    // The union, not the started set alone: a run whose start hook never fired would otherwise report no
    // projects while reporting their files, and the consumer would read every one of them as absent
    const projects = new Set([...this.#started, ...reported.map(({ project }) => project)]);
    const run: ReportedRun = { projects: [...projects].sort(), modules: reported };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  }
}

/**
 * What the run reported, or `undefined` where the file never arrived.
 *
 * The distinction is the one thing this has to get right, and it is the same one
 * `spec-count-reporter.ts`'s reader makes: a reporter that stopped being called writes nothing, and
 * nothing read as an empty run would be a gate checking no markers and a cache recording no durations,
 * both reporting success. So `undefined` is a refusal for the caller to make, never a zero.
 */
export function readReportedRun(file: string): ReportedRun | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReportedRun>;
    if (!Array.isArray(parsed.modules) || !Array.isArray(parsed.projects)) return undefined;
    return { projects: parsed.projects, modules: parsed.modules };
  } catch {
    return undefined;
  }
}
