> **Superseded in part** by its own Phase 1 spike (branch `AS/spec-placement-without-milliseconds`): the
> spike refuted Decision 1's premise, so Decisions 1-3 were not implemented and Phases 2-3 were replaced
> by the alternative the goal had skipped. Decisions 4-8 landed as written. The text below is the plan as
> written; the Outcome records what was built instead and why.
>
> **Written in session** `f122fdc5-84c9-467f-9c61-66330eab32d0` (Claude Code, 2026-10-05). Resume it with `claude -r f122fdc5-84c9-467f-9c61-66330eab32d0`.

```
# Goal: the spec-placement audit stops storing milliseconds

Implement docs/goals/goal-spec-placement-without-milliseconds.md on master, at or after a531211b0 —
the base its Background holds at. Nothing here depends on the branch it was typed on.
Before Phase 1, confirm the base: scripts/lib/spec-cost.ts exports WINDOW, costOf, disagrees and
worthKeeping; scripts/lib/measure.ts exports bodyDrift, drifted and DRIFT_SHARE; and both
scripts/chain.ts and scripts/spec-cost.ts call drifted(). If they don't, stop and say so — the plan
was surveyed somewhere else.
Read Background, Decisions, Open decisions, Phases and Constraints first. Decisions are final:
implement them, don't reopen them or stop to ask. Open decision 1 must be settled with the user
before Phase 3; if it is still marked open when you reach it, stop and ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward. Stored user data is the exception: it
moves with migrations. The spec-cost records are test expectations, not user data.

Phase 1 is a spike. Report its four results and stop before Phase 2.

Finished when:
- Phases 1-5 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- No spec-cost record stores a millisecond cost, a `machine` field, or a window of readings. The
  audit's verdict is a per-spec streak, and `grep -r "WINDOW\|costOf\|worthKeeping\|disagrees"
  scripts/` finds only what Decision 6 keeps.
- Nothing measures spec costs in a process of its own: `spawnSync('npx', ['vitest'...])` is gone from
  scripts/spec-cost.ts, and the durations come from the suite run (Decision 2).
- `RECORD_IDLE_FLOOR`, `refusesAsContended` and `isMeasuredMachine` no longer gate the spec audit; a
  second machine can satisfy the audit with no `--force` (Decision 3).
- `bodyDrift`/`drifted`/`DRIFT_SHARE` have exactly one caller, scripts/chain.ts, and DRIFT_SHARE's
  basis for that caller is either re-measured or recorded as inherited with its reason (Decision 4).
- The chain's drift report says whether one step or the body moved, and names a remedy that fits the
  case it reports (Decision 5).
- npm run typecheck; npm run spec over every file touched; npm test -w @app/internal-repo-checks;
  npm run chain. `npm run spec-cost:check` (or its replacement) passes on a deliberately busy box.
- A final summary: phase -> done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end. A
  phase is landable on its own; a commit is how that stays true. Conventional message, no
  Co-Authored-By or session lines, `git commit -- <paths>` naming only that phase's files.
- Check `git diff --cached` first: something outside the session stages files in this tree, and a
  pathspec commit leaves the rest of the index alone.
- Don't push, tag, or open a PR unless the user asks.

Never:
- the standing prohibitions in Constraints below: git (push/tag/PR), publishing and workflows, real
  data dirs, broad process kills, bare tsc on preload, the example pack, release metadata, typed
  EARS, compat shims, loosened assertions.
- raise DRIFT_SHARE, or widen any band or threshold, to silence a report (Decision 7). A threshold
  that fires wrongly is a detector to fix or delete, not a number to inflate.
- delete scripts/lib/spec-cost.ts wholesale. Decision 6 names the recorded lessons that survive and
  where each goes; a deletion that takes them with it is the failure this goal is most likely to
  cause.
```

## Background (2026-10-05, at `a531211b0` on `master`)

Surveyed at `e111c0ba4` on `AS/drive-vocabulary`, and the base is `master` because every file cited below is byte-identical at `a531211b0`: `scripts/lib/{spec-cost,measure,spec-dry,unit-pool,chain-steps}.ts`, `scripts/{spec-cost,chain,test-unit-pool}.ts` and `packages/internal-repo-checks/tests/suite-split.spec.ts`. That branch's commits touched the Playwright configs and the drive engine, none of which this goal reads — so the survey is true at master's tip and the line numbers below are the same there. Checked with `git diff master..HEAD -- <each path>`.

