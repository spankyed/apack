# Cleanup latency diagnostic, 2026-10-28

Diagnostic fixture pin `201a2c8cbb` extends functional pin `ac84b7d3fb` with optional timestamped spans and a
watch control. The production implementation is unchanged. This is the predeclared pair in the benchmark README:
one fresh 100k OFF full-watch process, then one fresh process removing query watches. Both retain 50 point watches,
foreground writes/scalar lookups and the same primary seed/build/retirement work. The control removes three scalar
query watches and three build-only substring watches. Runs are sequential and not order-balanced; instrumentation,
cache/host variation and schedule changes prevent causal or qualification claims from the pair alone.

Owned Linux arm64, Node 23.11.1, SQLite 3.53.4, two CPUs / 6 GiB. The dependency seed and pinned engine are read-only;
source/dependencies are copied to a disposable container. Nothing builds or runs on the daily Mac. Exact source
hashes, loaded native hashes, raw spans, heartbeat samples, stage markers, resource counters and commands are retained.
Heartbeat helper checks and EARS typecheck pass. Both diagnostic processes finish normally with exit 1 for budgets;
neither times out. These diagnostics do not supersede the retained uninstrumented cohort failure.

| Diagnostic | Build / cleanup | Lookup p99 | Heartbeat p99 | Stalls >16 ms |
|---|---:|---:|---:|---:|
| Full watches | 103.48 / 70.47 s | 38.03 ms | 97.40 ms | 1,595 |
| No query watches | 49.06 / 44.90 s | 20.46 ms | 44.73 ms | 433 |

Both keep admission, search-call, operation and observed WAL/file sizes within their original limits. Full-watch
turn p99 also misses (30.92 ms); the control's turn p99 is 9.41 ms. Neither passes the original overall latency
limits. The control is never a smaller replacement qualification workload.

During cleanup, full-watch scalar lookups consume 35.83 s and scalar watch reads 20.14 s, against 5.18 s inside
background batches. With query watches removed, scalar lookups still consume 33.24 s against 4.55 s inside batches.
Cleanup lookup p99 is 25.08 / 18.79 ms, background p99 3.56 / 2.73 ms. Significant overdue timer intervals overlap
foreground lookups in both processes. Watches are material additional measured work, but removing them does not
resolve the miss. Do not attribute all stalls to retirement batches or tune only their row count based on this data.

`analyze.py.txt` intersects spans with each heartbeat's overdue interval `[at-delay, at]`, rather than counting
all work in a whole timer period as stall work. Summed overlap durations are observed overlap, not exclusive CPU
causes: spans can include descheduling, IO and garbage collection. Uncovered time and the worst intervals are
retained in `analysis.json`. Mid-first-process cgroup CPU accounting includes setup and is explicitly labeled;
it is not a matched before/after measurement or a host-contention diagnosis.

Next inspect the generated unindexed scalar lookup plan and profile its execution separately from background
work before choosing a remedy. Preserve the unchanged qualification budgets and failed cohort; FULL, large text,
actual app flows, IO/platform and remaining goal acceptance remain open.
