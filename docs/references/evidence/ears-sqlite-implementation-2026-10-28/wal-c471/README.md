# Checkpoint overlap capacity

[Run 41368637752](https://github.com/spankyed/apack/actions/runs/41368637752), source `c471c7f8f0885098cd4a4acf5bccbfbc038956f5`, passes all four v3 resource cohorts: burst/sustained writes with released/retained readers. The matching built package runs in disposable Linux at two CPUs, 6 GiB/no swap, FULL synchronous mode and the ordinary 1,000-page auto-checkpoint. Burst uses 512 writes; sustained uses 4,096 paced 64-KiB writes over two minutes. Snapshot visibility, busy refusal/unchanged sequence/reuse, read-only reopen/integrity and scratch cleanup pass in every cohort. Original complete numeric reports are gzip-preserved with decompressed SHA-256; progress files are not substituted for completed reports.

| Regime / reader | Write p95 | Writer heartbeat p99 | Explicit overlap bytes | FULL / TRUNCATE |
| --- | --- | --- | --- | --- |
| Burst / released | 1.46 ms | 6.02 ms | 34,123,776 | 0.06 / 0.05 ms |
| Burst / retained | 1.53 ms | 2.78 ms | 94,065,112 | 61.18 / 10.16 ms |
| Sustained / released | 2.58 ms | 1.19 ms | 271,437,824 | 0.06 / 0.09 ms |
| Sustained / retained | 4.24 ms | 3.66 ms | 765,226,648 | 735.15 / 86.18 ms |

The sustained retained-reader cohort shows why post-commit samples were incomplete capacity evidence: before release the main database is 192,512 bytes and WAL 492,838,552 bytes. After explicit FULL checkpoint, main grows to 271,405,056 bytes while WAL still occupies 492,838,552 bytes, plus 983,040 shared-memory bytes. Logical overlap is 765,226,648 bytes; allocated overlap is 765,231,104. TRUNCATE/reopen leaves 271,437,824 logical bytes with WAL zero. The overlap is about 55% larger than the earlier 494-MB post-commit sample for this fixture. Provision headroom for both growing database and retained WAL; this is not an instantaneous peak bound.

The two-call FULL/sample/TRUNCATE sequence deliberately exposes coexistence and measures each synchronous call; it is not the ordinary one-call TRUNCATE timing or a new product checkpoint policy. Its retained-reader maintenance calls exceed the 16-ms foreground budget. Write-loop heartbeat percentiles exclude this later maintenance and therefore cannot establish checkpoint/application responsiveness. Separate maintenance heartbeat is sparse and includes instrumentation, so it is not percentile qualification. The retained sustained process maxRSS through FULL is 203,584 KiB, including setup/instrumentation, not isolated checkpoint allocation or a general memory bound.

This closes the missing explicit overlap witness for the selected fixture. It does not establish saturation throughput, indefinite reader retention, independent-device variance, physical power-loss behavior, arbitrary filesystems, all application resource limits or final-source adoption acceptance. Production maintenance placement/foreground responsiveness remains an owned concern.
