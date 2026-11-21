# Goal: `npm run spec` never reports a pass it did not earn

> **Written in session** `bc6d43e0-1c60-4cad-8237-15508a9e6649` (Claude Code, 2026-09-28). Resume it with `claude -r bc6d43e0-1c60-4cad-8237-15508a9e6649`.

> **Finished 2026-09-28. Phases 1-4 are implemented and committed; see the Outcome at the end for what each
> one landed as, what was measured, and the choices made where the plan left a detail open. Read this doc as
> history — it names the code as it was, and the Background's §1 and §2 describe defects that no longer
> reproduce.**

> **Re-surveyed 2026-09-28 (later the same day) at `af694db4f`. Phase 1 is implemented and its Background is
> now history; Phases 2-4 are untouched and every reproduction behind them still reproduces. Read this block
> before the Background: it closes one phase, re-dates every number, and corrects two Decisions.**
>
> - **Phase 1 shipped** in `249c0a8e8`, with `46268f236`, `fc96b83bd` and `a4d4abca9` behind it. Every item of
>   its "Done when" was re-checked and holds. **The base check below asked an implementer to confirm the
>   defect Phase 1 removed, and would have stopped them** — corrected in place, as
>   [`goal-unit-suite-cost.md`](goal-unit-suite-cost.md) corrected its own.
> - **Phase 1 added a fourth verdict the Decision did not name**, and it is the right addition: `no count`,
>   for a run whose reporter never wrote a file. It exits 3 with the count treated as unknown rather than as
>   zero, because "the reporter stopped being called" and "nothing ran" are the same silence. Decision 1's
>   three *codes* are unchanged; the verdicts are four.
> - **Background §2's symptom changed and did not improve.** A content source no longer passes quietly — it now
>   exits 3 saying *"No spec covers packages/default-setup/src/content/…"*, which is **false**: `tests/content/`
>   covers it across the build edge. Phase 1 turned a silent hole into a confident wrong answer, which is a
>   better failure and still a wrong one. Phase 2 is unchanged and is what fixes it.
> - **`packages/<pack>/apack.json` is the opposite case** and neither phase noticed: `.json` is not a source
>   extension, so it carries no claim, and the target prints *"every spec covering apack.json"*, runs nothing
>   and exits **0**. Decision 2's extension test is right — it is what keeps a doc target honest — so Phase 2
>   owns this one too, and says so now.
> - **Decision 6 mislabels a tier, and did so when it was written.** It calls `test:unit:pack` tier 2; it is
>   `tier: 1` in `chain-steps.ts` today and was at `56ba5bcad`. The Decision's whole argument is that the label
>   is *read* from that file and so cannot disagree with it, which makes the error the exact one it warns
>   against. Corrected below.
> - **Decision 7's ratio moved 40% in three days.** 36.0s of file-time ran in 23.3s of wall at the survey
>   (1.55:1); the same target now records 41.9s and runs in 20.8s (2.18:1). The Decision's refusal to calibrate
>   a per-suite ratio is strengthened by that; its example sentence, which prints a wall range derived from one
>   ratio, is struck below.
> - **The record it predicts from is now a *sample*.** `spec-cost.json` gained hysteresis, a contention refusal
>   and a drift-gated `--all` (root `CLAUDE.md`, "There is a third kind"). A recorded cost is deliberately
>   allowed to sit up to `DRIFT_SHARE` from the truth, so Phase 4's prediction inherits a band rather than a
>   number. Phase 4 says what to do about it.
> - **Phase 1 met its "Done when" and left half of Decision 2 unimplemented.** A change set of nothing but a
>   doc exits 0, as required — but it still spawns `packages:ensure` and a root `--changed` vitest that reports
>   *"No test files found"*, under the label *"the specs your changes affect"*. Decision 2 asked for the other
>   half too: that it **say nothing changed that a spec could cover**, rather than pay 3.4s to discover it. The
>   root `CLAUDE.md`'s first time-waster is *running anything at all after a doc edit*, so this is the rule the
>   command itself now breaks. Added to Phase 3, whose subject is a run whose answer is already known.
> - **Every number in Background was re-measured at this commit.** The record is 369 specs and 315.9s where it
>   was 354 and 246.9s.

