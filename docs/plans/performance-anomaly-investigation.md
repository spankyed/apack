# Performance anomaly investigation

Status: investigation complete; local chain and strict CI pending. Base `9bcf4cd9f8`; native pin `1849f68`. Continue independently of the active
thread-opening work and main-checkout validation. Preserve original failures and their source hashes.

## Questions and completion

1. Explain the retained 102.914-second launch by its actual phase, or state exactly what the retained
   evidence cannot establish. Distinguish fresh processes/profiles from cold filesystem cache. Add only
   missing lifecycle evidence that is necessary to reproduce the delay; do not claim later warm passes
   explain it. Fix a demonstrated defect and verify its affected path.
2. Attribute the model-test deadlines to database opening/closing, writes (including durable units),
   reference assertions, query verification and watch waiting. Profile the original full 120/40 workloads
   at fixed seed 20261031 in a disposable runner copy; preserve deadlines and restore its source. Fix
   demonstrated redundant work without reducing isolation, operations, durability or assertions.
3. Reanalyse old and final overhead trials by order, drift, CPU/GC and work. Run a narrower same-mode
   control through the existing suite: one app for search, one closed common seed for startup. Use
   disabled mode for all 50 scheduled actions/launches, predeclare the first ten as control warmup,
   and assign the last forty to logical A/B by the existing ABBA order (twenty each). The suite records
   five warmups plus 45 measured trials; the diagnostic analysis explicitly excludes the next five as
   its second warmup group. Admit the complete raw run before this fixed regrouping. This is a noise
   control, never an overhead qualification or a substitute for a failed 5% budget. Keep actual modes
   in manifests; do not invent recording modes or loosen comparison admission.

## Execution

Use `session/performance-anomalies` in its own worktree, dependencies and Linux work volume. Reuse
an independent copy of installed dependencies and the previously verified native build; do not copy
compiler targets across checkouts. One expensive local Docker run at a time, two CPUs, 6 GiB without
extra swap, 256 MiB shared memory and disk-backed fixtures. Do not cancel existing work.

Start with retained logs and controls. Run focused diagnostic cases before broader qualification;
name the evidence gap for every further run. Instrumented timings are attribution, not accepted app
speed measurements. Preserve exact scripts, phase totals, process/resource data and failed captures.
No timeout increases, workload reductions, tmpfs substitution or speculation-driven runtime changes.

Deliver a finding-by-finding disposition with evidence, fixes and remaining limits. Commit and push
reviewable changes; use the repository chain and required CI at a stable implementation checkpoint.
Documentation-only findings reuse existing valid checks. Do not merge new changes without instruction.


## Current handoff

Read the [finding-by-finding disposition](../references/evidence/2026-10-31-performance-anomalies.md).
The model-fixture and window-discovery fixes passed clean six-job strict CI on `e42fcfc745`. The local
chain failed two compiler deadlines; evidence edits also invalidated its host-unit aggregate proof.
Do not report the local chain as passing. The independent model properties and isolation counterfactual
passed with unchanged 120/40 workloads and deadlines.

A subsequent real-child probe exposed a shutdown timer race. Its corrected eight-case suite passes;
the old implementation fails the strengthened case. The existing simpler state case was replaced,
so test count did not increase. Actual source now passes 15 focused main/testing cases. Initial-only
launch logging is also corrected. Finish typechecks, commit/push the checkpoint and dispatch strict CI.

The bounded Linux candidate build timed out in default-pack preparation before its app probes. Gather
a CPU profile of that one build before another local app run, with unchanged resource limits and
ceiling. Once preparation succeeds, use the existing two smoke cases to verify shared-app launch logs,
then the explicit shutdown-stall probe and one clean real search comparison. Keep all diagnostic and
qualification invocations separate. No native source changes are proposed.

The narrow disabled/disabled controls measured +1.44% search and +0.37% startup; a real startup recording
comparison passed (-1.82%). The historical 102.914-second setup cause and a robust sub-5% short-search
overhead bound remain unestablished. Preserve failures and do not relax the timing or correctness gates.
Do not merge.
