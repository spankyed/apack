# Pinned sqlite-vec real-model layout control

Default-cache source `d86458227b`; matched app-cache source `0fe78fc8de`.
All six default-cache and four matched-cache processes complete. Every mean recall check exceeds 0.95; 100k main-thread heartbeat requirements still fail. The pinned dependency remains sqlite-vec 0.1.9; reports retain actual loaded native hashes. No production query path changes in this checkpoint.

The first matrix uses SQLite default cache (2,000 KiB), with temporary databases on the mounted results path. The second uses the actual EARS 65,536 KiB page cache and private Linux overlayfs. Neither isolates cache from filesystem by itself, nor certifies cold/physical storage behavior. The second compares both layouts under the same conditions.

99,900 vectors, initial phase, three pooled timed passes (300 calls per row):

| Cache | Layout | Candidate K | Scope | Recall | Query p95 ms | Heartbeat p99 ms |
|---|---|---:|---:|---:|---:|---:|
| default-cache | vec0-binary | 1024 | 100% | 1.000 | 181.02 | 194.42 |
| default-cache | vec0-binary | 1024 | 10% | 1.000 | 43.22 | 44.43 |
| default-cache | vec0-binary | 1024 | 1% | 1.000 | 13.19 | 14.12 |
| default-cache | vec0-binary | 256 | 100% | 1.000 | 28.36 | 29.41 |
| default-cache | vec0-binary | 256 | 10% | 1.000 | 38.26 | 44.10 |
| default-cache | vec0-binary | 256 | 1% | 1.000 | 9.02 | 9.89 |
| app-cache | sql-binary | 1024 | 100% | 1.000 | 55.98 | 58.99 |
| app-cache | sql-binary | 1024 | 10% | 1.000 | 12.79 | 13.90 |
| app-cache | sql-binary | 1024 | 1% | 1.000 | 6.73 | 8.05 |
| app-cache | sql-binary | 256 | 100% | 1.000 | 53.15 | 66.78 |
| app-cache | sql-binary | 256 | 10% | 1.000 | 7.51 | 8.53 |
| app-cache | sql-binary | 256 | 1% | 1.000 | 4.38 | 5.93 |
| app-cache | vec0-binary | 1024 | 100% | 1.000 | 186.10 | 189.58 |
| app-cache | vec0-binary | 1024 | 10% | 1.000 | 43.17 | 50.82 |
| app-cache | vec0-binary | 1024 | 1% | 1.000 | 12.97 | 13.93 |
| app-cache | vec0-binary | 256 | 100% | 1.000 | 28.68 | 29.72 |
| app-cache | vec0-binary | 256 | 10% | 1.000 | 39.96 | 42.92 |
| app-cache | vec0-binary | 256 | 1% | 1.000 | 10.43 | 11.33 |

Ordinary SQL is substantially cheaper for selective filters here; vec0 is cheaper for broad 256-candidate retrieval. At K=1,024, vec0 remains expensive under matched application cache and private storage. The [pinned upstream minimum-selection loop](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L5582) rescans a chunk for each selected result, with selection work O(chunk_size × min(K, chunk_size)); the [KNN caller](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L6545) applies it per chunk. That is consistent with K-sensitive costs, but no profiler establishes its exact share of measured runtime.

Integration direction: retain the already-pinned scalar extension and ordinary derived binary codes as the first SQL candidate slice, with native eligibility/top-N/reranking, owner aggregation and exact fallback. This avoids adding a second generation-private virtual-table lifecycle solely for this slice. It is not final broad-search acceptance: broad responsiveness still requires a measured execution/ANN solution. Do not present a selective pass or the 200 ms diagnostic query limit as satisfying the 16 ms heartbeat.

Integrate and test canonical-byte preservation, primary/derived ownership, raw restore/rebuild/audit, model/hash/generation freshness, all owner chunks, deterministic ties, arbitrary candidate IDs/trash/exclusion, large K, units/savepoints/watches and numeric extremes. Re-measure through actual EARS because these primitive tables do not reproduce its joins, chunk counts, layout or transaction delivery. Preserve synchronous contracts unless an explicit architecture decision changes them.

No new native dependency, app speedup, cold-storage guarantee, overall relevance/recall qualification or adoption is claimed. All original goal phases and failed gates remain required.
