# Application performance optimization

Status: approved for execution, 2026-10-31. Base: master `78c8f15ea7`; native pin
`dde229d90c60665405fdcfc93b054a77fe8d0e1d`. This work follows the completed
[measurement foundation](../archive/plans/application-performance.md).

Integration checkpoint: upstream master advanced during execution to `05490e387a`, including
the shared validation fixes and native pin `7b484b0834720d6d7b4fb89270d4ac02a6f42c1d`.
Keep the completed original-pin baselines labeled; final integration and affected qualification
use that newer frozen pin. Never switch native inputs beneath an active captured run. A subsequent integration checkpoint is
master `27518626c4`, including weighted relations and native pin
`1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`; final combined qualification uses it.

## Outcome

Measure the four maintained application actions on current code, identify their largest costs, and
remove demonstrated unnecessary query or allocation work. Requalify recording overhead after the
cleanup. Deliver independently reviewable evidence and implementation PRs, with every selected
candidate accepted, rejected with evidence, or explicitly unresolved. Measurements, rather than a
target number of optimizations, determine which changes ship.

Use the existing [suite](../../tests/performance/README.md), recorder, profiles, query plans, report
admission and revision comparison. Do not build another benchmark framework. The earlier
[query investigation](ears-query-efficiency.md) and sibling elmdb allocation/codec investigation are
prior art: avoid reimplementing their completed fixes.

## Execution and experiment controls

- Use isolated branches in the existing session worktree; preserve master and other sessions. Each
  comparison checkout owns its dependencies, generated output and staging index.
- Freeze a clean committed application revision and a private native checkout matching its pin.
  Record actual build/binding hashes. Do not measure another agent's changing native checkout.
- Execute repeated application/native runs in the maintained Linux runner: two CPUs, 6 GiB memory,
  no additional swap, explicit 256 MiB shared memory. Keep fixture data disk-backed. Record the
  external-drive storage condition; results describe this environment, not desktop macOS latency.
- Inspect existing jobs before expensive execution, use one local Docker execution owner, and keep
  valid outputs. Do not cancel unrelated or existing validation. Freeze source during captured builds
  and measurements. A source or native change invalidates only the results that depend on it.
- Keep all raw trials, errors, exits, manifests and profiles in owned ignored report directories.
  Commit compact source-qualified evidence and references; do not commit heap snapshots or large
  profile archives. No developer database or live inference provider participates.
- Preserve existing timeouts, integrity checks and acceptance criteria. An over-budget or noisy run
  remains evidence; do not rerun until a favorable number appears. Diagnose concrete failures before
  another broad execution. Harness changes require a demonstrated measurement gap.

## Stage 1 Baseline and recording overhead

Deliver an evidence PR from `session/performance-baseline`, containing this plan, the current
baseline, overhead dispositions and a ranked bottleneck list. No production optimization belongs in
this PR.

1. Prepare current packages, built-in pack and application through existing build commands. Verify
   the loaded native checkout and output match the declared pin.
2. Run disabled versus lightweight for thread opening, search, streaming and populated startup.
   Run the separate disabled versus detailed comparisons on the same frozen source and environment.
   Each uses five warmups and twenty measured actions per mode in the existing observed ABBA order.
3. Admit every run using the maintained readers. Record absolute median/range/count, unsuccessful
   trials, work counters, process resources, and recording completeness. Retain per-scenario outcomes
   even if another scenario fails or exceeds budget. The lightweight median budget remains 5%; detailed
   mode has no assumed low-overhead guarantee.
4. Rank costs using both visible-action duration and supporting traces/counters. Separate streaming's
   fixed producer pacing from avoidable latency, and startup admission from profile-copy preparation.
   Search starts after debounce; view readiness is not paint; fresh startup is warm-filesystem startup.
5. If noise or an apparent regression prevents a decision, use a declared focused A/A control or
   reproduction of that uncertainty. Do not repeat the whole matrix without a named coverage gap.

Done when all four actions have admitted source-specific baselines and overhead dispositions, or a
concrete failure with retained evidence and a resolution. An overhead failure requires a measured
diagnosis and justified fix; it cannot be renamed a pass. Historical results do not certify this code.

## Stage 2 Allocation copy and codec investigation