```
# Goal: npm run spec never reports a pass it did not earn

Implement docs/goals/goal-spec-earns-its-pass.md on the current branch, at or after af694db4f — the base its
Background was re-surveyed at. Phase 1 is already done; start at Phase 2.
Before Phase 2, confirm the base, with CONTENT=packages/default-setup/src/content/actions/claude-code/answer-question.ts:
`npm run spec -- $CONTENT` exits 3 claiming no spec covers it; `npm run spec -- packages/default-setup/apack.json`
exits 0 having run nothing; scripts/lib/spec-plan.ts exports planTargets, verdictOf and exitCodeFor, and Run
carries claimsCoverageOf. If any is already false, stop and say so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root CLAUDE.md, "Backward compatibility" — a standing rule,
not this goal's choice): change signatures, migrate every in-repo caller, test, fixture and doc in the
same change, and fix forward.

Every number in Background was measured on 2026-09-28 on a 10-core machine with nothing else running, and
re-measured the same day at af694db4f. Re-measure before you use one to justify a choice: a contended run
has produced a 36% error here, and the file-time-to-wall ratio moved 40% in three days.

Finished when:
- Phases 2-4 are implemented and each meets its "Done when"; every new route, helper and guard is
  mutation-checked. Phase 1 is done (`249c0a8e8`) and is not to be re-implemented.
- No target naming a file that exists can exit 0 having run no spec. A source file nothing covers says
  so, names what would cover it where that is known, and exits non-zero.
- The two edges no module graph can see — a pack's content sources to its goldens, and apack.json to the
  generated tree — are declared routes in scripts/lib/spec-plan.ts, asserted by internal-repo-checks'
  spec-plan.spec.ts, and named in the root CLAUDE.md beside the other spec commands.
- A failing run stops the plan instead of paying for the runs behind it.
- `npm run spec:dry` prints the plan, the specs it would run and what the record says they cost,
  running nothing.
- Checks: npm run typecheck; npm test -w @app/internal-repo-checks; npm run spec-cost:check; npm run chain once
  at the end.
- A final summary: phase -> done/deferred, evidence, the conventional choices made, and the measured
  cost of the collection Phase 4 adds.
- The doc is in docs/archive/goals/, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Check `git diff --cached` and `git status` first: another agent works in this checkout and stages
  files. Commit only what this goal touched.
- Don't push, tag, or open a PR unless the user asks.

Never:
- the standing prohibitions in Constraints: git pushes/tags/PRs, publishing and workflows, real data
  dirs and broad pkill, bare tsc in packages/preload, npm install in the example pack, release
  metadata, widening the typed EARS types, backward-compat shims, loosened assertions.
- edit a recorded cost by hand: packages/*/etc/spec-cost.json moves only through spec-cost:update.
- make the ordinary `npm run spec` pay for a collection pass it does not need — Decision 5 says which
  route pays and why.
- fail a run that legitimately executed nothing: a pool skipping on its own stamp is not a coverage
  hole (Decision 2).
```

## Background (surveyed 2026-09-28 at `56ba5bcad` on `master`)

> Re-surveyed at `af694db4f`. §1 is **closed** and kept as the case Phase 1 was written from; §2 and §3
> still hold, with §2's symptom changed and every number re-measured. What moved besides Phase 1 is the lint
> gate, which now reads `packages/**`, and `spec-cost.json`, which is now maintained as a sample (§3).

[`goal-spec-follows-the-graph.md`](goal-spec-follows-the-graph.md) made `npm run spec` route a
source file through the module graph: one root `vitest related` over every host project, so editing
`@apackdev/sdk` runs the 104 specs that cover it rather than the one package it lives in.
[`goal-pack-test-config.md`](goal-pack-test-config.md) closed the pack side, so a pack's own
source walks the pack's graph instead of running its whole 89-spec suite. `scripts/lib/spec-plan.ts` is the
routing as data and `packages/internal-repo-checks/tests/spec-plan.spec.ts` asserts it in 33 cases.

What is left is the honesty of the answer. Three things, all reproducible at this commit.

### 1. An empty answer is reported as a pass — **closed by Phase 1 (`249c0a8e8`)**

What it was:

```
$ npm run spec -- packages/renderer/src/main.ts
→ every spec covering packages/renderer/src/main.ts
No test files found, exiting with code 0
$ echo $?
0
```

What it is, re-run at `af694db4f`:

```
$ npm run spec -- packages/renderer/src/main.ts
→ every spec covering packages/renderer/src/main.ts
No spec covers packages/renderer/src/main.ts — nothing ran, so nothing passed.
$ echo $?
3
```

The rest of this section is the evidence Phase 1 was written from, kept because §2 and §3 still rest on it.

`vitest related` exits 0 when the graph reaches no spec, and `scripts/spec.ts:84` reads a run's status as the
whole verdict. So "nothing covers this file" and "everything that covers this file passed" are the same
output and the same exit code — which is the defect the archived goal's own Background called *confidently
wrong*, in the one shape its fix did not cover.

It is not one file. Collected through vitest's node API against the root config (counts are the specs
`related` would run):

