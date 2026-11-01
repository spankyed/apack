# Current cosine scorer: paired Scalar/AVX2 corpus

[Run 41328523791](https://github.com/spankyed/apack/actions/runs/41328523791), source `3baadcecea7d07fd75bac59594d612e845efd1a9` (runtime identical to `3bc228d580`), completes both managed-model variants on one AMD EPYC 7763 runner at 2 CPU/6 GiB/no swap, Node 23.11.1/SQLite 3.53.4. Both foregrounds actually report `vec1_cos_distance`; trusted extensions report Scalar and AVX2 respectively. This addresses the changed scorer input since the earlier b9 pair.

Each variant verifies 1,800 independent-reference queries. Mean recall at every tested depth/scope/family passes 0.95 (minimum 0.9575 generic, 0.956875 dispatch); all 100 ms/10k and 200 ms/99.9k query-p95 limits pass. Generic misses nine heartbeat groups; dispatch misses eight against the unchanged 16 ms target. Green workflow means diagnostic completion, not full qualification.

| 99.9k scope/family | Scalar query p95 ms | AVX2 query p95 ms | Scalar heartbeat p99 ms | AVX2 heartbeat p99 ms |
| --- | ---: | ---: | ---: | ---: |
| all / lexical | 70.41 | 70.38 | 104.19 | 110.62 |
| all / held-out | 69.83 | 58.45 | 89.94 | 86.06 |
| 1% / lexical | 17.95 | 17.68 | 22.79 | 22.75 |
| 1% / held-out | 19.64 | 20.80 | 22.44 | 22.25 |
| 10% / lexical | 107.55 | 110.94 | 128.29 | 128.05 |
| 10% / held-out | 109.76 | 95.97 | 130.05 | 110.91 |

Results do not establish a consistent foreground remedy or causal speedup: each variant trains independent models, and order/cache/model variance is not controlled. Keep ordinary generic production artifacts, probes, candidate budgets and durability unchanged. Full app/resource/platform/provider and physical failure requirements remain open.

Twelve explicit original numeric/model/aggregate reports are compressed unchanged with decompressed SHA-256 hashes. They contain no source corpus text/vectors/IDs. Acquisition/install logs, relevance per-document output, profiles and database files are omitted. This is not qualification of the later database-admission repair.
