> **Absorbed and closed.** [`goal-one-job-pool.md`](../goals/goal-one-job-pool.md) implemented this and
> recorded where it was wrong: one root vitest over all eight is not possible (host suites resolve
> workspace source, the pack suite must resolve the published `dist`, and Node conditions are per
> process), `max(floor, work/cores)` was never the model, and "the cost is 3 tests, not 94" is backwards.
> `test:unit` is two pools at 35.3s. Kept for the survey and the reasoning, not as work to pick up.

# Plan: one job pool for `test:unit`

`npm run test:unit` takes **44.3s** doing **~95s of work on 10 cores** against a **13.0s** hard floor. The
ideal is `max(floor, work/cores)` ≈ 13s. The 3.4× gap is architectural, not saturation, and the mechanism
that closes it is already in the repo as dead code.

Surveyed 2026-09-25 against `faee075fd`. Timings come from a full `test:unit` capture on an adjacent base;
the per-suite floors below are unaffected by the fast/integration split, but the `@apackdev/cli` fast-suite
figures are derived by mapping file timings onto the tip's naming rather than measured on the tip. Test 1
confirms the whole model in one run.

## Where the time is

| suite | work | **floor** (slowest single file) | files |
|---|---|---|---|
| `@apackdev/cli` fast | 30.8s | 7.4s | 38 |
| `@apackdev/host` | 19.9s | 4.8s | 79 |
| `@apackdev/sdk` | 18.9s | **13.0s** | 57 |
| `@app/default-setup` | 17.6s | 5.3s | 84 |
| `@app/api` | 5.1s | 1.1s | 16 |
| `@apackdev/ears` | 2.8s | 2.1s | 10 |
| `@app/renderer` | 0.1s | 0.1s | 8 |

For contrast, the split moved 229.1s of work and a 39.5s file out of `@apackdev/cli` into the integration
half: 32 integration files vs 38 fast ones. `@apackdev/cli` is no longer the giant; `@apackdev/sdk`'s floor is.

## Why more lanes do not pay

`scripts/test-unit.ts` schedules **suites**; vitest schedules **files inside a suite**. Two schedulers with
no shared budget. At `lanes=2`, with a suite using 2.0–3.8 cores, 4–7.6 of 10 are busy — and a third lane
oversubscribes *within* a suite rather than filling idle cores, which is why the recorded table reads
1: 69.8s, 2: 44.3s, 3: 47.7s, 8: 63.1s.

`goal-test-tiers.md` names this as its first industry gap — *"A build system has one job pool; this has N"* —
and Decision 6 asks for one owner of concurrency. `test-unit.ts` is a budget **over** N pools, not one pool.
That is the ceiling, and no lane count removes it.

## Lever 1 — one vitest run over all packages

**The mechanism already exists, unused.** The root `vitest.config.ts` declares
`projects: ['packages/apack-sdk', 'packages/api', 'packages/default-setup', 'packages/renderer']` — four of
eight, referenced by nothing. `scripts/spec.ts` deliberately runs each package's own `test` instead. Its last
commit was `aa877a299 build(default-setup): switch to vitest workspace`, an unfinished migration.

**Vitest already schedules this correctly.** The default sequencer
(`node_modules/vitest/dist/chunks/coverage.*.js:3472`) receives every project's files as one list and sorts
it longest-first from a duration cache (`return bState.duration - aState.duration`), falling back to file
size when cold. That is longest-processing-time-first across package boundaries — the greedy makespan
approximation, within 4/3 of optimal — and it is the one job pool Decision 6 wants.

**The work:** extend `projects` from 4 to 8, and point `test:unit` at a single root `vitest run` with
`--maxWorkers` as the one budget knob, replacing lanes × per-suite workers. Per-package configs are
*referenced*, not replaced, so `npm test -w <pkg>` and `npm run spec` keep working unchanged. Additive, not
a migration.

**Checked, and clear:**

- no package disables `isolate` or sets a custom `pool`; three set `fileParallelism: true`, which is the default
- `isolatedDataDir` separates workers by `VITEST_POOL_ID` (`worker-<n>`), which stays unique under a shared pool
- per-project `environment` (renderer's jsdom), `alias` (main's electron stub), `setupFiles`, `globals` and
  `testTimeout` are all per-project settings, so nothing has to be flattened