`packages/*/etc/spec-cost.json` records what every spec file costs in milliseconds. `scripts/lib/spec-cost.ts` is 1,233 lines and `scripts/spec-cost.ts` 584, and between them they hold a window of up to three readings per spec (`WINDOW`, `spec-cost.ts:220`), a median with a deliberate length-two rule (`costOf`, `:247`), an agree-band (`disagrees`, `:367`; `worthKeeping`, `:390`), two idle floors, a contention refusal, a `machine` field, a path for a record measured on another box, and a body-drift report.

**What consumes a recorded cost.** Two things, and neither is the test runner:

1. **The audit.** `packages/internal-repo-checks/tests/suite-split.spec.ts` fails when a spec is in the wrong half, has no recorded cost, or is recorded and gone.
2. **An advisory total.** `scripts/lib/spec-dry.ts`'s `priceSpecs` (`:52`) prints `npm run spec:dry`'s estimate. Its own header (`:11`) says the total "is deliberately allowed to sit up to `DRIFT_SHARE` from the truth", and the command prints `measuredAt` because the figure is a band rather than a number.

**Placement does not come from the cost.** `halfOfPath` (`spec-cost.ts:455`) reads the filename — `.integration.spec.ts` means the integration half — and the pool runner uses that half (`CONFIG_BY_HALF`, `scripts/lib/unit-pool.ts:16`). No runner reads a millisecond. `halfFor` (`:458`) compares a cost against `INTEGRATION_ABOVE_MS` (2,500) and `FAST_BELOW_MS` (1,000) to answer one question: *is this spec filed in the wrong half?*

So the millisecond is an intermediate value. The record stores it and re-derives a verdict from it, where the verdict is what both consumers of the audit actually want.

**The durations already come from the suite's own reporter.** `measure()` (`scripts/spec-cost.ts:69-100`) runs `spawnSync('npx', ['vitest', 'run', '--config', config])` and regex-parses vitest's default per-file lines (`FILE_LINE`, `:63`), reading both the pooled `|project|` prefix and the bare per-package form. The parse exists; what makes this a separate command is only that it starts its own vitest instead of reading the run that already happened.

**What the millisecond costs the design.** Because a millisecond is a fact about a machine rather than about the repo:

- `RECORD_IDLE_FLOOR = 0.85` (`measure.ts:159`) refuses to record on a busy box, measured because "at `IDLE_FLOOR` a permitted run drifts the body about as far as `DRIFT_SHARE`".
- The record carries `machine` and `spec-cost:check` reports differently off that box, because a second contributor could otherwise only satisfy `unrecorded` by writing their own box's numbers into someone else's record.
- `--all --force` exists so another machine can take the record over.
- A spec must be measured with its *config*, not alone: `chain-inputs` reads 1,688 ms beside its siblings and 963 ms on its own, against a 1,000 ms band, so a solo reading files it in the wrong half.

**The body-drift report, and why it is in this goal.** `bodyDrift` (`measure.ts:190`) compares the sum of a run's measurements against the sum recorded, and `drifted` (`:202`) raises it past `DRIFT_SHARE = 0.15` (`:199`). Its premise is in its own doc comment: *"Random jitter does not bias a sum — the lags fall both ways and cancel, which is why a spec suite's total moved 0.4%, 6.5% and 9.9% between idle runs while its members moved 10-18% each."*

That was measured on `@app/internal-repo-checks`' fast half. Measured 2026-10-05 across all twelve records, five suites have a single spec at 64% or more of their body, so there is nothing for its jitter to cancel against:

| suite | specs | top spec's share of the body |
|---|---|---|
| `apack-ui` | 2 | 93% |
| `main` | 3 | 89% |
| `apack-sdk` | 61 | 86% |
| `apack-ears` | 9 | 79% |
| `apack-testing` | 10 | 64% |
| `internal-repo-checks` | 46 | 12% — where the threshold was measured |

