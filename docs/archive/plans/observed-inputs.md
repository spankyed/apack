> **Done** (branch `AS/one-action-cache`). All six items are closed: `package.json` out of every step's
> inputs (`ccfb74e7d`), dep files for `main` and `preload` (`f004ab2cd`), the nine unobserved steps recorded
> rather than watched (`5ff837083`), `seconds` gaining its update half (`dfa56d523`), the warm-chain
> regression closed where it actually was (`115582524`), and the integration half pooled (`3963a37a9`,
> keyed correctly in `12db65692`). Each entry below carries what it cost and, where there was one, the thing
> the plan did not predict. Read it as history: it names code as it was.

# Observe the inputs

`goal-one-action-cache.md` derived the chain's *consequences* — ordering, mutexes, classification — from
what each step declares it reads and writes. It left the *premise* hand-written: `inputs` is still a
literal on every step, and everything else is a function of it.

This is the follow-up: make the premise observed rather than asserted, and remove the one blunt input that
makes every key coarser than it needs to be.

## Where it stands (2026-10-01, at `dea84c15a` on `AS/one-action-cache`)

Per-step input verification, counted:

| checked by | steps |
|---|---|
| a dep file — the compiler reports what it read | 15 |
| the module graph — `suite-reads` walks the specs | 3 |
| **nothing per-step** | **11** |

The eleven are `packages:check`, `compile`, `test:external-pack:contract`, `typecheck:fe`,
`typecheck:main`, `typecheck:preload`, `build:app`, `test:external-pack:app`, `test:smoke`, `test`,
`test:packaged-authoring`.

They are not unchecked — `chain-inputs` holds every tracked file to being *some* step's input — but that
is a coverage question. It cannot catch a step declaring too little, which is the failure that produces a
green run over work that changed. So the premise everything derives from is verified for 18 of 29 steps.

## 1. `package.json` is in all 29 steps' inputs, and need not be — **done** (`ccfb74e7d`)

`ROOT` puts `package.json` and `package-lock.json` into every step, and the root vitest configs with them.
It is a blunt proxy for *the command this step runs*, written when a step's command had no other
representation. The root `CLAUDE.md` already concedes the cost: *"Correct, and the reason a one-word
change to an unrelated script costs a full run."*

Measured over the last ~587 commits:

| | commits |
|---|---|
| touched `package.json` | 37 — **all 37 scripts-only**, no dependency field changed |
| touched `package-lock.json` | 8 |
| touched the root vitest configs | 5 |

Thirty-seven times, an npm-script edit invalidated all 29 steps: a full chain against a 2.5s warm run.

**It is an artifact because the precise answer became computable in the meantime.** Every step is one root
npm script, and `reachableText(step.name, rootScripts())` (`scripts/lib/npm-scripts.ts`) returns that
command's text and the files it reaches. Two checks already use it, and its workspace resolution was
fixed while making the typecheck legs into steps — before that it expanded `npm run X --workspace Y` as
the root's `X`, which is why nobody could have keyed on it.

**The work.** Replace `package.json` in `ROOT` with, per step, the text its command reaches. Keep
`package-lock.json`: 8 commits is real, and a dependency change does affect everything. Keep the
`workspaces` field some other way — it decides what a workspace is (`PACKAGE_DIRS`), so it is a genuine
global input even though the rest of the file is not. Give the root vitest configs to the vitest steps
only.

**Done when** an edit to one npm script re-runs only the steps whose reachable command text changed,
proved by a case that mutates a script and asserts which steps go stale — and `chain --dry` after editing
an unrelated script reports the rest cached.

**The risk worth naming.** This makes a cache key depend on a text walk of shell, which is the thing
`check:tiers` is criticised for elsewhere in these docs. The difference is that a wrong *scan* reports a
false finding and a wrong *key* is silent. So the key must be the union of the command text **and** the
files that text names, never a parse of what the command means — and the case above is what holds it.

