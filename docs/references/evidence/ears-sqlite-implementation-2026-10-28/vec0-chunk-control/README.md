# Stable sqlite-vec chunk control, 2026-10-29

Benchmark source `24804f6587`, actual full hashes in raw reports. Existing sqlite-vec 0.1.9; no native fork or production dependency/layout change. Same canonical private 99,900-row real 1536D corpus, 100 observed queries, initial/updated phases, all eligibility scopes, K=256 and exact reranking. One first pass and three timed passes per group. FULL WAL, app-matched 64 MiB cache, private ordinary container filesystem. Two CPUs, 6 GiB RAM, no swap, dropped capabilities and actual mode-denial.

| Chunk | Phase | Scope | Mean recall | Query p95 ms | Heartbeat p99 ms |
|---|---|---|---|---|---|
| 64 | initial | 100% | 1.000 | 29.43 | 30.45 |
| 64 | initial | 10% | 1.000 | 14.01 | 18.16 |
| 64 | initial | 1% | 1.000 | 9.35 | 10.80 |
| 64 | updated | 100% | 1.000 | 30.26 | 31.89 |
| 64 | updated | 10% | 0.999 | 11.92 | 13.03 |
| 64 | updated | 1% | 1.000 | 9.19 | 10.16 |
| 128 | initial | 100% | 1.000 | 38.72 | 39.87 |
| 128 | initial | 10% | 1.000 | 12.39 | 13.32 |
| 128 | initial | 1% | 1.000 | 7.65 | 8.78 |
| 128 | updated | 100% | 1.000 | 39.46 | 41.16 |
| 128 | updated | 10% | 0.999 | 12.52 | 13.56 |
| 128 | updated | 1% | 1.000 | 7.86 | 8.80 |
| 256 | initial | 100% | 1.000 | 58.37 | 59.92 |
| 256 | initial | 10% | 1.000 | 16.48 | 20.71 |
| 256 | initial | 1% | 1.000 | 7.43 | 8.36 |
| 256 | updated | 100% | 1.000 | 58.78 | 60.13 |
| 256 | updated | 10% | 0.999 | 15.58 | 16.58 |
| 256 | updated | 1% | 1.000 | 7.63 | 8.52 |

All sampled recall groups clear 0.95, but every configuration misses broad heartbeat responsiveness. Smaller chunks do not establish the hypothesized broad improvement; a mixture of per-chunk selection, global merging and chunk access may matter, but no profile attributes the cost. Do not select a production chunk size or claim a universal speedup from these results.

The [1024-row default baseline](../real-vector-matrix/sqlite-vec/README.md) remains retained separately; these are sequential exploratory configuration runs, not randomized paired evidence or fresh held-out acceptance. Query/heartbeat samples, returned ranks, native hashes and load/update/resource receipts are retained. Corpus/model payloads remain outside Git.

The unchanged goal still requires an explicit viable native vector execution strategy, arbitrary owner filters before K, owner aggregation, own-unit/savepoint visibility, background admission/update bounds, fresh held-out quality, actual integrated responsiveness and platform qualification. Neither this control nor the [vec1 owner-filter result](../vec1-owner-scope/README.md) completes those requirements. No dependency or runtime change follows.