| Source file | Specs covering it | re-measured `af694db4f` |
|---|---|---|
| `packages/renderer/src/main.ts` | **0** | **0** |
| `packages/api/src/server.ts` | **0** | **0** |
| `packages/main/src/index.ts` | **0** | **0** |
| `packages/renderer/src/views/settings/surface.ts` | **0** | **0** |
| `packages/apack-ui/src/design/button.ts` | **0** | **0** |
| `packages/main/src/app-context.ts` | 2 | 2 |
| `packages/apack-host/src/services/index.ts` | 16 | 15 |
| `packages/apack-sdk/src/fe/settings.ts` | 19 | 19 |

Five of eight sampled files — composition roots and entry modules, which is where an uncovered edit is most
likely and least expected — answered 0 and exited 0. **They still answer 0**, which is the point worth
keeping: Phase 1 did not give them coverage, it stopped them being reported as covered. The same five now
exit 3.

The router already refuses to pass quietly for a *name* that matches nothing (`unmatched`, exiting 1, and
`spec-plan.spec.ts`' case *"reports a target that matches nothing instead of passing quietly"*). The same
claim is not made for a file that exists and nothing covers.

### 2. A content source is told nothing covers it, and something does

Re-run at `af694db4f`, after Phase 1:

```
$ npm run spec -- packages/default-setup/src/content/actions/claude-code/answer-question.ts
→ @app/default-setup: every spec covering src/content/actions/claude-code/answer-question.ts
No spec covers packages/default-setup/src/content/actions/claude-code/answer-question.ts — nothing ran, so nothing passed.
$ echo $?
3
```

**That sentence is false.** Phase 1 was right to stop calling this a pass and has now put the router's name
to a claim about coverage that is wrong, rather than to a silence that was merely unhelpful — the exit code
is honest about the run and the words are not. It read, before Phase 1:

```
→ @app/default-setup: every spec covering src/content/actions/claude-code/answer-question.ts
No test files found, exiting with code 0     # $? = 0
```

Its sibling has the opposite shape and is untouched by Phase 1, because `.json` carries no coverage claim
(Decision 2, correctly — it is what keeps a doc target honest):

```
$ npm run spec -- packages/default-setup/apack.json
→ @app/default-setup: every spec covering apack.json
$ echo $?
0
```

So one edge asserts something untrue and the other still passes quietly, and Phase 2 is what closes both.
The specs that do cover the content file are
`packages/default-setup/tests/content/content-parity.spec.ts` and `tests/content/compiled-bodies.spec.ts`, which read
`dist/*.content.json` — so the edge is `src` → `apack build` → compiled content → golden, a build edge of exactly
the shape the archived goal closed for the `dist` seam, and nothing routes it. That goal recorded it, under
*"What the graph still cannot see"*, along with `apack.json` → codegen → specs, which has the same shape: the
generated tree is imported by specs, so a *regenerated* tree is covered, while editing the manifest alone
reaches nothing.

It was recorded in the right words in the wrong place. `docs/goals/README.md` says an archived doc *"records
the code as it was … read it as history"*, and that for an invariant *"prose in an archived doc is not [a
guard], because the archive describes the past"*. Two known holes in the current router live only there.

### 3. The cost and the tier are recorded artifacts the router does not read

Both exist and both are gated. `scripts/lib/chain-steps.ts` declares a tier per chain step and
`npm run check:tiers` fails a tier-1 or tier-2 step that can reach the app. `packages/<pkg>/etc/spec-cost.json`
records a measured millisecond count per spec file, written by `spec-cost:update` and checked by
`spec-cost:check`. `scripts/lib/spec-plan.ts` imports neither — `unit-suites.ts` and `workspace-deps.ts` are
its only inputs, and the word "tier" appears in it twice, both times in prose.

What the record holds, re-summed from the twelve per-package files at `af694db4f` (every `measuredAt`
2026-09-28):

| Suite | Specs | Recorded file-time | of which the integration half |
|---|---|---|---|
| `apack-cli` | 56 | 182.9s | 167.9s |
| `internal-repo-checks` | 30 | 43.1s | 34.2s |
| `internal-publish-checks` | 9 | 32.6s | 30.6s |
| `apack-host` | 79 | 21.7s | — |
| `default-setup` | 94 | 13.4s | — |
| `apack-sdk` | 59 | 13.4s | — |
| `api` | 15 | 5.7s | — |
| `apack-ears` | 9 | 2.6s | — |
| `main`, `renderer`, `apack-ui`, `apack-testing` | 17 | 0.5s | — |
| **total** | **368** | **315.9s** | 232.7s |

369 spec files, of which 368 carry a cost and one is recorded as skipped (`default-setup`). The survey three
days earlier read 354 and 246.9s, so the body of this record grew 28% in three days while the answer it
supports — which half a spec runs in — did not move.

**And the record is now a *sample*, which Phase 4 has to know.** Since the survey it has gained hysteresis
(`moved`: a measurement is recorded only when it would place the spec differently or is a large move), a
contention refusal, and an `--all` that rewrites every row only against a drifted body. The root `CLAUDE.md`
carries the doctrine under *"There is a third kind, and it is the one that misbehaves: a sample"*. The
consequence for a prediction is direct: **a recorded cost is deliberately allowed to sit up to `DRIFT_SHARE`
(15%) from the truth**, and a correlated drift under `SETTLED_FRACTION` (35%) moves no individual row at all.
A predicted total is therefore a band, not a number, and nothing in the chain re-measures it — only a human
running `spec-cost:update --all`.

The record covers the answers the router gives. Re-measured at `af694db4f`: the same target collects **108
files, every one of them priced**, summing to 41.9s of file-time, and the run takes 20.8s of wall (`Duration
19.17s`, 1133 tests). So a prediction is available and has to be stated as file-time with the ratio said out
loud.

**The ratio is not a constant, and that is the finding.** It was 36.0s → 23.3s at the survey (1.55:1) and is
41.9s → 20.8s three days later (2.18:1) — a 40% move, on the same target, from specs being added to covering
suites and from the record's own hysteresis. Reporting the sum as a wall-time promise would be wrong by half;
reporting a wall range from a measured ratio would be wrong by a third within a week.

Collecting the answer without running it is cheap, through `createVitest({ related })` and
`getRelevantTestSpecifications()`:

| Target | Specs | Collection | re-measured `af694db4f` |
|---|---|---|---|
| `apack-sdk/src/types/sdk-entities.ts` | 104 → **108** | 5.7s cold, 1.7s warm | 2.5s first in the process |
| `apack-ears/src/query.ts` | 146 → **150** | 4.6s | 1.6s |
| `main/src/app-context.ts` | 2 | 1.8s | 1.6s |
| `renderer/src/main.ts` | 0 | 2.6s | 1.6s |

**Collection cost is flat in the size of the answer** — it is the eleven project configs being loaded, not the
graph being walked — and the second measurement makes that sharper than the first: **1.6s for 0 specs and 1.6s
for 150**, with only the first target in a process paying 2.5s. That is 8% of the 20.8s root run and most of a
one-spec run, which is Decision 5.

### Already closed, recorded so nobody re-chases it

Two items from the review that produced this doc are fixed at this commit, and a reader of that review would
otherwise go looking:

- **`vitest related` crashing in `@app/default-setup`** (`Failed to parse source for import analysis …
  Install @vitejs/plugin-vue`) is gone: `definePackTestConfig` (`@apackdev/testing/vitest`) stubs a pack's `.vue`
  files, so the walk no longer stops at the first SFC. That was
  [`goal-pack-test-config.md`](goal-pack-test-config.md).
- **Two `spec` runs racing each other's package build** is gone, and this one was verified rather than read:
  with `@apackdev/ears`' stamp cleared, two `npm run packages:ensure` started 0.3s apart both exit 0. The second
  waits on the lock, re-checks once it holds it, and returns without a duplicate build — `BuildIntent`, whose
  `freshness` arm is what `ensurePackagesBuilt` sets on the builds it spawns
  (`packages/apack-host/src/build/packages-built.ts:777,856,966`). What used to fail here was a second reader
  finding the same units stale and losing the lock; it now waits for the build it would have duplicated.

## Decisions

1. **A run that executed no spec is not a pass.** *(Implemented, `249c0a8e8`. The codes are as written; the
   implementation added a fourth verdict, `no count`, for a run whose reporter never wrote a file — it exits 3
   with the count unknown rather than assumed zero, since "the reporter stopped being called" is the way this
   check would go quiet. `exitCodeFor` and `verdictOf` in `spec-plan.ts` are where both live.)* `npm run spec` exits non-zero and says which target
   produced no answer. Three exit codes, documented in `scripts/spec.ts`' header because an agent reads
   them: **1** a spec failed, **2** a name was wide enough to be a search and was listed instead of run
   (already shipped), **3** a target that exists is covered by no spec. Distinct codes, because the three
   need different next moves and only one of them is a bug in the code under test.

   **`--passWithNoTests=false` already does half of this**, measured: `npx vitest related --run
   packages/renderer/src/main.ts --passWithNoTests=false` exits 1 where the same run without it exits 0. That
   is the fallback if the reporter below turns out awkward — one flag, and the pass stops being a pass. It is
   not the choice, because it fails without saying why and collapses into exit 1, and because Phase 4 needs the
   count anyway to check its prediction against what ran.

2. **Emptiness is decided from the run's own report, not by collecting first.** *(Implemented, `249c0a8e8`:
   `Run.claimsCoverageOf`, `scripts/lib/spec-count-reporter.ts`. The extension test holds — a `.md` target
   exits 0 and the label now reads "the specs that import …, if any". Its cost is that `apack.json` carries
   no claim either, which Background §2 records and Phase 2 owns.)* The run already knows what it
   ran; asking a second process would double the ~2s collection on every source-file target to learn
   something the first process is about to tell us. So the `related` and `--changed` runs write a JSON
   reporter to a temp file beside the human output, and `spec.ts` reads the file count back.

   **Only a run that carries a coverage claim is judged this way, and only over a file a spec could cover.**
   A run that legitimately executes nothing is not a hole: `test:unit:pack` skipping on its own stamp, and a
   filtered run whose `-t` pattern matched no case, both report zero and both are correct. The claim belongs to
   the route, so it is a field on `Run`, set by the two `related` routes and the `--changed` route and by
   nothing else.

   **And the target has to be code.** Today a `.md` takes the source-file route: `npm run spec --
   docs/goals/README.md` prints *"every spec covering docs/goals/README.md"* and exits 0, and a change set of
   nothing but a doc plans the same empty root `--changed` run. Failing those would contradict the first entry
   in the root `CLAUDE.md`'s list of time-wasters — *running anything at all after a comment, a doc or a
   CLAUDE.md edit* — which is the one most often ignored. So the claim is made for a target with a source
   extension, and the `--changed` route claims only over the subset of the change set that has one: an empty
   subset is not a hole, it exits 0 and says nothing changed that a spec could cover. A doc target keeps
   today's behaviour, and the label stops claiming coverage it was never going to have.

