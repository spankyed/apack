# Built-package fallback vector chunk-skew resources

[Run 41336691997](https://github.com/spankyed/apack/actions/runs/41336691997), source `045a9e76d74d8a7e2d78e611cb9a486739c81af6`, completes three fresh-process synthetic cohorts on one AMD EPYC 9V45 runner, enforced 2 CPU/6 GiB/no swap. Each holds 4,608 owners and 1,536 dimensions fixed, varying one owner's chunks; its only winning vector is in the final chunk. All 20 warm serial queries per cohort verify the top-five identities and scores against independent trigonometric expectations; all owned scratch is removed. This uses untrained fallback selection and low-rank synthetic vectors, not managed ANN recall or representative text/model qualification.

| One owner's chunks | Total chunks | Query p95 ms | Heartbeat p99 ms | Process maxRSS MiB, including setup |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 4,608 | 6.37 | 5.98 | 217.03 |
| 1,024 | 5,631 | 9.68 | 9.27 | 238.14 |
| 16,384 | 20,991 | 80.47 | 91.44 | 325.52 |

The heavy cohort misses the unchanged 16 ms heartbeat limit. Candidate owner caps do not bound chunk work; this fixture retains both fallback candidate scanning and canonical reranking, so these readings do not isolate their individual costs. Capping canonical chunks would violate the winner check. A successful diagnostic step means measurements/correctness completed, not performance acceptance. File sizes are post-query snapshots; process maxRSS includes setup; twenty serial samples are not independent model/trial variance or peak disk measurement.

The same focused run passes all 114 host cases with no exclusions. Shared SQLite has 424 passes/one keyword failure/no exclusions; native has 262 passes/the same failure/162 SQLite-only exclusions. The sole failing shared case is `real repository-content search relevance 'find generated metadata ownership'`. The generated API patch is empty. This run remains red; it does not replace full strict/platform/installed qualification.

Six explicitly inspected original numeric/test reports are compressed unchanged with decompressed SHA-256 hashes. Profiles, database files, logs, traces and build output are omitted. No production candidate/probe/scoring/durability defaults or acceptance limits change.