Deliver a dependent investigation PR, using Stage 1's detailed captures and prior evidence first.
Collect extra profiles only for boundaries the existing captures cannot answer.

- Attribute CPU and sampled JavaScript allocation to backend execution, EARS request encoding,
  binding crossing, answer decoding/object assembly, transport and renderer application. Inclusive
  binding time is not pure native execution; JS heap samples do not describe native allocation.
- Select at most three concrete query paths from the action evidence. Record the caller, recipe,
  compiled plan, projected fields, expected result, crossings, returned bytes and native stage counters.
  Keep returned rows distinct from rows visited and causal work distinct from recording-window totals.
- Inspect allocations/copies/codecs on the selected paths. A necessary ownership copy, validation pass
  or decompression is not automatically waste. Existing native codec fixes are not new candidates.
- Rank findings by absolute impact, confidence, lift and semantic risk. Before prototyping each
  candidate, record the unnecessary work, predicted reduction, minimum worthwhile benefit in workload
  units, acceptable tradeoffs and relevant correctness invariants, informed by baseline variability.

Done when the bottleneck ranking is supported by profiles/work evidence and each proposed change has
a measurable acceptance condition. Explicit no-change findings are valid; opaque native attribution
must remain labeled rather than becoming an unsupported Rust implementation recommendation.

## Stage 3 Query efficiency improvements

Create focused implementation PRs for the selected query paths, dependent on the investigation.
Use existing index filters, limits, projections, existence terminals and set reads before considering
new engine capabilities. Group by action or shared cause rather than by individual helper.

For each candidate:

1. Capture the baseline recipe, answer and work on the same deterministic data. Include a larger
   existing fixture where a scaling claim is involved.
2. Remove only the demonstrated unnecessary work. Preserve membership, ordering/ties, missing/null
   handling, pagination, snapshot/unit behavior, errors and watch invalidation.
3. Reuse existing correctness cases. Add only a meaningful coverage gap and show that the guard detects
   the deliberate regression in a disposable copy. Do not add timing assertions to ordinary CI.
4. Run balanced before/after measurements with comparable source/build/native/fixture/resource
   provenance. Keep mechanism savings separate from application responsiveness. Accept only the
   predeclared worthwhile benefit, with no unexplained regression on the other affected paths.

No speculative indexes, decoded caches, new query language, lazy-row API or storage migration. Account
for write/index/disk costs if the evidence requires an index change. Put any necessary native change
in its owning repository with its own acceptance; do not silently relax comparison provenance.

## Stage 4 Allocation and codec improvements

Evaluate at most two localized candidates from Stage 2, in separate focused implementation PRs when
they have independent causes. Prefer eliminating an unnecessary traversal, temporary collection,
copy or decode while preserving ownership and public semantics. Do not ship a new serializer, cache
or lifetime-sensitive API as a shortcut.

Verify applicable prototype-sensitive keys, nested/binary values, missing/null, frozen results,
read-your-writes, refusal/original-error behavior and results surviving later commits/close. Reuse the
existing coverage for these contracts. Use unprofiled matched timings and allocation/work evidence
to accept or reject a candidate; detailed-profile timing alone cannot establish a speedup.

Finish each change with the relevant application action and adverse query shapes. Reject candidates
whose benefit is insignificant or whose retention/complexity cost outweighs it. If recording itself
changes, repeat the affected overhead qualification on final code and retain the failed antecedent.

## Validation review and delivery

Run focused tests while developing and the repository gates at stable checkpoints. Use the exact
native pin for application validation. Reuse valid builds and checks; broaden only after a change,
failure or explicit coverage gap. Required final strict CI remains required for implementation PRs;
report pending or failed checks accurately. Do not merge without instruction.

Review the final diffs for semantic changes, lifetime/reentrancy issues, unbounded state, benchmark
bias and test duplication. Fix material issues before delivery. Rewrite each PR description around
its final scope, evidence, invariants and remaining limits; avoid an operational diary.

Closure requires the baseline/evidence PR, the investigation PR, and all justified implementation
PRs to be committed/pushed and reviewable. Each selected query and allocation candidate must have a
recorded disposition. The final report distinguishes measured wins, rejected ideas, remaining
uncertainties and checks; it does not promise that all four investigation categories need code changes.
