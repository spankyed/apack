# FULL value admission runtime trace at df0bb4ce5e

The dedicated value/FULL job in [run 41252485895](https://github.com/spankyed/apack/actions/runs/41252485895), source `df0bb4ce5ed4d6137e6c6a3080a4ae462a8997db`, completed successfully under verified 2 CPU/6 GiB/no swap. This is one instrumented 100k synthetic trial, explicitly **not ordinary latency acceptance**. The parent workflow still had an unrelated macOS app job queued when this receipt was recorded; job success is not whole-workflow success.

Admission takes 3.22ms, foreground operation p99 1.90ms, lookup p99 2.98ms and heartbeat delay p99 11.09ms. All recorded budgets pass in this trial. Background build and retirement spans peak at 6.84ms and 10.63ms, respectively. Thus this trace does **not reproduce** the 100–372ms steps seen in the earlier ordinary FULL trials, and cannot establish their cause or clear their five heartbeat failures.

Across the measured runtime, cgroup throttle count/time do not increase. There are 74 GC events, totaling 32.94ms, with maximum duration 0.90ms. Those observations apply only to this trace. The inspector records 36,400 samples; most sampled self time has an anonymous/native frame without source location, so it cannot isolate fsync or exclusive SQLite CPU time. No durability, checkpoint, batch or latency-budget change follows from this non-reproduction.

Compressed raw numeric/synthetic reports and profile plus hashes retain the trace for independent analysis. This contains no database profile, corpus text or embedding payload. Production acceptance still requires ordinary repeated trials and the rest of the goal's workload, relevance and platform gates.

Inspecting the queued job also found a workflow routing defect: generic `check` did not exclude `sqlite-admission`, so every dedicated admission run unnecessarily scheduled a macOS application build. The subsequent source correction adds that exclusion, with static positive controls for dedicated suites and negative controls preserving generic app suites. It does not cancel or alter the existing run.
