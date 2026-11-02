# Matched post-Seagate vector matrix: complete observations, failed acceptance

Both backends finish18cohorts ×fourpasses ×100queries =7200actual queries at frozen runtimea9c9340df7, on the same OrbStack/Seagate boundary with2CPU/6GiB/no swap. The corpus, held-out truth, logical eligibility and original thresholds match. Native uses pinned2441/hannoy0.3.0; SQLite uses the unchanged normal selected compact-IN extension and64-bucket/32-probe trained model. This is not OS-cold or full fresh ingestion. Native starts from a compacted resumed snapshot; SQLite starts from a closed primary snapshot and reuses its trained model. Their physical histories differ.

SQLite verifies all99900 canonical vectors before/after admission and after999-owner updates, with strict byte hashes and unchanged base/incumbent hashes. Native remains diagnostic-only: four signed-zero losses in complete scans keep its byte gate failed, with no other component changes. Its[complete evidence](../native-zero-sign-matrix-completed/README.md) remains authoritative. No normalization or waiver is applied.

## Observed query results

Every cohort/pass mean recall passes: minimum.986 native and.973 SQLite. Native fails35of72 heartbeat passes and two latency passes; SQLite fails49heartbeat passes and four latency passes. Both frozen gates remain false. SQLite is slower in15of18 pooled timed cohorts; it wins the two10k/1% cohorts and updated99.9k/10% cohort. These are observations from one matched run, not confidence intervals or a universal database ranking.

The table uses nearest-rank p95 over the300samples from passes1–3 of each cohort, not an average of percentiles. Ratio above1 means SQLite slower. Original gates are still evaluated separately on each original pass, including pass0. First-pass values and all raw samples remain in summary/probe.json; first pass must not be relabeled OS-cold. SQLite first-pass p95 reaches1469ms in the initial10k/all-scope cohort, despite later timed p95 around52ms. No attribution establishes the precise cause of that first-pass gap.

| Phase | Rows | Eligible scope | Native p95 ms | SQLite p95 ms | SQLite/native |
| --- | ---: | ---: | ---: | ---: | ---: |
| initial | 1000 | 100% | 2.54 | 8.04 | 3.17 |
| initial | 1000 | 10% | 1.39 | 10.29 | 7.41 |
| initial | 1000 | 1% | 1.30 | 2.61 | 2.02 |
| initial | 10000 | 100% | 34.17 | 52.43 | 1.53 |
| initial | 10000 | 10% | 14.27 | 22.80 | 1.60 |
| initial | 10000 | 1% | 9.99 | 4.81 | 0.48 |
| initial | 99900 | 100% | 7.48 | 25.59 | 3.42 |
| initial | 99900 | 10% | 40.92 | 62.95 | 1.54 |
| initial | 99900 | 1% | 4.66 | 15.25 | 3.27 |
| updated | 1000 | 100% | 3.13 | 11.56 | 3.69 |
| updated | 1000 | 10% | 1.99 | 10.48 | 5.28 |
| updated | 1000 | 1% | 1.45 | 2.93 | 2.02 |
| updated | 10000 | 100% | 40.86 | 54.12 | 1.32 |
| updated | 10000 | 10% | 14.84 | 21.16 | 1.43 |
| updated | 10000 | 1% | 26.29 | 6.89 | 0.26 |
| updated | 99900 | 100% | 22.66 | 33.18 | 1.46 |
| updated | 99900 | 10% | 261.56 | 66.76 | 0.26 |
| updated | 99900 | 1% | 12.73 | 24.52 | 1.93 |

## Updates, admission and resources

The same999-owner update phase with64-item durable batches takes22.020s SQLite versus269.581s native. This is one observed update phase per backend, with different physical index histories; no fresh-ingestion ratio is claimed. Native's remaining27900 embeddings take75.9minutes, not a complete ingestion measurement.

SQLite's physical admission takes1001.973s in1763batches. Summed projection work is8.531s; summed commit time is990.426s (about98.8% of admission wall time). It needs no offline cursor preparation. The4ms projection slice plainly does not bound durable commit or foreground stalls on this storage. Preserve FULL/default checkpoints; do not hide this by weakening acknowledgment or treating row bounds as time bounds. Training-model reuse means this run does not measure production training cost.

Final main-file lengths are1,844,715,520bytes native and1,798,098,944bytes SQLite. These are retained-copy file lengths including free capacity, not peak disk usage, logical payload or fragmentation-adjusted comparisons. SQLite WAL is0 at the reported end after phase reopen; that does not prove bounded peak WAL. Node process maximum RSS is1,780,328KiB native and905,732KiB SQLite. Do not claim half total memory: LMDB mappings and SQLite OS page cache are accounted differently, and process high-water marks omit other processes/kernel cache.

## Disposition and next evidence

This supports neither adoption nor a claim that SQLite cannot serve the app. It establishes selective/update wins alongside substantial query and foreground regressions. Next performance work should attribute scoping/eligibility, candidate selection, reranking and commit stalls on the retained copies before selecting a code/algorithm change. Keep query CPU versus wall time, first versus subsequent passes, and backend ownership/acknowledgments explicit. No unregistered parameter sweep, repeated full matrix for a green result or permanent dual-backend decision follows.

The actual app/load/resource, multi-chunk/hybrid usefulness, remaining physical/worker/unknown-commit faults, exact-input strict/app/packaging checks and maintenance/adoption audit remain required. Raw candidate reports/logs/input hashes are compressed unchanged with receipts. Both final working copies are retained; no database/corpus/model/native binary enters Git.
