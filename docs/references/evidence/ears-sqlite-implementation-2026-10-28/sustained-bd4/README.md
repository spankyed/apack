# Repeated matched durable write/watch workload

[Run 41340220925](https://github.com/spankyed/apack/actions/runs/41340220925), source `bd4e6f9506d6eee29a64158794cbe4b876d58489`, completes all twelve fresh-process trials. Each writes for 60 seconds into 20,000 tasks, with three repetitions per backend/views-open-or-closed combination and alternating backend/mode order. Every mutation uses a durable unit on both engines; every open view converges. Native is pinned to `f496470679a7bd9764398108b20f62a73333c701`.

One AMD EPYC 9V45 runner enforces 2 CPU/6 GiB/no swap. The workload's human-readable conditions show four host logical CPUs; the retained cgroup limits are the actual two-CPU cap. Both backends execute matching built packages in separate fresh processes, whose loaded native bindings are fingerprinted. This compares acknowledged durable operations on this runner; it does not prove identical physical-device flush mechanics or power-loss safety.

| Trial | Views | Backend | Commits/s | Ack p95 ms | Heartbeat p99 ms | Maximum heartbeat ms | Ordered read mean ms |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | none | sqlite | 3813 | 0.34 | 0.91 | 146.51 | — |
| 1 | none | elmdb | 2651 | 0.19 | 26.20 | 69.68 | — |
| 1 | views | sqlite | 2612 | 0.36 | 15.98 | 58.58 | 32.761 |
| 1 | views | elmdb | 2711 | 0.20 | 26.06 | 59.23 | 10.686 |
| 2 | views | elmdb | 2712 | 0.22 | 29.39 | 87.02 | 11.013 |
| 2 | views | sqlite | 2466 | 0.38 | 4.77 | 64.11 | 36.047 |
| 2 | none | elmdb | 2843 | 0.19 | 24.91 | 51.98 | — |
| 2 | none | sqlite | 3602 | 0.35 | 3.02 | 58.60 | — |
| 3 | none | sqlite | 4092 | 0.34 | 0.44 | 15.00 | — |
| 3 | none | elmdb | 2841 | 0.20 | 24.41 | 115.58 | — |
| 3 | views | sqlite | 2274 | 0.38 | 11.50 | 103.71 | 41.094 |
| 3 | views | elmdb | 2718 | 0.20 | 40.16 | 71.96 | 14.19 |

Median throughput with views closed is SQLite 3,813/native 2,841 commits/s; with views open it is SQLite 2,466/native 2,712. SQLite's heartbeat p99 passes 16 ms in all six cohorts; native misses it in all six. This is an observed workload-specific advantage, not a universal engine speedup. SQLite's ordered-view mean is 32.76–41.09 ms versus native 10.69–14.19 ms, while its acknowledgment p95 is also higher. The repeated samples show costs and tradeoffs rather than one winning ratio.

Maximum stalls remain: SQLite reaches 146.51 ms without views and 103.71 ms with them. Passing the sample-based p99 does not bound individual stalls or qualify actual renderer/search/streaming responsiveness. Process maxRSS is 210.6–277.9 MiB for SQLite and 267.2–280.9 MiB for native, including fixture setup and workload instrumentation (not engine-only memory or OS page cache). Process CPU share is higher for SQLite in these samples. Peak disk/WAL, cold/reopen/device variance and realistic app flows remain separate requirements.

The older five-second Seagate pilot used different hardware/source/storage; do not infer a causal cross-host speedup from the much shorter current ordered reads. These synthetic typed projections are not a corpus/vector/search qualification, and do not clear retained broad-search or ordinary-admission misses. Workflow success means all complete/convergent measurements executed; the matrix deliberately retains `qualification: false` and each original heartbeat result.

Thirteen explicit original JSON reports are compressed unchanged with decompressed SHA-256 hashes, including every raw deadline heartbeat sample. Duplicate stdout, logs, database/profile files and traces are omitted. No production behavior, durability, probe/candidate policy, deadline or acceptance budget changes.
