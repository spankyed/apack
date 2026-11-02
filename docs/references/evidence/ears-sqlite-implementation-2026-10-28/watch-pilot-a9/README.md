# Matched write/watch pilot on external Docker storage

Frozen built runtime `a9c9340df74f90b85434e8ddafa9742bd6867cbf`; benchmark `006bcb1901`. One disposable Linux arm64 container, two CPUs/6 GiB/no swap/network, OrbStack storage on Seagate. Source hashes are checked; no original corpus database is used. Eight 120-task/one-second smoke cases precede eight 20k-task/five-second cases. Each case creates its own database and waits for logical indexes before measurement. All 16 converge.

This is one fixed-order pilot, not repeated sustained application qualification. Durable mode uses a durable unit for every write on both backends. Default mode retains different policies: elmdb group sync, SQLite FULL per commit. Never interpret default throughput as a matched durable-acknowledgment ratio.

| Backend | Ack | Views | Commits/s | Ack median ms | Ack p95 ms | Settle ms |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| elmdb | durable | open | 3 | 303.74 | 363.75 | 0.4 |
| sqlite | durable | open | 2 | 225.90 | 2645.87 | 15334.9 |
| elmdb | durable | closed | 4 | 265.41 | 365.12 | 0.0 |
| sqlite | durable | closed | 3 | 243.50 | 922.85 | 0.0 |
| elmdb | default | open | 17644 | 0.03 | 0.05 | 0.2 |
| sqlite | default | open | 3 | 239.02 | 819.98 | 15275.7 |
| elmdb | default | closed | 27422 | 0.03 | 0.04 | 0.0 |
| sqlite | default | closed | 4 | 221.26 | 916.34 | 0.0 |

The ordered watch returns about 6.7k projected ranks. SQLite averages about 4.1 seconds per ordered read in both modes and takes about 15 seconds to settle, versus about 15–17 ms per ordered read for elmdb. This query execution regression needs an explain/cost investigation separately from the very expensive durable acknowledgments on this storage. No cause is asserted yet.

Low sampled event-loop p99 is not a responsiveness pass: SQLite durable/open reports p99 1.42 ms but maximum 2650.8 ms, a low-count write workload and 15.3 seconds of settlement. Preserve all raw measurements. Process max RSS includes fixture setup and instrumentation; it excludes OS cache and is not a total-memory comparison. The raw `views` object contains per-view statistics (empty for closed cases); log filenames identify view mode.

Compressed original JSON, per-case stdout, hashes and reproduction scripts accompany this note. No existing acceptance budget is changed.