**One gotcha:** npm `pretest` hooks do not fire under a single root run, so `packages:ensure` must run once up
front. `test-unit.ts` already does exactly that, for the same reason.

**Expected: 44.3s → ~13s**, then bounded by one file.

## Lever 2 — the floor file

`packages/apack-sdk/tests/build/generate-entries.spec.ts`, 94 tests, 13.0s. **The cost is 3 tests, not 94.**

There are exactly three `typecheck()` call sites (L428, L444, L470), all inside the describe *"generated
sends compile"*. Each runs a full `ts.createProgram` that resolves `@apackdev/sdk` under
`customConditions: ['@apackdev/source']`, so it type-checks **165 files / ~17k lines** of SDK + ears
*source* — `skipLibCheck: true` skips `.d.ts`, and the SDK is `.ts`. The other 91 tests are string and AST
assertions over generated code, together about 1s.

So **splitting by topic buys nothing**, and splitting compile-from-rest still leaves a 12s file. The fix is
amortisation: the three programs re-parse an identical graph. `root` is `mkdtempSync`'d in `beforeEach`, so
every test-specific file sits under a fresh unique path, which makes the cache rule safe by construction:

> Cache any `SourceFile` whose path is **not** under `root`; never cache one that is.

A shared `ts.CompilerHost` with that rule, plus `oldProgram` so binding is reused and not only parsing.
**Expect 13s → 5–7s** — measure rather than promise, because a cached host saves parsing while the checker
still runs per program; `oldProgram` is what recovers the rest.

Worth doing alongside, on correctness grounds rather than speed: move those 3 tests into their own file. It
is a real tier boundary — 91 pure tests, 3 that invoke a compiler.

## Combined

**44.3s → ~13s → ~9.5s**, at which point the wall is `work/cores` rather than any single file.

## Phases

1. **Extend `projects` to 8 and run one root vitest.** Keep `test-unit.ts` until the numbers are in, so the
   comparison is honest. **Done when:** root-run wall is recorded against 44.3s and the total test count
   equals the sum of the eight per-suite counts.
2. **Retire the lane scheduler** if Phase 1 wins, leaving `--maxWorkers` as the single budget. Decision 6 is
   then satisfied by construction rather than by a script.
3. **Amortise the compiler** in `generate-entries.spec.ts`, and split its 3 compiling tests out.
   **Mutation:** a type error injected into the fixture is still caught.
4. **Re-measure and record.** If Phase 1 does not win, close this plan with the measurement, as
   `goal-test-tiers.md` Phase 6 requires of parallelism work.

## Tests to run

1. **Decisive, ~2 min.** Extend `projects` to 8; `vitest run --maxWorkers=10` at the root; compare wall to
   `test-unit.ts`'s 44.3s.
2. **Correctness gate.** Root-run total test count must equal the sum of the eight per-suite counts. A drop
   means a project's `include` did not carry.
3. **Floor, ~2 min.** Add the cached host; run `generate-entries.spec.ts` alone before and after; confirm the
   asserted diagnostics are unchanged.

## Falls out of this

`generate-entries.spec.ts` imports `transformSync` from **esbuild** (L1108, in *"generated appliers"*), and
esbuild starts a child process — while `suite-split.spec.ts` reads the file as clean, because that rule looks
for `node:child_process` imports. This is a **pre-existing** second instance of the guard hole recorded in
`cli-suite-spawns-rebase.md` §3.1, not one that branch creates, and it argues for making the predicate
cost-based rather than mechanism-based. **Done** — `goal-one-job-pool.md` Phase 2 replaced the predicate
with the measured cost in `packages/apack-cli/etc/spec-cost.json`, so all three instances below are closed.

A third instance, from `goal-test-tiers.md` Phase 7: `tests/cli/test-contract.integration.spec.ts` injects a
fake runner and spawns nothing, in about 20ms, but imports `contractTest`, whose *default* runner is
`spawnSync`. The guard asks what an export's implementation reaches, which is true of the export and false
of every test in that file. Mechanism over cost again, and the same fix covers all three: ask what a spec
costs, not what its imports could do.

## What `goal-test-tiers.md` landed first, and what it means here

Phases 4 to 6 of that goal landed on `AS/chain-inputs` before this plan starts. Three of its results are
inputs to Lever 1, and one of them pulls against it.

### The chain runs `test:unit` as eight steps, and this plan should collapse them

