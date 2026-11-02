# Runtime quota/affinity control — 2026-10-28

Preregistered source `7b1d8bab2ec99c505d9bfafd3302d0affe5bca0c`, normal built EARS entries, Node 23.11.1,
SQLite 3.53.4, owned Linux arm64 container, unchanged two-CPU bandwidth quota/6 GiB. Four fresh profiles ran
in quota-only / affinity-two / affinity-two / quota-only order. The affinity children report allowed CPUs 0–1,
controls 0–9; all retain cpu.max 200000/100000. Exact archive, runner, actual entrypoints/native hashes,
all 6,000 samples, CPU profiles, constraints, GC observations and first-150/remaining-350 analysis are retained.

| Process | SQL p99 | Facade p99 | CPU-loop p99 | CPU-loop max |
|---|---:|---:|---:|---:|
| Quota-only 1 | 2.26 ms | 2.51 ms | 4.37 ms | 30.70 ms |
| Affinity-two 2 | 2.20 ms | 2.33 ms | 4.42 ms | 33.61 ms |
| Affinity-two 3 | 2.32 ms | 2.34 ms | 6.92 ms | 32.77 ms |
| Quota-only 4 | 2.38 ms | 2.52 ms | 4.38 ms | 30.71 ms |

Every process completed with the expected answers and 500 calls per mode. There were zero own-group throttle
increments inside every timed window and no captured GC events. Two CPU-loop calls exceed 16 ms in each,
at exactly ordinals 31 and 32. Their process CPU deltas are about 31–35 ms, but those counters include all
process threads, so do not call them exclusive main-thread CPU or prove a particular optimization cause.
This repeatable call-age pattern is not evidence that affinity fixed the old miss. No query/batch rewrite or
runner change is justified by these controls. Zero own-group counters also do not exclude ancestor throttling
or guest/host effects; the kernel's counter scope is narrower than every possible scheduling delay.

This differs from the earlier source/tsx sentinel: normal built entries, profiling and per-call instrumentation
are used equally in all four variants. It does not isolate which change or environment difference accounts for
the earlier tails. First-150 samples remain in whole-run statistics; the stratum is not cold-disk evidence.
No admission/watch work runs here. These results do not supersede the retained 100k admission heartbeat failure,
change its 16 ms target, qualify FULL or prove production resource/latency behavior.

The next preregistered diagnostic traces the actual full-watch 100k OFF admission workload once, recording
GC, CPU samples and cgroup intervals while retaining the existing source/tsx invocation and all original limits.
