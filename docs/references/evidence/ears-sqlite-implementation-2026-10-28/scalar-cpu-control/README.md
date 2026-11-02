# Fixed-work CPU sentinel, 2026-10-28

Distinct diagnostic following the SQL variants, on unchanged functional source ac84b7d3fb through local e23636b763.
One fresh 100k primary profile, no watches or background indexing. Alternate actual generated SQL, EARS facade and
a pure JavaScript three-million-iteration integer loop in forward/reverse blocks; 500 calls per mode. The loop's
checksum is consumed in the output. Its amount of work is fixed and is not calibrated to SQL duration. All SQL
answers match the known first ten ids. Owned two-core / 6 GiB Linux, Node 23.11.1, SQLite 3.53.4; fingerprints retained.
The process finishes successfully. It is not a new admission qualification or a replacement for its failed sample.

| Diagnostic path | Median | p99 | Maximum | Samples >16 ms |
|---|---:|---:|---:|---:|
| EARS facade | 1.624 ms | 11.30 ms | 41.41 ms | 2 |
| Actual generated SQL | 1.488 ms | 9.33 ms | 25.26 ms | 1 |
| Fixed JS integer loop | 3.970 ms | 27.48 ms | 119.84 ms | 11 |

Large outliers do not require a database call. However, the loop runs longer than a typical SQL call and its eleven
outliers occur within the first 143 of 500 calls (zero-based indices 11–142). JIT warmup/compilation, process/runtime
activity and guest/host effects remain possible; this does not prove host contention or eliminate a database cause
for the original cleanup miss. Process CPU deltas mostly follow elapsed time, but include other process threads.
Keep cold samples; do not discard their tails or select the best diagnostic p99 as a passing qualification.

The targeted predicate variants provided no compelling median gain. Do not add query compiler complexity or tune
watch/batch constants merely to obtain a green synthetic run. Next separate runtime/host effects with controlled
cold/steady-state and long-running resource evidence while continuing the required actual app/storage lifecycle
integration. The original 16 ms workload target, failed cohort, large-text/FULL and all phase 3–7 requirements remain.
