# Simplify the validation tooling

**Status:** done 2026-10-21 on `session/simplify-validation-tooling`, one commit per phase. It absorbed the
[stretch-projection removal](drop-the-stretch-projection.md).

## Why

The validation tooling has grown machinery to explain and police itself:
- `scripts/` is about 14,500 lines, and the internal-repo-checks specs that check it about 16,500.
- The core chain files are 50–73% comments (`chain-steps.ts` 71%, `core-budget.ts` 73%), with 96 phrases of
  edit history ("until 2026-…", "used to", "no longer") despite the repo's own rule that a comment states the
  current state.
- The root `CLAUDE.md` is 1,034 lines, while its preamble says the rule lives there and its evidence in `docs/`.
- Several numbers are declared by hand and then policed by more machinery: per-step `seconds`, per-rung
  `stretches`, and specs holding guide text to code.

The outcome: fewer concepts to learn, the rules findable, and nothing hand-maintained that a run can observe.
Every deadline and every check of behaviour stays.

## Phases

### 1. Delete the stretch projection

`step-timeouts.ts` kills a wedged step by declared class, and also predicts whether a step would be killed on a
box `SLOWER_MACHINE` (4x) smaller. The second job goes. The strict gate's 3-vCPU runners now record each
step's real duration under its real deadline, so the reading replaces the projection, and `timedOutBecause`
already reports a kill with the deadline and the recorded cost. Its one advisory was false: `outgrownRungs`
fired on `test:integration` on every run, and the repair was a per-step `stretches`, a fourth concept added to
keep a third honest.

| Goes | Where |
|---|---|
| `Rung.stretches`, each rung's `measured` / `until`, `declaredShare`, `ASSUMED_RUNGS` | `scripts/lib/step-timeouts.ts` |
| `ChainStep.stretches`, and its declarations on `test:integration` and `test:native` | `scripts/lib/chain-steps.ts` |
| `outgrownRungs` and `outgrownReport`, with their call site | `step-timing.ts`, `chain-output.ts`, `chain.ts` |
| `scripts/measure-stretch.ts`, `measure:stretch`, and `SLOWER_MACHINE` | `core-budget.ts` loses its last reader |
| The bound, the outgrown cases and their mutation entries | `chain-graph`, `step-timing`, `chain-output`, `decision-mutations` specs |
| The `ASSUMED_RUNGS` check on `ci.yml`'s header, and that header's scaling sentence | `chain-table.spec.ts`, `ci.yml` |

**Stays:** the four rungs and `rungForKind`, `coresFor` and `POOL_WIDTH` (the scheduler and pools use them),
and the workflows' `timeout-minutes`.
**Do not** derive a rung from a cost, keep `declaredShare` for the bound alone, or replace a rung with a
per-step deadline: each couples the killer to a measurement.

### 2. Record step costs instead of declaring them

Every step declares `seconds` by hand. Six were re-declared on 2026-10-21 alone, and `driftedSteps` /
`driftReport`, `MEASURED_ON`, `isMeasuredSchedule` and `scheduleMismatch` exist to tell when a declaration has
gone stale, and on which machine it was true. After phase 1, a step's cost only orders the schedule and draws
the critical path. Neither decides pass or fail, which is where the repo's rule says a reading needs no
apparatus.

- **Record:** each completed step's wall time, in a machine-local window of recent runs under
  `node_modules/.cache/`, uncommitted. That's the shape `spec-durations.ts` already uses for specs; reuse its
  window code rather than writing a second one.
- **Read:** the scheduler and `--dry`'s critical path take the median of the window, and a step with no reading
  yet takes one neutral default, named once. The critical path says how many of its steps were read rather
  than recorded.
- **Delete:**
  - `ChainStep.seconds` and every declared figure with its dated comment;
  - `POOL_SECONDS`;
  - `driftedSteps` / `driftReport`, `MEASURED_ON`, `isMeasuredSchedule`, `scheduleMismatch`;
  - the specs that sum or bound declared seconds (`typecheck-legs.spec.ts`' guide figures among them).
- **Stays:** `seconds` on a typecheck leg only if the runner schedules legs by it; if so, legs read the same
  window.

### 3. Drop the busy-machine retry

When a step fails while the machine was busy, the chain re-runs it alone to "classify" the failure
(`shouldClassify`, `classifyLine`, the `.retry` evidence, `--no-classify`). Both strict workflows pass
`--no-classify`, and locally a passing retry hides a flaky failure. Delete the retry and its flag. A failed step
is a failed step, and its evidence stays. Keep the `voided` and `--strict` handling, which is a different
question: inputs that moved while a step ran.

### 4. Stop pinning prose to code

Specs that hold guide text to code force a doc edit for every code edit:
- `typecheck-legs.spec.ts`' check of `CLAUDE.md`'s leg count and summed seconds (gone with phase 2 anyway);
- the `ci.yml` header check (gone with phase 1);
- `chain-table.spec.ts`' check that every chain flag is named in the guide.

Generate what can be generated: `npm run chain -- --help` printed from `chain-flags.ts`, with the guide pointing
at it instead of restating each flag. Delete each check whose subject becomes generated text, and do not
restate the figures in prose.

### 5. Record content, not modification times, as build inputs (approved 2026-10-21)

A pack build records an observation for every file metadata field a compiler reads. When Tailwind stats
`@apackdev/ui`'s built modules it reads `mtimeMs`, so the record holds those times (80 such observations in the
bundleUi fixture). As a result:
- touching an unchanged dependency file makes a build look stale;
- the strict gate must pin source mtimes and hand outputs over as pax to keep sub-second times.

