# Actual owner-projection query comparison — 2026-10-30

Source `897b609e0186f22a9d188ad3f7a64674749b631d`. Following the
[fixed-model projection controls](../owner-projection-controls/README.md), three independent Node processes
run 900 actual EARS queries each on the same retained updated-only 1536-dimensional snapshot/model:
current library, private metadata-only C lookup, and a SQL-only LEFT JOIN with explicit missing-base refusal.
All 900 paired ordered answers/scores match for each alternative. Minimum cohort mean recall is 0.974.
Every process verifies the same model and whole database-file checksum before/after; this probe does not
newly enumerate all canonical rows, whose earlier verification belongs to the unchanged snapshot evidence.

Observed one-pass medians in milliseconds:

| Corpus rows | Scope | Current | Private C | SQL-only |
| --- | --- | --- | --- | --- |
| 1,000 | 100% | 6.17 | 6.36 | 6.13 |
| 1,000 | 10% | 7.27 | 7.23 | 7.05 |
| 1,000 | 1% | 1.78 | 1.80 | 1.67 |
| 10,000 | 100% | 39.16 | 39.10 | 37.54 |
| 10,000 | 10% | 14.22 | 15.53 | 13.73 |
| 10,000 | 1% | 3.21 | 3.77 | 2.44 |
| 99,900 | 100% | 19.50 | 25.50 | 17.94 |
| 99,900 | 10% | 50.86 | 63.25 | 47.11 |
| 99,900 | 1% | 12.23 | 10.75 | 11.16 |

No protective pauses occurred under the two-CPU/6-GiB/no-swap boundary. Fixed baseline/C/SQL order, OS caches
and system scheduling remain limitations. The unchanged PQ scan's hardware ticks vary between processes,
so these observations cannot attribute latency differences to projection alone. Native counters measure
hardware ticks, not CPU time, and exclude some result materialization. Actual SQL plans show the bounded
virtual scan driving a primary-key LEFT JOIN; native candidate counts and all answer/score pairs agree.
Independent process peaks are retained, not engine-only memory or isolated lookup allocations.

The SQL observation is modestly lower in several native cohorts; the C observation does not establish a
benefit. Every variant still observes heartbeat misses above 16 ms. This single updated-only pass per
cohort is not the full initial/update/four-pass acceptance protocol. No C or SQL alternative is promoted:
additional native patch ownership is unwarranted by this result, and direct shadow-schema SQL needs a
maintenance/corruption review plus full owner/multi-chunk/unit/platform proof before selection. The ordinary
packaged library remains byte-identical. Preserve original ANN/cache/durability settings and every failed
response gate; scoped SQL execution and durable admission costs remain unresolved.