`measure.ts:120-131`'s own table records the worst single spec moving 74% between two *quiet* runs. At 93% concentration that is ~69% body movement from noise, four and a half times `DRIFT_SHARE`: the report cannot avoid false-firing on those suites. Observed on 2026-10-05 — `@apackdev/testing` reported +16% and `@app/internal-repo-checks` −14% on one run, opposite directions, which is the signature of jitter rather than the correlated drift the report exists to catch.

**The remedy it prints does not fit the case that fires.** `spec-cost.ts:327` prints `--all --forget` on every branch, while that flag's own documentation calls it *"for a change you know about — a bundler bump, a policy change — and not to chase a drift you do not"*. For spec costs the report only prints: `drifted()` there is a `console.log`, and `spec-cost.ts:1100` records that a drift **gate** on the write already existed and was already removed (*"It replaced `rewritesEveryRow`, which was `all && drifted(body)` — a drift gate on a write"*). So the standing cost is a misleading sentence, not a blocked workflow.

**Removing the spec-cost caller orphans the threshold.** After this goal `bodyDrift` has one caller, `scripts/chain.ts:768`. Measured 2026-10-05, ten chain steps declare a `seconds` cost, totalling 266 s, with `test:packaged-authoring` at 91 s — **34% of the body, and the top three 62%**. That is the same concentration regime the premise fails in, the subject the threshold was calibrated on is the one this goal deletes, and nobody has measured the chain's own quiet-run body variance.

## Spike results (2026-10-05)

Machine: Apple M1 Pro, 10 cores. Quiet runs at 88-94% idle, loaded runs at 20% idle (eight `node` CPU burners, started and stopped by captured PID). Spike code is a throwaway Python probe under the session scratchpad; **do not reuse it** — it duplicates `FILE_LINE` by hand, and Phase 3 should use the JSON reporter instead (Q2).

Commands: `npm run packages:ensure`; `npx tsx scripts/test-unit-pool.ts {host,pack,integration} --all` (the `--all` is required — the pools otherwise run only stale projects and a cached run prints nothing); `node scripts/with-source.mjs npx vitest run --reporter=default --reporter=json --outputFile=<path>`.

### Q1 — Does every spec appear with a duration in a real pool run? **Yes.**

415 file lines parsed across the three pools, 415 distinct specs, against 414 recorded across twelve suites. **No recorded spec is missing from a pool run.** One spec is seen with no duration: `default-setup/tests/features/code/be/claude-code-permission-flow.spec.ts`, which is fully skipped, so vitest prints no time for it — the case `scripts/spec-cost.ts:93` already handles, and it is in the record's `skipped` list rather than `samples`.

The three pools print three different line shapes, all of which `FILE_LINE` already reads: the host and integration pools prefix `|@project|`, while the pack pool invokes `npm test -w <workspace>` per suite and prints no prefix, so suite identity there comes from the invocation and not the line. Phase 3 has to carry that distinction.

### Q2 — Is a JSON reporter available and better? **Yes to both, and it should be used.**

`--reporter=default --reporter=json --outputFile=<path>` runs both: the human output is unchanged and the JSON is written beside it. Verified on a pooled multi-project run (`@app/renderer` + `@app/main`, 11 of 11 files present) and on a single project, where the two agree to rounding (131/132 ms, 2/2, 11/11).

`testResults[]` carries `name` as an **absolute path** plus `startTime`/`endTime`; the duration is their difference, and there is no `duration` field. It is better than the regex on three counts: the path is unambiguous so neither the `|project|` prefix nor the npm-banner tracking is needed, there is no ANSI to strip, and it does not depend on reporter formatting.

### Q3 — What streak length is needed? **No consecutive-count N works. This refutes Decision 1's premise.**

288 specs measured in all three runs (one quiet, two loaded). Nine specs' verdicts moved under load, and **three moved in both loaded runs**:

| spec | quiet | busy 1 | busy 2 |
|---|---|---|---|
| `internal-publish-checks/.../published-manifest-paths.spec.ts` | 2443 ms (fast) | 3532 ms (integration) | 3326 ms (integration) |
| `internal-repo-checks/tests/spec-waits.spec.ts` | 1658 ms (fast) | 2509 ms (integration) | 2920 ms (integration) |
| `internal-repo-checks/tests/suite-reads.spec.ts` | 1537 ms (fast) | 2530 ms (integration) | 2614 ms (integration) |

