# Performance anomaly findings

Investigation source `657177c14a`, based on `9bcf4cd9f8`; native source pin
`1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`, Linux binding SHA-256
`9c0469d914d90d0ad7763e84378f0f7149855a85420ae2965dcfb4b4eb2f1474`.
Two CPUs, 6 GiB, no extra swap, 256 MiB shared memory, disk-backed fixtures on the host's external
OrbStack storage. One application workload at a time. These observations certify no other filesystem,
hardware or operating system. Fresh processes and profiles do not establish cold filesystem caches.

## Initial 102.914-second connection

The retained streaming setup failed before any measured action. Its app log records pack registration
in 8.308 seconds and another approximately 32.6 seconds from backend listening to frontend pack ready.
The original driver has no absolute phase anchors to account for the full 102.914 seconds. It cannot
establish a database, graphics, cache or filesystem cause. Keep the setup failure separate from action
latency, and keep cold-start performance unqualified.

A demonstrated discovery defect is fixed: awaiting one renderer evaluation could defeat the discovery
deadline and hide another ready window. The helper now checks windows concurrently, with at most one
pending evaluation per window, and wakes independently of those evaluations. The two new regression
cases fail the old helper; all five focused cases pass the fix. No deadline was raised. Monotonic launch
phase logs now distinguish attachment, application state, viewport and connection, with wall time only
for approximate correlation to retained app logs. These logs live in the test fixture.

Five dedicated fresh-profile probes passed in 18.84–29.16 seconds. A later search-run setup connected
in 34.36 seconds. None reproduces or explains the historical 102.914 seconds. Returning populated
profiles are a different condition and cannot substitute for these measurements.

## Model-test deadlines

At fixed diagnostic seed 20261031, the instrumented original full 120-workload synchronous property took 96.329
seconds: database opening used 89.445 seconds (92.9%), versus 2.505 seconds in native reads and 0.044
seconds disposing all databases. The watched property reached only 20 of its 40 workloads before its
unchanged deadline: opening used 23.667 of 31.794 seconds. Nested phase totals overlap and must not be
summed. Native format bootstrap deliberately forces an initial sync even with periodic syncing off;
ongoing durable units were not the dominant cost. No native durability behavior is changed.

Candidate: create and close one empty public backup with the same schema, then copy its data file into
a fresh directory and open a fresh handle per workload. No live handle, lock file or mutable database is
shared. Keep full operation counts, assertions, savepoints and durable commits. Initial empty-state
assertions make accidental state reuse observable. Acceptance is predeclared in the retained probe:
at least 50% median setup reduction, identical schema and unchanged seed, independent inodes, full
120/40 workloads inside existing deadlines, and assertion failure when files deliberately share an inode.

## Recording variability

The original search comparison measured 12.2 versus 14.1 ms (+15.57%). Its first-half medians were
11.45/11.90 ms, second-half 14.90/15.50 ms. In the recorded-mode renderer, median layout time grew
2.313 to 5.890 ms while the native-read span total stayed approximately 3.177/3.156 ms. This identifies
renderer/layout drift rather than a slower database read as a substantial confounder. It does not prove
why layout grew or establish a memory leak. Post-hoc regrouping does not turn the failed gate into a pass.

The final historical search comparison passed its declared pooled-median criterion at +3.07%, but
removing one ABBA block at a time yields -4.98% to +11.07%. This is sensitivity analysis, not a confidence
interval. A point-estimate pass does not establish a universal 5% overhead bound.

The narrower same-mode controls keep all actual modes disabled: one warmed app for search, one closed
common seed for startup. The original 45 measured plus five warmup records are admitted before the
predeclared last-40 regrouping (20 per logical variant). Median differences are +1.44% search and +0.37%
startup. The controls are diagnostic, not recording qualifications. New API/pack hashes differ from the
historical final run, so these controls cannot retroactively excuse earlier failures.

