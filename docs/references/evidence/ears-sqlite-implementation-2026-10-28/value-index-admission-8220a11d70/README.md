# Value-index admission qualification, source 8220a11d70

Three alternating-size fresh-process trials per 10k/100k fixture were scheduled for each synchronization mode.
Every process owns a disposable SQLite profile and 53 watches. The exact source/native manifests are recorded
per mode. The underlying engine pin is 933aa19; this is a SQLite-only admission workload, not an elmdb performance
comparison. All reported times are milliseconds. Working targets were recorded before measurement in the storage
plan; these are not complete application, long-reader, cold-cache or platform durability qualification.

| Mode | Size-trial | Admission | Foreground operation p99 | Lookup p99 | Timer stall p99 | Budgets |
|---|---|---:|---:|---:|---:|---|
| sync-off | 10000-1 | 1.93 | 2.67 | 4.60 | 7.73 | pass |
| sync-off | 10000-2 | 1.51 | 1.62 | 7.46 | 9.79 | pass |
| sync-off | 10000-3 | 1.47 | 0.99 | 3.00 | 3.12 | pass |
| sync-off | 100000-1 | 1.78 | 2.07 | 13.65 | 8.90 | pass |
| sync-off | 100000-2 | 1.60 | 3.82 | 15.26 | 11.96 | pass |
| sync-off | 100000-3 | 1.25 | 0.72 | 3.54 | 3.57 | pass |
| durable | 10000-1 | 3.64 | 16.79 | 2.38 | 19.39 | FAIL |

All six sync-disabled trials pass the pre-recorded targets, including sampled WAL/file growth, retired-generation
cleanup, watch delivery and commit identity. The first durable/FULL 10k trial fails the 16 ms foreground-operation
and timer-stall p99 targets (16.79 ms and 19.39 ms). The runner preserved its report and stopped as designed; the
remaining durable trials were not run. No target was relaxed or failed sample discarded. This slice is not fully
qualified. Durability/background scheduling still needs work and remeasurement; the cause has not been isolated
to CPU work versus I/O/checkpointing/host variance by this report.

`summary.json` retains quantiles and budgets. Each `<size>-<trial>.json.gz` retains every raw timing/batch sample,
resource observation and assertion outcome; decompress with `gzip -dc`. Empty stderr files record clean execution,
not an omitted failure. The failed trial's nonzero exit reflects its recorded budget failures.

The concurrent work was subsequently merged into master at 98386b36a18d244c19ffb501830b990ed49f7653, adding substring/
regex contracts, watch fixes and elmdb 6ab2f69. Reconcile that pinned input before final qualification. These results
remain evidence for 8220a11d70; they do not establish acceptance of the forthcoming integrated source.
