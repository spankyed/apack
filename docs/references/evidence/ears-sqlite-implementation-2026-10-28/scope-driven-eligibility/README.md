# Scope-driven eligibility diagnostic — 2026-10-30

Source `17f14da2e1c4b1925d617d0b1525be9bc087feac`, with the new compact-IN library from `63c8267994`.
This private query wrapper compares the existing bounded eligibility page against a scope-first join.
The alternative preserves scope SQL/parameters, excludes duplicates with DISTINCT including physical chunk
row identity, and keeps the 4097-row exact/ANN routing threshold. No production SQL changes.

The actual EARS query path produces identical ordered answers/scores for 900 paired production controls,
50 additional paired controls (duplicate IDs, prior limit, zero limit, prior order/limit and empty IDs),
and all 3600 measured pairs across nine updated-only cohorts and four passes: 7200 measured executions.
All 99,900 canonical vectors verify against the corpus and the retained read-only snapshot checksum stays
unchanged. Existing model, ANN settings, original quality/response gates and default durability policy remain.
Both shapes fail the frozen gates, including timed-only responsiveness. Minimum cohort mean recall remains
0.974. This is not complete initial/update, multi-chunk/unit or app acceptance for the alternative.

Observed medians in milliseconds, pooling the three timed passes (pass zero retained separately):

| Corpus rows | Eligible scope | Existing SQL | Scope-first SQL |
| --- | --- | --- | --- |
| 1,000 | 100% | 7.27 | 7.44 |
| 1,000 | 10% | 8.45 | 8.64 |
| 1,000 | 1% | 2.63 | 2.37 |
| 10,000 | 100% | 40.33 | 37.52 |
| 10,000 | 10% | 15.53 | 14.73 |
| 10,000 | 1% | 3.28 | 2.89 |
| 99,900 | 100% | 19.34 | 18.84 |
| 99,900 | 10% | 49.81 | 44.71 |
| 99,900 | 1% | 12.26 | 11.81 |

The container has two CPUs, 6 GiB RAM and no swap. No protective pauses occurred. Baseline runs first and
both shapes share one Node process/cache, so these observations are not a randomized causal speedup or
independent per-variant peak-memory measurement. Query plans and every sample remain in the original report.
The alternative adds DISTINCT/join complexity while both versions still miss responsiveness; it is **not
promoted** from this diagnostic. Native candidate work and durable admission COMMIT remain separate costs.
No model/corpus/database or native binary payload is committed. The full goal stays active.