3. **The two edges no module graph can see are declared routes, reported by default and run under `--full`.**
   This is the mechanism `packSuiteNote`/`packSuiteRun` already is, reused rather than reinvented, and it
   inherits that decision's shape for the same reason: the note costs nothing and the run costs a build.
   - `packages/<pack>/src/content/**` → that pack's `tests/content/`, through `npm run build -w <pack>` — the
     pack's own build, which is what the root `compile` wraps; there is no `compile -w <pack>`, and the
     `packages:ensure` and `facade:check` that `compile` adds around it are already the plan's own first run
     and a separate artifact check.
   - `packages/<pack>/apack.json` → that pack's whole suite, through the same build, codegen rewriting
     `src/__generated__/` being a change to what every spec in the pack imports.

   The routes are data in `spec-plan.ts` and derived from the pack's own layout, not a hand-written list of
   two packs: `spec-plan.spec.ts` partitions the packs under `packages/` the way it already partitions those
   that reach a pack suite, so a third pack cannot arrive unrouted.

4. **A failing run stops the plan.** `spec.ts` runs every run in the plan and counts failures, so a 1s
   tier-1 failure still pays the 18s pack suite behind it, and a named `tests/e2e` spec behind a failed root
   run costs 26s to tell you nothing. A failure is the answer; the runs behind it are a bill for information
   already obtained. `--no-bail` keeps the old behaviour for the case where you want every failure at once.

