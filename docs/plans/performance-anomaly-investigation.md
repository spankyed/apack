# Performance anomaly investigation

Status: investigation and bounded profiles complete; final startup correction and combined validation in progress. Base `9bcf4cd9f8`; native pin `1849f68`. Continue independently of the active
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


## Completion disposition

Read the [finding-by-finding evidence](../references/evidence/2026-10-31-performance-anomalies.md).

- Model workloads: preserved 120/40 workloads, operation counts, isolation, durability and deadlines.
  Copying a closed empty seed removes redundant durable format creation; the isolation counterfactual fails.
- Window discovery: an unresponsive page no longer defeats the discovery deadline or hides another ready window.
- Shutdown: a real-child counterfactual reproduces an overdue-timer false refusal; the correction preserves
  escalation and requires actual exit. A real application shutdown-stall probe passes.
- Launch evidence: phases are recorded once per application. The maintained shared-app smoke cases verify this.
- Recording: admitted real search comparison is 10.6 → 11.4 ms (+0.8 ms / +7.55%), over the original 5% budget.
  The bounded detailed profile cannot isolate lightweight cost; no recorder rewrite or threshold relaxation.
- Startup: fresh-profile detailed launches take 17.5–19.1 s. Flush parent stacks identify regenerated API
  contact publication. Only those files switch to private atomic publication without durability flushes.
  Secrets and dev-session records retain durable writes. Paired publication measured 2,311.517 ms durable versus 0.150 ms runtime; all three fresh-app probes pass.
  This is an isolated publication win, not a whole-startup latency qualification.
- Historical 102.914-second setup: exact cause remains unestablished. Later passes do not explain it.

Strict CI passed all six jobs on e602e9ad77. The runtime contact correction has a new strict CI checkpoint
in progress. The earlier local broad chain remains failed, with unchanged compiler deadlines and an
invalidated host-unit aggregate proof; do not describe it as passing. Both complete compiler files now pass all 16 focused cases under unchanged deadlines. Validate the combined committed branch against current master through
`session:check` before merging. Finish evidence before that gate and freeze its inputs throughout.

The user authorized completion and merge on November 1. Keep the active main checkout untouched.
No native source changes, workload reductions, timeout increases or acceptance relaxations are authorized.
