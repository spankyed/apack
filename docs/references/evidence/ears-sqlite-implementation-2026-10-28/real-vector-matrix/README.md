# Real-model native vector decision gate

Original source: `5fb4893b7f67f8adf1ae2b2b58096f952b75f152`. Follow-on source: `42f408b1ff`.
Independent oracle source: `5f613394f5`. All runs are Linux ARM64 / Node 23.11.1, 2 CPUs, 6 GiB, zero swap, capabilities dropped, with actual mode-denial verified. Production dependencies and EARS execution are unchanged.

The committed protocol fixes 100 held-out queries, 1k/10k/99,900 real publisher-labeled 1536D embeddings, trash filtering, three eligibility scopes, initial/update phases, one first pass and three timed passes. All scalar oracle cross-checks pass for the first query’s returned top answers in all 18 cohorts. This checks scalar agreement, not a separate exhaustive oracle implementation.

## Original matrix: not accepted

All nine processes complete, but no strategy passes all requirements. IVF’s fixed 16 probes lose recall, especially under restrictive filters. Each original invocation trained independently, so differences between 256 and 1,024 candidates do not isolate K. No training-repeat robustness is established.

100k initial phase, pooled three timed passes (300 query calls per row):

| Strategy | Eligible scope | Mean recall@10 | Query p95 ms | Heartbeat p99 ms |
|---|---:|---:|---:|---:|
| flat | 100% | 1.000 | 101.79 | 103.68 |
| flat | 10% | 1.000 | 68.18 | 69.76 |
| flat | 1% | 1.000 | 64.83 | 69.73 |
| ivf-bq-1024 | 100% | 0.967 | 39.90 | 44.44 |
| ivf-bq-1024 | 10% | 0.941 | 11.47 | 12.81 |
| ivf-bq-1024 | 1% | 0.863 | 6.31 | 8.00 |
| ivf-bq-256 | 100% | 0.969 | 6.48 | 7.40 |
| ivf-bq-256 | 10% | 0.940 | 6.36 | 7.32 |
| ivf-bq-256 | 1% | 0.847 | 5.88 | 6.80 |

Flat matches initial answers, but the full updated cohort has two exact duplicate cutoff ties: updated ordinals 10,207 and 23,207 reuse original vectors 41,544 and 54,544. Native K=10 returns the later owner, giving strict recall 0.998. Reranking only the returned ten cannot restore deterministic creation order. Treat this as a correctness failure, not as an allowed approximation of exact execution. The logical update mapping explains the ties; an attempted post-run native byte inspection found the intentionally cleaned-up database absent, and does not establish a separate byte control.

Flat’s 100k heartbeat remains far above 16 ms. Broad IVF can exceed 0.95 mean recall on this sample while narrower scopes fail. Per-query recall is substantially lower than the mean in some queries. Do not replace those failures with aggregate broad recall.

The separately preregistered follow-on scans all binary codes before exact reranking and shares the identical hashed model between candidate limits. Its results and final disposition follow below; original failures remain retained.

Raw JSON/logs are gzip-compressed with zero gzip timestamp. Reports include every query, answer ordinals, candidate counts, latency and heartbeat samples; no source IDs, text, embedding payload or private model bytes enter Git. The private corpus card declares no license: this evidence does not authorize redistribution.

This is a native primitive gate. Transaction/owner/chunk/model freshness, background admission, realistic hybrid queries, numeric extremes, full application responsiveness, other OS/architectures and the rest of goal phases 3–7 remain required. No speedup against integrated elmdb or production adoption is established.


## Full binary-scan follow-on

All six processes complete, and each cohort uses identical model bytes for both candidate limits. All 36 scope/phase/cohort mean recall checks exceed 0.95. This does not satisfy the heartbeat gate. No EARS integration or production dependency is added.

100k pooled timed results:

| Strategy | Phase | Scope | Mean recall | Query p95 ms | Heartbeat p99 ms |
|---|---|---:|---:|---:|---:|
| scan-bq-1024 | initial | 100% | 1.000 | 29.80 | 33.05 |
| scan-bq-1024 | initial | 10% | 1.000 | 22.05 | 23.28 |
| scan-bq-1024 | initial | 1% | 1.000 | 19.31 | 29.17 |
| scan-bq-1024 | updated | 100% | 1.000 | 22.20 | 23.26 |
| scan-bq-1024 | updated | 10% | 1.000 | 22.57 | 26.90 |
| scan-bq-1024 | updated | 1% | 1.000 | 19.35 | 21.85 |
| scan-bq-256 | initial | 100% | 0.989 | 16.55 | 17.54 |
| scan-bq-256 | initial | 10% | 0.991 | 16.41 | 17.28 |
| scan-bq-256 | initial | 1% | 0.999 | 16.36 | 17.37 |
| scan-bq-256 | updated | 100% | 0.989 | 16.83 | 18.13 |
| scan-bq-256 | updated | 10% | 0.990 | 16.80 | 17.70 |
| scan-bq-256 | updated | 1% | 0.999 | 16.69 | 21.74 |

Next: compare the existing sqlite-vec binary primitive against this result before adding another production native dependency; then integrate the chosen native candidate execution with exact reranking and selective exact fallback. Preserve canonical bytes, multiple-chunk owner scoring, deterministic owner ties, generation/model freshness and own-unit/savepoint visibility. Move expensive execution and admission away from the main thread without substituting a stale worker snapshot for own transaction reads. Qualify real EARS/pack/view behavior and the original latency, responsiveness, resource and platform gates.

Setup failures are retained separately: the explicit unprivileged user could not read the private dependency volume, and the tmpfs scratch attempt compiled but failed extension loading before any query. The final container uses its existing dependency owner with all capabilities dropped, verifies actual mode denial, and uses a private ordinary container filesystem. A specific loader root cause for the tmpfs attempt was not isolated. These setup failures are not benchmark samples.