**Measured, and it is the number this item existed for.** A space added to `db:repl`:

    before   0 of 28 cached
    after   26 of 28 cached

The two that run are `packages:ensure`, which is never cached, and `typecheck:be`, which genuinely reads
the manifest — **the one thing the plan did not predict**. The dep-file gate reported it the moment the
manifest left `ROOT`: the api's three programs resolve through the root `package.json`, a real read that
had been indistinguishable from the accident while every step declared it. One leg declares it now
through `alsoReads`, which exists for repo-root files no workspace scope can name. `commandText` is built
on `reachableText`'s `invoked` rather than its `text`, since the text carries the contents of every
followed file and those are already hashed as declared inputs.

## 2. Two tsconfig lines take the dep-file gate from 15 steps to 17 — **done** (`f004ab2cd`)

`typecheck:main` and `typecheck:preload` set no `tsBuildInfoFile`, so they report nothing and their
declared inputs rest on reasoning. Every other compiler leg writes one into
`node_modules/.cache/tsbuildinfo` and is checked against it by `dep-files.integration.spec.ts`.

`typecheck:fe` is the third uncovered one and is **not** this cheap: the renderer writes three build infos
under `packages/renderer/node_modules/.tmp` and they record no program at all — no `fileNames` key,
because a solution-style config records its references and the referenced configs do the compiling. A
case pins that, so it fails if they ever grow one.

**Done when** `dep-files.integration.spec.ts`'s uncovered list is `['typecheck:fe']` alone. It is.

One thing the two lines found that the reasoning had not: `packages/main` and `packages/preload` pin
typescript to an exact `5.8.3` and carry their own copy, where the root resolves `^5.8.3` to 5.9.3. A build
info records the compiler that wrote it, so a single expected version would have failed both legs for the
right reason and the wrong one. `typeScriptFor(depFile)` resolves it per workspace now.

## 3. The nine that no tool reports on — **closed as a record** (`5ff837083`)

The remaining steps are builds, shell scenarios and Playwright runs. No compiler reports their reads and
no module graph reaches them, so the only honest options are:

- **Watch the process.** What a run opened is observable, and the plan's out-of-scope note argues against
  syscall tracing ("cannot tell 'read because it matters' from 'stat'd during module resolution"). That
  objection is about using a trace as a *key*; using it to check a declaration is a different claim and
  the one worth re-examining.
- **Make the step produce its read set.** `--listFiles` already does this for one shell script
  (`tests/scripts/test-packaged-authoring.sh`), which is the existing precedent.
- **Accept it, and say so per step.** A step whose inputs nothing can check is a known gap, and naming
  the eleven is better than a count that drifts.

**Settled: the third.** `dep-files.integration.spec.ts` now asserts the nine by name, beside the list of
legs no dep file speaks for, in the same shape and for the same reason — a step gaining observation shows
up, one losing it shows up, and a new step nothing watches has to be added deliberately. It is a record
of a known gap, not a gate over it, and that is the honest thing to have: a watcher for a build or a
shell scenario costs more than the staleness it would catch, and tracing was already out of scope.

The count is nine rather than eleven, and the arithmetic moved while this was written: `f004ab2cd` gave
`main` and `preload` dep files, so observation is 17 by dep file, 3 by module graph, 9 by nothing.

## 4. `seconds` is 29 hand-recorded measurements with no update path — **done** (`dfa56d523`)

It breaks the repo's own naming rule — *"an artifact with only an update is one nothing will notice has
gone stale"* — and it has neither half. The chain already measures every step and reports drift against
the table, so the measurement exists; it is the recording that is manual.

This was settled during `goal-one-action-cache.md` as *keep it in the table*, with an explicit revisit
condition of **~47 actions**, on the grounds that 13 entries are read by whoever opens the step they
describe. **That condition is half met**: the table went from 13 to 29 in one change, and the plan it
serves targets 47. Re-read that decision rather than inheriting it.