A same-build real search comparison completed all actions but failed API/worker teardown. Its invocation
is rejected by the existing qualifier and remains failed; raw action medians are diagnostic only. Do not
rewrite invocation evidence or report it as qualified. Startup qualification passed: 7079.14 ms disabled versus 6950.34 ms lightweight (-1.82%), with
20 measured launches per mode and all capture/correctness checks. This is measured variation, not an
instrumentation speedup. The seed probe passed: median total setup fell from 353.16 to 2.35 ms (99.3%);
one-time source/backup creation cost 1472.31 ms. The full fixed-seed model properties passed in 10.773
and 16.271 seconds. Shared-file counterfactual failed after its second workload because its initial state
contained the previous workload's rows and edges. The committed properties retain random seeds.


## Evidence and disposition

Compact reports and diagnostic source snapshots live in
[performance-anomalies-2026-10-31/](performance-anomalies-2026-10-31/). Diagnostic scripts are archived
verbatim, with `.txt` appended; their original working directory was the checkout and their original
location `.apack/`. The follow-up script consumes the committed model fixture copied to
`.apack/model-seeded-candidate.ts`. They are historical probes, not a new supported command. `diagnostics.json` retains
control manifests and all forty regrouped control timings per action, launch phases and original instrumented phase totals;
`historical-overhead-sensitivity.json` retains the reanalysis. `startup-mode-comparison.json` retains the
strictly admitted real comparison. `database-open-probe.json` retains all sixteen balanced observations.
The original instrumentation diff and both model outcomes are preserved. Historical search resource
records retain renderer metric windows, native read durations and backend CPU/GC observations behind
the layout analysis. All per-block statistics are diagnostic sensitivity, not replacement acceptance.

Full raw reports remain on session-owned Docker volume `apack-linux-work-e57d8dafb632` under
`/work/.apack/performance/anomalies-657177c14a` and `anomalies-followup-657177c14a`. The original
102.914-second failure remains on `apack-linux-work-220c5d355e10` under
`/work/.apack/performance/optimization-harness-9eede3e3cd/logs/lightweight-streaming.log` with its
`lightweight-streaming/streaming/playwright/app-0.log`. The previous final qualification is already
retained by the application-performance optimization evidence. No failed invocation was changed.

- Fixed: discovery can no longer wait indefinitely for a renderer evaluation. Focused old-code
  counterfactual fails two cases; fixed helper passes all five. Five fresh-profile probes exercise it.
- Fixed: redundant empty-format bootstrap in the model fixture, preserving workload isolation and scope.
  Typecheck and focused lint passed; full properties passed on the bounded Linux runner.
- Investigated, still unknown: the complete cause of the original 102.914-second setup. No cold-disk
  performance claim follows from fresh-profile passes. New phase logs make recurrence diagnosable.
- Investigated: the earlier two-worker startup A/A control confounded worker and seed differences.
  A single-seed control is much tighter, and a new real startup comparison passes the original budget.
- Still open: short-search lightweight overhead. Historical point estimates are sensitive to order/drift;
  the new same-build raw action difference is +7.59%, but its invocation failed teardown and cannot
  qualify. This is not excused by the +1.44% same-mode control. A targeted recording-cost investigation
  needs an admitted comparison; do not select passing repeats or widen the 5% criterion.
