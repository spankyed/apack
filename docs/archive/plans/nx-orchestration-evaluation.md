# Evaluate Nx as the validation orchestrator

Status: proposed evaluation, not an adoption decision. Start after the settings and pack contracts goal closes.
Date: 2026-10-19.

## Decision to make

Determine whether Nx can replace enough generic validation infrastructure to reduce maintenance
without weakening apack's dependency, build-integrity or process-lifetime guarantees.

This evaluation precedes further orchestration development in the
[fast-validation plan](validation-feedback-budget.md). That plan retains the workflow, runtime and
coverage goals; this plan decides who implements generic orchestration. The
[Nx assessment](../references/nx-validation-assessment.md) records the supporting discussion.

Do not put Nx over `npm run chain` and retain both systems. Adoption must retire identified generic
machinery. Nx is not a replacement for compiler input capture, native admission or sealed publication.
The current goal's acceptance requirements remain unchanged.

## Candidate ownership

| Nx would own | apack would retain |
|---|---|
| Project/task graph and affected selection | Captured compiler installations and runtime ownership |
| Generic task ordering and execution | Compiler input observations and freshness replay |
| Proven-safe task verdict caching | Native library inspection/admission and platform helpers |
| Standard task/project reporting | Sealed output, archive integrity and incumbent retention |
| Top-level concurrency, if adequate | Scenario operation deadlines, cancellation and awaited cleanup |

Use Nx's native configuration if adopted. The earlier TypeScript decision rejects building our own
JSON configuration language; it does not prohibit an established tool's supported configuration.
Do not maintain parallel authoritative Nx and custom target inventories.

## Replacement ledger

These are candidates from source inspection, not approved file deletions. Recheck current consumers
before implementation. Record the replacement, retained guarantee and passing evidence for each.

| Current owner | Candidate replacement and limits |
|---|---|
| `scripts/chain.ts` | Replace generic selection, dispatch and verdict handling; retain only a thin entry point if useful |
| `chain-steps.ts` graph functions | Replace custom ordering/graph execution; migrate actual dependency declarations rather than losing them |
| `chain-stamps.ts` | Replace chain task verdicts with Nx caching where sound; migrate `drive-preflight.ts`'s build-freshness consumer before deleting shared code |
| `unit-pool.ts` and `test-unit-pool.ts` | Retire nested test-verdict stamps and stale-project selection; preserve required worker settings, counts, resolution and diagnostic semantics |
| `scripts/typecheck.ts` | Replace generic job scheduling with targets; preserve generation/report ordering and compiler invocation context |
| `chain-schedule.ts` | Retire only if Nx's execution model also covers remaining typecheck/runtime-build callers and resource/conflict requirements |
| `core-budget.ts` | Retire orchestration policy only after nested resource use is accounted for; shared timeout/measurement consumers must be migrated or retained |
| `chain-output.ts` and `chain-evidence.ts` | Replace generic task presentation where Nx suffices; retain required failed-step logs, actual test counts, traces and diagnostic evidence |
| `chain-lock.ts` | Keep checkout/shared-output exclusion until equivalent coordination is proved across concurrent invocations |
| `workspace-deps.ts` | Replace duplicated orchestration derivation where justified; import enforcement and other consumers still need correct package/dependency information |

Related tests of retired stamp naming, scheduler algorithms or graph implementation can be removed
with that implementation. Tests asserting apack's dependency/configuration guarantees stay, adapted
to their new owner. Do not claim all of a mixed-purpose module disappears.

### Rough maintenance expectation

A 2026-10-19 sizing of the candidate modules found about 4,850 total lines and 1,685 approximate
code lines, excluding blank lines and standalone comments. This is a rough textual count, not a
measurement of removable code.

Successful adoption might remove 800–1,200 code lines while adding 250–450 lines of configuration
and adapters: roughly **500–900 net lines removed**. Obsolete infrastructure tests could provide
additional savings. Total source deletion including comments might reach 2,000–3,500 lines, but
that would overstate the reduction in executable complexity.

Use these figures to test the maintenance argument, not as a deletion quota or adoption threshold.
Report actual code/configuration, tests and comments separately. Removing owned responsibilities
matters more than the line count; never delete correctness checks or compiler guarantees to meet an
estimate. If most generic machinery survives underneath Nx, reassess whether adoption is worthwhile.

## Machinery outside replacement scope

Keep the following behaviors and their acceptance coverage:

- `packages/apack-host/src/build/compiler-inputs/` and CLI input/startup/watch observations: executed
  inputs, missing candidates, directory membership and freshness.
- CLI compiler installation, runtime, worker/thread and process-group owners: captured execution and
  complete retirement. Do not replace these with task termination assumptions.
- PE/ELF/macOS inspection, admission and helpers: actual native ownership and the approved support boundary.
- Common pack input records, sealed output/archive verification, atomic publication and incumbent retention.
- `bounded-spawn.ts` and other shared operation owners while their guarantees and callers remain needed.
- Checkout-owned authoring work directories, external readiness/archive validity and exact archive/app handoff.
- Package-build freshness APIs used by developer launch and runtime paths. Do not delete shared
  `packages-built.ts` primitives merely because chain/test verdict stamps move to Nx.

Ordinary build-freshness checks and compiler records are not generic test verdicts. An Nx cache hit
does not by itself establish that a pack is valid for its current external inputs.

## Dependency checks remain acceptance requirements

Nx's graph and configured inputs do not prove input completeness. Preserve:

