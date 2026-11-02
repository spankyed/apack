# Matched checkpoint policy comparison at 5db

[Run 41314330036](https://github.com/spankyed/apack/actions/runs/41314330036) completes at `5db5e278812703727c8c2f4f9494beb6c93fdb01`, AMD EPYC 7763, Linux/x64, Node 23.11.1, SQLite 3.53.4, 2 CPU/6GiB/no swap. All six fresh 100k FULL value-admission processes pass the unchanged budgets. This is a diagnostic with qualification:false; it does not clear the ordinary 80c failure or establish app acceptance.

| Trial | 1000/128-page heartbeat p99 ms | 1000/128-page GC batch p99 ms | 1000/128-page build+GC seconds |
| --- | --- | --- | --- |
| 1 | 12.972 / 13.025 | 8.78 / 3.12 | 46.119 / 48.602 |
| 2 | 10.272 / 11.036 | 8.03 / 3.11 | 35.567 / 39.517 |
| 3 | 10.069 / 9.687 | 8.07 / 3.15 | 35.561 / 38.267 |

The 128-page control reduces observed WAL size from 4457872 to 848752 bytes and GC batch p99, but lengthens build+GC work in every pair and does not consistently reduce heartbeat delay. No production policy change is justified. Fsync counts/exclusive checkpoint time are not instrumented; this experiment evaluates policy effects without proving checkpoint-exclusive attribution. Filesystem cache, scheduling and storage noise remain uncontrolled. Alternated order and CPU identity are recorded, not substitutes for broader variance/platform evidence. Original foreground/watches/durability/budgets are unchanged; neither inspector nor commit observer is installed.

The diagnosed addon-provenance correction works: actual matching SQLite binary is required while msgpackr's additional native helper remains recorded. Only explicit inspected numeric reports, matrices and source/image/limit receipts are retained unchanged through gzip with original hashes/lengths. Provenance omits host mounts and records the original digest/omission. Duplicate stdout/stderr and all uninspected trees remain in CI/private download. Inputs are synthetic; no vectors, databases or private corpus payload is copied.