5. **A prediction is opt-in, as `npm run spec:dry`, and the ordinary run pays nothing for it.** Collection is
   flat at ~2s: worth it against a 23.3s root run, not against a 3s one, and the router cannot know which it
   has until it has paid. Rather than guess, the prediction is its own command — `<action>:<variant>`, as
   `spec:full` already is — printing the plan, the spec paths and their recorded cost, and running nothing.
   That also makes it the command to reach for when the question is *"what would this run?"*, which today
   takes running it.

6. **No tier ordering.** The review that produced this doc asked for tier-ordered escalation, and measuring
   the plans retired it: `planTargets` already emits `packages:ensure`, then the graph runs, then named specs
   grouped by package, then the `--full` pack suite, which is cheap-first for every plan the router can
   produce. The cost was never the order, it was that nothing stopped — which is Decision 4, and is three
   lines rather than a tier model for a second scheduler. Giving a spec a tier by inference is the thing not
   to do: a tier is declared (`chain-steps.ts`) and `check:tiers` is what makes it mean anything.

   **What a tier is still good for is a label.** `spec:dry` prints the declared tier of the chain step a run
   corresponds to where one exists — `packages:ensure` is tier 2, `test:unit:pack` is **tier 1** (this decision
   said tier 2, and was wrong when it was written: `POOL_STEPS` in `chain-steps.ts` has given both unit pools
   `tier: 1` since before the survey — read the file, which is the decision's own instruction), a `tests/e2e`
   run is the `test` step's tier 3 — and prints nothing where none does, a root `related` run spanning tier 1 and the
   tier-2 specs that read the built packages. Read from `chain-steps.ts`, never computed from what a run looks
   like, so the label cannot disagree with `check:tiers`. Derived, not mapped: a `Run`'s command already *is*
   the npm script whose name the chain step carries (`packages:ensure`, `test:unit:pack`, `test`), so the label
   is a lookup on that name. Writing a second table beside `chain-steps.ts` is the trap here — *a list and its
   type are one declaration*, and this is the same mistake in another shape. That is the half of the original request worth
   keeping: knowing that the next run launches the app is worth a word, and it costs no scheduler.

7. **A predicted cost is stated as file-time, and the wall is not predicted at all.** 36.0s of recorded
   file-time ran in 23.3s of wall at the survey; the sum is what the record holds and the wall is what the
   user waits. Printing the sum alone would overstate every answer by about half, and calibrating a ratio per
   suite is a second recorded artifact to keep current.

   *(Re-measured: the same target is 41.9s → 20.8s three days later, a ratio of 2.18:1 against 1.55:1. **The
   example sentence this decision gave — "104 specs, 36.0s of recorded file-time — about 20-25s of wall across
   workers" — is struck**: a wall range derived from one measured ratio was wrong by a third inside a week, and
   printing it would make the prediction less true than printing nothing. Print the spec count and the summed
   file-time, and say that it is file-time summed across workers rather than time to wait. The refusal to
   calibrate a per-suite ratio stands and is the stronger for the re-measurement.)*

## Phases

### Phase 1 — a zero answer is not a pass — **DONE (`249c0a8e8`, `46268f236`, `fc96b83bd`, `a4d4abca9`)**

> Re-checked at `af694db4f`, every item of the Done-when below: `renderer/src/main.ts` exits 3 with the
> message; `apack-sdk/src/fe/settings.ts` passes at 0; `docs/goals/README.md` exits 0 and no longer claims
> coverage; a `-t` pattern matching no case exits 0. Kept as written, as the record of what was asked for.

- Add the coverage claim to `Run` in `scripts/lib/spec-plan.ts` **on Decision 2's terms, which are the whole
  of the correctness here**: the two `related` routes and `--changed`, *and only over a target with a source
  extension* — the `--changed` route over the coverable subset of the change set, an empty subset carrying no
  claim. Read the Decision rather than this line: a summary of it that keeps the routes and drops the
  extension test makes `npm run spec -- docs/goals/README.md` and a doc-only change set fail, which this
  phase's own Done-when forbids.
- Add the pure verdict function beside it — given a run and the number of spec files it executed, one of
  `pass`, `fail`, `covered nothing` — so the decision is in the tested half of the split, as the file's
  header requires.
- `scripts/spec.ts`: give the claiming runs a JSON reporter to a temp file alongside the default reporter,
  read the executed file count back, and exit 3 when a claiming run executed none. The message names the
  target and, for a target Phase 2 routes, the command that does cover it.
- Document the three exit codes in `scripts/spec.ts`' header and in the root `CLAUDE.md` beside the spec
  commands.

**Done when:** `npm run spec -- packages/renderer/src/main.ts` exits 3 and says no spec covers it;
`npm run spec -- packages/apack-sdk/src/fe/settings.ts` still passes and exits 0; `npm run spec --
docs/goals/README.md` exits 0 and no longer claims to run every spec covering it; a change set of nothing but
a doc exits 0; a `-t` pattern matching no case still exits 0 (it is a filter, not a claim). New cases in
`packages/internal-repo-checks/tests/spec-plan.spec.ts` assert which routes carry the claim and the verdict for each
of the three outcomes. Mutation: dropping the claim from the root route makes the empty case pass again, and
the new case fails.

### Phase 2 — the edges no module graph can see are routes, not prose

- Implement the two routes of Decision 3 in `spec-plan.ts`, derived from the pack's layout.
- An apply-source or `apack.json` target prints what covers it and how (the note), and under `--full` runs it:
  the pack's `build` then the content specs, or the pack's suite for a manifest change.
- Delete the corresponding sentences from `packages/default-setup/tests/content/CLAUDE.md` and the root
  `CLAUDE.md` where they describe the gap as permanent, and say what the router now does instead.

**Done when:** `npm run spec -- packages/default-setup/src/content/actions/claude-code/answer-question.ts`
names `tests/content/` and exits non-zero — it exits 3 today with a sentence that is false, so the test is the
message, not the code; `npm run spec -- packages/default-setup/apack.json` names that pack's suite instead
of exiting 0 having run nothing; `npm run spec:full -- <that file>`
compiles the pack and runs the content specs, and the golden failure a deliberately edited content body produces is
the run's failure. `spec-plan.spec.ts` partitions every pack under `packages/` into routed and unroutable.
Mutation: removing the content route leaves the file answering zero specs, and the partition case fails.

### Phase 3 — a failure stops the plan

- `scripts/spec.ts`: stop at the first failing run, reporting which runs were not reached and why, with
  `--no-bail` for the old behaviour (consumed like `--full`, first position only, so *everything from the
  first `-` is vitest's* stays exact).
- **And do not start a run whose answer is already known.** A `--changed` plan whose coverable subset is
  empty — a doc-only change set — currently spawns `packages:ensure` and a root vitest to be told *"No test
  files found"*, 3.4s measured, under a label claiming to run the specs the changes affect. Decision 2 asked
  for the sentence and Phase 1 shipped the exit code without it. `planChanged` knows the subset is empty
  before anything runs, so the plan is no runs and one line: nothing changed that a spec could cover. The
  same question as the bail above — the run is a bill for an answer already in hand — which is why it is
  here rather than in a phase of its own.

**Done when:** a plan with a deliberately failed first run exits 1 without running the rest, and names them;
`--no-bail` runs all of them; a doc-only change set runs no vitest at all, says nothing changed that a spec
could cover, and exits 0 in well under the 3.4s it costs today. Measured and recorded in the phase: what a failed root run used to cost
against what it costs now, on the `--full` plan that carries the pack suite. A case in `spec-plan.spec.ts`
for the flag's position, beside the `--full` one.

### Phase 4 — the plan says what it would cost

- `npm run spec:dry` (`scripts/spec.ts --dry`, script in the root `package.json` beside `spec:full`): collect
  through vitest's node API for each `related`/`--changed` route, print each run, the spec paths it would run
  and the recorded cost of those paths, and run nothing.
- Read the per-package records through `scripts/lib/spec-cost.ts`, the module the check and the command
  already share, so a third reader cannot disagree with them. A spec with no recorded cost is counted and
  named, not silently treated as free.
- Print file-time, said to be file-time summed across workers, and the declared tier of a run that has one
  (Decision 6 — read the tier from `chain-steps.ts`; `test:unit:pack` is tier 1). **No wall-time estimate**
  (Decision 7 as re-measured).
- **Say the prediction is a band, because its input is a sample.** The record is maintained with hysteresis
  and a drift gate (Background §3), so a row may sit up to `DRIFT_SHARE` from the truth and a correlated
  drift under `SETTLED_FRACTION` moves no row at all. Print the record's own `measuredAt` — the oldest across
  the suites the plan touches — beside the total, so a prediction built on a month-old sample says so. Do not
  invent a second freshness signal: `measuredAt` is the one the record already keeps, and a computed
  confidence would be a third reader of the same numbers.
- Nothing here re-measures. `spec:dry` reads the record and runs no spec, so a stale record makes the
  prediction stale and not wrong — the fix for that is `spec-cost:update --all`, which is a separate,
  deliberate act.

**Done when:** `npm run spec:dry -- packages/apack-sdk/src/types/sdk-entities.ts` prints that file's spec
paths and their summed cost in under 8s cold, runs no test, and exits 0, **and the count equals what the
ordinary run executes** — which is the criterion, rather than a number: it was 104 at the survey and 108 at
the re-survey three days later, and every spec added to a covering suite moves it. `npm run spec` with no `--dry` performs no collection — asserted by the plan's shape, and the
phase records its wall time against the pre-phase number to show it did not move. Mutation: a record with a
file removed reports one unpriced spec by name rather than a smaller total.

## Deferred

- **`@apackdev/cli`'s integration half.** 167.9s of its 182.9s, and 53% of the 315.9s the twelve records hold
  between them (132.0s of 144.1s, and the same 53%, at the survey) — the largest single cost in the repo's specs, and not a routing problem: those specs run real
  builds, and whether they can share one is the question. It belongs with
  [`goal-unit-suite-cost.md`](goal-unit-suite-cost.md), whose Phases aim at `default-setup` and `@apackdev/sdk`
  (the `test:unit` halves) and say nothing about the integration half. Recorded here so the number is written
  down where it was measured; the agent implementing this goal must not start it.
- **Tier-aware escalation**, refused with its reasoning in Decision 6 rather than deferred, so it is not
  proposed again without a measurement.

## Constraints

- Commit each phase as it finishes, in logical chunks, no attribution lines; `git diff --cached` and
  `git status` first, and `git commit -- <paths>` naming only that phase's files — another agent commits in
  this checkout. Pushing, tagging and PRs are on request only.
- No publishing, releases or triggered workflows; dry runs only.
- No real data dirs (`~/Library/Application Support/apack*`), no broad `pkill`/`killall`; the app launches
  only with an isolated `APACK_USER_DATA_DIR`.
- No bare `tsc` in `packages/preload`, no `npm install` in the example pack, no version or release metadata.
- The typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- No backward-compat shims: change the signature and migrate every in-repo caller, test, fixture and doc in
  the same change. Stored user data is the exception and moves with a migration.
- Investigate a failing test rather than loosening it; every new route, helper and guard gets a mutation
  check (`docs/goals/README.md`, and the root `CLAUDE.md` on a check that may have looked at nothing).
- Recorded artifacts move only through their `:update` half: `packages/*/etc/spec-cost.json` through
  `spec-cost:update`, never by hand.
- Keep the loop fast: the narrow checks during the work (`npm test -w @app/internal-repo-checks -- spec-plan`, the
  package's `tsc --noEmit`), the chain once at the end of a phase.

## Outcome

Finished 2026-09-28 on `AS/spec-earns-pass`, four commits over the re-survey.

| Phase | | Landed as |
|---|---|---|
| 1 — a zero answer is not a pass | **done** (before this run) | `249c0a8e8` + `46268f236`, `fc96b83bd`, `a4d4abca9` |
| 2 — the build edges are routes | **done** | `155d78d7e` |
| 3 — a failure stops the plan | **done** | `e80049327` |
| 4 — the plan says what it would cost | **done** | `469fdde3f` |

### What each one is worth, measured

| | before | after |
|---|---|---|
| a content source | exit 3, *"No spec covers …"* — false | exit 3, named: `@app/default-setup tests/content` |
| `packages/default-setup/apack.json` | exit 0, nothing run | exit 0, 1 spec run, the suite named beside it |
| `spec:full -- <content source>` | no route | build + 18 specs, 16s; a broken content body fails it |
| a doc-only change set | 3.4s, `packages:ensure` + an empty vitest | **0s**, "nothing changed that a spec could cover" |
| a failing `--full` plan | 23s, 2 runs | 22s, 1 run, the other named (the pack pool is 17s forced; it had skipped on its own stamp) |
| "what would this run?" | run it, 21s | `spec:dry`, **3s**, 108 specs and 41.9s of file-time |
| the ordinary run's own cost | 20.8s | **21s** — the prediction is opt-in and costs it nothing |

### The collection Phase 4 adds

**Nothing, to the ordinary run.** `vitest/node` and the pricing load behind `await import` inside the `--dry`
branch, and `spec-plan.spec.ts` asserts that from the source: a static import of either is the one way it
regresses, and it would regress silently. The run measured 20.8s before the phase and 21s after.

`spec:dry` itself is **3-4s** — about 1.6s per collecting run, flat in the size of the answer, plus process
start. Re-measured at the re-survey: 1.6s for 0 specs and 1.6s for 150, which is the eleven project configs
loading rather than a graph being walked.

### Choices made where the plan left a detail open

- **The edge rides on the run, as `Run.beyond`, rather than a list beside the plan.** The first cut made
  `src/content/**` a route *instead of* the pack `related` walk, and measuring killed it: an apply **helper** is
  imported by specs directly — `_helpers/thread-context.ts` reaches 3 — so replacing the walk threw away a
  precise answer to recommend a build. The walk still runs and carries what it could not see; what the edge
  changes is which sentence an *empty* walk gets, and the note a full one prints.
- **A build edge overrides Decision 2's source-extension test for the coverage claim.** `apack.json` is not
  code, so the extension test withholds the claim and the target exits 0 having run nothing. An edge is that
  claim made directly and about a named spec directory, so it carries one whatever the extension. The
  extension test still decides every other target, which is what keeps a doc honest.
- **`OWN_FLAGS` is a leading *run* of arguments, not first position only.** Two flags had to compose
  (`spec:full -- --no-bail x`), and a list-plus-parser in one declaration is what stops a declared flag
  reaching vitest as a filename — there is a case that walks the list.
- **A non-coverable change set plans zero runs**, rather than a plan carrying a "nothing to do" field. The
  command says the sentence when the plan is empty and the target list was too.
- **`spec:dry` prices three kinds of run, not one.** The phase named the collecting routes; a plan also holds
  named-spec runs (their file list is the target) and whole-suite runs (the suite's record). Without the last
  two, `--full`'s pack suite — the most expensive run a plan produces — contributed nothing and read as free.
  A run that is none of the three says so rather than printing an empty prediction.
- **The apply route runs `tests/content/` whole**, 18 specs, not the 6 goldens at its top level: the directory
  mirrors `src/content/`, so the per-action specs under it are covered by the same edge.
- **One existing case changed rather than being added to.** `planChanged([])` asserted `packages:ensure` plus
  a root run for an empty change set — a shape the command never asks for, since it reports "nothing changed"
  before planning. It now asserts no runs, beside a real change set for the property it was testing.

### What this leaves

- **`@apackdev/cli`'s integration half**, 167.9s of the 315.9s the twelve records hold, is still the largest
  single cost in the repo's specs and is not a routing problem. It belongs with
  [`goal-unit-suite-cost.md`](goal-unit-suite-cost.md), as Deferred said.
- **Nothing automated runs `spec:dry` or `--all`**, so a correlated drift in the record is still found only by
  a human. The prediction says how old its numbers are, which is the most a reader can act on without a
  re-measurement nobody schedules.
