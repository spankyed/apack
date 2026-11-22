> **Done** (branch `AS/costs-across-machines`). All four phases are closed: deadlines became declared
> classes (`8ad50cc27`), the drift report stopped printing advice off the measured machine (`69470a693`),
> `spec-cost`'s placement checks were scoped to it (`9755ee816`), and the CI rule went into the root
> `CLAUDE.md` (`2b09fd2a5`). A review after the fact found three more and each is fixed: the machine
> identity was a core count, so every 10-core box read as the measured one (`c427b1c3b`); the
> `spec-cost:check` *command* was left enforcing where only its spec had been scoped (`551ed825b`); and a
> step's bound and its script's now coincide, which needed saying rather than changing (`a5119d250`).
>
> Three things in the plan were corrected by implementing it — the inner shell bounds it had missed, the
> critical-path floor it wrongly called machine-bound, and the ratio it proposed for the half edges — and
> each correction is marked where it applies. Read it as history: it names code as it was.

# Costs across machines: the cost model is single-machine

## Problem

Every tolerance in the chain is a fraction, and every cost is a second. The fractions travel; the seconds
do not. One machine has hidden the difference, and the first second machine — a new developer's laptop, or
the CI runner whose triggers are commented out — meets all of it at once.

### What travels and what does not

| Portable (relative) | Machine-bound (absolute) |
|---|---|
| `IDLE_FLOOR` 0.7, `SETTLED_FRACTION` 0.35 | `MEASURED_ON` — the CPU and core count of one box |
| `DRIFT_SHARE` 0.15, `CONTENDED_SHARE` 0.25 | 29 `seconds` values + `POOL_SECONDS` |
| `--cores`, defaulting to `box()` | `SIZE_MS` 15s / 60s |
| `POOL_WIDTH`'s shares (`{ share: 0.5 }`, `UNCAPPED`) | spec half edges 1000 / 2500ms, over 389 recorded specs |

**`AS/chain-core-budget` made the *scheduler* machine-relative and left the *cost model* machine-absolute.**
That is the asymmetry this plan is about. The budget is a share of whatever box it finds; the costs it
schedules are seconds measured on one.

### The root cause

**Wall-clock time is recorded as a property of the code. It is a property of code x machine x load.**

It cannot be patched in place, because the five consumers of those numbers need different precision:

| consumer | needs | portability |
|---|---|---|
| `budgetFor` -> a step's kill deadline | an order of magnitude | **required** — a spurious kill is a broken build |
| `sizeOf` -> `SIZE_MS` test timeout | an order of magnitude | **required** |
| `spec-cost` -> which half a spec runs in | a binary, with a wide band | **required** |
| `criticalPath` -> the floor line | this machine's numbers | local |
| `driftReport` -> "re-measure, or record" | this machine's numbers | local |

Three need portability and two are inherently local. One number serving all five is the defect.

### The invariant

> **A number measured on one machine may inform a report. It may never decide whether work survives.**

That sorts every row above without consulting the table, and it applies to the next number someone adds:
*does this kill or block anything?* If it does, it cannot be a measurement.

### What breaks, concretely

**A flaky kill in CI, not a clean failure.** `ci.yml` runs on `macos-14`, a hosted runner with a fraction
of this box's ten cores (confirm the count before relying on the arithmetic below). Nine chain steps have a
real deadline and all nine sit at exactly four times their recorded cost:

```
test:packaged-authoring   91s declared -> 364s deadline
test:integration          60s         -> 240s          5 workers here, ~2 there
test:unit:host            42s         -> 168s          9 workers here, ~2 there
build:app                 39s         -> 156s
test:external-pack:contract 36s       -> 144s
```

A pool that drops from nine workers to two is three to four times slower, which puts `test:unit:host` at
130-170s against a 168s deadline. That is the worst failure shape available: intermittent, and it looks
like the code.

**Nobody else can maintain the table.** `--record` refuses unless this is the machine `MEASURED_ON` names
(`isMeasuredSchedule`), so a second developer can neither record their own numbers nor fix stale ones. A
recorded artifact one machine can write is not a shared artifact.

**Permanent noise for everyone else.** A mismatch against `MEASURED_ON` prints on every run on any other
machine, and the drift report fires on most steps — correctly, and uselessly, since the advice it gives
cannot be taken there.

