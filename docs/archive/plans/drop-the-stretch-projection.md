# Drop the stretch projection: keep the deadline, delete the prediction

**Status:** archived 2026-10-21, absorbed into [Simplify the validation tooling](simplify-validation-tooling.md)
as its first phase. The audit below was refreshed against the code the same day.

## What this is about

`scripts/lib/step-timeouts.ts` does two jobs, and only the first is load-bearing.

1. **Kill a wedged step.** Four declared classes — `quick` 60s, `suite` 600s, `scenario` 900s and
   `acceptance` 7,200s for the integration and native pools — with membership checked against the kind of
   work by `rungForKind`. A deadline is a declared class, never a multiple of a measurement, and the file's
   header makes that case well.
2. **Predict whether a step would be killed on a smaller machine.** This is each rung's `stretches`,
   `declaredShare`, `ASSUMED_RUNGS`, the per-step `stretches` override, `outgrownRungs` and its report, and
   `measure:stretch`. It projects a cost measured on the developer's 10-core Mac onto a box `SLOWER_MACHINE`
   (4x) slower.

The proposal is to delete the second job.

## Why

**The smaller machine is no longer hypothetical, so the prediction has a better substitute: the reading.**
The strict gate runs on 3-vCPU hosted runners, and every run records each step's real duration under its real
deadline. A projection of what a smaller box would do is strictly worse than what the runner reports every
strict run. The chain already says so on the runner: its drift report prints *"the table it is compared
against describes another machine"* and gives rows without advice.

**Its output has been one signal, and it was false.** `outgrownRungs` fired on `test:integration` on every
chain run, at 103–135% of its rung, while the step had not moved. `suite`'s `stretches: 4` was measured on
`test:unit:host`, whose pool takes the whole box, while `test:integration` caps itself at half the cores and
loses 1.94x. The fix was a per-step `stretches`, now declared on both `test:integration` and `test:native`. That
is a fourth concept added to keep a third honest, which is the shape of a mechanism worth removing rather than
tuning.

**A kill already carries its evidence.** `timedOutBecause` prints the class's deadline, the step's recorded
cost and the machine both were taken on. A step that outgrows its rung on CI shows up as a kill with real
numbers, which is the evidence a rung change needs. A missing prediction costs a slower first discovery; a
wrong one cost a session.

## What goes

| Item | Where |
|---|---|
| `Rung.stretches`, and each rung's `measured` / `until` pair (the exactly-one-of invariant goes with them) | `scripts/lib/step-timeouts.ts` |
| `declaredShare`, `ASSUMED_RUNGS` | `scripts/lib/step-timeouts.ts` |
| `ChainStep.stretches`, and its two declarations (1.94 on `test:integration` and `test:native`) | `scripts/lib/chain-steps.ts` |
| `outgrownRungs` | `scripts/lib/step-timing.ts` |
| `outgrownReport`, and its call site | `scripts/lib/chain-output.ts`, `scripts/chain.ts` (around line 717) |
| `scripts/measure-stretch.ts` and the `measure:stretch` npm script | its whole output is a number to paste onto a `stretches` field |
| `SLOWER_MACHINE` | `scripts/lib/core-budget.ts`: once `step-timeouts.ts` and `measure-stretch.ts` stop reading it, nothing does |
| The `declaredShare` bound and the outgrown cases | `chain-graph.spec.ts`, `step-timing.spec.ts`, `chain-output.spec.ts` |
| The `stretches`, `declaredShare` and `outgrownRungs` entries | `decision-mutations.spec.ts` |
| The check holding `ci.yml`'s header to `ASSUMED_RUNGS`, and that header's scaling sentence | `chain-table.spec.ts`; `.github/workflows/ci.yml` lines 17–18 |

The docs that describe them change with them:
- the root `CLAUDE.md`'s `measure:stretch` entry;
- `docs/references/pipeline-commands.md` (the `declaredShare` and `outgrownRungs` lines);
- `docs/references/recorded-files.md` (its list of readers that tolerate half-to-double);
- `packages/internal-repo-checks/CLAUDE.md`'s `chain-graph` row and its description of the bound;
- the comment in `typecheck-legs.spec.ts` that cites the `ASSUMED_RUNGS` check.

Already gone since this plan was first written: `timedOutBecause` lost its `stretches` arm and `rungTerms`, and
now reports the bound and the recorded cost with no projection.

## What stays

- **The four rungs and `rungForKind`.** The deadline is the point, and nothing here touches it.
- **`driftedSteps` and `driftReport`:** does a declared cost still describe its step, half to double. No
  projection, so it answers wherever it runs, and gates only its advice on the measuring machine.
- **`scheduleMismatch`, `isMeasuredSchedule` and `MEASURED_ON`:** whether a reading describes the table, not a
  prediction about another machine.
- **`coresFor` and `POOL_WIDTH`.** `measure:stretch` used them, but so do the scheduler and the pools.
- **`ci.yml`'s and `strict-chain.yml`'s `timeout-minutes`:** round numbers that bound a hang, the right shape
  for CI.

## Verification

- `npm run typecheck`: the deletions ripple through `chain.ts`, `chain-output.ts`, `step-timing.ts`,
  `core-budget.ts` and the specs above, and the compiler finds every reader.
- `npm run spec -- packages/internal-repo-checks`: the total drops by the deleted cases and **no other case moves**. One
  that does was reading the projection for something else.
- `npm run chain -- --dry --all`: still prints the plan, the critical path and `driftReport`'s rows, and no rung
  advisory.
- **Mutation:** shorten a rung's `ms` and confirm a step is killed and `timedOutBecause` names the new deadline.
  That is the one behaviour this change must not touch.
- A strict run on the PR, since it edits the chain the gate runs on.

## What not to do

- **Do not derive a rung from a cost.** A class carries no machine, and thresholding a measurement couples the
  killer to the record.
- **Do not keep `declaredShare` "just for the bound".** The bound is the projection. Without a factor there is
  nothing to bound, and `driftedSteps` already watches whether a declaration describes its step.
- **Do not replace it with a per-step deadline.** That is the same coupling, one step at a time.

## The lesson worth keeping

Before adding a watcher, check whether an existing one is silent because it is broken rather than because it is
absent: a noisy check and a missing check look identical from the output. And before trusting a factor, ask
whether it measures *this* step or a different step's scaling. `suite`'s 4x was the second kind, and said so in
its own comment.
