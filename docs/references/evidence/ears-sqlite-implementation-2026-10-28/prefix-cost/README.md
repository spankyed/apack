# Ranked-prefix cost cohort — 2026-10-29

Preregistered at 76b1aa2765. All six fresh processes completed in exactly legacy / postings / prefix /
prefix / postings / legacy order, with identical fixtures, two CPUs/6 GiB and 180 seconds each. Controls
are SQLite revisions 9a2771ec25 and c132441538; this is **not an elmdb-versus-SQLite comparison**. Node
23.11.1 / SQLite 3.53.4 and both loaded native hashes match across all six. Lockfiles remain unchanged.
Every expected answer and complete highlight passes; no retry, discarded sample or budget change occurred.
Raw samples, heartbeat, binding calls, files/WAL/RSS and entrypoint/native provenance remain in the archive.

| Measurement | Legacy (trials 1 / 6) | Postings (2 / 5) | Prefix (3 / 4) |
|---|---:|---:|---:|
| Point p50 | 0.078 / 0.079 ms | 0.098 / 0.104 ms | 0.141 / 0.145 ms |
| Point/common p50 | 0.294 / 0.286 ms | 0.671 / 0.694 ms | 0.912 / 0.903 ms |
| Reverse point/common p50 | 0.283 / 0.282 ms | 0.656 / 0.681 ms | 0.878 / 0.883 ms |
| 100-owner/common p50 | 0.642 / 0.517 ms | 3.186 / 3.227 ms | 3.515 / 3.446 ms |
| Reverse 100-owner p50 | 0.628 / 0.516 ms | 3.259 / 3.205 ms | 3.422 / 3.469 ms |
| Selective/global exclusion p50 | 0.075 / 0.066 ms | 0.585 / 0.566 ms | 0.762 / 0.755 ms |
| Reverse exclusion p50 | 0.075 / 0.060 ms | 0.571 / 0.562 ms | 0.729 / 0.733 ms |
| Disjunction p50 | 0.084 / 0.085 ms | 0.131 / 0.126 ms | 0.252 / 0.246 ms |
| Broad limited p50 | 14.969 / 14.489 ms | 29.212 / 29.075 ms | 18.385 / 18.686 ms |
| Broad limited p99 | 21.426 / 16.205 ms | 59.361 / 31.269 ms | 19.751 / 19.987 ms |
| Broad highlighted p50 | 233.379 / 228.280 ms | 61.730 / 61.871 ms | 19.817 / 20.010 ms |
| Broad highlighted p99 | 302.471 / 265.908 ms | 72.154 / 92.139 ms | 22.201 / 84.191 ms |
| Broad recency p50 | 109.913 / 105.384 ms | 56.120 / 56.045 ms | 48.881 / 48.001 ms |
| Broad recency p99 | 126.246 / 125.104 ms | 72.518 / 75.072 ms | 65.067 / 69.134 ms |
| Name write p50 | 0.217 / 0.219 ms | 0.231 / 0.231 ms | 0.230 / 0.230 ms |
| Readiness | 396.7 / 356.7 ms | 1185.7 / 1177.3 ms | 1208.3 / 1251.4 ms |
| Main after build | 22.31 / 22.31 MB | 28.76 / 28.76 MB | 28.76 / 28.76 MB |
| Sampled RSS peak | 346.18 / 344.08 MiB | 260.64 / 261.08 MiB | 197.86 / 240.43 MiB |

The prefix improves broad limited reads by about 36% and highlighted reads by about 68% against the
preceding postings revision. Broad/recency still miss the unchanged latency target; highlighted tails
include an 84 ms sample. Point/conjunction/exclusion queries get modestly slower (point/common about
0.68 to 0.91 ms), so the new ranking wrapper is not a universal win. Writes and main-file bytes stay close.
Readiness retains the source-string/owner layout cost. Sampled RSS is lower here but does not bound memory.

These costs are **not accepted as production qualification**. Next inspect the actual native ranking and
generic recency execution paths/plans before another source change. Preserve this cohort and both earlier
failures. Do not retry identical source, relax budgets or substitute it for phase 3’s failed 100k heartbeat
gate. FULL, fuzzy vocabulary bounds, real corpus/vector quality, full app/packaging and every remaining
phase 3–7 requirement stay open. Functional checks and recovery-alias proof are recorded separately.
