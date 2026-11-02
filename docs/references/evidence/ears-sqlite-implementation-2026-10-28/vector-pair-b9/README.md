# Paired generic/AVX2 corpus: no consistent foreground-query benefit

[Run 41303652459](https://github.com/spankyed/apack/actions/runs/41303652459), source `b9f05c894ac15d13c76051d188ddd3411f77bfb9`, completes both builds on the same AMD EPYC 7763 runner with Node 23.11.1, SQLite 3.53.4, enforced 2 CPU/6 GiB/no swap. Trusted generic and diagnostic extensions report Scalar and AVX2 respectively; worker runtime/artifact provenance matches each foreground extension. The manifest/oracle/source/run/CPU/limits match across all six fresh query processes. Both variants pass all 1800 query/reference cases (all three recall depths), all scopes/families meet mean recall ≥0.95, and both pass the 100/200ms query-p95 targets. Minimum dispatch mean recall is 0.955. Twenty-one preflight safeguards and the bounded cross-model/membership checks pass. Private/database scratch is removed, and all three sampled read-only reopen passes preserve answers per size/build.

| 99.9k scope/family | Scalar query p95 (ms) | AVX2 query p95 (ms) | Scalar heartbeat p99 (ms) | AVX2 heartbeat p99 (ms) |
| --- | --- | --- | --- | --- |
| all / lexical | 66.16 | 66.88 | 103.45 | 96.53 |
| all / held-out | 69.30 | 76.18 | 90.45 | 93.24 |
| 1% / lexical | 20.73 | 20.51 | 25.92 | 27.14 |
| 1% / held-out | 24.37 | 23.44 | 25.97 | 25.69 |
| 10% / lexical | 104.04 | 101.66 | 111.01 | 108.63 |
| 10% / held-out | 105.35 | 103.33 | 108.59 | 110.92 |

There is no consistent foreground-query improvement in this pair. Both builds still fail all six 99.9k heartbeat groups and both 10k all-live groups. At 10k, all-live p95 is approximately 21–22ms for both; narrow scopes meet the pulse target in this pair. Earlier failed groups remain historical failures, not retrospectively cleared by this source/run.

Model admission at 99.9k is 47437ms generic versus 12988ms dispatch in this single pair. This is promising for background build time, not a causal speedup or model-variance qualification: each size/build trains its own model, order/cache is uncontrolled (the middle-size pair is reversed), and model hashes differ. Queries include FTS, eligibility, canonical reranking, driver and JS work outside the vec1 explicit AVX2 paths. Do not promote an artifact or lower probes from this result. The foreground allocation/highlight finding is separate work after this source.

Relevance again passes hybrid 25/25 on both engines with one pinned English model; keyword none/en remains 24/25 on each. Complete numeric reports, provenance, preflight outcomes, language/relevance results and cleanup are compressed here with original decompressed hashes. summary.json is a derived convenience. Reports retain process/reference/native costs and sampled logical files; these are not engine-only memory, exact allocated disk peaks, physical power-loss or final app/platform/resource acceptance. No private corpus text/vectors/IDs are retained.

This source predates the hybrid winner-highlight correction and worker SQL-interface type fix. It certifies neither. Default package artifacts remain generic; unsupported-CPU execution, full native faults, cross-platform/installed/signing and final-source requirements stay open.