**`spec-cost:check` fails for everyone else.** 363 specs are recorded in the fast half against a 2500ms
integration edge. At three times slower, **32 of them cross it** (20 at 2x, 39 at 4x), and the check fails
on a single spec in the wrong half. *Measured 2026-10-03; an earlier estimate of "most" was wrong and is
corrected here.*

### What is not the problem

The scheduler. `--cores` defaults to `box()`, `POOL_WIDTH`'s pool entries are shares, and the two bundler
entries are absolute *on purpose* — a bundler on fixed work uses about the same cores on any box, which is
why `PoolWidth` distinguishes `{ share }` from `{ cores }`. None of that needs changing.

**And the scheduler never reads a cost.** `chain-schedule.ts` declares `seconds?: number` on its step
interface and nothing reads it: admission is `cores`, `dependsOn` and `conflicts`. So coarsening the
deadlines below has no scheduling consequence — there is no ordering to get worse — which is what makes (1)
a safe change rather than a trade.

## The committed work

### 1. Deadlines become buckets, not multiples of a measurement

**The one that must land before a second machine**, because it is the only one that breaks a build rather
than printing noise.

The repo already has this pattern and already cites the source. `SIZE_MS`'s doc names Bazel's `size` as
*"a bucket whose whole purpose is a default timeout"*, and which bucket a test file lands in is **derived**
by `sizeOf` (`scripts/lib/test-timeouts.ts`) rather than declared. Chain steps are the one place that did
not follow: `budgetFor(seconds)` multiplies a measurement by four.

Replace that with a coarse bucket per step, chosen for the slowest plausible machine rather than measured
on the fastest. Bazel's own ladder is 60 / 300 / 900 / 3600s and is a reasonable starting shape; what landed
is three rungs of it — `quick` 60s, `suite` 300s, `scenario` 900s — because three kinds of work are nameable
here and a fourth would have been a value nothing distinguishes, which is `SIZE_MS`' argument against it.

**Corrected by implementing it: the inner shell bounds were half of this phase and the plan missed them.**
Four npm scripts bound a shell script through `scripts/bounded.ts <seconds>`, nested *inside* the chain's
own bound — and two were already the binding constraint, `test:external-pack:contract` at 90s inside against
144s outside and `test:packaged-authoring` at 240s against 364s. `bounded.ts`' own doc told the reader to
size them "at about four times what the thing costs healthy", so they were this machine's deadlines by the
same route. Coarsening only the chain's bound would have left a 90s shell bound killing a slow machine
exactly as before, and this phase's "done when" would have been false while it read as true. They name a
class now, so a step and the script it runs agree by construction.

**The bucket is declared by kind, and never derived by thresholding `seconds`.** That is the shortcut this
phase exists to refuse: a bucket picked by comparing a recorded cost against edges re-couples the killer to
the record, just coarsely, and the first slow machine is back where it started. `sizeOf`
(`scripts/lib/test-timeouts.ts:99`) is the precedent in both halves — it reads the config filename, the
half and suite membership, never a duration, and *refuses* a file it cannot classify rather than defaulting,
"because the budget is a ceiling, so the confident wrong answer is the permissive one".

It is cheap, and the reason is measured: **20 of the 29 steps already sit on `budgetFor`'s 60s floor**, so
the table's precision is doing nothing for two thirds of them. Only the nine above need a bucket.

What a bucket loses is the "this step grew" signal. That signal belongs to `driftReport`, not to the
killer, whose only job is to notice a wedge — and 900s says "wedged" as well as 364s does.

**Done when** no `boundedSpawn` deadline anywhere is a function of a recorded measurement. That is
greppable, so it is what a spec should assert rather than a reviewer remember.

### 2. The local record stops being everyone's warning

After (1), `seconds` has only local consumers: the critical-path line and the drift report. So it should
stop being a fact that one machine maintains and every other machine is warned about on every run.

**What landed is the advice gated and the numbers kept.** The rows still print off the measured machine,
because what a step cost is true wherever it ran; the sentence telling a reader to record it does not,
because `--record` refuses there. The guard is `isMeasuredSchedule`, not a bare core-count comparison —
the weaker form passes `--cores 10` on a twenty-core box, where the budget matches and every width is
twenty-core sized.

