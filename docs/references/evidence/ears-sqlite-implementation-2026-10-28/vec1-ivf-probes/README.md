# Exploratory IVF probe comparison, 2026-10-29

Runtime benchmark source `4badec03bf998cabd8264a63028454f1918a3f0a`. No production dependency or runtime changed.

Both invocations completed on the same hashed 64-bucket model, K=256, app-matched 64 MiB cache and private ordinary container filesystem. Two CPUs, 6 GiB RAM, no swap, capabilities dropped, actual mode-denial preflight. The first UID prerequisite failed to traverse the root-owned immutable seed; it is retained separately. The corrected run uses that volume owner with capabilities still dropped.

| Probes | Phase | Scope | Mean recall | Query p95 ms | Heartbeat p99 ms |
|---|---|---|---|---|---|
| 32 | initial | 100% | 0.984 | 9.52 | 10.49 |
| 32 | initial | 10% | 0.980 | 9.17 | 10.55 |
| 32 | initial | 1% | 0.947 | 9.21 | 10.13 |
| 32 | updated | 100% | 0.986 | 9.97 | 10.84 |
| 32 | updated | 10% | 0.976 | 10.73 | 11.95 |
| 32 | updated | 1% | 0.947 | 10.36 | 11.42 |
| 64 | initial | 100% | 0.987 | 17.08 | 18.35 |
| 64 | initial | 10% | 0.994 | 16.51 | 17.37 |
| 64 | initial | 1% | 0.999 | 16.55 | 17.56 |
| 64 | updated | 100% | 0.988 | 17.47 | 21.76 |
| 64 | updated | 10% | 0.991 | 16.73 | 21.84 |
| 64 | updated | 1% | 0.999 | 16.60 | 17.55 |

32 probes meet the sampled broad/10% recall and heartbeat budgets, but fail 1% recall. 64 probes improve recall but miss the 16 ms heartbeat budget. Neither configuration passes the complete matrix. The existing EARS exact fallback for small eligible sets is a possible integration policy, not measured by these native-only runs.

These queries have already informed strategy selection. Results are exploratory; fresh, separately frozen queries are required before acceptance. No generalization, integrated EARS, multi-chunk, arbitrary owner-scope, admission/update responsiveness, app or platform qualification follows. Existing IVF/full-scan and integrated-path failures remain retained.

Next prerequisite: qualify arbitrary SQL owner scopes. The current vec1 source expands metadata IN into comparisons (`vec1MetaValueFilter` and SIMD IN loops), so large owner lists may multiply metadata scan cost. The constant scope/active range predicates used here do not prove that the actual EARS where/traversal scopes remain fast. Measure this before choosing the extension or integrating an ANN path. Preserve filter-before-K and the synchronous public API.

Upstream source and hashes are pinned in [the compatibility gate](../vec1-compat/README.md); protocol is [REAL-VECTOR-PROTOCOL.md](../../../../../packages/apack-ears/bench/sqlite/REAL-VECTOR-PROTOCOL.md). Raw reports contain every query, rank and heartbeat sample. Model bytes and private corpus remain outside Git.
