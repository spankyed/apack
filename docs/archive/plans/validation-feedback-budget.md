# Restore fast validation

Status: closed and archived 2026-10-21, with [PR #249](https://github.com/spankyed/apack/pull/249). Created
2026-10-19. The [outcome](#outcome-2026-10-21) records what was delivered, the two criteria dropped and why,
and what carries forward.

This plan owns feedback budgets and coverage. The [Nx evaluation](../../plans/nx-orchestration-evaluation.md) decides
whether Nx or the existing runner owns generic task execution. **The lead developer chose to extend the
existing runner before that evaluation finished** (2026-10-20): the strict gate's cost made waiting the more
expensive option. So the parallel gate below is built on `scripts/chain.ts`. If Nx is adopted later, it has to
take over the job derivation (`scripts/lib/chain-only.ts`) and the sharding, not run beside them. The typed
configuration design below still applies while the runner is retained.

## Outcome and budgets

**An ordinary edit should reach a trustworthy integration verdict in 2–4 minutes on the developer's
existing computer, without skipping affected acceptance or hiding preparation.** Keep the daily
command simple: `npm run chain` selects the checks required for the change.

These are design budgets, not current performance claims:

| Measurement | Conditions and target |
|---|---|
| Warm incremental | Dependencies, unchanged builds and valid results available; aim near or below the previous 150-second baseline for actual ordinary edits |
| Cold test results | Dependencies installed, no reusable test verdicts; aim below 4 minutes, with 5 minutes as the acceptance ceiling; include all required generation and builds |
| Exhaustive | All required targets, bypassing verdict caches; measure a complete successful execution after reducing duplication, then set a separate budget |

Choose representative host, pack, SDK and compiler changes before optimizing. Cross-cutting changes,
including some SDK edits, may require longer acceptance. Show that selection and cost before execution;
a required remote result still pending means the integration verdict is incomplete.

Record machine, OS/runtime, core budget, source revision, selected targets and available build outputs.
Keep repeated measurements and variation. Report dependency installation and remote queue/provisioning
separately; do not exclude required preparation, use cached no-ops or change machines to claim success.
Preserve native-execution restrictions on the daily-use Mac. Report timing regressions initially;
introduce hard performance gates only after measurements stabilize.

## Current state (2026-10-21)

**Source:** branch `session/integration-sharding`, [PR #249](https://github.com/spankyed/apack/pull/249),
on top of [PR #248](https://github.com/spankyed/apack/pull/248) (merged).

**What changed:**

| Change | Where | Measured effect |
|---|---|---|
| A pack build captures only the dependency files its compilers read (R-F1's decision) | #248 | Shipped-pack cold build 140s → 60s locally, output byte-identical; on the two-core runner `build:default-setup` 473–522s → 105–166s (strict runs `39550321649`, `39554079038`); integration file time about 10,000s → 6,600s |
| Native-runtime and live-watcher specs are their own half (`*.native.spec.ts`, `test:native`) | #249 | Implements checkpoint 2's boundary: ordinary CLI integration versus real compiler scenarios |
| `chain --only`, `--shard k/N`, `--job`, with jobs derived from the graph | #249 | A consumer job refuses unless the producers' outputs it downloaded are current |
| The strict gate runs as a producers job plus five consumer jobs | #249 | Two integration shards, two native shards, and the app half with the remaining checks. Five is the free plan's cap on concurrent macOS jobs, account-wide; a sixth job waits for a slot and pays its setup again |
| Every integration and native case turns the event loop afterwards (`tests/_support/turn-event-loop.ts`) | #249 | Ends `Timeout calling onTaskUpdate` failing runs whose tests all passed |
| Native files run one at a time | #249 | Contention, not cost: one case took 14.4s alone (run `39553670513`) and passed 60s beside another native file on a 3-vCPU runner |
| Native cases whose subject is not capture share one compiler installation per file (`shareCompilerInstallation`) | #249 | About 23 fewer captures on the macOS gate. Native job time 48.5 → 42.2 min, and its slowest job 27.6 → 19.7 min (strict runs `39554079038` before, `39557857402` after) |

**Gate wall time:** the single-job strict gate was an estimated 2–2.5h. The parallel gate is green end to end:
strict run `39554079038` took about 42 minutes (one job waited 10 minutes for a runner) and `39557857402`, with
the shared installations, about 36: producers 10.4 min, then integration 25.9 and 11.6, native 19.7 and 22.5,
and the app half with the remaining checks 23.9.

**Measured and dropped:**
- **A per-run cache of dependency hashes:** after #248 it would save about 2–4s per build, for a new cache
  protocol.
- **Keeping the compiler copy between builds:** about 2.3s of a roughly 30s local build, for a cache
  directory with eviction.

Both conflict with "no other cache protocol" in decision 5 for little return. The per-file shared
installation above is not one of these: it lives inside one spec file and is disposed with it.

## Outcome (2026-10-21)

**Delivered:**
- **The strict gate takes about 36 minutes, from an estimated 2–2.5 hours,** green end to end. It is a
  producers job plus five consumer jobs derived from the graph (`chain --job`, `--shard`).
- **The cold shipped-pack build takes 105–166s on the runner, from 473–522s,** because a build captures
  only the dependency files its compilers read (R-F1).
- **The native half is its own target and size.** It runs one file at a time, its cases share one compiler
  installation per file, and its `enormous` budget took the timeout exceptions from 69 to 46.
- **Smaller fixes along the way:**
  - the `onTaskUpdate` RPC failures;
  - a step's `evidence`, which stops E2E runs turning `test:smoke` stale (3a.1);
  - the external-pack app step halved by parallel pack E2E workers (10.7);
  - the `suite` rung kept at 600s on measurement (10.1);
  - the declared step costs refreshed.

**Two criteria dropped, each because it would decide nothing:**
- **"Ordinary edits meet the 2–4 minute budget" was not measured.**
  - Locally the chain already costs only the edit's slice, and every run prints its per-step costs.
  - A compiler or CLI edit cannot meet it at all without affected selection. The CLI integration and native
    specs cannot run on the developer's Mac, so that half of its verdict waits on CI.
  - Measuring would have confirmed a known gap.
- **"Exhaustive duration has its own measured budget" was not set.** CI may fail a check, never a clock, so a
  budget nothing enforces would only be a sample, which this repo declines to keep. Each job's
  `timeout-minutes` bounds a hang, and each step declares its `seconds`.

**Carried forward:**
- [Affected-only selection](../../plans/deferred/affected-selection.md) (decision 3), deferred. It is the lever for
  ordinary-edit speed on a fresh runner. After it comes recording which built files each spec reads, the only
  lever for package-source edits.
- [The credential-boundary app test's per-run pack build](../../issues/ISSUE-app-step-credentials-prebuild.md).
- [The Windows Electron-runtime side-by-side failure](../issues/ISSUE-windows-electron-module-sxs.md), for the
  Windows VM.
- The 46 remaining timeout exceptions stay reviewed per case. The 31 integration ones would need the
  integration half sized to its cold-build specs, which would loosen its fast specs too.

## Problem

The user reports a historical full chain near 150 seconds. Recent failed strict attempts took roughly
29–34 minutes without reaching every stage. Those are not controlled comparisons, but the feedback
loop is plainly too expensive.

Broad package-level selection groups ordinary checks with repeated compiler capture, cold builds,
watch recovery, native loading and archive verification. Fail-fast retries repeat expensive successful
work while leaving later coverage unknown. Some enclosing deadlines do not fit sequential operations;
synchronous execution can also prevent runner updates.

Use the existing graph, caches, test tools, timing reports, scheduler and process owners. Success means
less necessary work on the ordinary path, not merely larger deadlines or renamed test groups.

## Design decisions

### 1. Group by responsibility, with clear ownership

Use familiar terms: **unit** tests cover an isolated owner, **integration** tests cover collaborating
components, and **acceptance** tests cover a supported workflow through public interfaces. A **target**
is an independently selectable group. Platform and resource needs are separate from test purpose.

Name targets by stable responsibility, such as compiler behavior, native runtime or external authoring.
A parser check and an OS-loader probe can both be integration tests without sharing prerequisites.

| Owner | Responsibility |
|---|---|
| Vitest/Playwright project | File discovery, resolution/environment, setup and test/hook defaults |
| Chain target and planner | Inputs/outputs, dependencies, selection, cache validity, resources and process deadline |
| Tests and existing helpers | Assertions, fixture ownership and scenario operation/cleanup bounds |

Scripts and CI invoke these owners without duplicate inventories or execution policies. Compatible
projects can share a worker pool; a selectable target does not require a separate process. Preserve
the existing source-versus-published-package resolution boundary.

Keep ordinary behavior checks and representative real build/archive/app smoke coverage in the routine
path. Independently select exhaustive native/runtime matrices, repeated cold builds and full external
authoring/lifecycle scenarios. A slow ordinary test needs investigation, not automatic relabeling.

### 2. Retain typed TypeScript authoring

Keep TypeScript records composed with existing helpers and native test projects. Source inspection
finds useful derivations already in `chain-steps.ts`: workspace dependency closures, typecheck targets
from `TYPECHECK_LEGS`, pool membership and fixture inventories. Expanded JSON would duplicate them;
JSON references would require a new configuration language. Authoritative JSON is therefore ruled out
for this work. Vitest 3.2 already supports the needed named projects.

The chain references each project without duplicating its test globs. A CLI pilot might separate
ordinary integration, compiler and native-runtime projects; create only boundaries justified by their
actual reads, prerequisites or execution requirements. Existing shell-based author/app workflows stay
in their producer/consumer form.

Extend the existing planning path to produce one resolved data model for execution and reporting:
selected targets, invocation/project references, inputs/outputs, dependency edges, selection reasons,
resources and deadlines. Keep execution callbacks out of target declarations and platform applicability
visible. Input freshness must still be checked when accepting results; a plan does not freeze disk.

JSON output is optional for an identified consumer, not another authored contract or required project.
An export must identify revision, comparison base and environment and distinguish declared targets
from collected/executed tests. Existing dry-run output may suffice.

Update discovery, selection, cache keys, timeout guards and reports together. Replace text-only checks
that force duplicate inventories with checks over resolved declarations where appropriate. Retain
source checks for source properties and dependency-read checks for input completeness. No arbitrary
TypeScript interpreter, naming linter or per-test registry is needed.

### 3. Select required targets before consulting result caches

These are intended command contracts; affected-target selection still needs implementation:

| Command | Guarantee |
|---|---|
| `npm run spec` | Focused checks, retaining notices about uncovered build edges |
| `npm run chain` | Routine checks plus all acceptance required by the selected change; valid results may be reused |
| `npm run chain -- --dry` | Explain comparison base, selected work, prerequisites, platforms, cache decisions and expected cost |
| `npm run chain -- --strict --all --no-classify` | Exhaustive execution for this environment, bypassing verdict caches |

Source impact selects required targets. Input/output/environment records determine whether selected
results can be reused. A cold verdict cache must not select unrelated acceptance. Missing or changed
required output must still select its producer and invalidate consumers.

Extend the existing graph rather than creating a parallel selector. Narrow broad package-level inputs
only when actual reads justify it. Trace source impact through producers to consumers, and retain
conservative coverage for dependencies that cannot be bounded.

Pin and print comparison base and head. Integration checks cover the full branch change against the
target branch's appropriate base, not only the last commit. Local selection includes staged, unstaged
and relevant untracked files, deletions and renames. Missing bases or unclassified relevant inputs
expand coverage visibly; the ordinary runtime target does not apply to that conservative fallback.

Whole-product exhaustive acceptance requires results from every required environment through existing
platform workflows and VM procedures. Keep `--all` exhaustive and `--strict` a verdict policy. A local
pass does not certify unexecuted platforms; required unavailable coverage stays pending.

### 4. Run exhaustive acceptance at deliberate boundaries

| When | Required validation |
|---|---|
| During implementation | Focused checks for changed behavior |
| Before integration | Routine checks plus affected acceptance |
| Closing a substantial cross-cutting goal | Exhaustive acceptance on the converged committed candidate |
| Before release | Exhaustive acceptance and verification of actual candidate packages/installers |
| Impact cannot be bounded confidently | Exhaustive acceptance, for example after broad toolchain or selector changes |

Compiler edits require affected compiler/platform targets, not automatically unrelated app workflows.
Do not run exhaustive acceptance after every commit. Occasional manual full execution can check
selection soundness; new automatic triggers or schedules need separate authorization.

After failure, validate the repaired boundary before another broad run. Reuse unaffected evidence only
when input and environment records establish validity. Relaxed diagnostics cannot count as acceptance.
Required uncached final gates still need complete execution after relevant repairs converge.

### 5. Reduce actual work and make expensive execution predictable

Preserve every distinct behavioral guarantee, not necessarily every redundant execution. Account for
existing cases and name their retained replacements when consolidating. Test branch combinations at
the responsible owner; retain real public workflows and OS execution for claims requiring them.

Share verified immutable preparation through existing producers. Consumers must not regenerate it.
Give mutating consumers private copies/profiles, and keep fresh execution for capture, independent
installations, watcher replacement, corruption and cleanup assertions. Preserve exact archive identity
between author and app halves. Do not create a fixture service or another cache protocol.

Reserve resources for nested compiler work through the existing scheduler. Measure before increasing
concurrency. Refresh stale duration estimates from completed runs, keeping expected cost separate from
timeout allowances and using existing reporting.

Bound expensive operations with existing process owners. Give multi-step scenarios enough total time
for their operations and awaited cleanup. Preserve short event/readiness waits. Record phase timings;
distinguish operation timeout, scenario timeout, reporting error and cleanup failure. Larger allowances
prevent premature termination but do not make execution faster.

Investigate runner blocking separately from slow execution. Use existing subprocess boundaries where
possible and keep necessary in-process instrumentation explicit. An outer timer cannot interrupt
synchronous work; `setImmediate` between phases cannot make that work responsive. Verify reporting and
exit status as well as assertions. Avoid blanket increases, retry-to-green and new worker frameworks.

Project defaults should fit their normal work. Reduce title-keyed timeout exceptions as recurring
patterns acquire a suitable project, retaining reviewed overrides for genuinely different scenarios.
Keep familiar filenames for discovery without deriving every prerequisite and resource limit from a
single integration suffix.

For incomplete diagnostics, report passed, failed, skipped and unstarted work. Resume missing coverage
in bounded batches with required setup rather than repeating the expensive prefix. Diagnostic limits
and collect-all execution do not automatically become normal acceptance policy.

A new test normally joins an existing target. A new target needs a distinct execution boundary; a new
helper needs demonstrated duplication. Added full-build scenarios must explain their new guarantee,
why a smaller test is insufficient and measured cost. Mark cost pending until measured. These are
review rules using existing reports, not new per-test metadata.

### Review findings this plan owns

The [PR 246 review](../references/evidence/pr-246-review.md) recorded four findings that are budget decisions, not
defects with one fix, and its acceptance runs surfaced a fifth (R-F1). They stay as they are until this plan resolves them:

| Finding | Current state | Resolve by |
|---|---|---|
| 10.1 | **Decided 2026-10-21: the `suite` rung stays at 600s.** Its slowest member on the two-core runner is `test:unit:host` at 323–370s (strict runs `39542948538`, `39547245467`), so 300s would kill a passing step. The rest measure 13–274s. The history: the `suite` rung is 600s (`scripts/lib/step-timeouts.ts`), double its earlier 300s. The reason recorded for raising it, the integration pool, now has its own `acceptance` class. On the two-core runner, strict run `39450690425` (2026-10-20) measured `test:external-pack:contract` at 345s and `test:unit:host` at 294s, both `suite` members, so returning to 300s would kill or nearly kill passing steps | Measure the remaining `suite` members, then set the rung from that measurement or return it to 300s. No change before then |
| 10.2 | **Reduced 2026-10-21, 69 → 46.** The native half is its own project now, so it got its own size: `enormous`, 300s (`SIZE_MS`), which its config declares. The 23 native exceptions whose composed budgets fit it are gone, and two checks stop them coming back: composed literal budgets are now evaluated rather than read as unknown, and an exception whose case fits its budget is reported as stale. The native configs were also missing from the budget check's population. The history: `TIMEOUT_EXCEPTIONS` (`packages/internal-repo-checks/tests/suite-timeouts.spec.ts`) holds 69 per-test overrides of 120–540s, many justified only by a run that hit the old limit | Apply "reduce title-keyed timeout exceptions" above: move recurring patterns to a fitting project, keep reviewed overrides for genuinely different scenarios |
| 10.7 | **Refreshed 2026-10-21, then halved: 84s.** It measured 167.5s alone (79% idle); running the suites on one worker per three cores, and the default-fork lifecycle beside them rather than after, took it to 83.4s (76% idle). The history: `test:external-pack:app` declared `seconds: 18` but now also runs the default-fork lifecycle (four app launches, four `apack pack` commands) | Refresh the declared cost from a completed run |
| R-F1 | **Decided and implemented (PR #248): a build captures only the dependency files its compilers read.** On the runner `build:default-setup` now takes 105–166s. `build:default-setup` is back on `suite`; the fork stays on `scenario` (next action 2). The history: a cold `apack pack build` of default-setup took 522s on the two-core hosted macOS runner (strict run `39430263642`), with 175s in finalization (run `39427595920`). Finalization re-checked every captured input twice and replayed the startup threads' observations from disk; removing those repeats cut it to 63s on the runner (run `39489689366`, 2026-10-20) and a local cold build from 149s to 122s (interleaved, 2 runs each, 71-76% idle). The runner's whole pack build is still 473s, because the phases before finalization take about 400s and varied by 52s between two runs; capturing and re-checking the dependency inputs is a large share of it in the local profile. The observation set is about 104,000 entries, including the whole package directory of every dependency and devDependency (36,800 files). Warm local builds cost the same as cold (118-120s), so `seconds` is now 120. Both steps stay on `scenario`: 473s leaves too little margin under `suite`'s 600s | Decide whether the build's inputs should include whole dependency package trees (devDependencies in particular), or only the files the compilers actually read. That is a change to the freshness contract, so it needs a decision before any code. Then re-measure on the runner and return both steps to `suite` if the cold build fits with margin |
| 3a.1 | **Resolved 2026-10-21: a step's `evidence`.** What a step writes as an account of its run (results, an app's log) and no step reads is `evidence`, not an output. It orders writers and is kept on failure like an output, but is no part of the cache key, so an E2E run no longer makes `test:smoke` stale. Both steps declare their results directory that way. The history: `test:smoke` and `test:e2e` both declared `.apack/tests/results` as an output, and output digests are now part of a step's cache key, so any E2E run makes `test:smoke` stale with no input moved | Decide what a check step's declared outputs mean for cache validity, in the chain target and planner, rather than special-casing one step |

## Implementation checkpoints

1. **Map execution before moving tests.** Reuse current evidence and complete only missing inventory.
   Produce two small tables:
   - Before/after selection for representative host, pack, SDK and compiler changes: targets,
     prerequisites, platforms and expected critical path.
   - Build reduction: repeated work, retained guarantees, removed execution and expected savings.
   Separate work reduction from narrower selection and cache reuse. Establish a credible budget path.
2. **Prove one CLI boundary.** Separate ordinary CLI integration from real compiler scenarios using
   native projects and the existing typed planner. Prove discovery, resolution, prerequisites and
   meaningful selection/preparation savings. If both still require the same expensive work, fix
   ownership before expanding. Exercise cold caches, changed/deleted/untracked inputs, shared
   dependencies, missing bases and missing producer output.
3. **Expand and reduce waste.** Apply the proven pattern only where needed. Consolidate redundant
   builds, share suitable preparation and correct execution/reporting ownership. Validate affected
   boundaries first, then measure the agreed change scenarios. A missed budget requires identifying
   the remaining critical path, not silently excluding required work.
4. **Accept and document.** Reconcile retained/replaced guarantees and run exhaustive acceptance on
   committed source. Update CLAUDE.md, command help, configs and workflow guidance alongside behavior
   changes; remove replaced rules. Record exact source, platform evidence, runtime results and remaining
   limitations before closing this plan.

No compiler redesign, new runner, cloud purchase, release or publication is authorized by this plan.

## Completion criteria

- ~~Ordinary edits meet the stated warm/cold-result budgets on the existing computer, including required
  preparation.~~ Dropped; see the [outcome](#outcome-2026-10-21). Longer cross-cutting acceptance and pending
  remote obligations remain explicit.
- Selection and build counts show less necessary work, not merely regrouping, larger deadlines or
  cached no-ops. ~~Exhaustive duration has its own measured budget.~~ Dropped; see the
  [outcome](#outcome-2026-10-21).
- Every distinct guarantee has retained coverage. Existing structural checks protect discovery,
  accidental duplicate execution, project references, exhaustive reachability and producer dependencies.
- Typed declarations remain authoritative; execution and reporting consume one resolved plan.
  Native project configs own discovery, resolution boundaries and worker budgets remain correct,
  and dependency-read checks still protect input completeness.
- Shared preparation preserves integrity, freshness, isolation and exact archive handoff. Tests of
  cold capture and lifetime still own fresh execution where necessary.
- Expensive scenarios retain bounded operations, cancellation where supported, phase timings and
  awaited cleanup. Normal acceptance has no unhandled reporting errors.
- Commands and documentation agree. The
  [completed settings and pack contracts goal](../goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19)
  records its final acceptance decision; this separate plan does not reopen that delivery or waive
  other goals' validation requirements.

## References

[Bazel test definitions](https://bazel.build/versions/7.4.0/reference/be/common-definitions) separate
resource size from timeout. [Vitest v3 projects](https://v3.vitest.dev/guide/projects) provide native
grouping and discovery. Apply these principles within the installed tools; no tool migration is implied.
