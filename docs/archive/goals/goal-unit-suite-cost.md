> **Closed 2026-10-02 (branch `AS/one-action-cache`) by the condition Phase 2 wrote for itself** — *"If the
> isolation is what costs, say so, record the number, and stop"* — though from a direction nobody expected.
>
> Measured on `@app/default-setup`'s suite, load average 6.56, 95 spec files, 765 tests:
>
> ```
> Duration 15.73s — setup 100.69s, tests 14.17s, transform 1.84s, collect 1.98s
> user 98.67s + sys 16.28s = 115s CPU
> ```
>
> Summed setup is **7.1× the tests' own cost**, as every survey said. **But `setupPackTests` is not what costs
> it.** Timing the call itself across 18 files: **24-56ms**, against ~1.46s of setup per file. Keeping the
> setup file's imports and skipping only the call: setup **25.49s** against **26.34s** over those 18 files — so
> the function this phase was written about is **~3%**, and ~97% is the setup file's **module evaluation**,
> which happens once per file because `isolate: true` gives each file a fresh module graph. That graph is the
> isolation the phase refused to trade (*"sharing a registry or a database between files is not a trade this
> goal makes"*), and deferring the imports into the call would move the work rather than remove it: the
> harness evaluates those modules because the call uses them.
>
> So Phase 2 is closed with its measurement rather than its change, and with it the goal: Phase 4 was done in
> `1b3eb9876`, Phases 1, 3 and 5 collapsed into it on 2026-09-28, and Decisions 2 and 3 were struck with the
> lane machinery they assumed.
>
> **One lever is left unmeasured rather than unpursued**, recorded in
> [`packages/apack-testing/CLAUDE.md`](../../../packages/apack-testing/CLAUDE.md) where the harness lives: the
> harness imports `@apackdev/sdk/build` statically (238ms as a standalone import) for content compilation most
> files never do, but reaches it on every setup through two format-check helpers — so the saving depends on a
> marginal cost inside a worker that was not taken, and is probably well under the standalone number.
>
> Read what follows as history: it names code and a scheduler as they were.

> **Re-verified 2026-09-28 (later the same day). The mechanism this goal analyses no longer exists, and the
> metric it measures in cannot be taken here. Read this block before the Background; it strikes two Decisions
> and collapses three Phases.**
>
> **`APACK_TEST_LANES` appears nowhere in the repo.** `test:unit` runs **two pools, one after the other**,
> handing vitest every file at once so its own longest-first sequencer packs them
> ([`goal-one-job-pool.md`](goal-one-job-pool.md)). The lane machinery this goal is written
> against is gone, and the pooling that replaced it already delivered the 43s this goal set as its target.
>
> - **The base check below failed, and told an implementer to stop.** It asked them to confirm `test:unit`
>   reports "2 lanes" and takes `APACK_TEST_LANES`. Corrected in place, so the next reader is not stopped by a
>   condition that can never hold again.
> - **Decision 2 is moot** — there is no lane count to leave alone — and **Decision 3 is wrong**: wall clock is
>   a makespan over one file list now, not a sum over suites. Vitest packs files across what used to be suite
>   boundaries, so suite time is not the scheduling unit and bounds the wall only loosely. Both struck below.
> - **The lane table is history, and lives in the code that replaced it.** `scripts/test-unit.ts`'s header
>   carries it — `1: 69.8s, 2: 44.3s, 3: 47.7s, 8: 63.1s` — beside the reason it stopped applying: two
>   schedulers with no shared budget. It is not repeated here.
>
> **What survives is Phase 2, and it is intact.** `setupPackTests` is still called at module scope
> (`packages/default-setup/tests/setup.ts:33`), once per test file. That is the whole remaining value. Phases 1,
> 3 and 5 were scaffolding around the old scheduler and are collapsed into one measure-and-close phase.
>
> **The metric changes, because the old one is not obtainable in this repo.** Every number here was taken
> "alone, on an idle machine", and the machine is not idle — this tree is worked by concurrent agents, and both
> re-measures before this one carry an "upper bound, another agent held the repo" caveat. The attempt that
> prompted this block read `default-setup` at **52.9s against the 17.6s recorded hours earlier**: load average
> **44.5 on ten cores**, six foreign `vitest` processes at 117–145% CPU. A uniform 3× inflation is contention,
> and it is not a number anyone can act on.
>
> So the quantity this goal moves is **work** — CPU-seconds (`user` + `sys`) and invocation counts: how many
> times `setupPackTests` runs, and what one call costs. Work is what a change removes; elapsed is what the
> scheduler and the neighbours make of it. **Work can be measured on a loaded box and compared across days;
> elapsed cannot**, which is why this goal has been re-measured three times and moved none. Elapsed stays as a
> reported secondary, quoted only with the load average beside it.
>
> **And the payoff is smaller than the framing suggests, which is worth knowing before starting.** Every full
> chain run on 2026-09-28 put the critical path at 105–125s through `packages:ensure -> compile -> build:app ->
> test:packaged-authoring`, with the unit pools in a lane beside it. **Making the unit suites faster will not
> move a cold chain.** What it moves is the inner loop — `npm run spec` — and the warm chain where the pools
> are the only steps that run.
>
> **One measurement trap, recorded because it caught a reader.** `etc/spec-cost.json` sums per-file durations,
> which is neither metric. By that measure `@apackdev/host` looks largest — 81 specs, 20.1s cumulative — while
> its wall time run alone is third.

> **Written in session** `1d53eb9c-d886-49f8-bc5a-90793d43315e` (Claude Code, 2026-09-25). Resume it with `claude -r 1d53eb9c-d886-49f8-bc5a-90793d43315e`.

```
# Goal: the unit suites cost what they do, not what they wait for

Implement docs/goals/goal-unit-suite-cost.md on AS/test-pipeline, at or after c7517e0da — the base
its Background was measured at. Read Background, Decisions, Phases and
Constraints first. Decisions are final: implement them, don't reopen them or stop to ask.

Before Phase 1, confirm the base: `scripts/test-unit.ts` runs two pools one after the other, and
`packages/default-setup/tests/setup.ts` calls `setupPackTests` at module scope. If the second is no
longer true, stop and say so — it is the item this goal exists to remove. (The lane machinery the
original base named is gone; see the block above.)

Then take the work figures, not the clock: `user` + `sys` for a suite run, and how many times
`setupPackTests` is called. Those hold on a loaded machine. If you want an elapsed number too, check
`uptime` and `ps` first and quote the load beside it — a contended run has already produced a 3x error
here, which is larger than anything this goal can save.

Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code: change signatures, move modules, migrate every in-repo
caller, test and doc in the same change, and fix forward.

Finished when:
- Phase 1 measures, Phase 2 acts or closes, and Phase 3 runs only if Phase 1 names something in `sdk`.
  Phase 4 is done; Phase 5 is folded into Phase 1. Each that runs meets its "Done when".
- The work `default-setup`'s suite does has measurably dropped — CPU-seconds and `setupPackTests`
  invocations, both recorded before and after — or Phase 2 is closed with the measurement showing the
  cost is the isolation. A number that did not move is a result.
- No elapsed figure is quoted without the load average it was taken under. `test:unit` is already
  inside the 43s the original target named, delivered by pooling rather than by this goal.
- No test is deleted or loosened to make a number. Coverage is not the lever here; cost is.
- Every test that hits vitest's 5s default under load has a timeout sized to what it does, and the
  size is justified by a measurement rather than raised until it passes.
- npm run chain passes once at the end; npm run typecheck; npm run lint:check.
- The Outcome records: the work figures before and after, what each phase moved, what it cost to move it,
  and the load any elapsed number was taken under.

Commit as you go:
- Commit each phase when its "Done when" holds and its suite is green — not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Check `git diff --cached` first: something outside the session stages files.
- Don't push, tag, or open a PR unless the user asks.

Never:
- Constraints' standing rules are hard stops, not advice: no push/tag/PR, no publish or release, no
  real data dir, no broad pkill, no bare tsc on preload, no version metadata, and no change to the
  typed EARS types to make a call site compile.
- delete or skip a test to make a suite faster; that is the one lever this goal refuses.
- raise a timeout past what a measurement justifies, or raise one to hide a genuinely slow test.
- measure on a machine running anything else, including another agent's suite.
```

## Background (2026-09-25, at c7517e0da on AS/test-pipeline)

`goal-test-cleanup.md` Phase 2 made `test:unit` run its suites concurrently and set a target of 25s. It
reached 43s and stopped. This goal is the part that was left.

### Where the time is

> **Re-measured 2026-09-28**, the four largest, alone and warm, on the same machine. Not idle — another agent
> held the repo — so read these as upper bounds; the ordering is what the aim rests on, and contention does not
> reorder them.
>
> | Suite | Alone (2026-09-25) | Alone (2026-09-28) | Tests |
> |---|---|---|---|
> | `@app/default-setup` | 15.9s | **17.6s** | 727 |
> | `@apackdev/sdk` | 12.3s | **12.9s** | 545 |
> | `@apackdev/host` | 8.9s | 8.6s | 747 |
> | `@apackdev/cli` (fast half) | 5.3s | 4.6s | 396 |
>
> The two targets grew and the others did not, so their share of the sum has risen rather than fallen. The item
> Phase 2 names grew with them: `default-setup` reports **`setup 116.4s` against `tests 15.9s`** — the per-file
> `setupPackTests`, summed across workers, now about seven times the cost of the tests it sets up. The seven
> smaller suites were not re-measured; at 13.2s combined below, they do not move the aim.

> **Re-measured 2026-09-25** at `07afe0bc2`, idle, same machine. The table below it is the original survey
> at `c7517e0da`, kept because the Decisions were taken against it. Eleven suites now rather than eight:
> `@app/internal-repo-checks`, `@apackdev/testing` and `@apackdev/ui` were created by later goals, and `@apackdev/cli`
> gave twenty specs away to them.
>
> | Suite | Alone | Tests |
> |---|---|---|
> | `@app/default-setup` | **15.9s** | 718 |
> | `@apackdev/sdk` | **12.3s** | 539 |
> | `@apackdev/host` | 8.9s | 680 |
> | `@apackdev/cli` (fast half) | 5.3s | 319 |
> | `@app/api` | 3.1s | 70 |
> | `@apackdev/ears` | 3.0s | 116 |
> | `@app/renderer` | 2.5s | 33 |
> | `@app/internal-repo-checks` | 2.1s | 177 |
> | `@apackdev/ui` | 0.9s | 2 |
> | `@app/main` | 0.8s | 23 |
> | `@apackdev/testing` | 0.8s | 19 |
> | **Sum** | **55.5s** | **2,696** |
>
> **The diagnosis is unchanged: `default-setup` and `sdk` are 51% of it**, exactly as before. The sum rose
> from 52.6s only because there are three more suites; the two targets did not move (14.7 → 15.9s,
> 12.0 → 12.3s), and `@apackdev/cli`'s fast half fell 8.9 → 5.3s by giving specs away rather than by getting
> faster. **`npm run test:unit` is 37.6–40.8s**, already under this goal's 43s target — delivered by
> `goal-one-job-pool.md`'s pooling, not by this goal. What is left here is the work inside the two largest
> suites — no arrangement of the scheduler removes it, and no scheduler is left to arrange.

Per suite, run alone, warm, on a 10-core machine:

| Suite | Alone | Tests |
|---|---|---|
| `@app/default-setup` | **14.7s** | 720 |
| `@apackdev/sdk` | **12.0s** | 539 |
| `@apackdev/cli` (fast half) | 8.9s | 475 |
| `@apackdev/host` | 8.1s | 684 |
| `@app/api` | 3.0s | 70 |
| `@apackdev/ears` | 2.9s | 116 |
| `@app/renderer` | 2.3s | 33 |
| `@app/main` | 0.7s | 19 |
| **Sum** | **52.6s** | 2,656 |

`default-setup` and `sdk` are **51%** of it.

### Why lanes cannot close the gap — **superseded 2026-09-28**

The table that stood here measured `test:unit` running suites two at a time, and that is not how it runs.
`scripts/test-unit.ts` carries the numbers now (`1: 69.8s, 2: 44.3s, 3: 47.7s, 8: 63.1s`) beside the reason
they stopped applying: two schedulers with no shared budget, so a third lane oversubscribed *inside* a suite
rather than filling idle cores. Vitest's own sequencer takes every project's files as one list and sorts it
longest-first, which is the greedy makespan approximation — so the pooling that replaced this closed the gap
the section was written to explain, and reached the 43s target on the way.

What the section got right is worth keeping: **the margins were thin across suites**, and the failures at
three and eight lanes were tests hitting vitest's 5s default rather than a race. Phase 4 fixed that at the
tier, and `suite-timeouts.spec.ts` now refuses a config that declares no budget at all.

### The one cost already identified

`packages/default-setup/tests/setup.ts:33` calls `setupPackTests({ contentRuntime, registration })` at
module scope, so it runs once per test file. Measured earlier in `goal-test-tiers.md`: ~1.16s × 84 files,
which a run reports as `setup 97.3s` — that figure is the sum across workers against a 15.4s wall, which
is why it reads as alarming and is not. It is still the largest single identified item inside the largest
suite. Nothing equivalent has been measured for `@apackdev/sdk`.

## Decisions

Final.

1. **The target is a measured floor, not 25s.** `goal-test-cleanup.md`'s 25s was set before anyone had
   measured what the suites cost. What this goal owes is a smaller number with the reason attached, and the
   floor stated — in work now, not in seconds. If the floor turns out to be "the isolation costs this much",
   that is the answer, and it is a result.
2. ~~**Lane count is not a lever and is not to be revisited.**~~ **Struck 2026-09-28: there are no lanes.**
   `test:unit` runs two pools, and inside each one vitest schedules every file itself. The decision was right
   about its own question and the question is gone.
3. ~~**Suite time is the number that matters.**~~ **Struck and replaced: work is the number that matters.**
   Wall clock is a makespan over one file list now, so a suite's total is not the scheduling unit and bounds
   the wall only loosely — and, measured alone on an idle machine, it is a figure this repo cannot produce
   while other agents run. Count **CPU-seconds (`user` + `sys`) and invocations** instead: a phase that lowers
   work has removed something, where one that lowers elapsed may only have been measured at a quieter moment.
   Work is comparable across days and across load; elapsed is comparable with nothing.
4. **Cost, never coverage.** No test is deleted, skipped or loosened to make a number. `goal-test-cleanup.md`
   already removed what did not earn its place; what is left is paid for.
5. **A timeout is sized from a measurement.** Phase 4 sizes each thin margin at about four times what the
   test costs alone, the same rule `chain-steps.ts` uses for step budgets. Raising one until it passes is
   the failure mode, not the fix.
6. **Measure work under any load; measure elapsed only when the box is quiet, and say what quiet meant.**
   `uptime` and `ps` before an elapsed number, and the load average quoted beside it. The old form of this
   decision — measure alone, then together, and call the difference the contention tax — belonged to the lane
   model and went with it.

## Phases

### Phase 1 — Measure the work, and name the largest item

Phases 1, 3 and 5 were three passes of the same activity, sized for a scheduler that is gone. They are one
phase now: measure before, measure after, and let the measurement close what it closes.

- For `@app/default-setup` and `@apackdev/sdk`: **CPU-seconds (`user` + `sys`) for the suite**, and the count
  and unit cost of `setupPackTests`. Per-file totals if they help, by the recipe in `goal-cli-suite-spawns.md`
  Decision 6 — but the summed `setup` figure a run prints is across workers and is not wall clock, which is
  why it reads as alarming and is not.
- An elapsed number is optional and takes the load average with it.
- No changes. The output is what Phase 2 is sized against and compared to afterwards.

**Done when:** both suites have a work figure, the largest item in each is named with what one call costs,
and the same figures are taken again after Phase 2 so the delta is the phase's result.

### Phase 2 — default-setup's per-file harness setup — **the goal**

`setupPackTests` runs once per test file (`tests/setup.ts:33`), and the summed setup figure has been several
times the tests' own cost at every measurement. It is the one item every survey of this goal has agreed on,
and the only one that survived the scheduler changing underneath it.

- Establish what it does per file that could be done once per worker, and do that much.
- Keep the isolation it provides: sharing a registry or a database between files is not a trade this goal
  makes. **If the isolation is what costs, say so, record the number, and stop** — that closes the goal.

**Done when:** `default-setup`'s work has dropped with its test count unchanged, or the phase is closed with
the measurement showing the cost is the isolation. **Mutation:** a test that mutates the registry still
cannot see another file's changes.

### Phase 3 — `@apackdev/sdk`'s largest item — **only if Phase 1 names one**

Nothing equivalent to `setupPackTests` has ever been measured for `sdk`; it has been assumed to have one
because it is second-largest. If Phase 1 finds no single item worth removing, close this with that sentence
rather than going looking for work to do.

**Done when:** sdk's work has dropped with its test count unchanged, or the phase is closed by Phase 1's
measurement naming nothing.

### Phase 4 — Size the thin timeouts — **done 2026-09-25 (`1b3eb9876`), by a different mechanism**

This phase was right, and it was right about the specific test. It sat unactioned, and on 2026-09-25 the
prediction below came true in a chain run: `@apackdev/sdk`'s "generated sends compile" — 1.3s alone — took
**5.8s under three lanes** and failed with *"Test timed out in 5000ms"*. A 4.5× multiplier against a 5s
default, in a suite whose tier allows 15s.

**It was fixed at the tier rather than per test**, which is the opposite of what Decision 5 below asks and
is the better answer. Five of the thirteen configs declared no timeout at all — `apack-ears`,
`apack-host`, `apack-sdk`, `main`, `renderer` — so every spec in them ran on vitest's 5s/10s defaults,
*tighter* than their tier. The budget belongs to the size (`SIZE_MS`, `scripts/lib/unit-suites.ts`; a three-valued `tier` when this was written), not to each test that trips
over a default, so all five now declare it, and `suite-timeouts.spec.ts` gained the half it was missing: it
checked a ceiling and left silence as an unrecorded third state, which was the state that bit. It now
requires each config to declare its tier's budget. The next test in line was a 4.1s lock test in
`@apackdev/host`, at 82% of a budget it never chose.

So **Decision 5 is superseded for this case**: a per-test timeout is for a test that genuinely needs longer
than its tier, and `TIMEOUT_EXCEPTIONS` is where those are recorded. It is not the fix for a suite running
on a default nobody chose.

~~- Every test that hits the 5s default under two or three lanes gets a timeout sized per Decision 5.~~
~~- This is not a speed change. It is what makes a lane measurement mean anything.~~

**Done when:** three lanes runs green five times in a row. **Mutation:** dropping one sized timeout back
to the default fails that run — done, in the other direction: dropping `hookTimeout` from `@apackdev/sdk`'s
config fails `suite-timeouts.spec.ts` by name.

**The five-run bar is met.** Five `chain -- --all` runs, three lanes with every step forced, on a clean and
fully committed tree: **192.5s, 192.1s, 185.0s, 173.0s, 201.7s — all green.** An earlier attempt at the same
five was abandoned after two because the next goal began editing spec files while they were in flight, and a
flake measurement taken over a tree being edited is evidence about nothing; these five were run on a quiet
one.

### Phase 5 — Re-measure, and state the floor — **folded into Phase 1**

Measuring before and after is one activity, not two phases with a gap between them where the tree moves.
Phase 1 owns both passes and the floor it reports. The lane half of this phase went with the lanes.

## Deferred

- **Caching `test:unit` per package.** `goal-test-tiers.md` Phase 5 owns it, and it is a different
  question: this goal makes a run cheaper, that one skips it.
- **The `@apackdev/cli` integration half (44s).** It spawns by design; `goal-cli-suite-spawns.md` has it.
- **`test:packaged-authoring`'s npm installs**, tracked in `goal-test-tiers.md`.

## Constraints

The repo's standing rules (root `CLAUDE.md`) apply:

- commit each phase as it finishes, no attribution lines, `git commit -- <paths>`; check
  `git diff --cached` first. Pushing, tagging and PRs are on request.
- no publishing, releases or triggered workflows; no real data dirs, no broad pkill.
- preload, example pack and release metadata rules; typed EARS types are change-controlled.
- published packages: `api:update` after export changes, with `etc/` committed.
- investigate a failing test before touching it; a test that fails while being made faster has found
  something.
- **Measure work, and it holds under load; measure elapsed, and the load decides the number.** `git status`,
  `uptime` and `ps` before taking any elapsed figure, and quote the load beside it. Two errors are on record:
  249s for what is 182.6s idle (36%), and `default-setup` reading 52.9s against 17.6s under load 44.5 with six
  foreign vitest processes (3×) — both larger than anything a phase here is likely to save, which is why the
  metric is CPU-seconds and invocations rather than the clock.