**Change:** where a compiler reads a dependency file's modification time, record and replay that file's content
hash instead, through the compiler input view (`packages/apack-host/src/build/compiler-inputs/`) and
`assertPackBuildInputsCurrent`. Authored inputs are already content-identified (`build/pack-inputs`:
"timestamps do not enter authored identity"), so this extends an existing rule to dependencies.

**Then delete** the mtime-pinning steps in `strict-chain.yml`. Keep pax only if a remaining recorded input still
needs exact times; otherwise default tar is enough.

**Verify:**
- a touched but unchanged dependency leaves a build current;
- a changed one still refuses;
- the bundleUi fixture replays across the strict handoff without pinning.

### 6. Write down the cache layers

The chain's stamps, the pools' per-suite stamps, the package-build stamps and a pack's phase cache are each
justified, and together they are the hardest part of the tooling to reason about. One page in
`docs/references/` gives, for each layer:
- what it caches;
- its key;
- what invalidates it;
- how it relates to the others, for example why `packages:ensure` is never cached.

No unification in this plan. If the page shows two layers doing one job, that becomes its own decision.

### 7. Put the guides and comments on a diet

Last, because it is easier once the code it describes is smaller.

- **Root `CLAUDE.md`:** the rules in imperative form with one citation each, as its preamble asks.
  - Measurements, histories and stories move to `docs/references/` (`pipeline-lessons.md`,
    `pipeline-commands.md`, `recorded-files.md`).
  - The `Commands` block becomes one line per command plus its flags, with no essays inside the code fence.
  - No line-count gate, as the preamble says.
- **The tooling's comments** (`scripts/` and `chain-steps.ts` above all):
  - remove edit history;
  - shorten essay comments to the current behaviour and its reason;
  - move what is worth keeping to the reference docs.
- **The package guides touched by phases 1–6:** update them in the same pass.

## Verification

- **After each phase:** `npm run typecheck`, `npm run lint:check`, `npm run check:specifiers` and
  `npm run spec -- packages/internal-repo-checks`. Each phase drops the cases it deletes, and no other case moves. One
  that moves was reading the deleted machinery for something else.
- **Phase 1 mutation:** shorten a rung's `ms` and confirm a step is killed and `timedOutBecause` names the new
  deadline.
- **Phase 2:** `npm run chain -- --dry --all` before any reading exists (every step at the default, said so),
  then after a run (readings used).
- **Phase 5:** the three checks above. It changes recorded build inputs, so `check:repro` too.
- **End:** one strict run on the branch, since phases 1–5 edit the gate's own tooling, and the docs link check.

## Out of scope

- Unifying the cache layers. Phase 6 documents them; changing them is a separate decision.
- [Affected-only selection](../../plans/deferred/affected-selection.md), which stays deferred.
- Any change to what a test asserts, or to a rung's deadline.

## Outcome

- **Phase 1** (`f9c310626`): stretch projection deleted; a rung is only its deadline.
- **Phase 2** (`aa1e02fc7`): step costs are a machine-local window of passing runs (`step-durations.ts`);
  declared `seconds`, `POOL_SECONDS`, the drift report and the measured-machine predicates are gone.
- **Phase 3** (`3370eba21`): busy-machine retry and `--no-classify` deleted.
- **Phase 4** (`6170bd1ed`): `npm run chain -- --help` generated from `chain-flags.ts`; the guide-pinning
  specs are gone.
- **Phase 5** (`ea3034388`): a compiler's read of a file's time field is recorded as the file's content
  hash; the strict gate no longer pins source times or uses pax. Bundled-ui fixture: 80 content facts, a
  touch stays current, a byte change refuses; `check:repro` 1751/1751 identical.
- **Phase 6** (`bf0c48ede`): [cache layers](../../references/cache-layers.md) written down. No two layers do
  one job; unification is not worth its cost.
- **Phase 7** (`b36ac76a4`, `0e4e6ded0`): root guide 980 -> 546 lines; tooling comments lose their edit
  history; the pipeline evidence references move to `docs/archive/references/`.
