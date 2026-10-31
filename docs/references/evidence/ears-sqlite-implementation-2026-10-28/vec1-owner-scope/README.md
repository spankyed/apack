# Vec1 graph-sized owner filter prerequisite, 2026-10-29

Source `d721453f01`, upstream/model hashes in raw receipt. Two CPUs, 6 GiB, no swap, dropped capabilities and actual mode-denial. FULL WAL, 64 MiB page cache, private ordinary container database. Same 99,900 real 1536D vectors and frozen 32-probe/64-bucket model as the probe diagnostic. No production dependency changed.

Ten previously observed queries per scope compare metadata range predicates against logically equivalent SQL owner-IN predicates. Owners are UUID-shaped text, with native indexed SQL constructing eligibility. All 256 candidate rows and exact distances match, not just the final top ten. IN runs after the warmer range control, so this is diagnostic, not independent attribution or acceptance.

| Scope | Eligible owners | Range p95 ms | Owner-IN p95 ms |
|---|---|---|---|
| 100% | 98870 | 10.67 | unfiltered control |
| 10% | 9889 | 14.11 | 2692.989769 |
| 1% | 988 | 11.86 | 283.47350000000006 |

Large arbitrary owner scopes are unsuitable through this vec1 path: range-filter timings do not predict graph-query performance. Upstream `vec1FilterArraySize`/`vec1FilterMethod` expand IN operands, and `vec1MetaValueFilter` loops over them per generic metadata value; SIMD numeric IN also loops its operands. This supports a multiplicative-cost hypothesis, not profiler attribution. Native owner filtering before K remains mandatory.

No integrated EARS, complete recall, freshness, admission, platform or adoption claim follows. The existing full goal remains active. Before owning an extension fork, test bounded candidate-selection settings in the existing stable sqlite-vec dependency; preserve the original measurements and budgets.

See [the earlier probe diagnostic](../vec1-ivf-probes/README.md) and [compatibility gate](../vec1-compat/README.md). The source benchmark records plans, all samples and native hashes. Model/corpus bytes stay private and outside Git.