Busy/quiet ratio over the 103 specs above 50 ms: **median 1.27x, p90 2.03x, max 3.29x.**

A streak counts *consecutive* runs, and load persists — for hours on a working machine. Three specs flipped twice running, so N=2 files three wrong renames; nothing about N=3 or N=4 is different, because a box loaded for three runs flips three times. **The premise that a boolean verdict is machine-independent is false**: the edge is an absolute wall-clock threshold, and load moves durations across it by 2-3x, so the verdict is exactly as machine-dependent as the millisecond was.

What the data does support is a **margin against the edge rather than repetition**. Load explains up to 3.29x here, so a spec over its edge by more than that is over it for reasons load cannot account for — `apack-sdk/tests/build/generate-entries.spec.ts` at 17 745 ms against a 2 500 ms edge is 7.1x and believable from one reading, where `spec-waits` at 2 509 ms is 1.004x and is noise. A ratio is machine-independent in the way a wall-clock threshold is not.

**`CONTENTION_RATIO_MAX = 2.5` is not that ratio, despite the name.** Its doc records it as an upper bound on how much more a spec reads *in the fast half than in the integration half*, measured on an idle box with each spec moved alone — a placement conversion, not a load factor. The 3.29x above neither confirms nor contradicts it; they are different quantities, and conflating them would size the band on the wrong measurement.

### Q4 — How far is any spec from its edge? **31 of 415, and the audit has two kinds, not one.**

31 specs sit within a 2.5x swing of their edge; the other 384 cannot be moved by any plausible noise. Eight specs' *pooled* durations already disagree with their filenames while `spec-cost:check` passes — and the reason is a distinction Decision 1 does not model. `overBudget` (`spec-cost.ts:634`) dispatches on `hasSplit` (`:534`):

- a package with two vitest configs gets **`misplaced`** — the spec is in the wrong half and a rename is the remedy;
- a package with one config gets **`outgrown`** — the spec costs more than a fast half allows and there is nowhere to move it, so the entry records *what makes it expensive* instead. Explicitly "not a queue of packages to split".

Only three packages have a split (`@apackdev/cli`, `@app/internal-repo-checks`, `@app/internal-publish-checks`), so nine of twelve suites can only ever produce `outgrown`. `generate-entries.spec.ts` at 17.7 s passes because it is `outgrown` with a recorded reason, not a misplacement.

A second effect Q4 exposes: the recorded costs were measured by `measure()` running one `npx vitest` **per package**, while specs actually run pooled across eleven projects. `generate-entries` is recorded at 11 308 ms and reads 17 745 ms pooled. Decision 2 already says a spec should be timed in the pool it runs in; the gap is larger than the doc assumed.

### What the spike did not cover

- Whether a margin-against-the-edge rule is stable across machines, which is the question Decision 1's replacement turns on. One box only.
- The pack pool's per-invocation suite identity under the JSON reporter (Q2 was verified on pooled and single-project runs, not on `npm test -w`).
- `spec:dry`'s basis (Open decision 1), untouched.

## Decisions

Final, except Open decision 1.

1. **The record stores the audit's verdict, not its input.** Per spec, the number of consecutive runs whose duration contradicted the spec's filename — a misfiled streak — plus the membership the audit already needs (`unrecorded`). No millisecond cost, no window of readings.

2. **The suite run is the measurement.** The pool runner (`scripts/test-unit-pool.ts`) parses the per-file durations it already causes vitest to print and updates the streak. Nothing starts a vitest of its own to price specs; `measure()`'s `spawnSync` goes. A spec is therefore always timed in the half and the pool it really runs in, which is what `chain-inputs`' 1,688-vs-963 ms gap says a cost must be.

