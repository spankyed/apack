# Distinct/group corpus-size CPU pilot

Source EARS `2584617f8c`, changed EARS files mounted over verified frozen `a9` dependencies. Disposable Linux arm64, two CPUs/6 GiB/no swap/network. Fresh equivalent typed rows on each backend; syncs disabled, fixture writes outside timed reads. This measures warm query execution, not durability or app responsiveness. Every result matches independently built expected IDs/groups.

72 successful queries: three sizes, two backends, unique numeric rank/20 string buckets, distinct/grouping, three rounds. First round is retained separately; each mean below has only two timed observations. This is a small pilot, not a stable cross-machine ratio.

| Entities | Field | Operation | elmdb ms | SQLite ms |
| --- | --- | --- | ---: | ---: |
| 1000 | rank | distinct | 2.40 | 3.33 |
| 1000 | rank | groupBy | 2.67 | 3.06 |
| 1000 | bucket | distinct | 0.72 | 3.53 |
| 1000 | bucket | groupBy | 0.65 | 4.19 |
| 5000 | rank | distinct | 36.14 | 21.05 |
| 5000 | rank | groupBy | 38.52 | 33.06 |
| 5000 | bucket | distinct | 4.74 | 15.69 |
| 5000 | bucket | groupBy | 4.08 | 16.25 |
| 20000 | rank | distinct | 831.17 | 94.65 |
| 20000 | rank | groupBy | 887.52 | 100.16 |
| 20000 | bucket | distinct | 28.81 | 142.59 |
| 20000 | bucket | groupBy | 102.94 | 131.77 |

At 20k unique numeric keys SQLite is about 8–9 times faster in these samples. The pinned native path searches a growing Vec of previous scalar keys; the candidate uses Map lookup. This is an algorithmic difference, not an inherent database advantage; the native path could receive the same improvement. Native remains faster for 20 string keys, where its scan stays short and SQLite still materializes/project-decodes selected fields.

No original latency/event-loop budget is declared passed. Repeated/larger distributions, native SQL aggregation and reduced distinct materialization remain work under the original goal. The runner has an inherited ordered-query scope label; the actual probe script, hashes and operation reports specify this workload.

Compressed raw observations, logs, hashed inputs and recipes accompany this note; receipts hash uncompressed bytes.