- Newly observed blocker: that search run's API shutdown reported `API process did not exit after
  shutdown signals`, and worker teardown exceeded its existing 120-second deadline. The API was absent
  at a later process inspection, but these logs cannot establish its exact exit time or the cause of the
  stop refusal. The existing qualifier rejected the invocation. The subsequently reproduced timer
  race and its correction are described below; the original invocation remains failed.

## Subsequent shutdown fix

Review identified a concrete false-refusal race. If the main event loop stalls beyond both the
escalation and refusal timers, they can run back to back before Node can deliver the child's exit.
A real child ignores SIGTERM; blocking its parent's event loop for 1.1 seconds reproduces the exact
shutdown error in the original implementation. The strengthened eight-case suite fails one case and
passes seven against the old code; all eight pass the correction.

The existing escalation delay and one-second confirmation grace remain. The grace now begins when
escalation actually executes, leaving an I/O turn for exit notification. A genuine failure to exit
still refuses. The regression replaces the simpler manager-state case and retains its assertion,
so the file still has eight cases. This establishes a bug and its fix, not the complete historical
cause of the retained search teardown failure. A real-app shutdown-stall probe and a new admitted
search comparison remain to run.

Launch-phase logging is also limited to initial connection: later tests sharing the same application
do not report their readiness time as boot time. The public launch clock remains available after
connection. Initial-format syncing is clarified in the existing option documentation.

## Validation checkpoint

Clean strict CI passed all six jobs on `e42fcfc745`:
[run 41266890054](https://github.com/spankyed/apack/actions/runs/41266890054). This covers the window
discovery and model-fixture fixes, before the subsequent shutdown and one-shot logging corrections.
The corrected actual source passes 15 focused cases: process stopping (8), application shutdown (2),
and window discovery (5). Focused main/testing/EARS typechecks and source lint passed. A new strict CI checkpoint is pending.

The local `chain --no-native --cores 2` did not pass. Its integration pool timed out in the unchanged
facade-report case (80 seconds) and dependency-graph beforeAll (240 seconds). Its host unit step also
reported changed inputs because evidence files were added while it ran: its aggregate cache proof is
invalid and is not final acceptance. The separately retained full model runs remain observations of
the unchanged model fixture. Pack unit tests passed (148 files). Preserve the failed local run at
`node_modules/.cache/apack-chain/runs/2026-11-01T02-47-16Z-88980/`; do not increase deadlines or rerun
the full chain to diagnose these compiler cases.

The isolated candidate producer build also exceeded the existing 600-second default-pack build
ceiling, after packages were built successfully. It did not reach the smoke or search diagnostic
phases. This is a preparation failure, not an application measurement. Its exact candidate source
was copied only inside the disposable runner and restored on exit. Profile that specific build on
a quiet host before another local application run; do not count unexecuted probes as passes.

Query, schema, durability and recording contracts are unchanged. The runtime shutdown correction
changes when exit confirmation begins, and still requires the API child to be gone before quit.


## Final lifecycle and recording checkpoint

Strict CI passed all six jobs on `e602e9ad77` ([run 41271153309](https://github.com/spankyed/apack/actions/runs/41271153309)).
On that source, the two maintained shared-app smoke cases passed with exactly one sequence of five
launch phases. A real-app probe blocking the main event loop during quit for 6.5 seconds also passed
with the original shutdown deadlines. The real disabled/lightweight search comparison completed all
correctness checks and teardown and was strictly admitted: **10.6 → 11.4 ms, +0.8 ms / +7.55%**.
It **fails the original 5% recording budget**. Admission is not a timing pass; no passing repeat was
selected. Raw comparison, execution journal and logs are in [followthrough](performance-anomalies-2026-10-31/followthrough/).

The failed producer attempt left a pack-build lock belonging to an absent container. With the
session volume exclusively locked, its exact PID, machine and token were checked before removing
only that stale build lock. The subsequent default-pack build passed in 124.4 seconds, under the
unchanged 600-second ceiling. This establishes the subsequent lock wait, not the cause of the
original preparation timeout or historical 102.914-second application setup.

## Bounded recording-cost profile

The maintained full search corpus ran in detailed mode (5 warmups, 20 measured actions), followed
by three independent fresh-profile startup diagnostics. All completed; CPU/allocation capture
stopped through owner teardown, not its duration cap. The
[summary and analysis](performance-anomalies-2026-10-31/followthrough/profile-summary.json) retain
the method limits. Backend search samples were dominated by idle time (1,583 ms), inspector calls
(959 ms), and GC (829 ms); renderer samples by program/GC and layout work. These are aggregate
sampled times across twenty detailed captures, including profiling machinery, not the cost of
lightweight recording. They do not isolate the 0.8 ms difference or justify a recorder rewrite.
No speculative codec or allocation change is proposed.

Keep the original 5% failure visible alongside its absolute cost. Any replacement policy needs
predeclared action-specific absolute and relative budgets, calibrated against same-mode noise and
user-visible latency before new measurements. Do not choose a threshold just above this result.
Independent lifecycle fixes can merge without claiming recording is within budget.

## Fresh-profile startup attribution

The three detailed launches reached the connected thread surface in **19.086, 17.489 and 17.726 s**.
These are fresh profiles and processes, not cold filesystem caches or unprofiled qualification.
Backend index admission took 0.932–1.320 s. Native file-copy samples and filesystem flushes were
substantial; parent stacks identify `publishApiFiles` through the private writer for the flushes.
This accounts for a measured current startup cost, not the historical 103-second event. Renderer
capture begins after earlier module bootstrap and cannot account for the whole launch.

The endpoint and token describe the current process, are removed at exit, and are regenerated on
each run. A focused correction adds `writePrivateRuntimeFile`: it retains unique 0600 temporaries,
complete byte writes, atomic rename, Windows retries and refusal cleanup, without requesting file
or directory durability. Only API contact files use it. Durable secret and dev-session writes keep
the existing sync and NOT_DURABLE contracts. The [paired writer benchmark](performance-anomalies-2026-10-31/followthrough/runtime-contact-validation/writer-benchmark.json)
ran ten balanced durable/runtime/runtime/durable blocks, twenty trials per path, on disk-backed
`/work` under the maintained two-CPU/6-GiB Linux runner. Publishing the endpoint and 64-character
token took median **2,311.517 ms durable versus 0.150 ms runtime**. Every trial checked token bytes,
0600 mode and exactly two published files. No trials were excluded. This isolates publication cost
on this host/storage configuration; it is not an application latency percentage.

The affected producer/runtime builds passed. Three unprofiled fresh-profile application probes
reached the thread surface and shut down cleanly, with connection phases at **14.666, 15.671 and
24.400 s**. Their variability and different capture mode preclude comparison against the earlier
detailed launches. The historical 103-second event remains unexplained. The focused private-file
suite passes nine cases (eight existing durable contracts and one runtime contract); the API contact
and authentication suite passes all eleven cases. Host/API typechecks and focused correctness lint
pass. Strict CI for this correction is running on `198de6ba5a`.


## Focused compiler recheck before combined validation

After the Linux batch finished, current prerequisite packages were ensured and the two complete
compiler files ran serially on macOS with their original assertions and deadlines. All **16 cases
in two files passed** in 157.46 seconds. The formerly failing facade-report case took 15.304 seconds
within its 80-second deadline; the dependency-graph file completed in 74.657 seconds within its
existing setup/test budgets. No compiler source or deadline changed. This does not retroactively
pass the earlier broad run or prove its environmental cause. The
[focused log](performance-anomalies-2026-10-31/followthrough/focused-compiler.log) is retained.

Final source review found no additional material defect in the window discovery, seed isolation,
shutdown grace or private runtime publication paths. Combined committed-input validation and strict
CI remain required before merge.


## Combined-check orchestration correction

The first clean combined candidate (`cbf8b85487`) passed prerequisites, application builds, all
typechecks, lint, external-pack contracts/fork, the 541-file host unit pool (204.5 s) and pack unit
pool (108.6 s). Its integration pool was actively running when `session:check` killed the **whole
chain at 900 seconds**. That wrapper classified the complete strict repository chain as one install
scenario, although an individual complete integration pool already has a declared 7,200-second
acceptance ceiling. This is an outer orchestration failure, not an integration-test result.

The wrapper now selects the existing acceptance class for the complete chain. No timeout class
value, test deadline, inner step ceiling or idle watchdog changed. The interrupted combined run
remains failed and retained at `integration-7yQ9fb`; a clean combined check must finish before merge.

The corrected session workflow passes its existing eleven integration cases, including setup failure,
validation refusal and source/candidate drift checks. Focused correctness lint also passes.