- `dep-files.ts` and `dep-files.integration.spec.ts` observations against resolved declared coverage.
- `build-reads.ts` and corresponding build-read/input coverage assertions.
- `suite-reads.spec.ts` and relevant `chain-inputs.spec.ts` guarantees for built packages, shipped-pack
  output, runner/config changes and producer ordering.
- Complete test discovery, explicit platform skips and exhaustive reachability.

Adapt these checks to resolved Nx configuration where applicable; do not preserve an obsolete custom
graph solely as their input. Confirm that resolved inputs include dependency expansion, runtime and
environment inputs as required. Do not compare only a raw JSON glob list or rely on last-run reads
as a complete key: new files and missing-path repairs can change resolution.

## Cache and execution constraints

Start with local execution and caching only where deterministic inputs/outputs are demonstrated.
Disable outer Nx caching for native/external-state acceptance and temporary external-workspace
workflows until their contracts are proved. Restoring a handoff directory does not restore its
external work tree. A follow-up verification target must actually run when required, not reuse a
verdict based on the same incomplete inputs.

Preserve effective command context: working directory, environment, runtime selection and argument
forwarding. Nx must not change the compiler identity accidentally. Acceptance completes at process
exit after cleanup; readiness strings such as `readyWhen` are not completion evidence.

Nx task concurrency is not our weighted core budget. Prove nested workers/builds do not oversubscribe
the machine, and preserve conflicting-writer exclusion. Prefer a simple adequate execution policy;
rebuilding the custom scheduler inside an Nx surface is a reason to reconsider adoption.

Diagnostic runs cannot populate normal acceptance verdicts. Explicit exhaustive execution must bypass
Nx and any retained inner test-verdict caches without unnecessarily rebuilding unchanged compiler
installations. Preserve the distinction between reusable produced bytes and a passing test result.

## Bounded evaluation

This document authorizes no installation or execution by itself. When scheduled, coordinate an isolated
pilot with the main implementation session; preserve existing work and keep dependencies, outputs and
profiles separate. Record the tested Nx version and check compatibility with the current Node,
Vitest and package-manager versions before installing. Do not silently upgrade the toolchain.

1. **Confirm replacement scope.** Re-audit the ledger and identify concrete generic code to retire.
   Choose ordinary CLI checks, one compiler acceptance target and one existing producer/consumer
   boundary. Wrap underlying commands, not the complete chain. Keep existing product code unchanged.
2. **Prove selection and outputs.** Change ordinary source, shared source, configuration and tests;
   exercise additions/deletions and base selection. Verify required targets, ordering, cold-result
   behavior, missing/modified output and unchanged-byte reuse. Collect every expected case; a green
   command that ran zero intended tests fails the pilot.
3. **Prove exceptional boundaries.** Run focused external-state invalidation and handoff-loss controls.
   Test diagnostic cache isolation, exhaustive bypass, cancellation/descendant cleanup and writer
   exclusion. Verify Windows and a supported Unix environment through existing approved resources.
   No native execution on the daily-use Mac, cloud subscription, new VM or broad repeated suite is required.
4. **Compare cost and decide.** Record preparation, runtime, cold/warm conditions, nested concurrency,
   configuration burden, retained adapter code and concrete deletions. Use focused failures to resolve
   only demonstrated blockers. Stop when the decision matrix below is answered; do not build a
   general surface suite or run repeated full-chain diagnostics to make the candidate fit.

## Go/no-go criteria

| Question | Required evidence |
|---|---|
| Does ordinary work select less execution? | Before/after targets and prerequisite counts for representative changes, with no missing coverage |
| Can one producer serve independent consumers? | Correct ordering, output identity and missing-output behavior without duplicate builds |
| Is caching sound at the chosen boundary? | Changed file/config/context inputs invalidate; native/external cases remain uncached unless demonstrated sound |
| Are dependency guarantees preserved? | Existing observation/configuration checks pass against the replacement representation |
| Does execution stay owned? | Focused Windows/Unix cancellation, descendants, cleanup, evidence and nested resource controls pass |
| Does exhaustive validation remain honest? | All required targets/cases accounted for, caches bypassed, diagnostics and platform skips explicit |
| Does maintenance decrease? | Named custom machinery removed, a small explicit adapter, no competing selector/scheduler/verdict caches |

**Go:** record the evidence and reconcile the fast-validation plan around Nx. Migration proceeds in
reviewable checkpoints; delete replaced machinery as targets move. Preserve native compiler and
build-integrity owners. Full adoption still needs committed-source exhaustive acceptance.

**No-go:** record the specific gaps and remove pilot-only integration from the eventual implementation.
Continue the typed-target design in the existing runner. Preserve useful pilot work/evidence in a
commit or stash; do not discard it. Do not keep a permanent shadow orchestrator.

The evaluator must give a recommendation with remaining limitations. Passing one target, a warm
cache demonstration or Nx launching the current chain is not sufficient for adoption. The full
fast-validation runtime target remains a later implementation outcome, not a pilot acceptance claim.

## References

- [Nx affected execution](https://nx.dev/docs/concepts/ci-concepts/building-blocks-fast-ci).
- [Task caching](https://nx.dev/docs/concepts/how-caching-works) and [input declarations](https://nx.dev/docs/references/inputs).
- [Project configuration and parallelism](https://nx.dev/docs/references/project-configuration).
- [Command execution semantics](https://nx.dev/docs/references/nx/executors).

Check the selected version's behavior during the pilot; documentation is not proof of compatibility
with this repository's compiler contract. Remote caching and distributed execution are outside the
initial evaluation and require separate review and authorization if later proposed.
