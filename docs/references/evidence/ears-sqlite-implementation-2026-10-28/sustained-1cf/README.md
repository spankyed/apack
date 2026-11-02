# Repeated sustained write/watch and actual ordering control

[Run 41345726834](https://github.com/spankyed/apack/actions/runs/41345726834), source `1cf08f7ec03ac2b321b1750d192d7a0918d5e071`, completes all twelve fresh-process 60-second/20,000-task cohorts under actual 2-CPU/6-GiB/no-swap limits, with durable units on both backends and all views converged. Same alternating backend/mode order as the [pre-correction baseline](../sustained-bd4/README.md). It runs the numeric-order correction; it predates the later master rebase. Node 23.11.1, AMD EPYC 9V45 host identity; the four visible logical CPUs in human conditions do not override the two-CPU cgroup.

The actual source mutation control passes all 28 ordinary ordering cost cases, then removes the admitted-type hint and fails exactly the retained inline discovery-cost assertion. Original and restored source hashes match; the CI step also requires a clean git diff. These original reports and verification are preserved, excluding stdout/log duplicates. The original matrix and twelve numeric workload reports retain raw heartbeat arrays, process resources and native/compiled hashes. SHA256SUMS names decompressed bytes. No database or private profile payload is published.

| Trial | Views | Backend | Commits/s | Ack p95 ms | Heartbeat p99 ms | Max stall ms | Ordered mean ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | none | sqlite | 4449 | 0.32 | 0.41 | 68.40 | — |
| 1 | none | elmdb | 2812 | 0.18 | 27.23 | 160.24 | — |
| 1 | views | sqlite | 2815 | 0.34 | 14.70 | 125.78 | 28.702 |
| 1 | views | elmdb | 2841 | 0.20 | 14.50 | 53.77 | 9.685 |
| 2 | views | elmdb | 2841 | 0.20 | 14.83 | 108.14 | 9.67 |
| 2 | views | sqlite | 2869 | 0.33 | 16.12 | 57.08 | 28.601 |
| 2 | none | elmdb | 2841 | 0.18 | 26.99 | 170.83 | — |
| 2 | none | sqlite | 4463 | 0.32 | 0.41 | 89.11 | — |
| 3 | none | sqlite | 4515 | 0.31 | 0.35 | 35.04 | — |
| 3 | none | elmdb | 2710 | 0.18 | 28.86 | 81.36 | — |
| 3 | views | sqlite | 2825 | 0.34 | 27.88 | 66.89 | 28.565 |
| 3 | views | elmdb | 2841 | 0.18 | 15.30 | 128.88 | 9.675 |

Closed-view median throughput is SQLite/native 4,463/2,812 commits/s; open-view median is 2,825/2,841. SQLite ordered means are 28.565–28.702 ms versus native 9.670–9.685 ms. The earlier SQLite range was 32.761–41.094 ms, but native and closed-view timings also change between runs; separate VM/process/model/cache states prevent attributing the cross-run difference solely to the optimization. The actual regression control proves removal of the redundant discovery work, not its causal wall-time benefit.

SQLite passes the original 16-ms heartbeat p99 limit in all three closed-view cohorts and only one of three open-view cohorts (14.70, 16.12, 27.88 ms). Native misses all closed-view cohorts but passes all three open-view cohorts (14.50, 14.83, 15.30 ms). Earlier SQLite six-of-six passes and native six-of-six misses are not a stable universal ranking. Maximum SQLite stalls still reach 125.78 ms; native reaches 170.83 ms. SQLite acknowledgment p95 remains higher. Process memory includes setup, instrumentation and growing sample maps; it is not engine-only or OS-cache memory.

Diagnostic completion is not complete acceptance. Preserve the two current SQLite heartbeat failures, original corpus/admission failures and all final-source/app/variance/resource requirements. No budgets, deadlines or durability policies change. Matching durable unit intent does not prove identical physical flush behavior or physical power-loss safety.