Phase 5 split `test:unit` into one chain step per package (`test:unit:<dir>` in `scripts/lib/chain-steps.ts`,
with matching root scripts), so a one-package edit re-runs one suite instead of eight. Each step runs
`npm test -w <pkg>`, so **the chain now starts eight vitest processes** — eight job pools, which is the
ceiling this plan exists to remove. The two pull in opposite directions and Lever 1 wins on the measurement:
what the split actually buys is the per-package *cache key*, not the per-package *process*.

Both properties survive in one shape:

> One `test:unit` chain step that reads the per-package fingerprints, decides which projects are stale, and
> runs one root vitest with `--project` for just those.

That keeps a renderer edit running only the renderer project while leaving one pool and one `--maxWorkers`.
`stampedRun` already writes one stamp per name, so N stamps under one step is an extension rather than a
redesign, and the step's `needs` collapse to `compile`. The eight steps are generated from `UNIT_SUITES` in a
single `.map()`, and no guard hardcodes eight — the specs in
`packages/internal-repo-checks/tests/chain-inputs.spec.ts` iterate `UNIT_SUITES` and `SUITE_READS` —
so the collapse is local to that map and the chain step table.

### `projects` should derive from `UNIT_SUITES` rather than repeat it

`scripts/lib/unit-suites.ts` already holds the eight workspaces and their directories, shared by
`scripts/test-unit.ts` and the chain table so the two cannot disagree. Extending `projects` from 4 to 8 by
hand would make a third copy of that list; deriving it is the same work and cannot drift. Lever 1's "extend
`projects` from 4 to 8" is then a one-line map.

### Which projects are stale is already computed

`workspaceDeps` and `SUITE_READS` (`scripts/lib/chain-steps.ts`) give each suite its inputs: its own
workspace, its dependencies' source read from its `package.json`, and the build output it reads. That is
exactly the input a `--project` filter needs, and `npm run chain --dry` prints the answer without running
anything.

### What a suite reads cannot be scanned for — it was measured

`@app/api`'s suite reads the built-in pack's `dist`, and no spec of its names that path: they boot the app
runtime and host code resolves it. Declaring it independent let it run beside `compile` under three lanes,
where it failed on a missing `settings.content.json` after passing serially forever. `@apackdev/host` is the
inverse — `sdk-bridge-drift.spec.ts` reads `dist/runtime/index.cjs` but *skips* when it is absent, so it
passes without the pack and would pass vacuously in a race.

Under one root run this matters less, because the whole step waits for `compile`. It matters for this plan
anyway: a per-project staleness filter is a claim about what each project reads, and the only method that
answers it is running each suite with the tree moved aside. That method, and its 2026-09-25 result, are
recorded in `SUITE_READS`' doc comment.

### The chain's lane default is 2, measured against today's step shape

Phase 6 added a lane-limited scheduler over the chain's DAG. Measured cold on an idle machine: serial 306.9s,
two lanes 194.0s (+11% total work), three lanes 202.7s (+55% total work) with one of two runs failing. So the
default is two.

**That number is against a `test:unit` that is eight suites.** After Lever 1 it becomes one ~13s step using
every core, and running it beside `typecheck` is a different contention problem — so the lane default is due
for re-measurement here, not a settled constant. Decision 11 of the goal (cache before parallelism) is why
the caching landed first; this plan is the second half of Decision 6, and the lane count is the seam between
them.

## Relation to the other plans

- `goal-test-tiers.md` Decision 6 (one owner of concurrency) is what Lever 1 implements; Decision 11 (cache
  before parallelism) still holds, because this is not parallelism-by-lanes — it is removing a second
  scheduler.
- Phase 8's per-tier timeouts are unblocked by the same change: per-project config is where a tier budget can
  finally be expressed. `generate-entries.spec.ts` is one of the files whose margin against vitest's 5s
  default caps lanes today — **not the only one**, so Lever 3 should not be credited with lifting that cap.
  Measured 2026-09-25 on a three-lane chain run: the failure was `findLmdbImports > holds for the repo` in
  `@apackdev/cli` at 5220ms, a whole-repo scan that takes ~2s alone. Two thin-margin whole-repo scans in two
  different suites is the "class of thin margins, not one test" already recorded in `scripts/test-unit.ts`,
  where raising one suite's timeout moved the failure to another suite.
- `cli-suite-spawns-rebase.md` is independent: its conversions live in the integration half, which
  `test:unit` does not run.