3. **Machine-independence follows, and the machinery that existed for it goes with it.** A streak is a fact about the repo: the same verdict is reached on a slow box and a fast one, because the question is "did it exceed 2,500 ms", not "by how much". So delete, for the spec audit: the `machine` field and `isMeasuredMachine`, the foreign-record path, `RECORD_IDLE_FLOOR`/`refusesAsBusy`/`refusesAsContended`, and the `--all`/`--suite`/`--force`/`--forget` flags. `RECORD_IDLE_FLOOR` itself stays for `chain --record`, its other caller.

4. **`bodyDrift`, `drifted` and `DRIFT_SHARE` stay, for the chain alone.** Phase 5 either re-measures `DRIFT_SHARE` against the chain's own steps and records the method, or records in its doc comment that the value is inherited from a subject that no longer exists, with the reason that is tolerable. Not both, and not silence.

5. **The chain's drift report says which of two things happened.** Recompute the drift with the single largest mover excluded; if that lands inside `DRIFT_SHARE`, one step moved and the body did not — name the step. Then each branch names a remedy that fits it: body drift → `--all --forget`; one step → `--step <name>`, which already exists; neither → say the record will absorb it and advise nothing. No new constant: the discrimination is a second reading of data `bodyDrift` already holds.

6. **The lessons survive the milliseconds.** `scripts/lib/spec-cost.ts` records what several guards cost to learn, and three are still true of a streak. Carry each into the new module's comments where it explains a choice, and do not restate the ones that die with the window:
   - **Why a streak needs a length above one.** Measured 2026-09-28, treating the sample as a derivation churned 125 of 163 entries between two idle runs while the answer changed zero times; and the 2026-10-03 episode where a 78%-idle recording moved two specs across `INTEGRATION_ABOVE_MS` and the gate demanded two renames. One contended run must not file a rename.
   - **Why the band had a floor as well as a fraction** — a fraction alone chases noise on a small number. The streak's analogue is that it counts runs and not magnitudes, which is the point to state.
   - **Why a measurement is not a derivation** (the three-kinds-of-recorded-artifact rule in root `CLAUDE.md`). The streak is still a sample; what changes is that its unit is machine-independent.
   Delete, with the window: the median-of-three argument, the length-two rule, `appendSample`, `disagrees`, `worthKeeping`, `COST_ACCURACY`, `nearEdge`, `provisional`, `CONTENTION_RATIO_MAX` and `ratiosFromMoves` — unless Open decision 1 lands on a basis that needs one, which Phase 3 settles.

7. **No threshold is widened to quiet a report.** `DRIFT_SHARE` in particular: correlated drift is the one failure nothing else detects, since a bump that adds a fifth to every entry sits under every per-entry tolerance by construction.

8. **Root `CLAUDE.md`'s "three kinds of recorded artifact" section is part of the work.** It names `spec-cost.json` as the only sample and describes the window as the shape to copy. Phase 4 rewrites that passage to describe what the record holds afterwards, including the sentence about a second sample.

## Open decisions (settle with the user before Phase 3)