**Corrected by implementing it: the critical-path floor is not machine-bound and is not silenced.**
`chain.ts` builds it from *measured* times, not from the table — *"Measured, not declared. Reporting the
floor from `seconds` made it wrong by the amount the table had drifted"* — so it describes the run that
just happened and is true on any machine. Only `driftReport`, which compares against the committed table,
needed gating.

**And the local-override option is closed rather than left open.** A per-machine duration is *already*
persisted: every chain stamp under `node_modules/.cache/apack-chain/` carries `takenAt` and `builtAt`, so
the last successful run of each step on this box is on disk. If an off-reference drift signal is ever
wanted, it is derivable from that, with no second cost table to keep true — which is the shape to use, and
the reason not to build one now.

**Done when** a run on a machine `MEASURED_ON` does not name prints no instruction it cannot follow, and
a spec asserts both halves — the instruction on the reference box, its absence off it. The numbers are not
the thing to silence; the advice is.

### 3. CI may fail a check, never a clock

Write the rule down, because it is the thing that keeps (1) and (2) from being re-litigated the first time
a runner is slow. In CI: deadlines from buckets, `--record` refused (it already is), drift report and
critical-path floor silent. Hosted runners are small and noisy; gating on wall-clock there manufactures
flakes that read as code failures.

## Declined for now, with the condition that would change it

**Calibration — recording costs in a machine-independent unit.** This branch proved the instrument:
CPU time over wall time gave a reproducible 1.6 and 2.2 cores for `compile` and `build:app` across two runs
each, where sampling the machine's idle gave 1.8 on one run and 2.7 on the next. So core-seconds are
measurable and far more portable than wall-clock.

Declined because the decisions these numbers inform — which bucket, which half — are coarse enough that
(1) and (2) close them, and a calibration factor is a second thing to keep true. **Revisit if a consumer
appears that needs a portable number rather than a portable decision.**

If it is ever wanted, **it is a cache and not a commit**, and the precedent is in-tree: the chain's stamps
and every `tsBuildInfoFile` already live under `node_modules/.cache/`, per machine and uncommitted, which
is exactly what a calibration is. A committed per-machine number is the problem this plan is about, so a
fix shaped like one would be the same mistake twice.

**Scaling the deadlines by the measured cores over this machine's.** The obvious shortcut, and wrong in both directions
at once: the single-threaded `tsc` legs barely scale with cores while the pools scale nearly linearly, so one
multiplier masks a real hang on a large box and still fires on a small one. Named here because it is what the
next reader of "the deadlines are ten-core deadlines" will reach for.

## 4. `spec-cost`'s half edges stay absolute, scoped to the machine that measured them

**Decided, not deferred, and the ratio this plan first proposed is refuted.** The half-split is *correctly*
machine-specific: a cost in milliseconds says where a spec belongs only against edges chosen for one
machine's speed. So enforcement is scoped to the box the record was taken on and skips elsewhere with a
named reason — the `packagesBuiltOrRefuse()` shape, which skips on evidence that does not apply rather than
passing over it. Demonstrated both ways: off the machine those five cases skip, and a record scaled by three
with the scoping removed fails exactly the placement gate, which is what a second developer used to get.

**What portability cannot do here**, measured 2026-10-03:

- **`internal-repo-checks` is not separable by any ratio.** Four fast specs cost more than its three cheapest
  integration specs — `lint-scope` 2388, `spec-plan-collect` 2134, `chain-inputs` 2041, `suite-reads` 1872
  against `fingerprint-scope.integration` 1843, `component-contracts.integration` 2007,
  `bounded-spawn.integration` 2059. The halves overlap at 9.4x the median against 7.3x, and today's record
  survives because of the dead band rather than because the halves separate.
- **The nine single-half suites have medians of 6-168ms**, so any ratio wide enough for the split suites is
  a far lower absolute bar there: today's six `outgrown` findings would become 42.
- **`outgrown` is not a placement question at all.** It is a ceiling on what a fast half may cost — a policy
  about loop time, the same kind of thing as the classes in (1).
- **And a median is a fit.** `goal-measured-placement.md` already carries the general form: *"a bound is not
  a fit; deriving one from the measurement it bounds is how a timeout stops catching anything."*

A ratio *would* have satisfied the "done when" this section used to carry — scaling every cost scales the
median, so every ratio is invariant by construction. That is the trap: the property was satisfiable by a
formulation that classifies today's record wrongly, so it was the wrong property to end on.