It did not move, and the conclusion held for the third time: `chain --all --record` writes the numbers
where they are. `driftReport` was always the check and always printed the value; the update is what was
missing. The hysteresis moved to `measure.ts`, the generic measurement layer, with the floor left to the
caller because the units differ — milliseconds for a spec, seconds for a step.

Two things it found. The first `--record` wrote `packages:ensure 14s -> 0s`, which is the exact mistake
that field's own doc records someone making, so sub-second measurements are excluded as `driftedSteps`
already excluded them. And `scripts/lib/spec-cost.ts` had no local imports — which read as a property of
the module and was a property of a test: `spec-cost-mutations` copies it to a temp directory, where a
relative import does not resolve. The spec rewrites them now.

## 5. Open regression inherited from the goal — **closed** (`115582524`), and not where it was looked for

The warm chain was **2.5s against the base's 1.5s**, and the stamp store was the wrong suspect. Parsing all
7.8MB of it is **34ms** of that run, measured; a fix aimed there was written and reverted. The cost was a
*second* reading of the tree: each dispatch decision built its own `freshnessSweep`, 1715ms of walking
against 189ms shared.

What made sharing one safe is the goal's own Phase 2. The concern on record was that a step reached at
t=100s has to see the tree as of then, so a shared sweep would hide a step whose inputs a *previous* step
had moved. But `dependsOn` is now derived as "B reads what A writes" — so a step that writes another's
inputs is already ordered before it, and the hazard is zero by construction rather than by vigilance.
`forget(step.outputs ∪ step.alsoWrites)` after each run covers what a step writes outside its declaration.
Warm chain **0.9s**, below the 1.5s base, and no stamp was invalidated to get there.

## 6. The integration half is the third pool — **done** (this branch)

Not an input-observation item; it is the other half of the Background table's second row, which the goal
measured and did not fix. `test:integration` ran one `vitest` over all three projects whenever any of them
was stale, so a `internal-repo-checks` edit paid 44s for 6s of work.

It is now the same runner as the two unit pools (`scripts/test-unit-pool.ts` over `POOLS` in
`scripts/lib/unit-pool.ts`), which is the point: **the integration half being special was itself the
artifact.** A pool is a resolution and a half — `host` and `pack` split on resolution, because Node
conditions are per process; `integration` shares the host resolution and splits on the half.

That split is what the pool key was missing. A stamp named for the directory alone cannot hold two halves,
so the expensive half would have been skipped on the fast half's record — which is why it had no per-suite
cache at all. `poolStampFor(suite, half)` fixes it, `unit-pool.spec.ts` holds the distinctness (mutation-
checked by setting the integration pool's half to `fast`: two cases fire), and the runner prunes the stamps
no pool would write, since the rename left one dead file per suite.

Measured 2026-10-01: a `internal-repo-checks` edit runs 6 files in **5.8s** against all 26 in **43.6s**. The asymmetry
is why it pays — `apack-cli`'s half alone is 227.5s of the 276.7s of file time, so any edit that does not
touch it skips 82% of the pool's work.

## Named, and deliberately not proposed

**`spec-cost` moves a spec between halves by telling you to rename the file**, so a spec's filename encodes
its measured runtime. That is an artifact of vitest selecting by glob, and deriving each config's
`include` from the cost records would remove it. It is left alone because the rename has a real virtue:
the half is visible in the path and in review, where an `include` list is visible in neither. A genuine
trade rather than a free one, and it should be taken only if something else needs the glob gone.

## Out of scope

- Adopting a build tool. `one-action-cache.md`'s reasoning stands and nothing here changes it.
- Gradle's "undeclared means uncacheable". It has no subject here: 23 of 29 steps are verification with
  nothing to emit, and this cache decides whether to run where Gradle's restores outputs. The archived
  goal's Outcome has the argument.