1. **What `spec:dry`'s printed estimate is based on, once no millisecond is stored.** — *open*
   - **The last run's own durations.** The pool runner already has them (Decision 2) and could write them beside the streak as an unversioned cache. Free, always current, and honest about being one reading. Noisier than a median for a preview, and it reintroduces a per-machine number into the record unless it is kept out of git.
   - **Keep a cost for the preview only, with no band and no gate.** One reading per spec, overwritten every run, explicitly advisory. Smaller change, keeps the file's purpose mixed.
   - **Drop the estimate; print the plan and the record's age.** `spec:dry`'s value is mostly which specs would run; the time is a band nobody acts on. Deletes the most machinery, and loses a figure the command was built around.

   Whichever is chosen, `spec:dry` must keep printing what it cannot price (`priceSpecs`' `unpriced`/`outside` buckets), which root `CLAUDE.md` names as one of the four shapes for a partial result.

## Phases

### Phase 1 — Spike: does the suite run carry what the audit needs?

Throwaway work on a branch or worktree; nothing from it is reused verbatim. Answer four questions and report before Phase 2.

- **Does every spec appear with a duration in a real pool run?** Run `npm run test:unit` capturing output, apply `FILE_LINE` (`scripts/spec-cost.ts:63`) to it, and compare the files found against the twelve records' membership. Report any spec that runs but prints no parseable duration, and any that prints one only in a per-package run.
- **Is a JSON reporter available and better than the regex?** Check whether vitest's `--reporter=json` carries per-file durations for the pooled, multi-project runs the pool uses, and whether it can be added alongside the human reporter without changing what a developer sees.
- **What streak length is needed?** Using the durations captured above plus one deliberately contended run (`npm run measure -- --busy N` for the load), count how often a spec's verdict flips between runs. The streak threshold must be the smallest N where no spec flips N times running on noise.
- **How far is any spec from its edge?** List specs whose duration sits within one contended run's swing of `INTEGRATION_ABOVE_MS` or `FAST_BELOW_MS`. These are the only specs the streak has to protect, and the count sizes the whole design.

**Done when:** the four answers are in a "Spike results" section in this doc, with the commands and the machine; the streak threshold N is stated with the data behind it; and any spec the parse cannot see is named.

### Phase 2 — The record holds a streak

- New record shape in `scripts/lib/spec-cost.ts`: membership plus a per-spec streak. Keep `halfOfPath`, `halfFor`, `INTEGRATION_ABOVE_MS`, `FAST_BELOW_MS`, `unrecorded` and `PLACEMENT_GUARD`; delete what Decision 6 names.
- `packages/internal-repo-checks/tests/suite-split.spec.ts` asserts on the streak: a spec is misfiled when its streak reaches N, and a streak below N is reported as provisional rather than acted on.
- Rewrite the twelve `packages/*/etc/spec-cost.json` files into the new shape. These are test expectations, not user data, so they are rewritten rather than migrated — but **not by hand**: the command writes them.

**Done when:** `npm test -w @app/internal-repo-checks` passes; no record holds a millisecond or a `machine` field; `npm run spec -- spec-cost` passes. Mutation: set one spec's streak to N and `suite-split` names that spec; set it to N−1 and the run reports it as provisional and passes.

### Phase 3 — The suite run is the measurement

Needs Open decision 1 settled.

- `scripts/test-unit-pool.ts` parses the durations from the run it already performs and updates each spec's streak: reset to zero when the verdict agrees with the filename, increment when it does not.
- Delete `measure()`'s `spawnSync` of vitest from `scripts/spec-cost.ts`, and the flags and refusals Decision 3 names. What remains of `spec-cost:update` is whatever Open decision 1 requires; if nothing, the script becomes `spec-cost:check` alone and the npm scripts follow.
- Implement Open decision 1's choice for `spec:dry`.

**Done when:** `npm run test:unit` updates the streaks with no extra vitest process; `npm run spec:dry` prints a plan and whatever basis was chosen, including its `unpriced`/`outside` buckets; the audit passes on a box held deliberately busy, with no `--force`. Mutation: make one spec exceed its edge for N runs and watch `suite-split` turn red, then rename it and watch it go green.

### Phase 4 — The docs catch up

- Root `CLAUDE.md`: the "three kinds of recorded artifact" passage (Decision 8), the `spec-cost:check`/`spec-cost:update` entries in Commands, and the `check:idle` entry's claim about which commands refuse.
- `packages/apack-cli/CLAUDE.md`'s "Tests" section states the 2.5 s/1.5 s band and that `spec-cost:update` records a measured cost; `packages/internal-repo-checks/CLAUDE.md` has the row for `suite-split`.
- Any doc naming a deleted flag.

**Done when:** `npm run spec -- doc-links` passes and `grep -rn "spec-cost:update -- --all\|RECORD_IDLE_FLOOR" docs/ packages/*/CLAUDE.md CLAUDE.md` finds nothing that describes the old behaviour. Docs outside `docs/archive/` describe the code as it is.

### Phase 5 — The chain's drift report, after it is the only caller

Deliberately last: the point is to re-derive the threshold for its actual sole consumer, which is only true once Phase 3 has removed the other one.

- Decision 4: re-measure `DRIFT_SHARE` against the chain's declared seconds, or record it as inherited with the reason. If re-measuring, use `npm run measure` and record runs, median and machine, as `measure.ts`'s existing table does.
- Decision 5: the top-mover exclusion and the three-branch remedy in `scripts/chain.ts`'s drift report.

**Done when:** `bodyDrift` has one caller; `npm run spec -- measure` and `npm run spec -- chain` pass; `npm run chain` is green. Mutation: feed the report a map where one step carries the whole movement and assert it names that step rather than the body, and a map where every step moved alike and assert it names the body — both as pure-function cases over two maps, which is the data-input shape root `CLAUDE.md` prescribes.

## Outcome (2026-10-05)

Landed on `AS/spec-placement-without-milliseconds`, cut from `master` at `bab40b892`. **The spike in Phase 1 refuted the premise behind Decisions 1-3 before any code moved, so the goal's central change was not built.** What landed instead is the alternative this goal had explicitly skipped — removing the spec-cost body-drift report — plus Decisions 4-8 as written. The spike cost about an hour of machine time and saved a redesign of ~1,800 lines that would have been strictly worse than what is there.

### Per phase

| Phase | Status | Evidence |
|---|---|---|
| 1 — Spike | **done** | `4c0001457`. Four answers in Spike results above, with commands and machine |
| 2 — The record holds a streak | **not done, refuted** | Q3: three specs' verdicts flipped in both loaded runs, so no consecutive-count N works |
| 3 — The suite run is the measurement | **not done, falls with it** | Measuring on every run, loaded or not, is worse than measuring deliberately on a quiet box — see Corrections |
| 2' — No body-drift report for spec costs | **done** (replaces 2) | `2510f5400`. `drifted()` has one caller; `spec-cost:check` ✅ 415 specs; internal-repo-checks 948/948 |
| 5 — The chain's drift report | **done** | `d1ecc6eef`. `driftVerdict` + 6 cases, both named mutations fire only on their cases |
| 4 — Docs | **done** | `d15f0c898`. Three passages in root `CLAUDE.md`; `doc-links` 6/6 |

### Corrections to the Decisions

**Decision 1 is wrong, and the spike's Q3 is the evidence.** The premise was that a boolean verdict is machine-independent "because the question is *did it exceed 2,500 ms*, not *by how much*". It is not: the edge is an absolute wall-clock threshold, and under sustained load three specs' verdicts flipped in **both** loaded runs. A streak counts consecutive runs and load persists for hours, so N=2 files three wrong renames and N=3 is no better. Both obvious repairs are ruled out by the same data — a margin against the edge needs 3.3x and so only catches egregious cases, and a per-run scale correction fails because load is not a uniform multiplier (after dividing by the median 1.18x, 20 of 83 specs are still off by more than 1.5x, and larger specs are *less* affected than smaller).

**Decisions 2 and 3 fall with it.** Both existed to make the record machine-independent. Once the verdict is known to be machine-dependent, measuring during every real run — including loaded ones — is *worse* than measuring deliberately on a quiet box, and `RECORD_IDLE_FLOOR` is correct rather than incidental. The deeper conclusion is that the millisecond, the window, the band and the idle floor are the shape of the problem: auditing a wall-clock budget is machine-dependent, and no unit change makes it otherwise.

**What replaced them is the option this goal skipped.** The session that wrote this doc considered deleting the spec-cost body-drift report ("B") and rejected it as something the redesign would subsume. The redesign is gone and the deletion is the whole remaining fix. It was already in this goal's own "Finished when" — *"`bodyDrift`/`drifted`/`DRIFT_SHARE` have exactly one caller, `scripts/chain.ts`"* — so Decision 4 had required it all along.

**Decision 4 took its second option.** `DRIFT_SHARE` is recorded as inherited rather than re-measured, with the reason on the constant: the figures behind it are a spec suite's, that suite stopped consuming it, and the concentration the chain does have is answered by Decision 5's second reading rather than by the threshold's size. An attempt to re-measure produced two repeatable runs (151.7s, 151.2s) on a box reading 58-66% idle against a floor of 85%, so they say the chain is repeatable and nothing about drift. Recorded as an attempt rather than a measurement.

**Decision 6 held, in the direction that mattered.** The lessons were not carried into a new module, because there is no new module — the window, band and median stay where they are. What the commit does record, where the report used to be, is why there is no report and what a replacement would have to do first.

### Conventional choices

- `bodyDrift` and `drifted` are now called only from `driftVerdict` inside `measure.ts`, and `driftVerdict` has the chain as its one caller. That is tighter than the "exactly one caller, `scripts/chain.ts`" the Finished-when asked for, and satisfies its intent.
- The largest mover is picked by absolute seconds rather than by its own share, so a tiny step that doubled is not named over the one that moved the sum. A case covers it.
- `--forget` was kept on `spec-cost:update` (Decision 3 would have deleted it). With the report gone it is for a change you already know about, which the flag's doc now says.

### Open items

- **Three spike findings worth their own work**, none of them blocking: the parse should move to vitest's JSON reporter (Q2 — absolute paths, no ANSI, no `|project|` prefix handling, verified working alongside the human reporter); the recorded costs are measured by one vitest **per package** while specs run pooled across eleven projects, an 11,308 ms vs 17,745 ms gap on `generate-entries.spec.ts`; and `overBudget` has two kinds (`misplaced` for the three split packages, `outgrown` for the other nine) that no plan here modelled.
- `CONTENTION_RATIO_MAX` is named as if it were a load factor but is measured as a fast-vs-integration placement ratio on an idle box. The name invites exactly the conflation this spike nearly made.
- The three specs added by the preceding branch carry membership without a cost on some runs; the machine sat at 80-88% against the 85% recording floor for most of this session.

### Final verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ all legs |
| `npm test -w @app/internal-repo-checks` | 948/948 |
| `npm run spec -- measure.spec.ts` | 49/49, both mutations fire only on their cases |
| `npm run spec-cost:check` | ✅ 415 specs across 12 suites |
| `npm run spec-cost:update -- --dry` | every record current |
| `npm run lint:check` | 0 warnings, 0 errors |
| `npm run chain` | ✅ 24.1s (21 of 28 cached), then ✅ **162.1s with `--all`** on a 90%-idle box |

Two notes from those chain runs, neither of them this goal's:

- The 24.1s run reported three steps past twice their declared cost (`check:specifiers` 5s->11s,
  `typecheck:scripts` 5s->12s, `lint:check` 3s->7s). None reappeared in the `--all` run on an idle box, so
  that was contention — the machine sat at 58-88% for much of this session with another process in the tree.
  A 150-line change cannot double a repo-wide scan.
- The `--all` run reported `test:smoke  seconds: 9 -> 20`. It appears only under full-chain concurrency —
  the same suite read 10.6s in an ordinary run — and nothing in this goal touches the app, the renderer or
  the E2E fixture. Left unrecorded on purpose: one reading, not this branch's, and recording a step cost is
  a deliberate act (`chain -- --all --record`) rather than something to fold into an unrelated change.

## Deferred

- **Per-suite drift thresholds derived from concentration.** Decision 5 answers the same question from the run's own data without a constant, and a threshold per suite is machinery for a number nobody reads directly.
- **The chain's own cost record.** It keeps declared `seconds` in `scripts/lib/chain-steps.ts` with `--record` writing them back, and has the same sample-versus-derivation question. Out of scope: this goal touches the chain only where deleting the spec-cost caller orphaned something.
- **Replacing the regex parse with a JSON reporter** beyond answering whether it is viable (Phase 1). If it is, it is a separate change with its own evidence.

## Constraints

- Commit each phase as it finishes, in logical chunks, no attribution lines, `git diff --cached` first; pushing, tagging and PRs are on request. Something outside the session stages files in this tree, so use `git commit -- <paths>`.
- No publishing, releases or triggered workflows.
- No real data dirs; no broad `pkill`/`killall`; E2E in the `apack-test` namespace with an isolated `APACK_USER_DATA_DIR`.
- No bare `tsc` on `packages/preload`; no `npm install` in the example pack; no edits to version or release metadata.
- Typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- Published packages: no `any`, the TypeScript floor, `api:update` after export changes.
- Investigate failing tests rather than loosening an assertion; mutation-check every new guard, and mutate a copy or a worktree rather than the shared tree.
- Measure on a quiet machine and record runs, median and machine with any number this goal adds (`npm run measure`, `npm run check:idle`).
- The spec-cost records are rewritten by the command that owns them, never by hand.
